import { getSql, json, handleOptions } from './db.js';

/* -------------------- helpers (kept) -------------------- */
function lowerHeader(headers, name) {
  if (!headers) return undefined;
  const k = Object.keys(headers).find(h => h.toLowerCase() === name.toLowerCase());
  return k ? headers[k] : undefined;
}
function parseBody(event) {
  try {
    let raw = event.body || '';
    if (event.isBase64Encoded && raw) raw = Buffer.from(raw, 'base64').toString('utf8');
    const ct = (lowerHeader(event.headers, 'content-type') || '').toLowerCase();
    if (ct.includes('application/json')) return raw ? JSON.parse(raw) : {};
    if (ct.includes('application/x-www-form-urlencoded')) {
      const o = {};
      new URLSearchParams(raw).forEach((v, k) => (o[k] = v));
      for (const k of Object.keys(o)) {
        if (typeof o[k] === 'string' && o[k].trim().startsWith('{')) {
          try { o[k] = JSON.parse(o[k]); } catch {}
        }
      }
      return o;
    }
    if (raw) { try { return JSON.parse(raw); } catch {} }
    return {};
  } catch { return {}; }
}

/* -------------------- handler (kept + enhanced) -------------------- */
export default async (event) => {
  const method = event?.httpMethod || 'GET';
  if (method === 'OPTIONS' || method === 'HEAD') return handleOptions();

  // Keep your GET shim for testing
  if (method === 'GET') {
    const qs = event.queryStringParameters || {};
    if (qs && (qs.po_number || qs.id) && (qs.status || qs.decision || qs.outcome || qs.comment)) {
      event.body = JSON.stringify({
        id: qs.id,
        po_number: qs.po_number,
        status: qs.status || qs.decision || qs.outcome || null,
        comment: qs.comment || null,
        actor: qs.actor || lowerHeader(event.headers, 'x-user-email') || 'manual'
      });
      if (!event.headers) event.headers = {};
      event.headers['content-type'] = 'application/json'; // (kept fix)
      event.httpMethod = 'POST';
    } else if ((qs.page || qs.pageSize || qs.list) != null) {
      // This is the actual list fetch — continue
    } else {
      return json({ error: 'Use POST with JSON. For GET testing, provide ?po_number= or ?id= and ?status=/decision/outcome or ?comment=' }, 400);
    }
  }

  if ((event?.httpMethod || 'POST') === 'POST' && !event.queryStringParameters?.pageSize) {
    // This branch is your status update POST (kept behavior)
    try {
      const sql = getSql();
      const body = parseBody(event);
      let { id, po_number } = body;
      let status = body.status || body.decision || body.outcome || null;
      const comment = body.comment ?? lowerHeader(event.headers, 'x-comment') ?? null;

      const actor =
        body.actor ||
        body.user?.name ||
        lowerHeader(event.headers, 'x-user-email') ||
        lowerHeader(event.headers, 'x-ms-client-principal-name') ||
        'flow';

      if (!id && po_number) {
        const r = await sql`SELECT id FROM purchase_orders WHERE po_number = ${po_number} LIMIT 1`;
        if (!r?.length) return json({ error: `PO not found for po_number ${po_number}` }, 404);
        id = r[0].id;
      }
      if (!id && !po_number) return json({ error: 'Provide "id" or "po_number"' }, 400);
      if (!status) {
        const cur = await sql`SELECT status FROM purchase_orders WHERE id = ${id}`;
        status = cur?.[0]?.status || 'Submitted';
      }

      await sql`UPDATE purchase_orders SET status = ${status} WHERE id = ${id}`;
      await sql`
        INSERT INTO po_approvals (po_id, actor, decision, comment, decided_at)
        VALUES (${id}, ${actor}, ${status}, ${comment}, NOW())
      `;
      return json({ ok: true });
    } catch (err) {
      console.error('[po-update-status] error:', err);
      return json({ error: err.message || String(err) }, 500);
    }
  }

  // GET list (enhanced with paid_total/remaining)
  try {
    const sql = getSql();
    const params = event?.queryStringParameters || {};
    const page = Math.max(1, parseInt(params.page || '1', 10));
    const pageSize = Math.max(1, Math.min(500, parseInt(params.pageSize || '500', 10)));
    const offset = (page - 1) * pageSize;

    const rows = await sql`
      WITH paid AS (
        SELECT po_id, COALESCE(SUM(amount),0)::numeric(12,2) AS paid_total
        FROM po_payments GROUP BY po_id
      )
      SELECT
        po.id,
        po.created_at,
        po.created_by,
        po.department,
        po.vendor_name,
        po.subtotal,
        po.tax,
        po.total,
        po.status,
        po.paid_at,
        (po.status || CASE WHEN po.paid_at IS NOT NULL THEN ' (Paid)' ELSE '' END) AS status_label,
        po.po_number,
        po.meta,
        COALESCE(p.paid_total,0)::numeric(12,2) AS paid_total,
        GREATEST(po.total - COALESCE(p.paid_total,0), 0)::numeric(12,2) AS remaining,
        COUNT(poi.id)::int AS line_items
      FROM purchase_orders po
      LEFT JOIN purchase_order_items poi ON po.id = poi.po_id
      LEFT JOIN paid p ON p.po_id = po.id
      GROUP BY po.id, p.paid_total
      ORDER BY po.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `;

    const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM purchase_orders`;
    return json({ ok: true, page, pageSize, count, rows });
  } catch (err) {
    console.error(err);
    return json({ error: err.message || String(err) }, 500);
  }
};

// netlify/functions/po-mark-paid.js
import { getSql, json, handleOptions } from './db.js';
import { getMethod, readJson, header } from './helpers.js';

const clean = v => {
  const s = (v || "").toString().trim();
  return s && !/^undefined(?:\s+undefined)?$/i.test(s) ? s : "";
};

export default async (event) => {
  const method = getMethod(event);
  if (method === 'OPTIONS' || method === 'HEAD') return handleOptions();
  if (method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await readJson(event);
    const { id } = body || {};
    if (!id) return json({ error: 'Purchase Order ID is required' }, 400);

    const sql = getSql();

    const rows = await sql(
      `UPDATE purchase_orders
         SET paid_at = NOW()
       WHERE id = $1 AND paid_at IS NULL
       RETURNING id, status, paid_at`,
      [id]
    );
    if (!Array.isArray(rows) || rows.length === 0) {
      return json({ error: 'PO not found or already paid' }, 404);
    }

    // Prefer headers (most reliable in prod), then body
    const actor =
      clean(header(event, 'x-user-name')) ||
      clean(header(event, 'x-user-email')) ||
      clean(header(event, 'x-ms-client-principal-name')) ||
      clean(body?.user?.name) ||
      clean(body?.user?.email) ||
      "System";

    // Audit insert
    const colsRows = await sql(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'po_approvals'`
    );
    const colSet = new Set((colsRows || []).map(c => (c.column_name || '').toLowerCase()));
    const actorCol =
      (colSet.has('actor') && 'actor') ||
      (colSet.has('decided_by') && 'decided_by') ||
      (colSet.has('by') && '"by"') ||
      (colSet.has('user_name') && 'user_name') ||
      (colSet.has('user') && 'user') ||
      null;
    const hasDecidedAt = colSet.has('decided_at');

    const cols = ['po_id', 'decision', 'comment'];
    const vals = [id, 'Marked as Paid', `PO marked as paid by ${actor}`];
    if (hasDecidedAt) { cols.push('decided_at'); vals.push({ __now: true }); }
    if (actorCol) { cols.push(actorCol); vals.push(actor); }

    let p = 1;
    const placeholders = vals.map(v => (v && v.__now ? 'NOW()' : `$${p++}`));
    const sqlText = `INSERT INTO po_approvals (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;
    const params = vals.filter(v => !(v && v.__now));
    await sql(sqlText, params);

    return json({ ok: true, po: rows[0] });
  } catch (err) {
    console.error('[po-mark-paid] error:', err);
    return json({ error: err?.message || 'Internal Server Error' }, 500);
  }
};

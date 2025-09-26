// netlify/functions/po-get.js
import { getSql, json, handleOptions } from './db.js';

export default async (event, context) => {
  const method = event?.httpMethod || event?.request?.method || 'GET';
  if (method === 'OPTIONS' || method === 'HEAD') return handleOptions();
  if (method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  try {
    const urlStr =
      event?.rawUrl || event?.url || event?.request?.url || event?.path || '';
    if (!urlStr) return json({ error: 'Missing path' }, 400);

    const u = new URL(urlStr, 'http://localhost');
    let id = u.searchParams.get('id');
    if (!id) {
      const parts = u.pathname.split('/').filter(Boolean);
      id = parts.length ? parts[parts.length - 1] : null;
    }

    if (!id || !/^[0-9a-fA-F\-]{36}$/.test(id)) {
      return json({ error: 'Invalid or missing id', id }, 400);
    }

    const sql = getSql();

    const [po] = await sql(
      `SELECT
         po.*,
         (po.status || CASE WHEN po.paid_at IS NOT NULL THEN ' (Paid)' ELSE '' END) AS status_label
       FROM purchase_orders po
       WHERE po.id = $1`,
      [id]
    );
    if (!po) return json({ error: 'Not found' }, 404);

    const items = await sql(
      `SELECT * FROM purchase_order_items WHERE po_id = $1 ORDER BY line_no`,
      [id]
    );
    const approvals = await sql(
      `SELECT * FROM po_approvals WHERE po_id = $1 ORDER BY decided_at DESC`,
      [id]
    );

    // ⬇️ Include paid_by so the UI can show who recorded the payment
    const payments = await sql(
      `SELECT id,
              amount::numeric(12,2) AS amount,
              method,
              note,
              paid_at,
              COALESCE(paid_by, '') AS paid_by
         FROM po_payments
        WHERE po_id = $1
     ORDER BY paid_at ASC, id ASC`,
      [id]
    );

    // Server-side totals for accuracy & speed
    const [agg] = await sql(
      `SELECT COALESCE(SUM(amount),0)::numeric(12,2) AS paid_total
         FROM po_payments WHERE po_id = $1`,
      [id]
    );
    const paidTotal = Number(agg?.paid_total || 0);
    const total = Number(po.total || 0);
    const remaining = +(total - paidTotal).toFixed(2);

    return json({
      ok: true,
      po,
      items,
      approvals,
      payments,
      paymentSummary: { total, paidTotal, remaining: Math.max(0, remaining) }
    });
  } catch (err) {
    console.error(err);
    return json({ error: err.message || String(err) }, 500);
  }
};

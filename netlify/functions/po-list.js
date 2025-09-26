import { getSql, json, handleOptions } from './db.js';

export default async (event) => {
  const method = event?.httpMethod || event?.request?.method || 'GET';
  if (method === 'OPTIONS' || method === 'HEAD') return handleOptions();
  if (method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  try {
    const sql = getSql();
    const params = event?.queryStringParameters || {};

    const page = Math.max(1, parseInt(params.page || '1', 10));
    const pageSize = Math.max(1, Math.min(500, parseInt(params.pageSize || '500', 10)));
    const offset = (page - 1) * pageSize;

    // Return paid_at + derived status_label so UI doesn't have to guess
    const rows = await sql`
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
        COUNT(poi.id)::int AS line_items
      FROM purchase_orders po
      LEFT JOIN purchase_order_items poi ON po.id = poi.po_id
      GROUP BY po.id
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

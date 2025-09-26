import { getSql, json, handleOptions } from './db.js';
import { getMethod, readJson } from './helpers.js';

export default async (event, context) => {
  const method = getMethod(event);
  if (method === 'OPTIONS' || method === 'HEAD') return handleOptions();
  if (method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { id, vendor } = await readJson(event);
    if (!id || !vendor) return json({ error: 'Missing id or vendor' }, 400);

    const sql = getSql();
    await sql(
      `UPDATE purchase_orders
         SET vendor_id = $2,
             vendor_name = $3,
             vendor_address1 = $4,
             vendor_city = $5,
             vendor_state = $6,
             vendor_zip = $7
       WHERE id = $1`,
      [id, vendor.id || null, vendor.name || null, vendor.address1 || null, vendor.city || null, vendor.state || null, vendor.zip || null]
    );

    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ error: err.message || String(err) }, 500);
  }
};
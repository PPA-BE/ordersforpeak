import { getSql, json, handleOptions } from './db.js';
import { getMethod, readJson } from './helpers.js';

export default async (event) => {
  const method = getMethod(event);
  if (method === 'OPTIONS' || method === 'HEAD') return handleOptions();
  if (method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await readJson(event);
    // Get the ID from the request BODY instead of the URL
    const id = body.id;
    const status = body.status;

    if (!id) {
      return json({ error: 'Missing "id" in request body' }, 400);
    }
    if (!status) {
      return json({ error: 'Missing "status" in request body' }, 400);
    }

    const sql = getSql();
    await sql('UPDATE purchase_orders SET status = $1 WHERE id = $2', [status, id]);

    if (body.actor || body.comment) {
      await sql(
        'INSERT INTO po_approvals (po_id, actor, decision, comment) VALUES ($1, $2, $3, $4)',
        [id, body.actor || 'system', status, body.comment || null]
      );
    }

    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ error: err.message || String(err) }, 500);
  }
};
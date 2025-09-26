// netlify/functions/po-set-epicor.js
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
    const { id, epicorPoNumber } = body || {};
    if (!id) return json({ error: 'Missing PO database ID' }, 400);

    const sql = getSql();
    let result;

    if (epicorPoNumber) {
      const epicorUpdate = { epicorPoNumber };
      [result] = await sql`
        UPDATE purchase_orders
           SET meta = meta || ${JSON.stringify(epicorUpdate)}::jsonb
         WHERE id = ${id}
       RETURNING id, meta
      `;
    } else {
      [result] = await sql`
        UPDATE purchase_orders
           SET meta = meta - 'epicorPoNumber'
         WHERE id = ${id}
       RETURNING id, meta
      `;
    }
    if (!result) return json({ error: 'PO not found or update failed' }, 404);

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

    const decision = epicorPoNumber ? 'Epicor Assigned' : 'Epicor Unassigned';
    const comment = epicorPoNumber
      ? `Assigned Epicor PO ${epicorPoNumber} by ${actor}`
      : `Removed Epicor PO assignment by ${actor}`;

    const cols = ['po_id', 'decision', 'comment'];
    const vals = [id, decision, comment];
    if (hasDecidedAt) { cols.push('decided_at'); vals.push({ __now: true }); }
    if (actorCol) { cols.push(actorCol); vals.push(actor); }

    let p = 1;
    const placeholders = vals.map(v => (v && v.__now ? 'NOW()' : `$${p++}`));
    const sqlText = `INSERT INTO po_approvals (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;
    const params = vals.filter(v => !(v && v.__now));
    await sql(sqlText, params);

    return json({ ok: true, updated: result });
  } catch (err) {
    console.error('[po-set-epicor] error:', err);
    return json({ error: err.message || String(err) }, 500);
  }
};

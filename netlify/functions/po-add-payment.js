// netlify/functions/po-add-payment.js
// Adds a partial payment row, returns recalculated totals, and sets paid_at when fully paid.

import { getSql, json, handleOptions } from './db.js';
import { getMethod, readJson, header } from './helpers.js';

// Robust numeric parser (keeps your helpers usage style)
function parseNumber(n, fallback = NaN) {
  if (typeof n === "number") return n;
  if (typeof n === "string") {
    const v = Number(n.replace(/[, ]+/g, ''));
    return Number.isFinite(v) ? v : fallback;
  }
  return fallback;
}

export default async (event) => {
  const method = getMethod(event);
  if (method === 'OPTIONS' || method === 'HEAD') return handleOptions();
  if (method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const sql = getSql();
    const body = await readJson(event);

    const id = String(body?.id || '').trim();
    const amount = parseNumber(body?.amount, NaN);
    const methodTxt = (body?.method ?? '').toString().trim() || null;
    const noteTxt = (body?.note ?? '').toString().trim() || null;
    if (!id) return json({ error: 'Purchase Order ID is required' }, 400);
    if (!Number.isFinite(amount) || amount <= 0) return json({ error: 'Amount must be a positive number' }, 400);

    // Load PO
    const [po] = await sql`SELECT id, total::numeric(12,2) AS total FROM purchase_orders WHERE id = ${id} LIMIT 1`;
    if (!po) return json({ error: 'PO not found' }, 404);

    // Current paid
    const [agg] = await sql`SELECT COALESCE(SUM(amount),0)::numeric(12,2) AS paid_total FROM po_payments WHERE po_id = ${id}`;
    const paidSoFar = Number(agg?.paid_total || 0);
    const remaining = +(Number(po.total) - paidSoFar).toFixed(2);
    if (amount > remaining) return json({ error: `Payment exceeds remaining. Remaining: ${remaining}` }, 400);

    // Who is paying (from headers if available)
    const actor =
      header(event, 'x-user-name') ||
      header(event, 'x-user-email') ||
      header(event, 'x-ms-client-principal-name') ||
      body?.user?.name ||
      body?.user?.email ||
      'System';

    // Detect schema (to support environments with/without paid_by column)
    let hasPaidBy = false;
    try {
      const colsRows = await sql`
        SELECT column_name, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'po_payments'
      `;
      const colSet = new Set((colsRows || []).map(c => (c.column_name || '').toLowerCase()));
      hasPaidBy = colSet.has('paid_by');
    } catch { /* non-fatal */ }

    // Insert payment (include paid_by if present)
    if (hasPaidBy) {
      await sql`
        INSERT INTO po_payments (po_id, amount, method, note, paid_by)
        VALUES (${id}, ${amount}, ${methodTxt}, ${noteTxt}, ${actor})
      `;
    } else {
      await sql`
        INSERT INTO po_payments (po_id, amount, method, note)
        VALUES (${id}, ${amount}, ${methodTxt}, ${noteTxt})
      `;
    }

    // Recompute
    const [aggAfter] = await sql`SELECT COALESCE(SUM(amount),0)::numeric(12,2) AS paid_total FROM po_payments WHERE po_id = ${id}`;
    const paidTotal = Number(aggAfter?.paid_total || 0);
    const nowRemaining = +(Number(po.total) - paidTotal).toFixed(2);

    // If fully paid, set paid_at & try to log a note in po_approvals
    if (nowRemaining <= 0.000001) {
      await sql`UPDATE purchase_orders SET paid_at = COALESCE(paid_at, NOW()) WHERE id = ${id}`;

      // Best-effort flexible insert into po_approvals regardless of column naming
      try {
        const colsRows = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'po_approvals'`;
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
        const vals = [id, 'Marked as Paid (Auto)', `Fully paid by ${actor}`];
        if (hasDecidedAt) { cols.push('decided_at'); vals.push({ __now: true }); }
        if (actorCol)     { cols.push(actorCol);    vals.push(actor); }

        let p = 1;
        const placeholders = vals.map(v => (v && v.__now ? 'NOW()' : `$${p++}`));
        const sqlText = `INSERT INTO po_approvals (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`;
        const params = vals.filter(v => !(v && v.__now));
        await sql(sqlText, params);
      } catch { /* ignore */ }
    }

    return json({
      ok: true,
      summary: { total: Number(po.total), paidTotal, remaining: Math.max(0, nowRemaining) }
    });
  } catch (err) {
    console.error('[po-add-payment] error:', err);
    return json({ error: err?.message || 'Internal Server Error' }, 500);
  }
};

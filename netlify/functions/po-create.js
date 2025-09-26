// netlify/functions/po-create.js
import { getSql, json, handleOptions } from './db.js';
import { getMethod, readJson, header, parseNumber } from './helpers.js';

export default async (event) => {
  const method = getMethod(event);
  if (method === 'OPTIONS' || method === 'HEAD') return handleOptions();
  if (method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const sql = getSql();
    const body = await readJson(event);

    // --- DEBUG MODE ---
    if (!body || Object.keys(body).length === 0) {
      return json({
        error: "The request body was empty or could not be parsed.",
        tip: "This is the most likely cause of the 'zero values' issue."
      }, 400);
    }

    // --- PARSE INCOMING DATA ---
    const v = body.vendor || {};
    const subtotal = parseNumber(body.subTotal, 0);
    const tax = parseNumber(body.taxAmount, 0);
    const total = parseNumber(body.grandTotal, subtotal + tax);

    // --- PREPARE Main PO Insert ---
    const poData = {
      po_number: body.poId || body.po_number || null,
      created_by: body.createdBy || body.user?.name || null,
      department: body.department || null,
      vendor_id: v.id || v.vendorId || null,
      vendor_name: v.name || null,
      vendor_address1: v.address1 || null,
      vendor_city: v.city || null,
      vendor_state: v.state || null,
      vendor_zip: v.zip || null,
      currency: body.currency || 'CAD',
      subtotal: subtotal,
      tax: tax,
      total: total,
      status: body.status || 'Submitted',
      meta: JSON.stringify({
        submittedAt: body.submittedAt || new Date().toISOString(),
        vendorReferenceNo: v.referenceNo || null,
        user: body.user || null
      })
    };

    // --- EXECUTE Main PO Insert ---
    const [po] = await sql(
      `INSERT INTO purchase_orders
         (po_number, created_by, department, vendor_id, vendor_name, vendor_address1, vendor_city, vendor_state, vendor_zip, currency, subtotal, tax, total, status, meta)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      Object.values(poData)
    );
    const poId = po.id;
    if (!poId) throw new Error("Failed to create PO, did not get an ID back.");

    // --- PREPARE Line Items Insert (now with supplier_item + peak_part + UOM) ---
    const items = Array.isArray(body.items) ? body.items : [];
    const cleanItems = items
      .map((it, i) => ({
        line_no:       parseNumber(it.line, i + 1),
        supplier_item: (it.supplierItem ?? it.supplier_item ?? '').trim(),
        peak_part:     (it.peakPart     ?? it.peak_part     ?? '').trim(),
        description:   (it.description  ?? '').trim(),
        qty:           parseNumber(it.qty, 0),
        uom:           (it.uom ?? '').trim(),
        unit_price:    parseNumber(it.unitPrice, 0)
      }))
      .filter(x =>
        x.description || x.qty > 0 || x.unit_price > 0 || x.supplier_item || x.peak_part
      );

    if (cleanItems.length > 0) {
      const itemParams = [];
      const valueStrings = [];
      let p = 1;

      for (const it of cleanItems) {
        // ($po_id, $line_no, $supplier_item, $peak_part, $description, $qty, $uom, $unit_price)
        valueStrings.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
        itemParams.push(
          poId,
          it.line_no,
          it.supplier_item,
          it.peak_part,
          it.description,
          it.qty,
          it.uom,
          it.unit_price
        );
      }

      const itemQuery = `
        INSERT INTO purchase_order_items
          (po_id, line_no, supplier_item, peak_part, description, qty, uom, unit_price)
        VALUES
          ${valueStrings.join(',')}
      `;
      await sql(itemQuery, itemParams);
    }

    return json({ ok: true, id: poId, po_number: poData.po_number });
  } catch (err) {
    console.error(err);
    return json({ error: err.message || String(err), stack: err.stack }, 500);
  }
};

// src/epicor.js
// Endpoint + auth you already use elsewhere; keep here for read-only BAQ pulls
const EPICOR_BASE = "https://cadcentraldtpilot00.epicorsaas.com/SaaS508Pilot/api/v1/BaqSvc";
const EPICOR_COMPANY = "157173";
const EPICOR_USER = "belhamaida";
const EPICOR_PASS = "Salmia12!";

// BAQ returning receipt lines for a given PO
// Example you tested: RcvItemsRequestionList?Company='157173'&PONum='1456'
function buildReceiptUrl(poNumber) {
  const encCo = encodeURIComponent(`'${EPICOR_COMPANY}'`);
  const encPo = encodeURIComponent(`'${poNumber}'`);
  return `${EPICOR_BASE}/RcvItemsRequestionList?Company=${encCo}&PONum=${encPo}`;
}

export async function fetchEpicorReceiptDetails(poNumber) {
  if (!poNumber) throw new Error("Missing Epicor PO #");
  const url = buildReceiptUrl(poNumber);
  const auth = btoa(`${EPICOR_USER}:${EPICOR_PASS}`);
  const r = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "Authorization": "Basic " + auth
    }
  });
  if (!r.ok) {
    const t = await r.text().catch(()=> "");
    throw new Error(`Epicor ${r.status}: ${t.slice(0,200)}`);
  }
  const data = await r.json();
  const rowsRaw = Array.isArray(data?.value) ? data.value : [];

  // IMPORTANT: map *RcvDtl_Received* (your screenshot) to boolean
  const rows = rowsRaw.map(v => ({
    partNum:         v?.RcvDtl_PartNum ?? "",
    partDescription: v?.RcvDtl_PartDescription ?? "",
    qty:             v?.RcvDtl_OurQty ?? 0,
    uom:             v?.RcvDtl_IUM ?? "",
    receiptDate:     v?.RcvDtl_ReceiptDate ?? "",
    wh:              v?.RcvDtl_WareHouseCode ?? "",
    bin:             v?.RcvDtl_BinNum ?? "",
    // "true"/true → true, everything else → false
    received:        (v?.RcvDtl_Received === true) || (String(v?.RcvDtl_Received ?? "").toLowerCase() === "true")
  }));

  return { poNumber, rows };
}

// Overall status from line receipts
// all true   -> "Received" (as you requested)
// some true  -> "Approved - Partial Receipt"
// none true  -> "Approved - Pending Receipt"
export function computeEpicorReceiptStatus(detail) {
  if (!detail || !Array.isArray(detail.rows) || detail.rows.length === 0) {
    return "Approved - Pending Receipt";
  }
  const total = detail.rows.length;
  const received = detail.rows.filter(r => r.received === true).length;
  if (received === 0) return "Approved - Pending Receipt";
  if (received === total) return "Received";
  return "Approved - Partial Receipt";
}

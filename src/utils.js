export const CURRENCY = "CAD";
export const TAX_RATE = 0.13;
export const money = (n) => (isNaN(n) ? "$0.00" : Number(n).toLocaleString(undefined, { style: "currency", currency: CURRENCY }));
export const parseNum = (v) => { if (typeof v === "number") return v; if (!v) return 0; return parseFloat(String(v).replace(/[^0-9.-]/g, "")) || 0; };
export const nowIso = () => new Date().toISOString();
export const daysAgo = (d) => { const dt = new Date(); dt.setDate(dt.getDate() - d); return dt; };
export const formatDate = (iso) => new Date(iso).toLocaleString();
export const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
export function escapeHtml(s=""){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m])); }

// Final statuses used by the poller to stop checking SharePoint
const FINAL = new Set(["Approved","Rejected","Failed","Received"]);
export const FINAL_STATUSES = FINAL;

// Normalization keeps your workflow strings intact
export function normalizeStatus(s){
  const t = String(s||"").trim().toLowerCase();
  if (t === "approve" || t === "approved") return "Approved";
  if (t === "reject"  || t === "rejected") return "Rejected";
  if (t === "fail"    || t === "failed" || t === "error") return "Failed";
  if (["submitted","pending","running","in progress","inprogress"].includes(t)) return "Submitted";
  // Preserve your custom workflow labels exactly:
  if (s === "Manager Approved - Pending Buyer / Finance") return s;
  if (s === "Fully Approved - Pending PO #") return s;
  if (s === "Approved - Pending Receipt") return s;
  if (s === "Approved - Partial Receipt") return s;
  if (s === "Approved - Full Receipt") return s;
  if (s === "Received") return s;
  return s || "Submitted";
}

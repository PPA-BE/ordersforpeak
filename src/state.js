import { todayStr } from "./utils.js";

const STORAGE_ROWS = "po-mock-rows-v1";
const STORAGE_SUBMISSIONS = "po-mock-submissions-v1";
const STORAGE_META = "po-mock-meta-v1";

let rows = [];
let submissions = [];
let meta = {
  vendorId:"", vendorName: "", vendorRefNo: "",
  vendorAddr1:"", vendorCity:"", vendorState:"", vendorZip:"",
  peakHst: "HST 709184311 RT0001", poDate: todayStr()
};

// --- Shared money/date/UOM helpers (exported so UI modules can import) ---
export const CURRENCY = "CAD";
export const TAX_RATE = 0.13;

export const money = (n) =>
  (isNaN(n) ? "$0.00" : Number(n).toLocaleString(undefined, { style: "currency", currency: CURRENCY }));

export const parseNum = (v) => {
  if (typeof v === "number") return v;
  if (!v) return 0;
  return parseFloat(String(v).replace(/[^0-9.-]/g, "")) || 0;
};

export function newRow(data={}){
  return {
    supplierItem: data.supplierItem || "",
    peakPart:     data.peakPart     || "",
    description:  data.description  || "",
    qty:          Number(data.qty)  || 0,
    uom:          data.uom          || "",   // NEW
    unitPrice:    Number(data.unitPrice) || 0
  };
}
export function setRowsFromItems(items=[]){ rows = items.map(newRow); persistRows(); }
export function getRows(){ return rows; }
export function setRows(r){ rows = r; persistRows(); }
export function addRow(){ rows.push(newRow()); persistRows(); }
export function removeRow(i){ rows.splice(i,1); persistRows(); }

export function getMeta(){ return meta; }
export function setMetaFromPayload(p){
  meta.vendorId = p.vendor?.id || "";
  meta.vendorName = p.vendor?.name || "";
  meta.vendorRefNo = p.vendor?.referenceNo || "";
  meta.vendorLicence = p.vendor?.cannabisLicenceNo || "";
  meta.vendorAddr1 = p.vendor?.address1 || "";
  meta.vendorCity  = p.vendor?.city || "";
  meta.vendorState = p.vendor?.state || "";
  meta.vendorZip   = p.vendor?.zip || "";
  meta.peakLicence = p.peak?.cannabisLicenceNo || "";
  meta.peakHst = p.peak?.hstNo || "HST 709184311 RT0001";
  meta.poDate = p.date || todayStr();
  persistMeta();
}
export function getSubmissions(){ return submissions; }
export function setSubmissions(s){ submissions = Array.isArray(s)? s:[]; persistSubmissions(); }
export function pushSubmission(s){ submissions.push(s); persistSubmissions(); }
export function updateSubmission(idx, patch){ submissions[idx] = { ...submissions[idx], ...patch }; persistSubmissions(); }

export function persistRows(){ localStorage.setItem(STORAGE_ROWS, JSON.stringify(rows)); }
export function loadRows(){ try{ const arr = JSON.parse(localStorage.getItem(STORAGE_ROWS)||"null"); if(Array.isArray(arr)){ rows = arr.map(newRow); return true; } }catch{} return false; }
export function persistSubmissions(){ localStorage.setItem(STORAGE_SUBMISSIONS, JSON.stringify(submissions)); }
export function loadSubmissions(){ try{ const arr = JSON.parse(localStorage.getItem(STORAGE_SUBMISSIONS)||"null"); submissions = Array.isArray(arr)? arr:[]; }catch{ submissions=[]; } }
export function persistMeta(){ localStorage.setItem(STORAGE_META, JSON.stringify(meta)); }
export function loadMeta(){ try{ const obj = JSON.parse(localStorage.getItem(STORAGE_META)||"null"); if (obj && typeof obj === "object") meta = { ...meta, ...obj }; }catch{} }
export function resetMeta(){ meta = { vendorId:"", vendorName:"", vendorRefNo:"", vendorAddr1:"", vendorCity:"", vendorState:"", vendorZip:"",
  peakHst:"HST 709184311 RT0001", poDate: todayStr() }; persistMeta(); }

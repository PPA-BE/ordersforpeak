// src/ui/cashflow.js
import { getGraphToken } from "../msal.js";
import { money, parseNum, escapeHtml, todayStr } from "../utils.js";
import { openModal, closeModal, renderStatusBadge } from "./modal.js";
import { buildHtmlPreview, exportExcelUsingTemplate } from "../excel.js";
import { markPoAsPaid } from "../api/poapi.js"; // kept (unused now) to avoid removing your code
import { toast } from "../vendors.js";
import { fetchEpicorReceiptDetails, computeEpicorReceiptStatus } from "../epicor.js";


// --- START: MODAL LOGIC AREA ---
const MANAGER_GROUP_ID = "98821b14-ae92-4010-9caa-c10f62a8ca9b";
let allPOData = [];
function localMarkPaid(id){ const now=new Date().toISOString(); allPOData=allPOData.map(r=> r.id===id? ({...r, paid_at: now, status: r.status||'Paid'}): r); return now; } // Cache for all POs to avoid re-fetching

async function checkUserGroupMembership() {
  window.isUserInManagerGroup = false; 
  try {
    const token = await getGraphToken();
    if (!token) return;
    const res = await fetch("https://graph.microsoft.com/v1.0/me/memberOf?$select=id", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`Graph API failed: ${res.status}`);
    const data = await res.json();
    const groupMemberships = data.value || [];
    if (groupMemberships.some(group => group.id === MANAGER_GROUP_ID)) {
      window.isUserInManagerGroup = true;
    }
  } catch (err) {
    console.error("Failed to check group membership:", err);
    window.isUserInManagerGroup = false;
  }
}

function renderCommentBadge(count) {
  const c = parseInt(count || 0, 10);
  if (!c) return "";
  return `<span class="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold align-middle" title="${c} update(s)">${c}</span>`;
}
// --- END: MODAL LOGIC AREA ---

// --- BEGIN: Payments section helper (top-level so the modal can use it) ---
function renderPaymentsSection(poDetail) {
  const payments = Array.isArray(poDetail?.payments) ? poDetail.payments : [];
  const paidTotal = Number(poDetail?.paymentSummary?.paidTotal || 0);
  const remaining = Number(
    poDetail?.paymentSummary?.remaining ??
    (Number(poDetail?.po?.total || 0) - paidTotal)
  );

  const rows = payments.map((p, i) => {
    const when = p.paid_at ? new Date(p.paid_at).toLocaleString() : "";
    const amt = (typeof money === "function")
      ? money(Number(p.amount || 0), "CA$")
      : `CA$${Number(p.amount || 0).toFixed(2)}`;
    const method = p.method ? escapeHtml(String(p.method)) : '<span class="text-slate-400">(n/a)</span>';
    const by = p.paid_by ? escapeHtml(String(p.paid_by)) : '<span class="text-slate-400">(unknown)</span>';
    const note = p.note ? escapeHtml(String(p.note)) : '<span class="text-slate-400">(no note)</span>';
    return `
      <tr>
        <td class="py-2 px-2 border border-slate-200 text-right text-slate-500">${i + 1}</td>
        <td class="py-2 px-2 border border-slate-200">${when}</td>
        <td class="py-2 px-2 border border-slate-200 text-right">${amt}</td>
        <td class="py-2 px-2 border border-slate-200">${method}</td>
        <td class="py-2 px-2 border border-slate-200">${by}</td>
        <td class="py-2 px-2 border border-slate-200">${note}</td>
      </tr>
    `;
  }).join("");

  return `
    <div class="mt-6">
      <div class="text-base font-semibold mb-2">Payments</div>
      <div class="overflow-x-auto">
        <table class="min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr class="bg-slate-50 text-xs text-slate-600 uppercase">
              <th class="py-2 px-2 border border-slate-200 text-right">#</th>
              <th class="py-2 px-2 border border-slate-200">When</th>
              <th class="py-2 px-2 border border-slate-200 text-right">Amount</th>
              <th class="py-2 px-2 border border-slate-200">Method</th>
              <th class="py-2 px-2 border border-slate-200">Paid By</th>
              <th class="py-2 px-2 border border-slate-200">Note</th>
            </tr>
          </thead>
          <tbody>
            ${payments.length ? rows : `<tr><td colspan="6" class="py-4 px-2 text-center text-slate-500 border border-slate-200">No payments recorded yet.</td></tr>`}
          </tbody>
          <tfoot>
            <tr class="bg-slate-50 font-semibold">
              <td class="py-2 px-2 border border-slate-200 text-right" colspan="2">Totals</td>
              <td class="py-2 px-2 border border-slate-200 text-right">${(typeof money==="function") ? money(paidTotal,"CA$") : `CA$${paidTotal.toFixed(2)}`}</td>
              <td class="py-2 px-2 border border-slate-200" colspan="3">Remaining: ${(typeof money==="function") ? money(remaining,"CA$") : `CA$${remaining.toFixed(2)}`}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `;
}
// --- END: Payments section helper ---

function fmtMoney(n){ return money(n||0, "CA$"); }
function monthName(i){ return new Date(2000,i,1).toLocaleString(undefined,{month:"short"}); }
function startOfMonth(y,m){ return new Date(y, m, 1); }
function endOfMonth(y,m){ return new Date(y, m+1, 0, 23,59,59,999); }

async function fetchPOs(){
  if (allPOData.length > 0) return allPOData;
  const res = await fetch("/.netlify/functions/po-list?pageSize=500");
  if (!res.ok) throw new Error("Failed to load POs: "+res.status);
  const { rows } = await res.json();
  allPOData = rows || [];
  return allPOData;
}

function unique(arr){ return [...new Set(arr)]; }
function groupBy(arr, keyFn){
  const m = new Map();
  for (const x of arr){ const k = keyFn(x); m.set(k, (m.get(k)||[]).concat([x])); }
  return m;
}
function sum(arr, sel){ let t=0; for (const x of arr) t += +sel(x)||0; return +t.toFixed(2); }

function buildFilterRanges(rows){
  const years = unique(rows.map(r => new Date(r.created_at).getFullYear())).sort();
  const now = new Date();
  const fallbackYear = now.getFullYear();
  const yearList = years.length ? years : [fallbackYear];
  return { yearList };
}

function applyTimeFilter(rows, { year, month, view }){
  if (!year) return rows;
  const y = parseInt(year, 10);
  if (!Number.isFinite(y)) return rows;
  if (month === null || !Number.isFinite(month)) {
    const s = new Date(y, 0, 1);
    const e = new Date(y, 11, 31, 23,59,59,999);
    return rows.filter(r => new Date(r.created_at) >= s && new Date(r.created_at) <= e);
  }
  if (view === "month"){
    const s = new Date(y, month, 1);
    const e = new Date(y, month+1, 0, 23,59,59,999);
    return rows.filter(r => new Date(r.created_at) >= s && new Date(r.created_at) <= e);
  } else {
    const s = new Date(y, 0, 1);
    const e = new Date(y, month+1, 0, 23,59,59,999);
    return rows.filter(r => new Date(r.created_at) >= s && new Date(r.created_at) <= e);
  }
}

function derive(allRows, filters){
  const baseFiltered = applyTimeFilter(allRows, filters);
  const deptFiltered = baseFiltered.filter(r => !filters.dept || (r.department||"") === filters.dept);
  const now = new Date();
  const yAnchor = Number.isFinite(parseInt(filters.year,10)) ? parseInt(filters.year,10) : now.getFullYear();
  const mAnchor = (typeof filters.month === "number") ? filters.month : now.getMonth();
  const monthStart = startOfMonth(yAnchor, mAnchor);
  const monthEnd   = endOfMonth(yAnchor, mAnchor);
  const isAllYears = !filters.year;
  const isAllMonths = (filters.month === null || !Number.isFinite(filters.month));
  let kpiPaid = 0;
  if (isAllYears && isAllMonths) { kpiPaid = sum(deptFiltered.filter(r => r.paid_at), r=>r.total); }
  else if (!isAllMonths) { const paidThisMonth = deptFiltered.filter(r => r.paid_at && (new Date(r.paid_at) >= monthStart) && (new Date(r.paid_at) <= monthEnd)); kpiPaid = sum(paidThisMonth, r=>r.total); }
  else { const s = new Date(yAnchor, 0, 1), e = new Date(yAnchor, 11, 31, 23,59,59,999); const paidInYear = deptFiltered.filter(r => r.paid_at && (new Date(r.paid_at) >= s) && (new Date(r.paid_at) <= e)); kpiPaid = sum(paidInYear, r=>r.total); }
  const approvedKeywords = ["manager approved","buyer","finance","approved"];
  const pipelineKeywords = ["submitted","pending","awaiting","rejected pending correction"];
  const committed = deptFiltered.filter(r => (!r.paid_at) && approvedKeywords.some(k => (r.status||"").toLowerCase().includes(k)));
  const kpiCommitted = sum(committed, r=>r.total);
  const pipeline = deptFiltered.filter(r => (!r.paid_at) && pipelineKeywords.some(k => (r.status||"").toLowerCase().includes(k)));
  const kpiPipeline = sum(pipeline, r=>r.total);
  const receivedNotInvoiced = allRows.filter(r => (r.status||"").toLowerCase() === "received" && !r.paid_at);
  const kpiRNI = sum(receivedNotInvoiced, r => r.total);
  let agingCutoff = monthEnd;
  if (isAllMonths && filters.year) agingCutoff = new Date(yAnchor, 11, 31, 23,59,59,999);
  if (isAllYears && isAllMonths) agingCutoff = now;
  const agingUniverse = allRows.filter(r => !r.paid_at && (new Date(r.created_at) <= agingCutoff));
  const over30 = agingUniverse.filter(r => ( (agingCutoff.getTime() - new Date(r.created_at).getTime())/(1000*60*60*24) ) > 30);
  const kpiAging = sum(over30, r=>r.total);
  const months = [];
  for (let i=11;i>=0;i--){ const d = new Date(yAnchor, mAnchor, 1); d.setMonth(d.getMonth()-i); months.push({ y: d.getFullYear(), m: d.getMonth() }); }
  const monthLabels = months.map(x => monthName(x.m)+" "+x.y);
  const monthlyPaid = months.map(({y:yy, m:mm})=>{ const s = startOfMonth(yy, mm), e = endOfMonth(yy, mm); const rows = allRows.filter(r => r.paid_at && (new Date(r.paid_at) >= s) && (new Date(r.paid_at) <= e)); return sum(rows, r=>r.total); });
  const byStatus = groupBy(deptFiltered, r => (r.paid_at ? "Paid" : (r.status_label || r.status || "Unknown")));
  const statusLabels = [...byStatus.keys()];
  const statusTotals = statusLabels.map(k => sum(byStatus.get(k), r=>r.total));
  const byDept = groupBy(baseFiltered, r => r.department || "No Department");
  const deptLabels = [...byDept.keys()];
  const deptTotals = deptLabels.map(k => sum(byDept.get(k), r => r.total));
  const byVendor = groupBy(deptFiltered, r=>r.vendor_name||"Unknown");
  const vendors = [...byVendor.keys()].map(name => ({ name, total: sum(byVendor.get(name), r=>r.total) })).sort((a,b)=>b.total-a.total).slice(0,10);
  const vendorLabels = vendors.map(v=>v.name);
  const vendorTotals = vendors.map(v=>v.total);
  function daysBetween(a,b){ return Math.floor((a.getTime()-b.getTime())/(1000*60*60*24)); }
  const agingBuckets = { "0-15":0, "16-30":0, "31-60":0, "61-90":0, "90+":0 };
  for (const r of agingUniverse){ const d = daysBetween(agingCutoff, new Date(r.created_at)); const t = r.total||0; if (d<=15) agingBuckets["0-15"]+=t; else if (d<=30) agingBuckets["16-30"]+=t; else if (d<=60) agingBuckets["31-60"]+=t; else if (d<=90) agingBuckets["61-90"]+=t; else agingBuckets["90+"]+=t; }
  const trailingPaid = monthlyPaid.slice(-3);
  const avg = trailingPaid.length ? trailingPaid.reduce((a,b)=>a+b,0)/trailingPaid.length : 0;
  const projLabels = []; const projValues = []; let pY = yAnchor, pM = mAnchor;
  for (let i=1;i<=3;i++){ pM += 1; if (pM>11){ pM=0; pY+=1; } projLabels.push(monthName(pM)+" "+pY); projValues.push(+avg.toFixed(2)); }
  return {
    filtered: deptFiltered, kpis: { kpiPaid, kpiCommitted, kpiPipeline, kpiAging, kpiRNI }, month: { labels: monthLabels, values: monthlyPaid }, status: { labels: statusLabels, values: statusTotals }, department: { labels: deptLabels, values: deptTotals }, vendors: { labels: vendorLabels, values: vendorTotals }, aging: { labels: Object.keys(agingBuckets), values: Object.values(agingBuckets) }, projection: { labels: projLabels, values: projValues }
  };
}

function writeKPIs(k){
  document.getElementById("kpiPaidMonth").textContent = fmtMoney(k.kpiPaid);
  document.getElementById("kpiCommitted").textContent = fmtMoney(k.kpiCommitted);
  document.getElementById("kpiPipeline").textContent = fmtMoney(k.kpiPipeline);
  document.getElementById("kpiAging").textContent = fmtMoney(k.kpiAging);
  document.getElementById("kpiRNI").textContent = fmtMoney(k.kpiRNI);
}

let charts = [];
function destroyCharts(){ for (const c of charts){ try{ c.destroy(); }catch(_){} } charts = []; }
function makeBar(ctx, labels, data, title){ const c = new Chart(ctx, { type: "bar", data: { labels, datasets: [{ label: title, data }] }, options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } } } }); charts.push(c); return c; }
function makeDoughnut(ctx, labels, data, title){ const c = new Chart(ctx, { type: "doughnut", data: { labels, datasets: [{ label: title, data }] }, options: { responsive:true, maintainAspectRatio:false } }); charts.push(c); return c; }
function makeLine(ctx, labels, data, title){ const c = new Chart(ctx, { type: "line", data: { labels, datasets: [{ label: title, data, fill:true, tension:0.3 }] }, options: { responsive:true, maintainAspectRatio:false, plugins:{ legend:{ display:false } } } }); charts.push(c); return c; }

function fillTable(rows){
  const tb = document.getElementById("rowsTbody");
  if (!tb) return;
  tb.innerHTML = rows.map(r => {
    const poId = r.po_number || (r.id || "").split('-')[0];
    const submittedDate = r.created_at ? new Date(r.created_at).toLocaleDateString() : "";
    const paidDate = r.paid_at ? new Date(r.paid_at).toLocaleDateString() : "";
    return `<tr class="text-slate-700">
        <td class="p-2 border border-slate-200 mono">${escapeHtml(poId)}</td>
        <td class="p-2 border border-slate-200">${submittedDate}</td>
        <td class="p-2 border border-slate-200">${escapeHtml(r.vendor_name || "")}</td>
        <td class="p-2 border border-slate-200">${escapeHtml(r.department || "")}</td>
        <td class="p-2 border border-slate-200 text-right font-medium">${fmtMoney(r.total)}</td>
        <td class="p-2 border border-slate-200">${renderStatusBadge(r.status, r.statusDetails || {}, !!r.paid_at)}</td>
        <td class="p-2 border border-slate-200">${paidDate}</td>
        <td class="p-2 border border-slate-200 text-center"><button class="btn-ghost open-po-btn" data-po-id="${escapeHtml(r.id)}">Open</button></td>
    </tr>`;
  }).join('');
}

function populateFilters(rows){
  const { yearList } = buildFilterRanges(rows);
  const ySel = document.getElementById("yearSel");
  ySel.innerHTML = `<option value="">All</option>` + yearList.map(y=>`<option value="${y}">${y}</option>`).join("");
  const mSel = document.getElementById("monthSel");
  mSel.innerHTML = `<option value="">All</option>` + Array.from({length:12}, (_,i)=>`<option value="${i}">${monthName(i)}</option>`).join("");
  const depts = unique(rows.map(r => r.department || "").filter(Boolean)).sort();
  const dSel = document.getElementById("deptSel");
  dSel.innerHTML = `<option value="">All</option>` + depts.map(d=>`<option>${d}</option>`).join("");
  const now = new Date();
  ySel.value = String(now.getFullYear());
  mSel.value = String(now.getMonth());
  document.getElementById("viewSel").value = "month";
}

function readFilters(){
  return { year: document.getElementById("yearSel").value, month: (function(){ const v = document.getElementById("monthSel").value; return v==="" ? null : parseInt(v,10); })(), view: document.getElementById("viewSel").value, dept: document.getElementById("deptSel").value };
}

function wireOpenPoHandler() {
    // MODIFICATION: Full implementation of showDetailsModal is now included
    const showDetailsModal = async (poData) => {
        openModal('<div class="p-8 text-center text-slate-500">Loading Epicor details...</div>');
        const epicorPoNumber = poData.meta?.epicorPoNumber;
        try {
            const detail = await fetchEpicorReceiptDetails(epicorPoNumber);
            if (detail?.error) throw new Error(detail.error);
            const statusAfter = computeEpicorReceiptStatus(detail);
            const rows = (detail?.rows || []).map((r, i) => `
                <tr>
                    <td class="py-1 px-2 border border-slate-200 text-right">${i + 1}</td>
                    <td class="py-1 px-2 border border-slate-200">${escapeHtml(r.partNum)}</td>
                    <td class="py-1 px-2 border border-slate-200">${escapeHtml(r.partDescription)}</td>
                    <td class="py-1 px-2 border border-slate-200 text-right">${r.qty || 0}</td>
                    <td class="py-1 px-2 border border-slate-200 text-center">${escapeHtml(r.uom)}</td>
                    <td class="py-1 px-2 border border-slate-200">${escapeHtml(r.receiptDate)}</td>
                    <td class="py-1 px-2 border border-slate-200">${escapeHtml(r.wh)}</td>
                    <td class="py-1 px-2 border border-slate-200">${escapeHtml(r.bin)}</td>
                    <td class="py-1 px-2 border border-slate-200">${r.received ? "RECEIVED" : "NOT RECEIVED"}</td>
                </tr>`).join('');

            openModal(`
                <div class="flex items-center justify-between mb-3 pr-32">
                    <div class="text-lg font-semibold">Epicor Details – PO ${escapeHtml(epicorPoNumber)}</div>
                    <button id="modal-back-btn" class="btn-ghost">Back</button>
                </div>
                <div class="text-sm text-slate-700 space-y-3">
                    <div class="overflow-x-auto">
                        <table class="min-w-full border-separate border-spacing-0">
                            <thead><tr class="bg-slate-50 text-xs text-slate-600 uppercase">
                                <th class="py-2 px-2 border border-slate-200 text-right">#</th>
                                <th class="py-2 px-2 border border-slate-200">Part #</th>
                                <th class="py-2 px-2 border border-slate-200">Description</th>
                                <th class="py-2 px-2 border border-slate-200 text-right">Qty</th>
                                <th class="py-2 px-2 border border-slate-200 text-center">UOM</th>
                                <th class="py-2 px-2 border border-slate-200">Receipt Date</th>
                                <th class="py-2 px-2 border border-slate-200">Warehouse</th>
                                <th class="py-2 px-2 border border-slate-200">Bin</th>
                                <th class="py-2 px-2 border border-slate-200">Received</th>
                            </tr></thead>
                            <tbody>${rows || `<tr><td colspan="9" class="text-center py-4">No receipt lines found.</td></tr>`}</tbody>
                        </table>
                    </div>
                    <div class="font-medium">Overall: ${escapeHtml(statusAfter)}</div>
                </div>`);
            document.getElementById('modal-back-btn')?.addEventListener('click', () => showPreviewModal(poData.id));
        } catch (e) {
            openModal(`<div class="p-8 text-center text-red-500">Error loading Epicor details: ${e.message}</div>`);
        }
    };

    const showPreviewModal = async (poId) => {
        openModal('<div class="p-8 text-center text-slate-500">Loading details...</div>');
        try {
            const res = await fetch(`/api/po/${poId}`);
            if (!res.ok) throw new Error('PO not found');
            const data = await res.json();

            const normalizedItems = (data.items || []).map((it, i) => {
                const qty = parseNum(it.qty ?? it.quantity ?? 0);
                const unitPrice = parseNum(it.unit_price ?? it.unitPrice ?? it.price ?? 0);
                const totalCandidate = parseNum(it.total ?? it.line_total ?? 0);
                const total = +((totalCandidate > 0 ? totalCandidate : qty * unitPrice)).toFixed(2);
                return { line: it.line_no ?? it.line ?? i + 1, supplierItem: it.supplierItem ?? it.supplier_item ?? "", peakPart: it.peakPart ?? it.peak_part ?? "", description: it.description ?? "", qty, uom: it.uom ?? "", unitPrice, total };
            });
            const calcSub = normalizedItems.reduce((a, x) => a + parseNum(x.total), 0);
            const poObj = data.po || {};
            const subTotal = parseNum(poObj.subtotal ?? poObj.subTotal ?? calcSub);
            const taxAmount = parseNum(poObj.tax ?? poObj.taxAmount ?? (subTotal * 0.13));
            const grandTotal = parseNum(poObj.total ?? poObj.grandTotal ?? (subTotal + taxAmount));
            const found = { 
                ...poObj, paid_at: poObj.paid_at || null, currency: poObj.currency || "CAD", subTotal, taxAmount, grandTotal,
                poId: poObj.po_number || poObj.id, date: poObj.created_at ? new Date(poObj.created_at).toLocaleDateString() : todayStr(),
                vendor: { name: poObj.vendor_name, address1: poObj.vendor_address1, city: poObj.vendor_city, state: poObj.vendor_state, zip: poObj.vendor_zip }, 
                items: normalizedItems
            };

            const approvals = Array.isArray(data.approvals) ? data.approvals : [];
            const normalizedApprovals = approvals.map(a => ({
                when: a.decided_at || a.created_at || a.timestamp || "", who: a.actor || a.approver || a.by || a.user || "",
                status: a.decision || a.status || a.outcome || "", comment: a.comment || a.notes || a.note || ""
            }));
            const approvalsRows = normalizedApprovals.map((a, i) => {
                let whenStr = ""; try { whenStr = a.when ? new Date(a.when).toLocaleString() : ""; } catch {}
                return `<tr class="align-top">
                    <td class="py-2 px-2 border border-slate-200 text-right text-slate-500">${i + 1}</td>
                    <td class="py-2 px-2 border border-slate-200">${whenStr}</td>
                    <td class="py-2 px-2 border border-slate-200">${escapeHtml(String(a.who))}</td>
                    <td class="py-2 px-2 border border-slate-200">${escapeHtml(String(a.status))}</td>
                    <td class="py-2 px-2 border border-slate-200">${escapeHtml(String(a.comment)) || '<span class="text-slate-400">(no comment)</span>'}</td>
                </tr>`;
            }).join("");
            const approvalsTable = `<div class="mt-6">
                <div class="flex items-center gap-2 mb-2"><div class="text-base font-semibold">Approvals & Comments</div>${renderCommentBadge(normalizedApprovals.length)}</div>
                <div class="overflow-x-auto"><table class="min-w-full border-separate border-spacing-0 text-sm">
                <thead><tr class="bg-slate-50 text-xs text-slate-600 uppercase">
                    <th class="py-2 px-2 border border-slate-200 text-right">#</th><th class="py-2 px-2 border border-slate-200">When</th>
                    <th class="py-2 px-2 border border-slate-200">By</th><th class="py-2 px-2 border border-slate-200">Decision</th><th class="py-2 px-2 border border-slate-200">Comment</th>
                </tr></thead>
                <tbody>${normalizedApprovals.length ? approvalsRows : `<tr><td colspan="5" class="py-4 px-2 text-center text-slate-500 border border-slate-200">No approvals yet.</td></tr>`}</tbody>
                </table></div></div>`;

            // 👉 NEW: payments table below approvals
            const paymentsTable = renderPaymentsSection(data);
            
            const html = buildHtmlPreview(found);
            const isPaid = !!found.paid_at;
            const epicorPoNumber = found.meta?.epicorPoNumber;
            const hasEpicor = !!epicorPoNumber;

            openModal(`<div class="flex items-center justify-between mb-3 pr-32">
                <div class="text-lg font-semibold">PO Preview – ${escapeHtml(found.poId)}</div>
                <div class="flex items-center gap-2">
                    ${window.isUserInManagerGroup && !isPaid ? `<button id="preview-mark-paid" class="px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700">Mark as Paid</button>` : ''}
                    <button id="preview-download" class="px-3 py-1.5 rounded bg-slate-600 text-white hover:bg-slate-700">Download Excel</button>
                    <button id="preview-details" class="px-3 py-1.5 rounded bg-slate-600 text-white hover:bg-slate-700 ${hasEpicor ? "" : "opacity-50 cursor-not-allowed"}" ${hasEpicor ? "" : "disabled"}>More Details</button>
                </div></div>
                ${html}
                ${ hasEpicor ? `<div class="mt-3 text-sm text-slate-600"><span class="font-medium">Epicor PO #:</span> ${escapeHtml(epicorPoNumber)}</div>` : "" }
                ${ isPaid ? `<div class="mt-3 text-sm text-emerald-700 font-medium">Paid on: ${new Date(found.paid_at).toLocaleDateString()}</div>` : "" }
                ${approvalsTable}
                ${paymentsTable}
            `);
            
            document.getElementById("preview-download")?.addEventListener("click", () => exportExcelUsingTemplate(found, found.items || []));
            const detailsBtn = document.getElementById("preview-details");
            if (detailsBtn && !detailsBtn.disabled) { detailsBtn.addEventListener("click", () => showDetailsModal(found)); }

            // ✅ NEW: open the partial-payment dialog instead of the old hard mark-paid
            const markPaidBtn = document.getElementById("preview-mark-paid");
            if (markPaidBtn) {
              markPaidBtn.addEventListener("click", async () => {
                try {
                  const res = await fetch(`/api/po/${found.id}`);
                  if (!res.ok) throw new Error('Could not load PO for payments');
                  const fresh = await res.json();
                  const mod = await import("./payments.js");
                  mod.openPaymentDialog({ po: fresh.po, paymentSummary: fresh.paymentSummary });
                } catch (e) {
                  toast(`Error opening payment dialog: ${e.message}`, true);
                }
              });
            }

        } catch (err) {
            console.error('Failed to fetch PO details:', err);
            openModal(`<div class="p-8 text-center text-red-500">Error: Could not load PO details.</div>`);
        }
    };

    document.body.addEventListener('click', (evt) => {
        const openBtn = evt.target.closest('.open-po-btn');
        if (openBtn && openBtn.dataset.poId) { showPreviewModal(openBtn.dataset.poId); }
    });
}


export async function renderCashFlow(){
  await checkUserGroupMembership();
  const all = await fetchPOs();
  populateFilters(all);
  wireOpenPoHandler();

  async function refresh(){
    const data = derive(all, readFilters());
    writeKPIs(data.kpis);
    destroyCharts();
    makeBar(document.getElementById("paidByMonth"), data.month.labels, data.month.values, "Paid");
    makeDoughnut(document.getElementById("byStatus"), data.status.labels, data.status.values, "By Status");
    makeDoughnut(document.getElementById("byDepartment"), data.department.labels, data.department.values, "By Department");
    makeBar(document.getElementById("topVendors"), data.vendors.labels, data.vendors.values, "Top Vendors");
    makeBar(document.getElementById("aging"), data.aging.labels, data.aging.values, "Unpaid Aging");
    makeLine(document.getElementById("projection"), data.projection.labels, data.projection.values, "Projection");
    fillTable(data.filtered);
    const lr = document.getElementById("lastRefreshed");
    const yv = document.getElementById("yearSel").value || "All";
    const mvRaw = document.getElementById("monthSel").value;
    const mv = mvRaw === "" ? "All" : monthName(parseInt(mvRaw,10));
    lr.textContent = "Meeting Month: " + mv + " • Year: " + yv + " • Updated " + new Date().toLocaleString();
  }

  // Clicking Save in the new payment dialog dispatches a `po:payment:recorded` event.
  // Refresh cashflow UI (KPIs/charts/table) when that happens.
  document.addEventListener("po:payment:recorded", async () => {
    allPOData = [];          // bust cache so /po-list is refetched on refresh-click
    await fetchPOs();        // warm it again
    await refresh();
  });

  document.getElementById("refresh").addEventListener("click", async () => {
      allPOData = [];
      await fetchPOs();
      await refresh();
  });

  document.getElementById("yearSel").addEventListener("change", (e)=>{ if (!e.target.value) { document.getElementById("monthSel").value = ""; } refresh(); });
  document.getElementById("monthSel").addEventListener("change", refresh);
  document.getElementById("viewSel").addEventListener("change", refresh);
  document.getElementById("deptSel").addEventListener("change", refresh);

  await refresh();
}

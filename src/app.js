// app.js

import { initAuth, revealAppUI, msalInstance, getGraphToken, getFlowToken } from "./msal.js";
import { money, parseNum, todayStr, escapeHtml, FINAL_STATUSES } from "./utils.js";
import {
  loadMeta, loadRows,
  getMeta, getRows, addRow, setRowsFromItems, resetMeta,
  getSubmissions, setSubmissions, updateSubmission, persistMeta, setMetaFromPayload
} from "./state.js";
import { renderTable } from "./ui/table.js";
import { openModal, closeModal, wireCommentLauncher, renderStatusBadge } from "./ui/modal.js";
import { startListStatusPolling, fetchPoStatus, normalizeStatus } from "./status.js";
import { exportExcelUsingTemplate, buildHtmlPreview } from "./excel.js";
import { bindVendorUI, toast } from "./vendors.js";
import { createPO, saveEpicorPoNumber, updatePoStatus, markPoAsPaid } from "./api/poapi.js";
import { fetchEpicorReceiptDetails, computeEpicorReceiptStatus } from "./epicor.js";

const FLOW_URL = "https://default9949b150278e46cf8570031db4e152.83.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/3caf75f97122486ea3159b51fd33670c/triggers/manual/paths/invoke?api-version=1";
const MANAGER_GROUP_ID = "98821b14-ae92-4010-9caa-c10f62a8ca9b";

/* ===== State & Performance helpers ===== */
const STATUS_TTL_MS = 5 * 60 * 1000;
const statusCache = new Map();
const startedPollers = new Set();
let isInitialLoad = true;
let filtersInitialized = false;

// --- A complete list of all possible statuses to ensure the filter is always populated ---
const ALL_STATUSES = [
  "Submitted",
  "Pending Manager Approval",
  "Manager Approved - Pending Buyer / Finance",
  "Fully Approved - Pending PO #",
  "Approved",
  "Approved - Pending Receipt",
  "Approved - Partial Receipt",
  "Received",
  "Rejected",
  "Failed"
].sort();


// --- Pagination State ---
let dashboardCurrentPage = 1;
let historyCurrentPage = 1;
const ITEMS_PER_PAGE = 5;

function createRenderScheduler(renderFn) {
  let scheduled = false;
  return function scheduleRender() {
    if (scheduled) return;
    scheduled = true;
    (window.requestAnimationFrame || setTimeout)(() => {
      scheduled = false;
      try { renderFn(); } catch (e) { console.error("Render failed:", e); }
    }, 16);
  };
}
const scheduleRender = createRenderScheduler(renderTablesFromState);

function createLimiter(maxConcurrent = 6) {
  let running = 0;
  const queue = [];
  const runNext = () => {
    if (!queue.length || running >= maxConcurrent) return;
    const { task, resolve, reject } = queue.shift();
    running++;
    Promise.resolve()
      .then(task)
      .then((v) => { running--; resolve(v); runNext(); })
      .catch((e) => { running--; reject(e); runNext(); });
  };
  return function enqueue(task) {
    return new Promise((resolve, reject) => {
      queue.push({ task, resolve, reject });
      runNext();
    });
  };
}
const statusLimiter = createLimiter(6);

let listFetchController = null;
function abortListFetchIfAny() {
  if (listFetchController) {
    try { listFetchController.abort(); } catch { /* ignore */ }
  }
}

/* ===== Comments UI helper ===== */
function renderCommentBadge(count) {
  const c = parseInt(count || 0, 10);
  if (!c) return "";
  return `
    <span
      class="ml-1 inline-flex items-center justify-center min-w-5 h-5 px-1 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold align-middle"
      title="${c} update(s)"
    >${c}</span>`;
}

/* ===== Filter UI & Logic ===== */
function createFilterControl(label, id, type = 'text', options = []) {
  const labelHtml = `<label for="${id}" class="text-sm font-medium text-slate-600">${label}</label>`;
  let controlHtml = '';
  if (type === 'select') {
    controlHtml = `<select id="${id}" class="w-44 px-2 py-1.5 border border-slate-300 rounded text-sm bg-white">
      ${options.map(opt => `<option value="${escapeHtml(opt.value)}">${escapeHtml(opt.text)}</option>`).join('')}
    </select>`;
  } else {
    controlHtml = `<input type="text" id="${id}" placeholder="Type to filter..." class="w-44 px-2 py-1.5 border border-slate-300 rounded text-sm" />`;
  }
  return `<div class="flex flex-col gap-1">${labelHtml}${controlHtml}</div>`;
}

function populateAndWireFilters(submissions) {
  if (filtersInitialized) return;

  const dashContainer = document.getElementById('dashboardFiltersContainer');
  const historyContainer = document.getElementById('historyFiltersContainer');

  const dateOptions = [
    { value: '', text: 'All Time' },
    { value: '7', text: 'Last Week' },
    { value: '30', text: 'Last Month' },
    { value: '90', text: 'Last 3 Months' },
    { value: '180', text: 'Last 6 Months' },
    { value: '365', text: 'Last 12 Months' }
  ];
  const statusOptions = [ { value: '', text: 'All Statuses' }, ...ALL_STATUSES.map(s => ({ value: s, text: s })) ];
  const uniqueDepartments = [...new Set(submissions.map(s => s.department).filter(Boolean))].sort();
  const departmentOptions = [ { value: '', text: 'All Departments' }, ...uniqueDepartments.map(d => ({ value: d, text: d })) ];

  let dashFiltersHtml = createFilterControl('Department', 'dashFilterDepartment', 'select', departmentOptions)
    + createFilterControl('Status', 'dashFilterStatus', 'select', statusOptions)
    + createFilterControl('Date Range', 'dashFilterDate', 'select', dateOptions)
    + createFilterControl('Vendor', 'dashFilterVendor', 'text')
    + `<div class="flex flex-col gap-1"><label class="text-sm font-medium text-slate-600">&nbsp;</label><button id="dashResetFilters" class="px-3 py-1.5 rounded bg-slate-600 text-white hover:bg-slate-700 text-sm">Reset</button></div>`;
  if (dashContainer) dashContainer.innerHTML = dashFiltersHtml;

  let historyFiltersHtml = createFilterControl('Status', 'historyFilterStatus', 'select', statusOptions)
    + createFilterControl('Date Range', 'historyFilterDate', 'select', dateOptions)
    + createFilterControl('Vendor', 'historyFilterVendor', 'text')
    + `<div class="flex flex-col gap-1"><label class="text-sm font-medium text-slate-600">&nbsp;</label><button id="historyResetFilters" class="px-3 py-1.5 rounded bg-slate-600 text-white hover:bg-slate-700 text-sm">Reset</button></div>`;
  if (historyContainer) historyContainer.innerHTML = historyFiltersHtml;

  // --- Performance: Debounce text inputs to avoid re-rendering on every keystroke ---
  let filterDebounce;
  const handleFilterChange = (isDebounced = false) => {
    clearTimeout(filterDebounce);
    const applyChanges = () => {
      dashboardCurrentPage = 1;
      historyCurrentPage = 1;
      renderTablesFromState();
    };

    if (isDebounced) {
      filterDebounce = setTimeout(applyChanges, 300);
    } else {
      applyChanges();
    }
  };

  const textFilterIds = ['dashFilterVendor', 'historyFilterVendor', 'dashSearch'];
  const selectFilterIds = ['dashFilterDepartment', 'dashFilterStatus', 'dashFilterDate', 'historyFilterStatus', 'historyFilterDate'];
  
  textFilterIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', () => handleFilterChange(true));
  });

  selectFilterIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => handleFilterChange(false));
  });
  
  document.getElementById('dashResetFilters')?.addEventListener('click', () => {
    ['dashFilterDepartment', 'dashFilterStatus', 'dashFilterDate', 'dashFilterVendor', 'dashSearch'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    handleFilterChange(false);
  });
  document.getElementById('historyResetFilters')?.addEventListener('click', () => {
    ['historyFilterStatus', 'historyFilterDate', 'historyFilterVendor'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    handleFilterChange(false);
  });

  filtersInitialized = true;
}

/* ===== Render Tables from current state ===== */
function renderTablesFromState() {
  const historyBody = document.getElementById('myHistoryBody');
  const dashboardBody = document.getElementById('recentTable');
  const submissions = getSubmissions();
  const currentUserUpn = msalInstance.getActiveAccount()?.username?.toLowerCase();

  // --- Get Filter Values ---
  const dashSearchQuery = document.getElementById('dashSearch')?.value.toLowerCase() || '';
  const dashDept = document.getElementById('dashFilterDepartment')?.value || '';
  const dashStatus = document.getElementById('dashFilterStatus')?.value || '';
  const dashDateDays = parseInt(document.getElementById('dashFilterDate')?.value, 10) || 0;
  const dashVendor = document.getElementById('dashFilterVendor')?.value.toLowerCase() || '';
  const historyStatus = document.getElementById('historyFilterStatus')?.value || '';
  const historyDateDays = parseInt(document.getElementById('historyFilterDate')?.value, 10) || 0;
  const historyVendor = document.getElementById('historyFilterVendor')?.value.toLowerCase() || '';

  const isWithinDays = (dateStr, days) => {
    if (!days) return true;
    const submissionDate = new Date(dateStr);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    return submissionDate >= cutoffDate;
  };

  // --- Apply Filters ---
  const dashboardData = submissions.filter(s => {
    if (dashSearchQuery && !((s.po_number || s.id || '').toLowerCase().includes(dashSearchQuery) || (s.vendor_name || '').toLowerCase().includes(dashVendor))) return false;
    if (dashDept && s.department !== dashDept) return false;
    if (dashStatus && s.status !== dashStatus) return false;
    if (dashVendor && !(s.vendor_name || '').toLowerCase().includes(dashVendor)) return false;
    if (dashDateDays && !isWithinDays(s.created_at, dashDateDays)) return false;
    return true;
  });

  const historyData = submissions.filter(s => {
    // THIS IS THE NEW FILTERING LOGIC FOR "My Requisitions"
    if (!currentUserUpn || (s.meta?.user?.upn || '').toLowerCase() !== currentUserUpn) {
      return false;
    }

    // Existing filters
    if (historyStatus && s.status !== historyStatus) return false;
    if (historyVendor && !(s.vendor_name || '').toLowerCase().includes(historyVendor)) return false;
    if (historyDateDays && !isWithinDays(s.created_at, historyDateDays)) return false;
    return true;
  });

  // --- Apply Pagination ---
  const dashTotalPages = Math.ceil(dashboardData.length / ITEMS_PER_PAGE) || 1;
  if (dashboardCurrentPage > dashTotalPages) dashboardCurrentPage = dashTotalPages;
  const dashStartIndex = (dashboardCurrentPage - 1) * ITEMS_PER_PAGE;
  const paginatedDashboardData = dashboardData.slice(dashStartIndex, dashStartIndex + ITEMS_PER_PAGE);

  const historyTotalPages = Math.ceil(historyData.length / ITEMS_PER_PAGE) || 1;
  if (historyCurrentPage > historyTotalPages) historyCurrentPage = historyTotalPages;
  const historyStartIndex = (historyCurrentPage - 1) * ITEMS_PER_PAGE;
  const paginatedHistoryData = historyData.slice(historyStartIndex, historyStartIndex + ITEMS_PER_PAGE);

  // --- Update Dashboard Metrics (based on filtered data) ---
  const count = dashboardData.length;
  const total = dashboardData.reduce((sum, po) => sum + parseFloat(po.total || 0), 0);
  const avg = count > 0 ? total / count : 0;
  const metricCount = document.getElementById('metricCount');
  const metricTotal = document.getElementById('metricTotal');
  const metricAvg = document.getElementById('metricAvg');
  if (metricCount) metricCount.textContent = count;
  if (metricTotal) metricTotal.textContent = money(total);
  if (metricAvg) metricAvg.textContent = money(avg);

  // --- Helper: compute Paid/Paid-Partial state for status badge ---
  function paidStateFor(po) {
    // Prefer server-computed fields from /po-list (added earlier): paid_total, remaining, paid_at
    if (po.paid_at) return true; // "(Paid)"
    const hasRem = typeof po.remaining !== "undefined";
    const hasPaid = typeof po.paid_total !== "undefined";
    if (hasPaid && hasRem) {
      const rem = parseNum(po.remaining);
      const paid = parseNum(po.paid_total);
      if (paid > 0 && rem > 0) return { partiallyPaid: true }; // "(Partially Paid)"
    }
    return false; // no suffix
  }
  
  // --- Generate and Render Table HTML (using paginated data) ---
  const historyRowsHtml = paginatedHistoryData.map(po => {
    const poId = po.po_number || (po.id || "").split('-')[0];
    const submittedDate = po.created_at ? new Date(po.created_at).toLocaleDateString() : "";
    const commentCount = po.comment_count || 0;
    return `
      <tr class="text-sm text-slate-700">
        <td class="py-2 px-2 border border-slate-200 mono">${escapeHtml(poId)}</td>
        <td class="py-2 px-2 border border-slate-200">${escapeHtml(submittedDate)}</td>
        <td class="py-2 px-2 border border-slate-200 text-right">${po.line_items || 0}</td>
        <td class="py-2 px-2 border border-slate-200 text-right font-medium">${money(po.total || 0)}</td>
        <td class="py-2 px-2 border border-slate-200">${escapeHtml(po.vendor_name) || 'N/A'}</td>
        <td class="py-2 px-2 border border-slate-200">
          <div class="flex items-center gap-1">
            ${renderStatusBadge(po.status, po.statusDetails || {}, paidStateFor(po))}
            ${commentCount > 0 ? `<span title="${commentCount} update(s)" class="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold text-white bg-amber-500 rounded-full">${commentCount}</span>` : ""}
          </div>
        </td>
        <td class="py-2 px-2 border border-slate-200 text-center">
          <button class="btn-ghost open-po-btn" data-po-id="${escapeHtml(po.id)}">Open</button>
        </td>
      </tr>`;
  }).join('');

  const dashboardRowsHtml = paginatedDashboardData.map(po => {
    const poFriendlyId = po.po_number || (po.id || "").split('-')[0];
    const submittedDate = po.created_at ? new Date(po.created_at).toLocaleDateString() : "";
    const showSetHash = String(po.status || "").toLowerCase().includes("fully approved");
    const commentCount = po.comment_count || 0;
    return `
      <tr class="text-sm text-slate-700">
        <td class="py-2 px-2 border border-slate-200 mono">${escapeHtml(poFriendlyId)}</td>
        <td class="py-2 px-2 border border-slate-200">${escapeHtml(submittedDate)}</td>
        <td class="py-2 px-2 border border-slate-200 text-right">${po.line_items || 0}</td>
        <td class="py-2 px-2 border border-slate-200 text-right font-medium">${money(po.total || 0)}</td>
        <td class="py-2 px-2 border border-slate-200">${escapeHtml(po.vendor_name) || 'N/A'}</td>
        <td class="py-2 px-2 border border-slate-200">${escapeHtml(po.created_by) || 'N/A'}</td>
        <td class="py-2 px-2 border border-slate-200">
          <div class="flex items-center gap-1">
            ${renderStatusBadge(po.status, po.statusDetails || {}, paidStateFor(po))}
            ${commentCount > 0 ? `<span title="${commentCount} update(s)" class="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold text-white bg-amber-500 rounded-full">${commentCount}</span>` : ""}
          </div>
        </td>
        <td class="py-2 px-2 border border-slate-200 text-center">
          <div class="flex items-center justify-center gap-2">
            <button class="btn-ghost open-po-btn" data-po-id="${escapeHtml(po.id)}">Open</button>
            ${showSetHash ? `<button class="btn-ghost" title="Set Epicor PO #" data-setpo="${escapeHtml(po.id)}" data-po-friendly-id="${escapeHtml(poFriendlyId)}">#</button>` : ""}
          </div>
        </td>
      </tr>`;
  }).join('');

  const emptyHistoryHtml = '<tr><td colspan="7" class="text-center p-4 text-slate-500">No matching purchase orders found.</td></tr>';
  const emptyDashboardHtml = '<tr><td colspan="8" class="text-center p-4 text-slate-500">No matching purchase orders found.</td></tr>';
  if (historyBody) historyBody.innerHTML = paginatedHistoryData.length ? historyRowsHtml : emptyHistoryHtml;
  if (dashboardBody) dashboardBody.innerHTML = paginatedDashboardData.length ? dashboardRowsHtml : emptyDashboardHtml;

  // --- Update Pagination UI ---
  const dashBackBtn = document.getElementById('dashBackBtn');
  const dashForwardBtn = document.getElementById('dashForwardBtn');
  const dashPageIndicator = document.getElementById('dashPageIndicator');
  if (dashBackBtn) dashBackBtn.disabled = dashboardCurrentPage <= 1;
  if (dashForwardBtn) dashForwardBtn.disabled = dashboardCurrentPage >= dashTotalPages;
  if (dashPageIndicator) dashPageIndicator.textContent = `Page ${dashboardCurrentPage} of ${dashTotalPages}`;

  const historyBackBtn = document.getElementById('historyBackBtn');
  const historyForwardBtn = document.getElementById('historyForwardBtn');
  const historyPageIndicator = document.getElementById('historyPageIndicator');
  if (historyBackBtn) historyBackBtn.disabled = historyCurrentPage <= 1;
  if (historyForwardBtn) historyForwardBtn.disabled = historyCurrentPage >= historyTotalPages;
  if (historyPageIndicator) historyPageIndicator.textContent = `Page ${historyCurrentPage} of ${historyTotalPages}`;
}

/* ===== Data loading (fast-first render + background status) ===== */

function updateSubmissionById(id, patch) {
  const list = getSubmissions();
  const idx = list.findIndex(s => s.id === id);
  if (idx > -1) updateSubmission(idx, patch);
}

// --- Performance: The main cause of slow loading is fetching ALL requisitions at once.
// --- The best long-term fix is server-side pagination, filtering, and sorting.
// --- This would involve changing this function to accept page/filter parameters
// --- and updating your /api/po-list endpoint to use them in its database query.
async function loadDataAndRenderAll() {
  const historyBody = document.getElementById('myHistoryBody');
  const dashboardBody = document.getElementById('recentTable');
  const loadingHtml = '<tr><td colspan="8" class="text-center p-4 text-slate-500">Loading...</td></tr>';

  abortListFetchIfAny();
  listFetchController = new AbortController();

  if (isInitialLoad) {
    if (historyBody) historyBody.innerHTML = loadingHtml;
    if (dashboardBody) dashboardBody.innerHTML = loadingHtml;
  }

  try {
    const response = await fetch('/api/po-list?pageSize=500', { signal: listFetchController.signal });
    if (!response.ok) throw new Error('Failed to fetch from API');

    let data = await response.json();
    let submissions = data.rows || [];

    setSubmissions(submissions);

    if (!filtersInitialized) {
      populateAndWireFilters(submissions);
    }
    renderTablesFromState();

    const posToCheck = submissions
      .filter(po =>
        po.po_number &&
        !po.meta?.epicorPoNumber &&
        !FINAL_STATUSES.has(normalizeStatus(po.status))
      );

    if (posToCheck.length > 0) {
      const now = Date.now();

      let anyPatchedFromCache = false;
      for (const po of posToCheck) {
        const cached = statusCache.get(po.po_number);
        if (cached && (now - cached.fetchedAt) < STATUS_TTL_MS) {
          const normalized = normalizeStatus(cached.data.status);
          updateSubmissionById(po.id, { status: normalized, statusDetails: cached.data });
          anyPatchedFromCache = true;
        }
      }
      if (anyPatchedFromCache) scheduleRender();

      for (const po of posToCheck) {
        const maybeCached = statusCache.get(po.po_number);
        if (maybeCached && (now - maybeCached.fetchedAt) < STATUS_TTL_MS) continue;

        statusLimiter(async () => {
          try {
            const spStatus = await fetchPoStatus(po.po_number);
            if (!spStatus) return;
            statusCache.set(po.po_number, { data: spStatus, fetchedAt: Date.now() });

            const normalized = normalizeStatus(spStatus.status);
            updateSubmissionById(po.id, { status: normalized, statusDetails: spStatus });
            scheduleRender();
          } catch {
            // Swallow per-PO status failures; keep going
          }
        });
      }
    }
  } catch (err) {
    if (err.name === "AbortError") return;
    console.error("Failed to load POs:", err);
    const errorHtml = `<tr><td colspan="8" class="text-center p-4 text-red-500">Error loading data.</td></tr>`;
    if (historyBody) historyBody.innerHTML = errorHtml;
    if (dashboardBody) dashboardBody.innerHTML = errorHtml;
  } finally {
    isInitialLoad = false;
  }
}

/* ===== Permission & UI Control ===== */

async function checkUserGroupMembership() {
  window.isUserInManagerGroup = false; // Default to false
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

function applyPermissions() {
  if (window.isUserInManagerGroup) {
    document.getElementById('dashboard')?.classList.remove('hidden');
    const tag = document.getElementById('dashAccessTag');
    if (tag) {
      tag.textContent = 'Manager View';
      tag.style.background = '#dcfce7';
      tag.style.color = '#166534';
    }
  }
}

function openReassignPoModal(poData) {
  const curEpicor = poData.meta?.epicorPoNumber || "";
  const submissionId = poData.po_number || poData.id;
  openModal(`
    <div class="flex items-center justify-between mb-3 pr-24">
      <div class="text-lg font-semibold">Reassign PO – ${escapeHtml(submissionId)}</div>
    </div>
    <div class="text-sm text-slate-700 space-y-3">
      <label class="block">
        <span class="text-slate-600">New Epicor PO #</span>
        <input id="reassign-new-po" class="mt-1 w-full border rounded px-2 py-1" placeholder="e.g. 1456" value="${escapeHtml(curEpicor)}">
      </label>
      <div class="flex gap-2 justify-end pt-2">
        <button id="reassign-cancel" class="btn btn-muted px-3 py-1 rounded text-white bg-slate-600 hover:bg-slate-700">Cancel</button>
        <button id="reassign-confirm" class="btn btn-primary px-3 py-1 rounded text-white bg-blue-600 hover:bg-blue-700">Confirm</button>
      </div>
    </div>
  `);

  document.getElementById("reassign-cancel")?.addEventListener("click", closeModal);
  document.getElementById("reassign-confirm")?.addEventListener("click", async () => {
    const newPo = String(document.getElementById("reassign-new-po")?.value || "").trim();
    if (!newPo) { toast("Enter a PO #", true); return; }
    
    try {
      await saveEpicorPoNumber(poData.id, newPo);
      const detail = await fetchEpicorReceiptDetails(newPo);
      const newStatus = computeEpicorReceiptStatus(detail) || "Approved - Pending Receipt";

      await updatePoStatus(poData.id, newStatus);
      
      toast(`Reassigned to Epicor PO # ${newPo}`);
      closeModal();
      loadDataAndRenderAll();
      
    } catch (e) {
      console.error("Failed to reassign PO:", e);
      toast(`Failed to reassign: ${e.message}`, true);
    }
  });
}

function wireOpenPoHandler() {
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
          <div class="flex items-center gap-2">
            <button id="modal-back-btn" class="btn btn-muted px-3 py-1 rounded text-white bg-slate-600 hover:bg-slate-700">Back</button>
            ${window.isUserInManagerGroup ? `
              <button id="reassign-po-btn" class="btn btn-primary px-3 py-1 rounded text-white bg-blue-600 hover:bg-blue-700">Reassign</button>
            ` : ''}
          </div>
        </div>
        <div class="text-sm text-slate-700 space-y-3">
          <div class="overflow-x-auto">
            <table class="min-w-full border-separate border-spacing-0">
              <thead><tr class="bg-slate-50 text-xs text-slate-600 uppercase">
                <th class="py-2 px-2 border border-slate-200 text-right">#</th><th class="py-2 px-2 border border-slate-200">Part #</th>
                <th class="py-2 px-2 border border-slate-200">Description</th><th class="py-2 px-2 border border-slate-200 text-right">Qty</th>
                <th class="py-2 px-2 border border-slate-200 text-center">UOM</th><th class="py-2 px-2 border border-slate-200">Receipt Date</th>
                <th class="py-2 px-2 border border-slate-200">Warehouse</th><th class="py-2 px-2 border border-slate-200">Bin</th>
                <th class="py-2 px-2 border border-slate-200">Received</th>
              </tr></thead>
              <tbody>${rows || `<tr><td colspan="9" class="text-center text-slate-500 py-4 border border-slate-200">No receipt lines found.</td></tr>`}</tbody>
            </table>
          </div>
          <div class="text-slate-700"><span class="font-medium">Overall:</span> ${escapeHtml(statusAfter)}</div>
        </div>`);

      if (window.isUserInManagerGroup) {
        document.getElementById('reassign-po-btn')?.addEventListener('click', () => openReassignPoModal(poData));
      }
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
        return {
          line: it.line_no ?? it.line ?? i + 1,
          supplierItem: it.supplierItem ?? it.supplier_item ?? "",
          peakPart: it.peakPart ?? it.peak_part ?? "",
          description: it.description ?? "",
          qty,
          uom: it.uom ?? "",
          unitPrice,
          total
        };
      });

      const calcSub = normalizedItems.reduce((a, x) => a + parseNum(x.total), 0);
      const poObj = data.po || {};
      const subTotal = parseNum(poObj.subtotal ?? poObj.subTotal ?? calcSub);
      const taxAmount = parseNum(poObj.tax ?? poObj.taxAmount ?? (subTotal * 0.13));
      const grandTotal = parseNum(poObj.total ?? poObj.grandTotal ?? (subTotal + taxAmount));

      const found = { 
        ...poObj,
        paid_at: poObj.paid_at || null, // Ensure paid_at is available
        currency: poObj.currency || "CAD",
        subTotal, taxAmount, grandTotal,
        poId: poObj.po_number || poObj.id,
        date: poObj.created_at ? new Date(poObj.created_at).toLocaleDateString() : todayStr(),
        vendor: { 
          name: poObj.vendor_name, 
          address1: poObj.vendor_address1, 
          city: poObj.vendor_city, 
          state: poObj.vendor_state, 
          zip: poObj.vendor_zip 
        }, 
        items: normalizedItems
      };

      const approvals = Array.isArray(data.approvals) ? data.approvals : [];
      const normalizedApprovals = approvals.map(a => ({
        when: a.decided_at || a.created_at || a.timestamp || "",
        who: a.actor || a.approver || a.by || a.user || a.approved_by || a.reviewed_by || "",
        status: a.decision || a.status || a.outcome || "",
        comment: a.comment || a.notes || a.note || ""
      }));

      const approvalsRows = normalizedApprovals.map((a, i) => {
        let whenStr = "";
        try { whenStr = a.when ? new Date(a.when).toLocaleString() : ""; } catch {}
        const statusText = a.status ? escapeHtml(String(a.status)) : "";
        const whoText = a.who ? escapeHtml(String(a.who)) : "";
        const commentText = a.comment ? escapeHtml(String(a.comment)) : "";
        return `
          <tr class="align-top">
            <td class="py-2 px-2 border border-slate-200 text-right text-slate-500">${i + 1}</td>
            <td class="py-2 px-2 border border-slate-200">${whenStr}</td>
            <td class="py-2 px-2 border border-slate-200">${whoText}</td>
            <td class="py-2 px-2 border border-slate-200">${statusText}</td>
            <td class="py-2 px-2 border border-slate-200">${commentText || '<span class="text-slate-400">(no comment)</span>'}</td>
          </tr>`;
      }).join("");

      const approvalsTable = `
        <div class="mt-6">
          <div class="flex items-center gap-2 mb-2">
            <div class="text-base font-semibold">Approvals & Comments</div>
            ${renderCommentBadge(normalizedApprovals.length)}
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full border-separate border-spacing-0 text-sm">
              <thead>
                <tr class="bg-slate-50 text-xs text-slate-600 uppercase">
                  <th class="py-2 px-2 border border-slate-200 text-right">#</th>
                  <th class="py-2 px-2 border border-slate-200">When</th>
                  <th class="py-2 px-2 border border-slate-200">By</th>
                  <th class="py-2 px-2 border border-slate-200">Decision</th>
                  <th class="py-2 px-2 border border-slate-200">Comment</th>
                </tr>
              </thead>
              <tbody>
                ${normalizedApprovals.length ? approvalsRows
                  : `<tr><td colspan="5" class="py-4 px-2 text-center text-slate-500 border border-slate-200">No approvals yet.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      `;

      // NEW: Payments ledger below Approvals (with Paid By column)
      const payments = Array.isArray(data.payments) ? data.payments : [];
      const paidTotal = parseNum(data?.paymentSummary?.paidTotal || 0);
      const remaining = parseNum(data?.paymentSummary?.remaining || 0);
      const paymentsRows = payments.map((p, i) => {
        const when = p.paid_at ? new Date(p.paid_at).toLocaleString() : '';
        const amt = money(parseNum(p.amount || 0), "CA$");
        const method = p.method ? escapeHtml(String(p.method)) : '<span class="text-slate-400">(n/a)</span>';
        const by = p.paid_by ? escapeHtml(String(p.paid_by)) : '<span class="text-slate-400">(unknown)</span>';
        const note = p.note ? escapeHtml(String(p.note)) : '<span class="text-slate-400">(no note)</span>';
        return `<tr class="align-top">
          <td class="py-2 px-2 border border-slate-200 text-right text-slate-500">${i + 1}</td>
          <td class="py-2 px-2 border border-slate-200">${when}</td>
          <td class="py-2 px-2 border border-slate-200 text-right">${amt}</td>
          <td class="py-2 px-2 border border-slate-200">${method}</td>
          <td class="py-2 px-2 border border-slate-200">${by}</td>
          <td class="py-2 px-2 border border-slate-200">${note}</td>
        </tr>`;
      }).join("");

      const paymentsTable = `
        <div class="mt-6">
          <div class="flex items-center gap-2 mb-2">
            <div class="text-base font-semibold">Payments</div>
          </div>
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
                ${payments.length ? paymentsRows
                  : `<tr><td colspan="6" class="py-4 px-2 text-center text-slate-500 border border-slate-200">No payments recorded yet.</td></tr>`}
              </tbody>
              <tfoot>
                <tr class="bg-slate-50 font-semibold">
                  <td class="py-2 px-2 border border-slate-200 text-right" colspan="2">Totals</td>
                  <td class="py-2 px-2 border border-slate-200 text-right">${money(paidTotal, "CA$")}</td>
                  <td class="py-2 px-2 border border-slate-200" colspan="3">Remaining: ${money(remaining, "CA$")}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      `;

      const html = buildHtmlPreview(found);
      const epicorPoNumber = found.meta?.epicorPoNumber;
      const hasEpicor = !!epicorPoNumber;

      // Compute preview badge paid state: Paid or Partially Paid
      const previewPaidState =
        found.paid_at ? true
        : (data?.paymentSummary?.paidTotal > 0 && data?.paymentSummary?.remaining > 0)
          ? { partiallyPaid: true }
          : false;

      openModal(`
        <div class="flex items-center justify-between mb-3 pr-32">
          <div class="text-lg font-semibold">PO Preview – ${escapeHtml(found.poId)}</div>
          <div class="flex items-center gap-2">
            ${window.isUserInManagerGroup && !found.paid_at ? `
              <button id="preview-mark-paid" class="px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700">Mark as Paid</button>
            ` : ''}
            <button id="preview-load" class="btn btn-primary px-3 py-1 rounded text-white bg-blue-600 hover:bg-blue-700">Load into Form</button>
            <button id="preview-download" class="btn btn-muted px-3 py-1 rounded text-white bg-slate-600 hover:bg-slate-700">Download Excel</button>
            <button id="preview-details" class="btn btn-muted px-3 py-1 rounded text-white bg-slate-600 hover:bg-slate-700 ${hasEpicor ? "" : "opacity-50 cursor-not-allowed"}" ${hasEpicor ? "" : "disabled"}>More Details</button>
          </div>
        </div>

        <!-- Inline status badge uses Paid/Partially Paid logic -->
        <div class="mb-2">${renderStatusBadge(found.status, found.statusDetails || {}, previewPaidState)}</div>

        ${html}
        ${ hasEpicor ? `<div class="mt-3 text-sm text-slate-600"><span class="font-medium">Epicor PO #:</span> ${escapeHtml(epicorPoNumber)}</div>` : "" }
        ${ found.paid_at ? `<div class="mt-3 text-sm text-emerald-700 font-medium">Paid on: ${new Date(found.paid_at).toLocaleDateString()}</div>` : "" }
        ${ approvalsTable }
        ${ paymentsTable }

      `);

      document.getElementById("preview-download")?.addEventListener("click", () => exportExcelUsingTemplate(found, found.items || []));
      document.getElementById("preview-load")?.addEventListener("click", () => {
        setMetaFromPayload(found); setRowsFromItems(found.items || []); renderTable(); window.refreshMetaInputs?.(); closeModal();
        toast(`Loaded ${found.poId} into the form.`); window.scrollTo({ top: 0, behavior: "smooth" });
      });
      
      // 🔁 REWORKED: open partial payment dialog instead of hard-mark-paid
      const markPaidBtn = document.getElementById("preview-mark-paid");
      if (markPaidBtn) {
        markPaidBtn.addEventListener("click", async () => {
          try {
            const res = await fetch(`/api/po/${found.id}`);
            if (!res.ok) throw new Error('Could not load PO for payments');
            const data = await res.json();
            const mod = await import("./ui/payments.js");
            mod.openPaymentDialog({ po: data.po, paymentSummary: data.paymentSummary });
          } catch (e) {
            toast(`Error opening payment dialog: ${e.message}`, true);
          }
        });
      }

      const detailsBtn = document.getElementById("preview-details");
      if (detailsBtn && !detailsBtn.disabled) {
        detailsBtn.addEventListener("click", () => showDetailsModal(found));
      }

    } catch (err) {
      console.error('Failed to fetch PO details:', err);
      openModal(`<div class="p-8 text-center text-red-500">Error: Could not load PO details.</div>`);
    }
  };

  document.body.addEventListener('click', async (evt) => {
    const openBtn = evt.target.closest('.open-po-btn');
    if (!openBtn) return;
    const poId = openBtn.dataset.poId;
    if (poId) showPreviewModal(poId);
  });
}

function wireSetPoHandler() {
  document.body.addEventListener('click', async (evt) => {
    const setPoBtn = evt.target.closest('button[data-setpo]');
    if (!setPoBtn) return;

    const poDBId = setPoBtn.dataset.setpo;
    const poFriendlyId = setPoBtn.dataset.poFriendlyId;
    const allSubs = getSubmissions();
    const sub = allSubs.find(s => s.id === poDBId);
    const currentEpicorPo = sub?.meta?.epicorPoNumber || "";
    
    const val = prompt(`Enter Epicor PO # for ${poFriendlyId}`, currentEpicorPo);
    if (val === null) return;

    const trimmed = String(val).trim();
    let finalStatus;
    
    try {
      await saveEpicorPoNumber(poDBId, trimmed);
      let intermediateStatus = trimmed ? "Approved - Pending Receipt" : "Fully Approved - Pending PO #";
      await updatePoStatus(poDBId, intermediateStatus);
      finalStatus = intermediateStatus;
      
      toast(trimmed ? `Saved Epicor PO # ${trimmed}` : "Epicor PO # cleared");
      
      if (trimmed) {
        const detail = await fetchEpicorReceiptDetails(trimmed);
        const statusFromEpicor = computeEpicorReceiptStatus(detail);
        if (statusFromEpicor && statusFromEpicor !== intermediateStatus) {
          await updatePoStatus(poDBId, statusFromEpicor);
          finalStatus = statusFromEpicor;
        }
      }
      
      const idx = getSubmissions().findIndex(s => s.id === poDBId);
      if (idx > -1) {
        const updatedMeta = { ...getSubmissions()[idx].meta, epicorPoNumber: trimmed || undefined };
        updateSubmission(idx, { status: finalStatus, meta: updatedMeta });
      }
      
      renderTablesFromState();

    } catch (e) {
      console.error("Failed to save or process Epicor PO#:", e);
      loadDataAndRenderAll();
    }
  });
}

function bindMetaInputs(refreshOnly=false){
  const meta = getMeta();
  const ids = ["vendorId","vendorName","vendorRefNo","peakHst","poDate","vendorAddr1","vendorCity","vendorState","vendorZip"];
  ids.forEach(id=>{
    const el = document.getElementById(id);
    if (el) el.value = meta[id] || (id==="peakHst"?"HST 709184311 RT0001":"");
  });
  if (refreshOnly) return;
  const sync = (id, key)=>
    document.getElementById(id).addEventListener("input", ()=>{
      const m = getMeta(); m[key] = document.getElementById(id).value; persistMeta();
    });
  sync("vendorName","vendorName");
  sync("vendorRefNo","vendorRefNo");
}
window.refreshMetaInputs = () => bindMetaInputs(true);

function wireButtons(){
  document.getElementById("logout")?.addEventListener("click", ()=> msalInstance.logoutRedirect());

  const onAdd = () => {
    addRow();
    renderTable();
    setTimeout(()=>{
      const last = document.querySelectorAll("#tbody tr:last-child input");
      if (last.length) last[0].focus();
    },0);
  };
  document.getElementById("addRow")?.addEventListener("click", onAdd);
  document.getElementById("addRowSide")?.addEventListener("click", onAdd);

  document.getElementById("clearAll")?.addEventListener("click", ()=>{
    if (!confirm("Clear all rows AND vendor/meta fields?")) return;
    setRowsFromItems([]);
    resetMeta();
    bindMetaInputs(true);
    renderTable();
    toast("Form cleared.");
  });

  document.getElementById("exportExcel")?.addEventListener("click", async ()=>{
    try {
      const rows = getRows()
        .map((r,i)=>({
          line:i+1, supplierItem:r.supplierItem?.trim(), peakPart:r.peakPart?.trim(),
          description:r.description?.trim(), qty:parseNum(r.qty), uom:r.uom?.trim() || "",    
          unitPrice:parseNum(r.unitPrice)
        }))
        .filter(x=> x.qty>0 || x.unitPrice>0 || (x.description && x.description.length));

      const poId = "PO-" + new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0,14);
      const payload = buildPayload(poId);
      await exportExcelUsingTemplate(payload, rows);
      toast("Excel exported.");
    } catch(err){
      console.error(err);
      toast("Export failed.", true);
    }
  });

  document.getElementById("sendForApproval")?.addEventListener("click", ()=>{
    const items = getRows()
      .map((r,i)=>({
        line:i+1, supplierItem:r.supplierItem?.trim(), peakPart:r.peakPart?.trim(),
        description:r.description?.trim(), qty:parseNum(r.qty), uom:r.uom?.trim() || "",
        unitPrice:parseNum(r.unitPrice), total:+(parseNum(r.qty)*parseNum(r.unitPrice)).toFixed(2)
      }))
      .filter(x=> x.qty>0 || x.unitPrice>0 || (x.description && x.description.length));

    if (!items.length){
      toast("Add at least one line before sending.", true);
      return;
    }

    const poId = "PO-" + new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0,14);
    const payload = buildPayload(poId, items);

    (async ()=>{
      try {
        const token = await getFlowToken();
        const res = await fetch(FLOW_URL, {
          method:"POST",
          headers: { "Content-Type":"application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify(payload)
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`${res.status}: ${text}`);
        
        try { await createPO(payload); } catch(e){ console.error('createPO failed', e); }
        
        await loadDataAndRenderAll();

        toast(`Sent ${poId} for approval. Total ${money(payload.grandTotal)}.`);

        startListStatusPolling(poId, async ()=>{
          await loadDataAndRenderAll();
        });
      } catch(err){
        console.error("Send failed", err);
        toast("Failed to start approval: "+ err.message, true);
      }
    })();
  });
}

function wirePagination() {
  document.getElementById('dashBackBtn')?.addEventListener('click', () => {
    if (dashboardCurrentPage > 1) {
      dashboardCurrentPage--;
      renderTablesFromState();
    }
  });
  document.getElementById('dashForwardBtn')?.addEventListener('click', () => {
    dashboardCurrentPage++;
    renderTablesFromState();
  });
  document.getElementById('historyBackBtn')?.addEventListener('click', () => {
    if (historyCurrentPage > 1) {
      historyCurrentPage--;
      renderTablesFromState();
    }
  });
  document.getElementById('historyForwardBtn')?.addEventListener('click', () => {
    historyCurrentPage++;
    renderTablesFromState();
  });
}

function buildPayload(poId, items){
  const meta = getMeta();
  const rows = items || [];
  const subtotal = rows.reduce((a,x)=> a + (x.total ?? (parseNum(x.qty) * parseNum(x.unitPrice))), 0);
  const tax = +(subtotal * 0.13).toFixed(2);
  const grand = subtotal + tax;

  const acct = msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0];
  const identity = {
    tenantId: acct?.idTokenClaims?.tid, oid: acct?.idTokenClaims?.oid || acct?.localAccountId,
    upn: acct?.username, name: acct?.name || acct?.idTokenClaims?.name,
    department: (window.__meProfile && window.__meProfile.department) || acct?.idTokenClaims?.department || null
  };

  const payload = {
    createdBy: (window.__meProfile && window.__meProfile.displayName) || identity.name || identity.upn,
    department: identity.department || null, poId, submittedAt: new Date().toISOString(), currency: "CAD",
    subTotal: +subtotal.toFixed(2), taxAmount: tax, grandTotal: +grand.toFixed(2),
    vendor: {
      id: meta.vendorId?.trim(), name: meta.vendorName?.trim(), referenceNo: meta.vendorRefNo?.trim(),
      address1: meta.vendorAddr1, city: meta.vendorCity, state: meta.vendorState, zip: meta.vendorZip
    },
    peak: { hstNo: meta.peakHst },
    shipTo: {
      company:"Peak Processing Solutions", address1:"2065 Solar Crescent",
      cityProvinceCountry:"Oldcastle, ON, Canada", postalCode:"N0R1L0"
    },
    date: meta.poDate || todayStr(),
    items: rows.length ? rows : getRows().map((r,i)=>({
      line: i+1, supplierItem:r.supplierItem?.trim(), peakPart:r.peakPart?.trim(),
      description:r.description?.trim(), qty:parseNum(r.qty), uom:r.uom?.trim() || "",             
      unitPrice:parseNum(r.unitPrice), total:+(parseNum(r.qty)*parseNum(r.unitPrice)).toFixed(2)
    })),
    status: "Submitted", user: identity, meta: {}
  };
  if (!payload.user.upn && acct?.username) payload.user.upn = acct.username;
  return payload;
}

async function fetchManager(){
  const card = document.getElementById("managerCard");
  const body = document.getElementById("managerBody");
  if (!card || !body) return;
  try {
    const token = await getGraphToken();
    if (!token) return;
    const res = await fetch("https://graph.microsoft.com/v1.0/me/manager?$select=displayName,mail,jobTitle,department", {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 404) {
      card.classList.remove("hidden");
      body.innerHTML = `<span class="text-slate-500">You cannot submit purchase order requests. Contact IT.</span>`;
      return;
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const mgr = await res.json();
    const name = mgr.displayName || "(No name)";
    const mail = mgr.mail || "";
    const title = mgr.jobTitle || "";
    const dept = mgr.department || "";
    card.classList.remove("hidden");
    body.innerHTML = `
      <div class="flex items-start justify-between">
        <div>
          <div class="font-medium">${escapeHtml(name)}</div>
          <div class="text-slate-600">${escapeHtml(title)}${title && dept ? " · " : ""}${escapeHtml(dept)}</div>
          ${mail ? `<div class="mt-1"><a class="text-blue-600 hover:underline" href="mailto:${encodeURIComponent(mail)}">${escapeHtml(mail)}</a></div>` : ""}
        </div>
      </div>`;
  } catch (err) {
    console.warn("Manager fetch failed:", err);
  }
}

async function startBackgroundPolling(){
  const subs = getSubmissions();
  const MAX_POLLERS = 25;
  let started = 0;
  subs
    .filter(s =>
      s.po_number &&
      !s.meta?.epicorPoNumber &&
      !FINAL_STATUSES.has(normalizeStatus(s.status)) &&
      !startedPollers.has(s.po_number)
    )
    .some(s => {
      startListStatusPolling(s.po_number, () => {
        scheduleRender();
      });
      startedPollers.add(s.po_number);
      started++;
      return started >= MAX_POLLERS;
    });
}

async function onReady(){
  await revealAppUI();

  // --- Performance: Run initial data fetches in parallel ---
  await Promise.all([
    checkUserGroupMembership(),
    loadDataAndRenderAll()
  ]);
  
  // Now that both are done, apply UI rules and wire up events
  applyPermissions();

  loadMeta();
  const hadData = loadRows();
  if (!getMeta().poDate) {
    const m = getMeta(); m.poDate = todayStr(); persistMeta();
  }
  bindMetaInputs();
  if (!hadData) { addRow(); }

  renderTable();

  wireButtons();
  bindVendorUI();
  wireCommentLauncher();
  wireOpenPoHandler();
  wireSetPoHandler();
  wirePagination();
  fetchManager();
  startBackgroundPolling();
}

initAuth({ onReady })
  // Refresh lists and open modal content when a payment is recorded (keeps filters/pagination intact)
  document.addEventListener("po:payment:recorded", async (ev) => {
    try {
      const response = await fetch('/api/po-list?pageSize=500');
      if (response.ok) {
        const data = await response.json();
        setSubmissions(data.rows || []);
        renderTablesFromState();
      }
    } catch (e) {
      console.warn('Refresh after payment failed', e);
    }
  });
;

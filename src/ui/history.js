// src/ui/history.js
import { getSubmissions, setMetaFromPayload, setRowsFromItems, money, parseNum } from "../state.js";
import { renderStatusBadge, openModal, closeModal } from "./modal.js";
import { buildHtmlPreview, exportExcelUsingTemplate } from "../excel.js";
import { fetchEpicorReceiptDetails, computeEpicorReceiptStatus } from "../epicor.js";

const tableBody = document.getElementById("myHistoryBody");

function formatDate(iso) { try { return new Date(iso).toLocaleString(); } catch { return iso || ""; } }
function showToast(msg, isError = false) { if (typeof window.toast === "function") window.toast(msg, isError); }

// Same Reassign modal as dashboard (kept local to this file)
function openReassignPoModal(submission, submissionIdx) {
  const curEpicor = submission?.epicorPoNumber || "";
  openModal(`
    <div class="flex items-center justify-between mb-3 pr-24">
      <div class="text-lg font-semibold">Reassign PO – ${submission.poId}</div>
    </div>
    <div class="text-sm text-slate-700 space-y-3">
      <label class="block">
        <span class="text-slate-600">New Epicor PO #</span>
        <input id="reassign-new-po" class="mt-1 w-full border rounded px-2 py-1" placeholder="e.g. 1456" value="${curEpicor}">
      </label>
      <div class="flex gap-2 justify-end pt-2">
        <button id="reassign-cancel" class="px-3 py-1.5 rounded bg-slate-200 text-slate-700">Cancel</button>
        <button id="reassign-confirm" class="px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700">Confirm</button>
      </div>
    </div>
  `);

  document.getElementById("reassign-cancel")?.addEventListener("click", () => {
    document.getElementById("app-modal")?.__close?.();
  });

  document.getElementById("reassign-confirm")?.addEventListener("click", async () => {
    const newPo = String(document.getElementById("reassign-new-po")?.value || "").trim();
    if (!newPo) { if (typeof window.toast === "function") window.toast("Enter a PO #", true); return; }

    // Save provisional and fetch Epicor
    submission.epicorPoNumber = newPo;
    submission.status = "Approved - Pending Receipt";

    try {
      const detail = await fetchEpicorReceiptDetails(newPo);
      const statusAfter = computeEpicorReceiptStatus(detail);
      submission.status = statusAfter;
    } catch (e) {
      console.warn("Epicor refresh failed", e);
    }

    // repaint table
    renderMyHistory();
    if (typeof window.toast === "function") window.toast(`Reassigned to Epicor PO # ${newPo}`);

    // close then reopen the details view
    document.getElementById("app-modal")?.__close?.();
    setTimeout(() => {
      const btn = document.querySelector(`button[data-open="${submission.poId}"]`);
      btn?.click();
      setTimeout(()=> document.getElementById("preview-details")?.click(), 100);
    }, 50);
  });
}

export function renderMyHistory() {
  const submissions = getSubmissions();

  tableBody.innerHTML = "";
  if (!submissions.length) {
    tableBody.innerHTML = `<tr><td colspan="7" class="text-center text-slate-500 py-4 border border-slate-200">No submissions yet.</td></tr>`;
    return;
  }

  submissions
    .slice()
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))
    .slice(0, 25)
    .forEach((s) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="py-2 px-2 border border-slate-200">${s.poId}</td>
        <td class="py-2 px-2 border border-slate-200">${formatDate(s.submittedAt)}</td>
        <td class="py-2 px-2 border border-slate-200 text-right">${(s.items || []).length}</td>
        <td class="py-2 px-2 border border-slate-200 text-right">${money(parseNum(s.grandTotal))}</td>
        <td class="py-2 px-2 border border-slate-200">${s.vendor?.name || ""}</td>
        <td class="py-2 px-2 border border-slate-200">
          ${renderStatusBadge(s.status, s.statusDetails || {})}
          ${s?.statusDetails?.comments ? `
            <button class="ml-2 align-middle" title="View approval comment" data-cmt="${s.poId}">💬</button>
          ` : ``}
        </td>
        <td class="py-2 px-2 border border-slate-200 text-center flex gap-2 justify-center">
          <button class="btn-ghost" data-open="${s.poId}">Open</button>
        </td>
      `;
      tableBody.appendChild(tr);
    });

  // OPEN -> preview + optional details
  tableBody.querySelectorAll("button[data-open]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-open");
      const all = getSubmissions();
      const found = all.find((x) => x.poId === id);
      if (!found) return;

      const html = buildHtmlPreview(found);
      const hasEpicor = !!found.epicorPoNumber;

      openModal(
        `
        <div class="flex items-center justify-between mb-3 pr-32">
          <div class="text-lg font-semibold">PO Preview – ${found.poId}</div>
          <div class="flex items-center gap-2">
            <button id="preview-load" class="px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700">Load into Form</button>
            <button id="preview-download" class="px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700">Download Excel</button>
            <button id="preview-details" class="px-3 py-1.5 rounded ${hasEpicor ? "bg-slate-700 hover:bg-black text-white" : "bg-slate-200 text-slate-500 cursor-not-allowed"}" ${hasEpicor ? "" : "disabled"}>More Details</button>
          </div>
        </div>
        ${html}
        ${ hasEpicor ? `<div class="mt-3 text-sm text-slate-600"><span class="font-medium">Epicor PO #:</span> ${found.epicorPoNumber}</div>` : "" }
        ${ (() => {
            const raw = (found?.statusDetails?.comments || "").trim();
            const first = raw ? raw.split(/\r?\n+/)[0].trim() : "";
            return first ? `<div class="mt-2 text-sm text-slate-700"><span class="font-medium">Approval Comment:</span> ${first}</div>` : "";
          })() }
        `
      );

      document.getElementById("preview-download")?.addEventListener("click", () => exportExcelUsingTemplate(found, found.items || []));
      document.getElementById("preview-load")?.addEventListener("click", () => {
        setMetaFromPayload(found);
        setRowsFromItems(found.items || []);
        closeModal();
        showToast(`Loaded ${found.poId} into the form.`);
        window.scrollTo({ top: 0, behavior: "smooth" });
      });

      const detailsBtn = document.getElementById("preview-details");
      if (detailsBtn && !detailsBtn.disabled) {
        detailsBtn.addEventListener("click", async () => {
          const poNum = found.epicorPoNumber;
          const detail = await fetchEpicorReceiptDetails(poNum).catch(e => ({ error: String(e) }));
          if (detail?.error) {
            openModal(`<div class="text-sm text-red-700">Epicor error: ${detail.error}</div>`);
            return;
          }
          const statusAfter = computeEpicorReceiptStatus(detail);

          const rows = (detail?.rows || []).map((r, i) => `
            <tr>
              <td class="py-1 px-2 border border-slate-200 text-right">${i+1}</td>
              <td class="py-1 px-2 border border-slate-200">${r.partNum || ""}</td>
              <td class="py-1 px-2 border border-slate-200">${r.partDescription || ""}</td>
              <td class="py-1 px-2 border border-slate-200 text-right">${r.qty || 0}</td>
              <td class="py-1 px-2 border border-slate-200 text-center">${r.uom || ""}</td>
              <td class="py-1 px-2 border border-slate-200">${r.receiptDate || ""}</td>
              <td class="py-1 px-2 border border-slate-200">${r.wh || ""}</td>
              <td class="py-1 px-2 border border-slate-200">${r.bin || ""}</td>
              <td class="py-1 px-2 border border-slate-200">${r.received ? "RECEIVED" : "NOT RECEIVED"}</td>
            </tr>
          `).join("");

          openModal(`
            <div class="flex items-center justify-between mb-3 pr-24">
              <div class="text-lg font-semibold">Epicor Details – PO ${poNum}</div>
              <div class="flex items-center gap-2">
                <button id="reassign-po" class="px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700">Reassign</button>
              </div>
            </div>
            <div class="text-sm text-slate-700 space-y-3">
              <div class="overflow-x-auto">
                <table class="min-w-full border-separate border-spacing-0">
                  <thead>
                    <tr class="bg-slate-50 text-xs text-slate-600 uppercase">
                      <th class="py-2 px-2 border border-slate-200 text-right">#</th>
                      <th class="py-2 px-2 border border-slate-200">Part #</th>
                      <th class="py-2 px-2 border border-slate-200">Description</th>
                      <th class="py-2 px-2 border border-slate-200 text-right">Qty</th>
                      <th class="py-2 px-2 border border-slate-200 text-center">UOM</th>
                      <th class="py-2 px-2 border border-slate-200">Receipt Date</th>
                      <th class="py-2 px-2 border border-slate-200">Warehouse</th>
                      <th class="py-2 px-2 border border-slate-200">Bin</th>
                      <th class="py-2 px-2 border border-slate-200">Received</th>
                    </tr>
                  </thead>
                  <tbody>${rows || ""}</tbody>
                </table>
              </div>
              <div class="text-slate-700"><span class="font-medium">Overall:</span> ${statusAfter}</div>
            </div>
          `);

          // Reassign handler
          document.getElementById("reassign-po")?.addEventListener("click", () => {
            const idx = getSubmissions().findIndex(x => x.poId === found.poId);
            openReassignPoModal(found, idx);
          });
        });
      }
    });
  });

  // 💬 comment icon -> small modal with full comment details
  tableBody.querySelectorAll('button[data-cmt]').forEach((b) => {
    b.addEventListener('click', () => {
      const id = b.getAttribute('data-cmt');
      const s = getSubmissions().find(x => x.poId === id);
      const d = s?.statusDetails || {};
      openModal(`
        <div class="text-sm text-slate-700 space-y-2">
          <div class="font-semibold">Approval Comment</div>
          <div><span class="text-slate-500">Approver:</span> ${d.approver || "—"}</div>
          <div><span class="text-slate-500">Outcome:</span> ${d.outcome || "—"}</div>
          <div><span class="text-slate-500">Updated:</span> ${d.updatedUtc ? new Date(d.updatedUtc).toLocaleString() : "—"}</div>
          <div class="mt-2 p-3 border rounded bg-slate-50 whitespace-pre-wrap">${d.comments || "(No comment)"}</div>
        </div>
      `);
    });
  });
}

// src/ui/wire-handlers.js
import { getSubmissions, setMetaFromPayload, setRowsFromItems } from "../state.js";
import { openModal, closeModal } from "./modal.js";
import { buildHtmlPreview, exportExcelUsingTemplate } from "../excel.js";
import { renderTable } from "./table.js";

// Helpers
function toast(msg, isError = false) {
  if (typeof window.toast === "function") window.toast(msg, isError);
}

// Attach once: handles both "Open" buttons anywhere (Dashboard + My History)
export function attachOpenPreviewHandlerOnce() {
  if (window.__openPreviewHandlerAttached) return;
  window.__openPreviewHandlerAttached = true;

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-open]");
    if (!btn) return;

    const id = btn.getAttribute("data-open");
    const all = getSubmissions();
    const found = all.find((x) => x.poId === id);
    if (!found) return;

    const html = buildHtmlPreview(found);
    const hasPO = !!found.epicorPoNumber;
    openModal(`
      <div class="flex items-center justify-between mb-3 pr-24">
        <div class="text-lg font-semibold">PO Preview – ${found.poId}</div>
        <div class="flex items-center gap-2">
          <button id="preview-load" class="px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700">Load into Form</button>
          <button id="preview-download" class="px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700">Download Excel</button>
          <button id="preview-details" class="px-3 py-1.5 rounded ${hasPO ? "bg-slate-700 hover:bg-black text-white" : "bg-slate-200 text-slate-500 cursor-not-allowed"}" ${hasPO ? "" : "disabled"}>More Details</button>
        </div>
      </div>
      ${html}
      ${hasPO ? `<div class="mt-3 text-sm text-slate-600"><span class="font-medium">Epicor PO #:</span> ${found.epicorPoNumber}</div>` : ""}
    `);

    document.getElementById("preview-download")?.addEventListener("click", () => exportExcelUsingTemplate(found, found.items || []));

    document.getElementById("preview-load")?.addEventListener("click", () => {
      setMetaFromPayload(found);
      setRowsFromItems(found.items || []);
      renderTable();
      window.refreshMetaInputs?.();
      closeModal();
      toast(`Loaded ${found.poId} into the form.`);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }, true);
}

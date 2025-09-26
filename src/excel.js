// src/excel.js
import { money, parseNum } from "./state.js"; // TAX_RATE now lives in state.js as well

const TEMPLATE_PATH = "po-template.xlsx";
const EXCEL_CELLS = {
  sheetName: null,
  poId: "J3",
  date: "J2",
  peakHst: "J4",
  vendorRef: "J5",
  currency: "B6",
};

const EXCEL_TABLE = {
  startRow: 27,
  columns: [
    { key: "line",         col: "B" },
    { key: "supplierItem", col: "C" },
    { key: "peakPart",     col: "D" },
    { key: "description",  col: "E" }, // includes [UOM: x] if provided
    { key: "qty",          col: "H" },
    { key: "unitPrice",    col: "I" },
  ],
  grandTotalCell: null,
};

function a1(col, row){ return `${col}${row}`; }

export async function exportExcelUsingTemplate(payload, items) {
  const resp = await fetch(TEMPLATE_PATH, { cache: "no-store" });
  if (!resp.ok) throw new Error("Template not found: " + TEMPLATE_PATH);

  const ab = await resp.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(ab);
  const ws = EXCEL_CELLS.sheetName ? wb.getWorksheet(EXCEL_CELLS.sheetName) : wb.worksheets[0];

  if (EXCEL_CELLS.poId) ws.getCell(EXCEL_CELLS.poId).value = payload.poId || "";
  if (EXCEL_CELLS.date) { const d = payload.date ? new Date(payload.date) : new Date(); ws.getCell(EXCEL_CELLS.date).value = d; ws.getCell(EXCEL_CELLS.date).numFmt = "yyyy-mm-dd"; }
  if (EXCEL_CELLS.peakHst)   ws.getCell(EXCEL_CELLS.peakHst).value = payload.peak?.hstNo || "";
  if (EXCEL_CELLS.vendorRef) ws.getCell(EXCEL_CELLS.vendorRef).value = payload.vendor?.referenceNo || "";
  if (EXCEL_CELLS.currency)  ws.getCell(EXCEL_CELLS.currency).value = payload.currency || "CAD";

  let row = EXCEL_TABLE.startRow;
  (items || []).forEach((r, i) => {
    EXCEL_TABLE.columns.forEach((c) => {
      const cell = ws.getCell(a1(c.col, row));
      let val = r[c.key];
      if (c.key === "line") val = i + 1;
      if (c.key === "description" && r?.uom) {
        const u = String(r.uom).trim();
        if (u) val = `${val || ""} [UOM: ${u}]`;
      }
      const isNumeric = c.key === "qty" || c.key === "unitPrice";
      cell.value = isNumeric ? Number(val || 0) : (val ?? "");
    });
    row++;
  });

  const filename = (payload.poId || "PO") + ".xlsx";
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

// ---- HTML preview (includes UOM) ----
function escapeHtml(s=""){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

export function buildHtmlPreview(po = {}) {
  const items = Array.isArray(po.items) ? po.items : [];

  const subtotal = items.reduce((acc, r) => acc + (parseNum(r?.qty) * parseNum(r?.unitPrice)), 0);
  const tax = +(subtotal * 0.13).toFixed(2);
  const grand = subtotal + tax;

  const rowsHtml = items.map((r, i) => `
    <tr>
      <td class="py-1 px-2 border border-slate-200 text-right">${i + 1}</td>
      <td class="py-1 px-2 border border-slate-200">${escapeHtml(r?.supplierItem || "")}</td>
      <td class="py-1 px-2 border border-slate-200">${escapeHtml(r?.peakPart || "")}</td>
      <td class="py-1 px-2 border border-slate-200">${escapeHtml(r?.description || "")}</td>
      <td class="py-1 px-2 border border-slate-200 text-right">${parseNum(r?.qty) || 0}</td>
      <td class="py-1 px-2 border border-slate-200 text-center w-16">${escapeHtml(r?.uom || "")}</td>
      <td class="py-1 px-2 border border-slate-200 text-right">${money(parseNum(r?.unitPrice))}</td>
      <td class="py-1 px-2 border border-slate-200 text-right font-medium">${money(parseNum(r?.qty) * parseNum(r?.unitPrice))}</td>
    </tr>
  `).join("");

  return `
    <div class="text-sm text-slate-700 space-y-3">
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div class="border rounded p-3">
          <div class="text-xs font-semibold mb-1">Vendor</div>
          <div class="break-anywhere">${escapeHtml(po?.vendor?.name || "")}</div>
          <div class="text-slate-500 break-anywhere">${escapeHtml(po?.vendor?.address1 || "")}</div>
          <div class="text-slate-500 break-anywhere">
            ${escapeHtml(po?.vendor?.city || "")}
            ${po?.vendor?.state ? ", " + escapeHtml(po.vendor.state) : ""}
            ${po?.vendor?.zip ? " " + escapeHtml(po.vendor.zip) : ""}
          </div>
        </div>
        <div class="border rounded p-3">
          <div class="text-xs font-semibold mb-1">PO</div>
          <div>PO ID: <span class="font-medium break-anywhere">${escapeHtml(po?.poId || "")}</span></div>
          <div>Date: ${escapeHtml(po?.date || "")}</div>
          <div>Total: <span class="font-medium">${money(grand)}</span></div>
        </div>
        <div class="border rounded p-3">
          <div class="text-xs font-semibold mb-1">Ship To</div>
          <div>Peak Processing Solutions</div>
          <div>2065 Solar Crescent</div>
          <div>Oldcastle, ON, Canada</div>
          <div>N0R1L0</div>
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="min-w-full border-separate border-spacing-0">
          <thead>
            <tr class="bg-slate-50 text-xs text-slate-600 uppercase">
              <th class="py-2 px-2 border border-slate-200 text-right">#</th>
              <th class="py-2 px-2 border border-slate-200">Supplier Item #</th>
              <th class="py-2 px-2 border border-slate-200">Peak Part #</th>
              <th class="py-2 px-2 border border-slate-200">Description</th>
              <th class="py-2 px-2 border border-slate-200 text-right">Qty</th>
              <th class="py-2 px-2 border border-slate-200 text-center w-16">UOM</th>
              <th class="py-2 px-2 border border-slate-200 text-right">Unit Price</th>
              <th class="py-2 px-2 border border-slate-200 text-right">Line Total</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || `<tr><td colspan="8" class="text-center text-slate-500 py-4 border border-slate-200">No items</td></tr>`}</tbody>
          <tfoot>
            <tr>
              <td colspan="7" class="text-right pr-3 py-2 border border-slate-200">Subtotal</td>
              <td class="text-right pr-2 py-2 border border-slate-200">${money(subtotal)}</td>
            </tr>
            <tr>
              <td colspan="7" class="text-right pr-3 py-2 border border-slate-200">HST (13%)</td>
              <td class="text-right pr-2 py-2 border border-slate-200">${money(tax)}</td>
            </tr>
            <tr>
              <td colspan="7" class="text-right pr-3 py-2 border border-slate-200 font-medium">Grand Total</td>
              <td class="text-right pr-2 py-2 border border-slate-200 font-semibold">${money(grand)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `;
}

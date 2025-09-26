// src/ui/payments.js
import { openModal, closeModal } from "./modal.js";
import { addPoPayment } from "../api/poapi.js";
import { money, parseNum, escapeHtml } from "../utils.js";

/**
 * Opens a modal to record a payment for a PO.
 * Expects: { po, paymentSummary } from /api/po/:id
 */
export function openPaymentDialog({ po, paymentSummary }) {
  const total = parseNum(paymentSummary?.total);
  const paid  = parseNum(paymentSummary?.paidTotal);
  const remain = Math.max(0, +(total - paid).toFixed(2));

  const ledgerNote = `
    <div class="text-xs text-slate-500 mt-1">
      Payments ledger appears under Approvals after you save.
    </div>`;

  const formHtml = `
    <div class="flex items-center justify-between mb-3 pr-24">
      <div class="text-lg font-semibold">Record Payment — ${escapeHtml(po.po_number || po.id)}</div>
    </div>

    <div class="text-sm text-slate-700 space-y-4">
      <div class="grid grid-cols-3 gap-4">
        <div class="p-3 rounded-lg bg-slate-50 border border-slate-200">
          <div class="text-xs text-slate-500">Total</div>
          <div class="text-base font-semibold">${money(total, "CA$")}</div>
        </div>
        <div class="p-3 rounded-lg bg-slate-50 border border-slate-200">
          <div class="text-xs text-slate-500">Paid to date</div>
          <div class="text-base font-semibold">${money(paid, "CA$")}</div>
        </div>
        <div class="p-3 rounded-lg bg-slate-50 border border-slate-200">
          <div class="text-xs text-slate-500">Remaining</div>
          <div class="text-base font-semibold">${money(remain, "CA$")}</div>
        </div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
        <label class="block">
          <span class="text-slate-600">Amount to record</span>
          <input id="pay-amount" inputmode="decimal" class="mt-1 w-full border rounded px-2 py-1"
                 value="${remain}" placeholder="${remain}" />
          <div id="pay-amount-hint" class="text-[11px] text-slate-500 mt-1">Must be &gt; 0 and ≤ ${remain}.</div>
        </label>

        <label class="block">
          <span class="text-slate-600">Method</span>
          <select id="pay-method" class="mt-1 w-full border rounded px-2 py-1">
            <option value="">(unspecified)</option>
            <option>ACH</option>
            <option>Wire</option>
            <option>Cheque</option>
            <option>Credit Card</option>
            <option>Cash</option>
          </select>
        </label>

        <label class="block md:col-span-1 md:col-start-1 md:row-start-2">
          <span class="text-slate-600">Note</span>
          <input id="pay-note" class="mt-1 w-full border rounded px-2 py-1" maxlength="200"
                 placeholder="Reference #, last 4, batch, etc." />
        </label>
      </div>

      ${ledgerNote}

      <div class="flex gap-2 justify-end pt-2">
        <button id="pay-cancel" class="px-3 py-1.5 rounded bg-slate-200 text-slate-700">Cancel</button>
        <button id="pay-save"   class="px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700">Save Payment</button>
      </div>
    </div>
  `;

  openModal(formHtml);

  const amtEl = document.getElementById("pay-amount");
  const methodEl = document.getElementById("pay-method");
  const noteEl = document.getElementById("pay-note");
  const saveBtn = document.getElementById("pay-save");

  function validate() {
    const val = parseNum(amtEl.value);
    const isOk = Number.isFinite(val) && val > 0 && val <= remain;
    saveBtn.disabled = !isOk;
    document.getElementById("pay-amount-hint").classList.toggle("text-rose-600", !isOk);
    return isOk ? val : null;
  }
  ["input", "blur"].forEach(ev => amtEl.addEventListener(ev, validate));
  validate();

  document.getElementById("pay-cancel")?.addEventListener("click", closeModal);

  saveBtn?.addEventListener("click", async () => {
    const val = validate();
    if (val === null) return;

    saveBtn.disabled = true;
    saveBtn.textContent = "Saving...";

    try {
      const res = await addPoPayment({
        id: po.id,
        amount: +(+val).toFixed(2),
        method: methodEl.value || undefined,
        note: noteEl.value || undefined
      });

      closeModal();

      if (typeof window.toast === "function") {
        const remainingAfter = parseNum(res?.summary?.remaining);
        const paidTotalAfter = parseNum(res?.summary?.paidTotal);
        window.toast(
          remainingAfter <= 0
            ? `Payment recorded. PO is now fully paid (Total Paid ${money(paidTotalAfter)}).`
            : `Payment recorded. Remaining ${money(remainingAfter)}.`,
          false
        );
      }

      document.dispatchEvent(new CustomEvent("po:payment:recorded", {
        detail: { id: po.id, summary: res?.summary }
      }));
    } catch (e) {
      if (typeof window.toast === "function") window.toast(e.message || "Failed to save payment", true);
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Payment";
    }
  });
}

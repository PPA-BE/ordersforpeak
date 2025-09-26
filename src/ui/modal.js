// src/ui/modal.js
import { escapeHtml } from "../utils.js";

// --- Ensure the preview modal exists; create it if missing ---
function ensureAppModal() {
  let modal   = document.getElementById("app-modal");
  let content = document.getElementById("app-modal-content");

  if (!modal || !content) {
    if (modal) modal.remove();
    modal = document.createElement("div");
    modal.id = "app-modal";
    modal.className = "fixed inset-0 z-[2147483646] hidden";
    modal.innerHTML = `
      <div class="absolute inset-0 bg-black/50" data-modal-close></div>
      <div class="relative mx-auto my-10 w-[92%] max-w-4xl">
        <div class="relative bg-white rounded-2xl shadow-2xl ring-1 ring-slate-200 p-4">
          <button id="app-modal-close" type="button"
            class="absolute top-2 right-2 rounded-full w-8 h-8 flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100"
            aria-label="Close">✕</button>
          <div id="app-modal-content"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    content = modal.querySelector("#app-modal-content");
  }

  const overlay = modal.querySelector("[data-modal-close]");
  const closeBtn = modal.querySelector("#app-modal-close");
  return { modal, content, overlay, closeBtn };
}

export function openModal(html) {
  const { modal, content, overlay, closeBtn } = ensureAppModal();
  content.innerHTML = html;
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  const onKey = (e) => { if (e.key === "Escape") close(); };
  function close() {
    modal.classList.add("hidden");
    document.body.style.overflow = "";
    content.innerHTML = "";
    overlay?.removeEventListener("click", close);
    closeBtn?.removeEventListener("click", close);
    document.removeEventListener("keydown", onKey, true);
  }
  modal.__close = close;

  overlay?.addEventListener("click", close);
  closeBtn?.addEventListener("click", close);
  document.addEventListener("keydown", onKey, true);
}

export function closeModal() {
  const modal = document.getElementById("app-modal");
  if (modal?.__close) modal.__close();
}

/**
 * Renders the colored status pill.
 * `paidState` is backward-compatible:
 *  - true  -> append "(Paid)"
 *  - { partiallyPaid: true } -> append "(Partially Paid)"
 *  - falsy -> no suffix
 */
export function renderStatusBadge(status, details = {}, paidState = false){
  const s = String(status||"Submitted");
  const comments = (details.Comments ?? details.comments ?? "");

  const clsMap = {
    "Approved": "bg-emerald-100 text-emerald-700",
    "Rejected": "bg-rose-100 text-rose-700",
    "Failed":   "bg-amber-100 text-amber-700",
    "Submitted":"bg-slate-100 text-slate-700",
    "Pending Manager Approval": "bg-sky-100 text-sky-700",
    "Manager Approved - Pending Buyer / Finance": "bg-sky-100 text-sky-700",
    "Fully Approved - Pending PO #": "bg-emerald-100 text-emerald-700",
    "Approved - Pending Receipt": "bg-indigo-100 text-indigo-700",
    "Approved - Partial Receipt": "bg-violet-100 text-violet-700",
    "Received": "bg-teal-100 text-teal-700"
  };
  const cls = clsMap[s] || "bg-slate-100 text-slate-700";

  const statusText = escapeHtml(s);
  let suffix = "";
  if (paidState === true) {
    suffix = `<span class="ml-1.5 font-semibold text-emerald-800">(Paid)</span>`;
  } else if (paidState && typeof paidState === "object" && paidState.partiallyPaid) {
    suffix = `<span class="ml-1.5 font-semibold text-amber-800">(Partially Paid)</span>`;
  }

  const pill = `<span class="inline-flex items-center text-xs px-2 py-0.5 rounded ${cls}">${statusText}${suffix}</span>`;
  
  const hasComment = String(comments||"").trim().length > 0;
  if (!hasComment) return pill;

  const approver = (details.Approver ?? details.approver ?? "");
  const updatedUtc = (details.UpdatedUtc ?? details.updatedUtc ?? "");
  const outcome = (details.Outcome ?? details.outcome ?? "");
  const payload = encodeURIComponent(JSON.stringify({
    status:s, approver:String(approver||""), updatedUtc:String(updatedUtc||""),
    outcome:String(outcome||""), comments:String(comments||"")
  }));
  return `<span class="inline-flex items-center gap-1 align-middle">${pill}
    <button type="button" class="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-800/90 hover:bg-slate-900 text-white shadow ring-1 ring-black/5" title="View approval comment" data-cmt="${payload}" aria-label="View approval comment">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4a2 2 0 0 0-2 2v14l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/></svg>
    </button></span>`;
}

// Optional: legacy comment launcher (kept for compatibility)
export function wireCommentLauncher(){
  if (window.__cmtHandlerAttached) return; window.__cmtHandlerAttached = true;
  document.addEventListener("click", (e)=>{
    const btn = e.target.closest("[data-cmt]"); if (!btn) return;
    e.preventDefault(); e.stopPropagation(); if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    try {
      const data = JSON.parse(decodeURIComponent(btn.getAttribute("data-cmt")||""));
      const when = data.updatedUtc ? new Date(data.updatedUtc).toLocaleString() : "";
      const s = data.status || "Submitted";
      const cls = {
        Approved:"bg-emerald-100 text-emerald-700",
        Rejected:"bg-rose-100 text-rose-700",
        Failed:"bg-amber-100 text-amber-700",
        Submitted:"bg-slate-100 text-slate-700"
      }[s] || "bg-slate-100 text-slate-700";
      const html = `<div class="flex items-start gap-3">
        <div class="shrink-0 mt-0.5 text-[11px] px-2 py-0.5 rounded ${cls}">${escapeHtml(s)}</div>
        <div class="min-w-0">
          <div class="text-[13px] font-medium break-anywhere">${escapeHtml(data.approver || "—")}</div>
          <div class="text-[11px] text-slate-500">${escapeHtml(when)}</div>
          ${data.outcome ? `<div class="text-[12px] text-slate-600 mt-1 break-anywhere">${escapeHtml(data.outcome)}</div>` : ""}
          <div class="text-[13px] text-slate-800 mt-2 whitespace-pre-wrap break-anywhere">${escapeHtml(data.comments || "")}</div>
        </div>
      </div>`;
      openModal(html);
    } catch(err){ console.error(err); }
  }, true);
}

import { escapeHtml } from "./utils.js";
import { getMeta, persistMeta } from "./state.js";

// WARNING: For production, move this to a server function to avoid exposing credentials.
const EPICOR_URL = "https://cadcentraldtpilot00.epicorsaas.com/SaaS508Pilot/api/v1/BaqSvc/VendorListReactPOProject?Company='157173'";
const EPICOR_USER = "belhamaida";
const EPICOR_PASS = "Salmia12!";

export function bindVendorUI(){
  const vendorSearchEl = document.getElementById("vendorSearch");
  const vendorLoadBtn = document.getElementById("vendorLoad");
  const vendorResultsEl = document.getElementById("vendorResults");
  const vendorCountEl = document.getElementById("vendorCount");
  const vendorFilterCountEl = document.getElementById("vendorFilterCount");

  let ALL_VENDORS = [];
  let FILTERED = [];

  vendorLoadBtn.addEventListener("click", async ()=>{
    vendorLoadBtn.disabled = true;
    vendorResultsEl.classList.add("hidden"); vendorResultsEl.innerHTML = ""; vendorFilterCountEl.textContent = "";
    try {
      const auth = btoa(EPICOR_USER + ":" + EPICOR_PASS);
      const resp = await fetch(EPICOR_URL, { method:"GET", headers: { "Accept":"application/json", "Authorization":"Basic " + auth } });
      if (!resp.ok) { let detail = ""; if (resp.status === 401) detail = " (Invalid login)"; if (resp.status === 403) detail = " (Forbidden)"; if (resp.status === 404) detail = " (Not found)"; toast(`Epicor error ${resp.status}${detail}`, true); return; }
      const data = await resp.json();
      const rows = Array.isArray(data?.value) ? data.value : [];
      ALL_VENDORS = rows.map(r => ({
        id: r?.Vendor_VendorID ?? "",
        name: r?.Vendor_Name ?? "",
        address1: r?.Vendor_Address1 ?? "",
        city: r?.Vendor_City ?? "",
        state: r?.Vendor_State ?? "",
        zip: r?.Vendor_ZIP ?? ""
      })).filter(v => v.id || v.name);
      vendorCountEl.textContent = String(ALL_VENDORS.length);
      applyVendorFilter();
      toast(`Loaded ${ALL_VENDORS.length} vendors.`);
    } catch (e) {
      console.error(e);
      toast("Load failed (CORS/network). Run from a local web server, not file://", true);
    } finally {
      vendorLoadBtn.disabled = false;
    }
  });

  vendorSearchEl.addEventListener("input", ()=>{
    clearTimeout(vendorSearchEl._t);
    vendorSearchEl._t = setTimeout(applyVendorFilter, 120);
  });

  function setVendor(v){
    document.getElementById("vendorId").value = v?.id || "";
    document.getElementById("vendorName").value = v?.name || "";
    document.getElementById("vendorAddr1").value = v?.address1 || "";
    document.getElementById("vendorCity").value = v?.city || "";
    document.getElementById("vendorState").value = v?.state || "";
    document.getElementById("vendorZip").value = v?.zip || "";

    // Update meta so it's persisted
    const m = getMeta();
    m.vendorId = v?.id || ""; m.vendorName = v?.name || ""; m.vendorAddr1 = v?.address1 || "";
    m.vendorCity = v?.city || ""; m.vendorState = v?.state || ""; m.vendorZip = v?.zip || "";
    persistMeta();
  }

  function renderVendorList(items){
    if (!items.length) {
      vendorResultsEl.classList.add("hidden");
      vendorResultsEl.innerHTML = "";
      vendorFilterCountEl.textContent = "";
      return;
    }
    vendorResultsEl.classList.remove("hidden");
    vendorResultsEl.innerHTML = "";
    items.forEach(v => {
      const row = document.createElement("div");
      row.className = "vendor-row";
      row.innerHTML = `<strong class="mono">${escapeHtml(v.id)}</strong> — ${escapeHtml(v.name)}`;
      row.addEventListener("click", () => {
        setVendor(v);
        vendorResultsEl.classList.add("hidden");
      });
      vendorResultsEl.appendChild(row);
    });
  }

  function applyVendorFilter(){
    const q = (vendorSearchEl.value || "").trim().toLowerCase();
    FILTERED = !q ? ALL_VENDORS : ALL_VENDORS.filter(v => (v.id || "").toLowerCase().includes(q) || (v.name || "").toLowerCase().includes(q));
    vendorFilterCountEl.textContent = q ? `${FILTERED.length} match${FILTERED.length===1?"":"es"}` : "";
    renderVendorList(FILTERED);
  }
}

export function toast(msg, isError=false){
  const el = document.getElementById("toast");
  el.textContent = msg; el.style.background = isError ? "#b91c1c" : "#16a34a";
  el.classList.remove("hidden"); setTimeout(()=> el.classList.add("hidden"), 2500);
}

import { money, parseNum } from "../utils.js";
import { getRows, setRows, addRow, removeRow } from "../state.js";

export function renderTable(){
  const tbody = document.getElementById("tbody");
  const rows = getRows();
  tbody.innerHTML = "";
  rows.forEach((r, idx)=>{
    const tr = document.createElement("tr"); tr.className = "align-middle";
    const total = parseNum(r.qty) * parseNum(r.unitPrice);
    tr.innerHTML = `
      <td class="py-2 px-2 border border-slate-200 text-center">${idx+1}</td>
      <td class="py-1 px-2 border border-slate-200"><input data-k="supplierItem" value="${r.supplierItem||""}" class="input"/></td>
      <td class="py-1 px-2 border border-slate-200"><input data-k="peakPart" value="${r.peakPart||""}" class="input"/></td>
      <td class="py-1 px-2 border border-slate-200"><input data-k="description" value="${r.description||""}" class="input"/></td>
      <td class="py-1 px-2 border border-slate-200"><input data-k="qty" inputmode="decimal" value="${r.qty}" class="input text-right"/></td>
      <td class="py-1 px-2 border border-slate-200 w-16">
        <input data-k="uom" value="${r.uom||""}" class="input text-center w-14" maxlength="6" placeholder="">
      </td>
      <td class="py-1 px-2 border border-slate-200"><input data-k="unitPrice" inputmode="decimal" value="${r.unitPrice}" class="input text-right"/></td>
      <td class="py-1 px-2 border border-slate-200 text-right font-medium">${money(total)}</td>
      <td class="py-1 px-2 border border-slate-200 text-center"><button class="text-red-600 hover:text-red-800" data-action="del" title="Delete row">✖</button></td>`;

    tr.querySelectorAll("input").forEach(inp=>{
      inp.addEventListener("input", (e)=>{
        const k = e.target.dataset.k;
        const v = (k === "qty" || k === "unitPrice") ? parseNum(e.target.value) : e.target.value;
        const arr = getRows(); arr[idx][k] = v; setRows(arr); updateFooter();
        tr.querySelector("td:nth-last-child(2)").textContent = money(parseNum(arr[idx].qty) * parseNum(arr[idx].unitPrice));
      });
      inp.addEventListener("keydown", (e)=>{ if (e.key === "Enter"){ const inputs = [...tbody.querySelectorAll("input")]; const i = inputs.indexOf(e.target); if (i > -1 && i + 1 < inputs.length) inputs[i+1].focus(); } });
    });
    tr.querySelector('[data-action="del"]').addEventListener("click", ()=>{ removeRow(idx); renderTable(); });
    tbody.appendChild(tr);
  });
  updateFooter();
}

export function updateFooter(){
  const rows = getRows();
  const subtotal = rows.reduce((acc,r)=> acc + parseNum(r.qty) * parseNum(r.unitPrice), 0);
  const tax = +(subtotal * 0.13).toFixed(2);
  const grand = subtotal + tax;
  document.getElementById("subTotal").textContent = money(subtotal);
  document.getElementById("hstAmount").textContent = money(tax);
  document.getElementById("grandTotal").textContent = money(grand);
  [...document.querySelectorAll("#tbody tr")].forEach((tr,i)=> tr.children[0].textContent = i+1);
}

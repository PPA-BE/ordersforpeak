function toast(msg, isError = false) {
  const toastEl = document.getElementById("toast");
  if (toastEl) {
    toastEl.textContent = msg;
    toastEl.style.background = isError ? "#b91c1c" : "#16a34a";
    toastEl.classList.remove("hidden");
    setTimeout(() => toastEl.classList.add("hidden"), 2500);
  } else {
    isError ? console.error(msg) : console.log(msg);
  }
}

export async function createPO(payload) {
  const res = await fetch("/api/po-create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create PO in DB: ${res.status} ${body}`);
  }
  return res.json();
}

export async function saveEpicorPoNumber(id, epicorPoNumber) {
  const res = await fetch("/api/po-set-epicor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, epicorPoNumber }),
  });

  if (!res.ok) {
    const body = await res.text();
    toast(`Failed to save Epicor PO #: ${body}`, true);
    throw new Error(`API Error: ${res.status} ${body}`);
  }
  return res.json();
}

export async function updatePoStatus(id, status) {
  const res = await fetch(`/api/po-update-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, status }),
  });

  if (!res.ok) {
    const body = await res.text();
    toast(`Failed to update PO status: ${body}`, true);
    throw new Error(`API Error: ${res.status} ${body}`);
  }
  return res.json();
}

export async function markPoAsPaid(id) {
  const res = await fetch("/api/po-mark-paid", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });

  if (!res.ok) {
    const body = await res.text();
    toast(`Failed to mark as paid: ${body}`, true);
    throw new Error(`API Error: ${res.status} ${body}`);
  }
  return res.json();
}

/* ===== NEW: Partial payment API (with header identity + route fallback) ===== */
async function postJsonWithFallback(path1, path2, payload, extraHeaders = {}) {
  // Try primary path
  let res = await fetch(path1, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify(payload),
  });

  // If route not found / not allowed, retry the Netlify direct path
  if (!res.ok && (res.status === 404 || res.status === 405) && path2) {
    try {
      res = await fetch(path2, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...extraHeaders },
        body: JSON.stringify(payload),
      });
    } catch (_) { /* swallow, next block will throw */ }
  }
  if (!res.ok) {
    const body = await res.text();
    toast(`Failed to add payment: ${body}`, true);
    throw new Error(`API Error: ${res.status} ${body}`);
  }
  return res.json();
}

export async function addPoPayment({ id, amount, method, note }) {
  // Best-effort to attach identity so the function can fill paid_by/actor
  let userEmail = undefined, userName = undefined;
  try {
    const acct = (window.msalInstance?.getActiveAccount?.() || (window.msalInstance?.getAllAccounts?.()[0])) || null;
    userEmail = acct?.username || undefined;
    userName  = acct?.name || acct?.idTokenClaims?.name || undefined;
  } catch { /* ignore */ }

  const headers = {};
  if (userEmail) headers["X-User-Email"] = userEmail;
  if (userName)  headers["X-User-Name"]  = userName;

  return postJsonWithFallback(
    "/api/po-add-payment",
    "/.netlify/functions/po-add-payment",
    { id, amount, method, note },
    headers
  );
}

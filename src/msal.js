export const msalConfig = {
  auth: {
    clientId: "4411014f-9e13-4f98-8bb0-3b24479163b0",
    authority: "https://login.microsoftonline.com/9949b150-278e-46cf-8570-031db4e15283",
    redirectUri: window.location.origin + window.location.pathname,
  },
  cache: { cacheLocation: "localStorage", storeAuthStateInCookie: true },
  system: { loggerOptions: { loggerCallback: (level, message, containsPii) => { if (!containsPii) console.log("[MSAL]", message); }, logLevel: msal.LogLevel.Info } }
};
export const GRAPH_SCOPES = ["User.Read","User.Read.All","Sites.Read.All"];

export const msalInstance = new msal.PublicClientApplication(msalConfig);
export let currentAccount = null;

function setActiveAccount(acct){ if (!acct) acct = msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0] || null; if (acct) { msalInstance.setActiveAccount(acct); currentAccount = acct; } return acct; }

export async function initAuth({ onReady }){
  try {
    const resp = await msalInstance.handleRedirectPromise();
    if (resp?.account) setActiveAccount(resp.account);
  } catch (e) { console.error("handleRedirectPromise", e); }
  setActiveAccount();
  if (currentAccount) { onReady?.(); return; }
  const FLAG = "msal_login_in_flight";
  if (!sessionStorage.getItem(FLAG)) {
    sessionStorage.setItem(FLAG, "1");
    msalInstance.loginRedirect({ scopes:["User.Read"], prompt:"select_account", navigateToLoginRequestUrl:false });
  }

  msalInstance.addEventCallback((evt)=>{
    const ok = evt.eventType === msal.EventType.LOGIN_SUCCESS || evt.eventType === msal.EventType.ACQUIRE_TOKEN_SUCCESS;
    if (ok && evt.payload?.account){ setActiveAccount(evt.payload.account); sessionStorage.removeItem("msal_login_in_flight"); onReady?.(); }
  });
}

export async function revealAppUI(){
  // show the app
  document.getElementById("authGate")?.classList.add("hidden");
  document.getElementById("app")?.classList.remove("hidden");

  const who = document.getElementById("whoami");
  if (!who) return;

  // Try Graph for friendly identity (no email)
  try {
    const account = currentAccount || msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0];
    const { accessToken } = await msalInstance.acquireTokenSilent({
      account,
      scopes: ["User.Read"] // already included in GRAPH_SCOPES
    });

    const resp = await fetch("https://graph.microsoft.com/v1.0/me?$select=displayName,department,jobTitle", {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (resp.ok) {
      const me = await resp.json();
      window.__meProfile = me;
      const parts = [me.displayName, me.department, me.jobTitle].filter(Boolean);
      who.textContent = parts.join(" — ") || (account?.name || "");
      return;
    }
  } catch (_) {
    // ignore and fall through to fallback
  }

  // Fallback if Graph call fails
  who.textContent = currentAccount?.name || currentAccount?.username || "";
}
export async function getGraphToken(){
  try { const res = await msalInstance.acquireTokenSilent({ account: currentAccount || msalInstance.getActiveAccount(), scopes: GRAPH_SCOPES }); return res.accessToken; }
  catch (e){ if (e instanceof msal.InteractionRequiredAuthError || e.errorCode === "interaction_required"){ await msalInstance.acquireTokenRedirect({ scopes: GRAPH_SCOPES }); return; } throw e; }
}

export async function getFlowToken(){
  const FLOW_SCOPES = ["https://service.flow.microsoft.com//.default"];
  const account = msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0];
  if (!account) throw new Error("No active MSAL account");
  try {
    const res = await msalInstance.acquireTokenSilent({ account, scopes: FLOW_SCOPES });
    return res.accessToken;
  } catch (e) {
    if (e instanceof msal.InteractionRequiredAuthError || e.errorCode === "interaction_required") {
      await msalInstance.acquireTokenRedirect({ scopes: FLOW_SCOPES });
    }
    throw e;
  }
}

export function logout(){
  const acct = msalInstance.getActiveAccount() || msalInstance.getAllAccounts()[0];
  return msalInstance.logoutRedirect({ account: acct });
}

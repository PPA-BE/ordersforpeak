import { getGraphToken } from "./msal.js";
import { normalizeStatus, FINAL_STATUSES } from "./utils.js";
import { getSubmissions, setSubmissions } from "./state.js";

const SPO_SITE_ID = "peakprocessing.sharepoint.com,8ca96fb9-53ff-4eec-b019-fec5eff65550,a9de02e6-a86f-4546-863e-0ad759615013";
const SPO_LIST_ID = "75d66917-dc1b-4efe-bac7-d6498d935e63";

export async function fetchPoStatus(poNumber){
  if (!poNumber) return null;
  const token = await getGraphToken();
  const safePoNumber = String(poNumber).replace(/'/g, "''");
  
  const headers = {
    Authorization: `Bearer ${token}`,
    "ConsistencyLevel": "eventual",
    "Prefer": "HonorNonIndexedQueriesWarningMayFailRandomly"
  };

  const base = `https://graph.microsoft.com/v1.0/sites/${SPO_SITE_ID}/lists/${SPO_LIST_ID}/items`;
  const url = `${base}?$filter=fields/Title eq '${safePoNumber}'&$expand=fields&$top=1`;

  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
        const errorText = await response.text();
        console.error(`Graph API failed with status ${response.status} for PO ${poNumber}. Response: ${errorText}`);
        return null;
    }
    
    const data = await response.json();
    const item = (data.value || [])[0];
    if (!item) return null;
    
    const f = item.fields || {};
    return { 
      status: f.Status || "Submitted", 
      outcome: f.Outcome || "", 
      approver: f.Approver || "", 
      comments: f.Comments || "", 
      updatedUtc: f.UpdatedUtc || item.lastModifiedDateTime 
    };
  } catch (e){
    console.error(`Network or other error fetching status for PO ${poNumber}:`, e);
    return null;
  }
}

export function startListStatusPolling(poNumber, onUpdate){
  let tries = 0; const maxTries = 120; const intervalMs = 5000;
  const timer = setInterval(async ()=>{
    tries++;
    try {
      // Before fetching, check if the PO now has an Epicor number and stop if it does.
      const currentSubs = getSubmissions();
      const currentItem = currentSubs.find(x => x.po_number === poNumber);
      if (currentItem?.meta?.epicorPoNumber) {
        clearInterval(timer);
        return;
      }
      
      const s = await fetchPoStatus(poNumber);
      if (s && s.status){
        const subs = getSubmissions();
        const i = subs.findIndex(x => x.po_number === poNumber);
        
        if (i > -1){
          const oldStatus = normalizeStatus(subs[i].status);
          const newStatus = normalizeStatus(s.status);

          if (oldStatus !== newStatus) {
            subs[i].status = newStatus;
            subs[i].statusDetails = s;
            subs[i].statusUpdatedUtc = s.updatedUtc;
            setSubmissions(subs);
            onUpdate?.();
          }
        }
        if (FINAL_STATUSES.has(normalizeStatus(s.status))) {
            clearInterval(timer);
        }
      }
    } catch(err) {
      console.error(`Polling error for ${poNumber}`, err);
    }
    if (tries >= maxTries) {
        clearInterval(timer);
    }
  }, intervalMs);
}

// Export normalizeStatus so other modules like app.js can use it
export { normalizeStatus };
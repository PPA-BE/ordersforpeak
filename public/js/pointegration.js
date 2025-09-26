// /public/js/poIntegration.js
export async function createPO(payload) {
  const r = await fetch('/.netlify/functions/po-create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-user-email': payload.createdBy || ''
    },
    body: JSON.stringify(payload)
  });
  if (!r.ok) {
    const e = await r.text();
    throw new Error('po-create ' + r.status + ' ' + e);
  }
  return r.json();
}

export async function listPO(params = {}) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch('/.netlify/functions/po-list' + (qs ? `?${qs}` : ''));
  if (!r.ok) throw new Error('po-list ' + r.status);
  return r.json();
}

/**
 * Call initPOIntegration({ getUserEmail, onToast }) AFTER the form & button exist.
 * The button must have: data-action="send-for-approval"
 */
export function initPOIntegration({ getUserEmail = () => null, onToast = (m) => console.log(m) } = {}) {
  const buttons = document.querySelectorAll('[data-action="send-for-approval"]');
  if (!buttons.length) {
    console.warn('initPOIntegration: no [data-action="send-for-approval"] button found.');
  }

  buttons.forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();

      // Prefer the closest form; fallback to the first form on the page.
      const form = btn.closest('form') || document.querySelector('form');
      if (!form) {
        onToast('PO form not found on page');
        return;
      }

      const email = getUserEmail();
      if (!email) {
        onToast('Missing user email — cannot create PO');
        return;
      }

      // Read vendor fields from THIS form
      const vendor = {
        id: form.querySelector('[name="vendor_id"]')?.value || null,
        name: form.querySelector('[name="vendor_name"]')?.value || null,
        address1: form.querySelector('[name="vendor_address1"]')?.value || null,
        city: form.querySelector('[name="vendor_city"]')?.value || null,
        state: form.querySelector('[name="vendor_state"]')?.value || null,
        zip: form.querySelector('[name="vendor_zip"]')?.value || null
      };

      // Line items: only inside THIS form
      const items = Array.from(form.querySelectorAll('[data-item-row]'))
        .map((row) => ({
          description: row.querySelector('[name="description"]')?.value?.trim() || '',
          qty: Number(row.querySelector('[name="qty"]')?.value || 1),
          unitPrice: Number(row.querySelector('[name="unitPrice"]')?.value || 0)
        }))
        .filter((x) => x.description.length);

      const payload = {
        createdBy: email,
        department: form.querySelector('[name="department"]')?.value || null,
        currency: form.querySelector('[name="currency"]')?.value || 'CAD',
        vendor,
        items,
        status: 'Submitted',
        meta: { source: 'UI' }
      };

      try {
        const out = await createPO(payload);
        onToast('PO submitted: ' + out.id);
        // Emit an event you can listen to (optional)
        btn.dispatchEvent(new CustomEvent('po:submitted', { bubbles: true, detail: out }));
      } catch (err) {
        console.error(err);
        onToast('Submit failed: ' + err.message);
      }
    });
  });

  return { createPO, listPO };
}


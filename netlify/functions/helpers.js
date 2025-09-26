export function getMethod(evt) {
  return evt?.httpMethod || evt?.request?.method || evt?.method || 'GET';
}

export async function readJson(evt) {
  try {
    // FIX: Check if the event object itself can be parsed as JSON.
    // This correctly handles ReadableStream from Netlify's v2 functions.
    if (typeof evt?.json === 'function') {
      return await evt.json();
    }
    
    // Legacy checks for other environments
    if (evt?.request && typeof evt.request.json === 'function') return await evt.request.json();
    if (typeof evt?.body === 'string' && evt.body.length) return JSON.parse(evt.body);
    
    return {};
  } catch { 
    return {}; 
  }
}

export function header(evt, name) {
  const h = evt?.headers || evt?.request?.headers;
  if (!h) return undefined;
  return typeof h.get === 'function' ? h.get(name) : (h[name] || h[name.toLowerCase()]);
}

export function parseNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
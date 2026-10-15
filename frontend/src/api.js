// Thin client for the TrueValue FastAPI backend.
export const API_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '');

async function request(path, { method = 'GET', body, timeout = 30000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = Array.isArray(data.detail) ? data.detail.map(d => d.msg).join(', ') : data.detail;
      throw new Error(detail || `Request failed (${res.status})`);
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('The server took too long to answer.');
    if (err instanceof TypeError) throw new Error('Cannot reach the TrueValue server. Is the backend running?');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const q = params => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();

export const api = {
  health: () => request('/api/health', { timeout: 6000 }),
  catalog: () => request('/api/catalog', { timeout: 8000 }),
  card: (productId, weights) => request(`/api/products/${encodeURIComponent(productId)}/card`, { method: 'POST', body: { weights } }),
  disposal: productId => request(`/api/products/${encodeURIComponent(productId)}/disposal`),
  stores: (lat, lon, category) => request(`/api/places/stores?${q({ lat, lon, category })}`, { timeout: 45000 }),
  dropOffs: (lat, lon) => request(`/api/places/drop-offs?${q({ lat, lon })}`, { timeout: 45000 }),
  barcode: (barcode, weights) => request('/api/barcode', { method: 'POST', body: { barcode, weights }, timeout: 30000 }),
  search: query => request(`/api/search?${q({ q: query })}`, { timeout: 45000 }),
  companies: query => request(`/api/companies/search?${q({ q: query })}`),
  chat: (message, weights, location) => request('/api/chat', {
    method: 'POST', timeout: 60000,
    body: { message, weights, location: location && location.source === 'browser' ? { lat: location.lat, lon: location.lon } : null },
  }),
  feedback: record => request('/api/feedback', { method: 'POST', body: record }),
};

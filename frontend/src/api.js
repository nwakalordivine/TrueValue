// Thin client for the TrueValue FastAPI backend. Every call goes through request(), which adds the
// signed-in user's access token and, on a 401, refreshes the session once and retries.
import { API_BASE } from './apiBase.js';
import * as session from './services/session.js';

export { API_BASE };

class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const errorText = data => {
  const detail = Array.isArray(data.detail) ? data.detail.map(d => d.msg).join(', ') : data.detail;
  return typeof detail === 'string' ? detail.replace(/^Value error, /, '') : '';
};

async function send(path, { method, body, timeout, token, keepalive }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const headers = {};
  // A file upload (FormData) goes as is: the browser sets the multipart Content-Type with its boundary
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method, headers, body: body === undefined || isForm ? body : JSON.stringify(body), signal: ctrl.signal, keepalive,
    });
    const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
    return { res, data };
  } catch (err) {
    if (err.name === 'AbortError') throw new ApiError('The server took too long to answer.', 0);
    if (err instanceof TypeError) throw new ApiError('Cannot reach the TrueValue server. Is the backend running?', 0);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// Swap the refresh token for a new pair. A rejected token ends the session here (signed out locally);
// a network failure does not, because being offline is not the same as being signed out.
export async function refreshTokens() {
  const refresh = session.refreshToken();
  if (!refresh) return false;
  try {
    const { res, data } = await send('/api/auth/refresh', { method: 'POST', body: { refresh_token: refresh }, timeout: 15000 });
    if (res.ok) { session.setSession(data); return true; }
    if (res.status === 400 || res.status === 401 || res.status === 422) session.clearSession();
    return false;
  } catch {
    return false;
  }
}

// auth: false for the sign-in calls themselves (no token, never a refresh)
async function request(path, { method = 'GET', body, timeout = 30000, auth = true, keepalive = false } = {}) {
  const token = auth ? session.accessToken() : null;
  let { res, data } = await send(path, { method, body, timeout, token, keepalive });
  if (res.status === 401 && token) {
    // The access token expired (or was revoked): one shared refresh, then try again once.
    // If another request already refreshed while this one was out, just retry with the new token.
    const renewed = session.accessToken() !== token && session.accessToken();
    if (renewed || await session.refreshOnce(refreshTokens)) {
      ({ res, data } = await send(path, { method, body, timeout, token: session.accessToken(), keepalive }));
    }
  }
  if (!res.ok) throw new ApiError(errorText(data) || `Request failed (${res.status})`, res.status);
  return data;
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
  search: (query, limit = 48) => request(`/api/search?${q({ q: query, limit })}`, { timeout: 45000 }),
  companies: query => request(`/api/companies/search?${q({ q: query })}`),
  chat: (message, weights, location) => request('/api/chat', {
    method: 'POST', timeout: 60000,
    body: { message, weights, location: location && location.source === 'browser' ? { lat: location.lat, lon: location.lon } : null },
  }),
  feedback: record => request('/api/feedback', { method: 'POST', body: record }),

  // Accounts
  requestCode: (email, username, mode) => request('/api/auth/request-code', { method: 'POST', auth: false, body: { email, username: username || null, mode: mode || null } }),
  verifyCode: (email, code, username) => request('/api/auth/verify-code', { method: 'POST', auth: false, body: { email, code, username: username || null } }),
  logout: refreshToken => request('/api/auth/logout', { method: 'POST', auth: false, body: { refresh_token: refreshToken }, timeout: 8000 }),
  me: () => request('/api/me'),
  savePreferences: (prefs, { keepalive = false } = {}) => request('/api/me/preferences', { method: 'PUT', body: prefs, keepalive, timeout: 15000 }),

  // Profile
  updateMe: username => request('/api/me', { method: 'PATCH', body: { username } }),
  uploadAvatar: blob => {
    const form = new FormData();
    form.append('file', blob, 'avatar.jpg');
    return request('/api/me/avatar', { method: 'POST', body: form, timeout: 60000 });
  },
  removeAvatar: () => request('/api/me/avatar', { method: 'DELETE' }),
  requestEmailChange: newEmail => request('/api/me/email/request', { method: 'POST', body: { new_email: newEmail } }),
  confirmEmailChange: (newEmail, code) => request('/api/me/email/confirm', { method: 'POST', body: { new_email: newEmail, code } }),
};

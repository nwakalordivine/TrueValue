// The signed-in session: tokens and the user, kept in localStorage. No network calls here (see api.js).
//
// Why localStorage and not cookies: the frontend and the API are on different domains, and Safari often
// blocks the cross-site cookies that httpOnly cookies would need. The access token goes in the
// Authorization header and the refresh token in the request body.
const KEY = 'truevalue-auth-v1';
const listeners = new Set();
let refreshing = null;

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function write(value) {
  try { value ? localStorage.setItem(KEY, JSON.stringify(value)) : localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}
const notify = () => { const user = currentUser(); listeners.forEach(cb => { try { cb(user); } catch { /* a listener must not break others */ } }); };

// The "exp" claim of a JWT, in milliseconds (no signature check: the server does that)
export function tokenExpiry(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '='))).exp * 1000;
  } catch { return 0; }
}

export const accessToken = () => read()?.access_token || null;
export const refreshToken = () => read()?.refresh_token || null;
export const currentUser = () => read()?.user || null;

export function setSession({ access_token, refresh_token, user }) {
  write({ access_token, refresh_token, user: user ?? currentUser() });
  notify();
}

export function setUser(user) {
  const s = read();
  if (!s) return;
  write({ ...s, user });
  notify();
}

export function clearSession() {
  const had = !!read();
  write(null);
  if (had) notify();
}

export function onAuthChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Many requests can fail with 401 at the same moment; they all wait for one shared refresh.
export function refreshOnce(doRefresh) {
  if (!refreshing) refreshing = Promise.resolve().then(doRefresh).catch(() => false).finally(() => { refreshing = null; });
  return refreshing;
}

// Guard: never start a page in a signed-in state whose refresh token has already expired.
const stored = read();
if (stored && (!stored.refresh_token || tokenExpiry(stored.refresh_token) <= Date.now())) write(null);

// Signing in or out in another tab updates this one
if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => { if (e.key === KEY || e.key === null) notify(); });
}

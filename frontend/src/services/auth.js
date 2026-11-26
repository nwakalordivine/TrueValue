// Signing in and out, as the pages use it. Tokens live in session.js; network calls in api.js.
import { api } from '../api.js';
import * as session from './session.js';
import { syncOnLogin, syncOnLoad } from './preferencesSync.js';

export const currentUser = session.currentUser;
export const onAuthChange = session.onAuthChange;

// Step 1: email the 6-digit code. Resolves to { sent, is_new_user }.
export const login = (email, username) => api.requestCode(email.trim(), (username || '').trim());

// Step 2: check the code, start the session, then bring the values in line. Resolves to { user, notice }.
export async function verify(email, code, username) {
  const data = await api.verifyCode(email.trim(), code, (username || '').trim());
  session.setSession(data);
  const notice = await syncOnLogin(data.user);
  return { user: data.user, notice };
}

// Sign out here even if the server cannot be reached. The values stay in this browser.
export async function logout() {
  const refresh = session.refreshToken();
  session.clearSession();
  if (refresh) { try { await api.logout(refresh); } catch { /* the token expires on its own */ } }
}

// Once per page load while signed in: proves the session still works (a failed refresh signs out),
// refreshes the stored user, and syncs the values with the account.
let checked = false;
export async function checkSession() {
  if (checked || !session.currentUser()) return;
  checked = true;
  try {
    const user = await api.me();
    session.setUser(user);
    await syncOnLoad(user);
  } catch {
    // 401 after a failed refresh has already signed out; offline keeps the session for later
  }
}

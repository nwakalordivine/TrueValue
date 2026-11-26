// Keeps a signed-in user's values (weights and budget) in step with their account.
// Guests are never sent anything: their values stay in this browser only (customerValuesService.js).
import users from '../data/userProfiles.json';
import priorityWeights from '../data/priorityWeights.json';
import { api } from '../api.js';
import { loadUser, saveUser } from './customerValuesService.js';
import { currentUser } from './session.js';

// Set while a change has not reached the account yet (a save is waiting, or the last one failed).
// It lives in localStorage so it survives closing the page, and checkSession() then pushes the local
// values instead of loading older ones from the server.
const UNSYNCED = 'truevalue-prefs-unsynced';
const DELAY = 800;
let timer = null, pending = null;

const flag = on => { try { on ? localStorage.setItem(UNSYNCED, '1') : localStorage.removeItem(UNSYNCED); } catch { /* storage blocked */ } };
export const hasUnsyncedChanges = () => { try { return localStorage.getItem(UNSYNCED) === '1'; } catch { return false; } };

export const localValues = () => loadUser(users[0], priorityWeights);

export function payload(user) {
  const weights = Object.fromEntries(Object.entries(user.weights || {}).map(([k, v]) => [k, Math.min(100, Math.max(0, Number(v) || 0))]));
  return { weights, budget_cad: Math.min(10000, Math.max(0, Number(user.budget_cad) || 0)) };
}

const same = (a, b) => JSON.stringify(payload(a)) === JSON.stringify(payload(b));

// Put the account's values into this browser and tell the open page to redraw
function applyServer(prefs) {
  const local = localValues();
  const merged = { ...local, weights: { ...local.weights, ...(prefs.weights || {}) }, budget_cad: prefs.budget_cad ?? local.budget_cad };
  saveUser(merged);
  window.dispatchEvent(new CustomEvent('truevalue:values', { detail: { user: merged } }));
  return merged;
}

async function push(user, opts) {
  await api.savePreferences(payload(user), opts);
  flag(false);
}

// Right after signing in: an account without saved values takes this browser's values;
// an account with saved values replaces them here. Returns a notice to show, or ''.
export async function syncOnLogin(user) {
  if (!user.preferences) {
    try { await push(localValues()); } catch { flag(true); }
    return '';
  }
  flag(false); // signing in with saved values: the account wins
  applyServer(user.preferences);
  return 'Loaded your saved values.';
}

// On each page load while signed in. A change that has not reached the account yet (made offline,
// or the page closed before it was sent) is pushed instead of being overwritten by older server values.
export async function syncOnLoad(user) {
  const local = localValues();
  if (hasUnsyncedChanges() || !user.preferences) {
    try { await push(local); } catch { flag(true); }
    return;
  }
  if (!same(local, user.preferences)) applyServer(user.preferences);
}

// While signed in: save to the account 800ms after the last change. onStatus('saving' | 'saved' | 'error').
export function queueSave(user, onStatus = () => {}) {
  if (!currentUser()) return false;
  flag(true);
  pending = { user, onStatus };
  clearTimeout(timer);
  onStatus('saving');
  timer = setTimeout(flush, DELAY);
  return true;
}

async function flush({ keepalive = false } = {}) {
  clearTimeout(timer);
  timer = null;
  const job = pending;
  pending = null;
  if (!job || !currentUser()) return;
  try {
    await push(job.user, { keepalive });
    job.onStatus('saved');
  } catch {
    job.onStatus('error'); // the unsynced flag stays set, so the next page load pushes these values
  }
}

// Leaving the page with a save still waiting: send it now (keepalive lets it finish after the page closes)
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { if (pending) flush({ keepalive: true }); });

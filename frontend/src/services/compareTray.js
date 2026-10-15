// Products the shopper picked to compare (up to 3), shared by every page through localStorage.
// An item is { kind: 'product', id: 'p5', name } for demo products or { kind: 'barcode', id: '3017620422003', name }.
const KEY = 'truevalue-compare-v1';
export const MAX = 3;

export function getTray() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function save(items) {
  try { localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX))); } catch { /* private mode */ }
}
export const inTray = (kind, id) => getTray().some(x => x.kind === kind && x.id === id);

// Returns 'added', 'removed' or 'full'
export function toggle(item) {
  const items = getTray();
  if (items.some(x => x.kind === item.kind && x.id === item.id)) {
    save(items.filter(x => !(x.kind === item.kind && x.id === item.id)));
    return 'removed';
  }
  if (items.length >= MAX) return 'full';
  save([...items, item]);
  return 'added';
}
export function add(item) { return inTray(item.kind, item.id) ? 'added' : toggle(item); }
export function clearTray() { save([]); }

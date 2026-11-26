// Compare page: the products in the compare tray, scored with the same model and the shopper's values.
import { mountShell } from './components/shell.js';
import './styles/compare.css';
import users from './data/userProfiles.json';
import priorityWeights from './data/priorityWeights.json';
import { api } from './api.js';
import { loadUser } from './services/customerValuesService.js';
import { getTray, toggle, clearTray, MAX } from './services/compareTray.js';
import { notifyCompareChanged } from './components/compare.js';
import { esc, money, verdictPill, statusBadge } from './components/views.js';

const content = mountShell({ active: 'compare' });
const user = loadUser(users[0], priorityWeights);

content.innerHTML = `
<div class="content-inner">
  <div class="section-head">
    <h1>Compare</h1>
    <p>Up to ${MAX} products, scored with exactly the same model and your values. Add products with the Compare button on search results, demo products or a result page.</p>
  </div>
  <div id="comparison" class="panel" aria-live="polite"></div>
</div>`;

const box = document.getElementById('comparison');
const link = t => `/result.html?${t.kind === 'product' ? 'product' : 'barcode'}=${encodeURIComponent(t.id)}`;

let run = 0;
async function render() {
  const current = ++run;
  const tray = getTray();
  if (!tray.length) {
    box.innerHTML = `<p>Nothing to compare yet.</p><p class="muted">Scan or search products, then choose Compare on up to ${MAX} of them.</p>
      <a class="button" href="/#find">Find a product</a>`;
    return;
  }
  box.innerHTML = '<p class="muted">Scoring your products...</p>';
  const cards = await Promise.all(tray.map(async t => {
    try {
      if (t.kind === 'product') return { t, card: await api.card(t.id, user.weights) };
      const res = await api.barcode(t.id, user.weights);
      return res.found ? { t, card: res.card } : { t, error: res.error };
    } catch (e) { return { t, error: e.message }; }
  }));
  if (current !== run) return; // a newer render started
  const ok = cards.filter(x => x.card);
  const dims = ok.length ? ok[0].card.breakdown.map(r => r.dimension) : [];
  const cell = (card, d) => {
    const r = card.breakdown.find(x => x.dimension === d);
    return r ? `<span class="cmp-score">${r.score === null ? 'Unknown' : r.score}</span> ${statusBadge(r.status)}` : '-';
  };
  box.innerHTML = `
    ${ok.length ? `<div class="table-scroll"><table class="compare-table">
      <thead><tr><th scope="col">Value</th>${ok.map(x => `<th scope="col"><a href="${link(x.t)}">${esc(x.card.name)}</a><small>${x.card.demo_data ? 'Demo product' : 'Real · Open Food Facts'}</small></th>`).join('')}</tr></thead>
      <tbody>
        <tr><th scope="row">True Value score</th>${ok.map(x => `<td><span class="cmp-total">${x.card.score ?? 'N/A'}<small>/100</small></span>${verdictPill(x.card.verdict)}</td>`).join('')}</tr>
        ${dims.map(d => `<tr><th scope="row">${esc(d)}</th>${ok.map(x => `<td>${cell(x.card, d)}</td>`).join('')}</tr>`).join('')}
        <tr><th scope="row">Evidence</th>${ok.map(x => `<td>${x.card.verified_percent}% verified<small>${x.card.coverage_percent}% coverage</small></td>`).join('')}</tr>
        <tr><th scope="row">Price</th>${ok.map(x => `<td>${money(x.card.price)}</td>`).join('')}</tr>
        <tr><th scope="row"><span class="sr-only">Actions</span></th>${ok.map(x => `<td><button type="button" class="button secondary small" data-remove-kind="${esc(x.t.kind)}" data-remove-id="${esc(x.t.id)}">Remove</button></td>`).join('')}</tr>
      </tbody></table></div>` : ''}
    ${cards.filter(x => x.error).map(x => `<p class="muted">Could not score ${esc(x.t.name)}: ${esc(x.error)} <button type="button" class="link" data-remove-kind="${esc(x.t.kind)}" data-remove-id="${esc(x.t.id)}">Remove</button></p>`).join('')}
    <p class="compare-foot"><button type="button" class="button ghost small" id="clearCompare">Clear comparison</button></p>`;
}

box.addEventListener('click', e => {
  const rm = e.target.closest('[data-remove-kind]');
  if (rm) { toggle({ kind: rm.dataset.removeKind, id: rm.dataset.removeId }); notifyCompareChanged(); render(); return; }
  if (e.target.closest('#clearCompare')) { clearTray(); notifyCompareChanged(); render(); }
});
// Another tab changed the tray
window.addEventListener('storage', e => { if (e.key === 'truevalue-compare-v1') render(); });
render();

// Near me page: real stores and recycling drop-offs from OpenStreetMap, sorted by distance.
import { mountShell } from './components/shell.js';
import './styles/nearme.css';
import fbProducts from './data/products.json';
import { api } from './api.js';
import { getLocation, mapEmbedUrl } from './services/locationService.js';
import { esc, placeList, locationLine } from './components/views.js';
import { icon } from './components/icons.js';
import { wireTabs } from './components/tabs.js';

const content = mountShell({ active: 'nearme' });
const state = { location: null, tab: 'stores', category: '' };
const $ = s => document.querySelector(s);

content.innerHTML = `
<div class="content-inner">
  <div class="section-head">
    <h1>Near me</h1>
    <p>Real stores and recycling drop-offs from OpenStreetMap, nearest first. We cannot see store inventory, so stock is always shown as Unknown.</p>
  </div>
  <div class="near-head">
    <span id="locationStatus" class="muted" role="status">Finding your location...</span>
    <button type="button" class="button secondary small" id="useLocation">${icon('locate')}Use my location</button>
  </div>
  <div class="near-controls">
    <div class="tabs" role="tablist" aria-label="What to find">
      <button type="button" role="tab" class="tab" id="tab-stores" aria-controls="nearList" aria-selected="true" data-tab="stores">${icon('store')}Stores</button>
      <button type="button" role="tab" class="tab" id="tab-dropoffs" aria-controls="nearList" aria-selected="false" data-tab="dropoffs">${icon('recycle')}Recycling drop-offs</button>
    </div>
    <label class="near-category"><span class="sr-only">Product category</span>
      <select id="storeCategory"><option value="">All groceries</option></select></label>
  </div>
  <div class="near-grid">
    <div class="panel" id="nearList" role="tabpanel" aria-live="polite"><p class="muted">Loading...</p></div>
    <iframe class="map" id="nearMap" title="Map of your area" loading="lazy"></iframe>
  </div>
</div>`;

async function renderNear() {
  const loc = state.location;
  $('#locationStatus').textContent = locationLine(loc).replace(/<[^>]+>/g, '');
  if (!loc) return;
  $('#nearMap').src = mapEmbedUrl(loc.lat, loc.lon);
  $('#storeCategory').closest('label').hidden = state.tab !== 'stores';
  $('#nearList').setAttribute('aria-labelledby', `tab-${state.tab}`);
  $('#nearList').innerHTML = '<p class="muted">Searching OpenStreetMap...</p>';
  try {
    if (state.tab === 'stores') {
      const res = await api.stores(loc.lat, loc.lon, state.category || undefined);
      $('#nearList').innerHTML = placeList(res.items, { kind: 'stores' });
    } else {
      const res = await api.dropOffs(loc.lat, loc.lon);
      $('#nearList').innerHTML = '<p class="muted">SARCAN depots take glass, flexible plastics and deposit containers (refund).</p>'
        + placeList(res.items, { kind: 'dropoffs', emptyText: 'No drop-off points found nearby.' })
        + `<p class="muted"><a href="https://www.sarcan.ca/" target="_blank" rel="noopener noreferrer">All SARCAN depots${icon('external', 14)}<span class="sr-only"> (opens in a new tab)</span></a></p>`;
    }
  } catch (e) { $('#nearList').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}

async function locate(force = false) {
  $('#locationStatus').textContent = 'Finding your location...';
  state.location = await getLocation({ force });
  renderNear();
}

async function loadCategories() {
  let products = fbProducts;
  try { products = (await api.catalog()).products; } catch { /* bundled demo data */ }
  const cats = [...new Set(products.map(p => p.category).filter(Boolean))];
  $('#storeCategory').innerHTML = '<option value="">All groceries</option>' + cats.map(c => `<option>${esc(c)}</option>`).join('');
}

wireTabs(document.querySelector('.near-controls .tabs'), tab => {
  state.tab = tab.dataset.tab;
  $('#nearList').hidden = false; // both tabs share one panel
  renderNear();
});
$('#useLocation').addEventListener('click', () => locate(true));
$('#storeCategory').addEventListener('change', e => { state.category = e.target.value; renderNear(); });
loadCategories();
locate(); // asks the browser for location; falls back to downtown Regina

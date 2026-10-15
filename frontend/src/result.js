// Result page: one product, one clear answer. Opened as
//   /result.html?barcode=3017620422003   (scan, photo, typed barcode)
//   /result.html?product=p5              (a product picked from the list)
import './styles.css';
import './result.css';
import users from './data/userProfiles.json';
import priorityWeights from './data/priorityWeights.json';
import { api } from './api.js';
import { loadUser } from './services/customerValuesService.js';
import { getLocation } from './services/locationService.js';
import { esc, money, placeList, disposalView } from './components/views.js';
import { add as addToCompare, getTray, MAX as TRAY_MAX } from './services/compareTray.js';

const user = loadUser(users[0], priorityWeights);
const params = new URLSearchParams(location.search);
const barcode = params.get('barcode');
const productId = params.get('product');
const $ = s => document.querySelector(s);
const app = $('#app');

const shell = inner => `
  <header class="r-top">
    <button class="r-icon" id="back" aria-label="Back">‹</button>
    <span class="r-brand">TRUE VALUE</span>
    <a class="r-icon" href="/#scanner" aria-label="Scan another product">▥</a>
  </header>
  <main class="r-main">${inner}</main>`;

const DOT = { Verified: 'dot verified', Claimed: 'dot claimed', Unknown: 'dot unknown' };

function render(res) {
  const c = res.card;
  const off = res.source === 'openfoodfacts';
  const pc = c.price_context;
  const sub = [c.brand, pc ? `${money(pc.price).replace(' CAD', '')} at ${pc.retailer}` : null].filter(Boolean).join(' · ');
  const score = c.score ?? 0;
  const alts = (c.alternatives || []).slice(0, 3);

  app.innerHTML = shell(`
    <p class="r-kicker">${barcode ? 'Scanned product' : 'Product'} <span class="r-tag ${off ? 'real' : 'demo'}">${off ? 'Real · Open Food Facts' : 'Demo product'}</span></p>
    <h1 class="r-title">${esc(c.name)}${c.size ? `, ${esc(c.size)}` : ''}</h1>
    <p class="r-sub">${esc(sub || (off ? 'Label and community data' : ''))}</p>

    <div class="r-grid">
    <div class="r-col">
    <section class="r-hero">
      <div class="r-score"><b>${c.score ?? 'N/A'}</b><span>out of 100<br><strong>matched to your priorities</strong></span></div>
      <div class="r-bar"><i style="width:${score}%"></i></div>
      <p>${esc(c.verdict.sentence)}</p>
      <div class="r-chips">
        <span class="r-chip">${esc(c.verdict.label)}</span>
        <span class="r-chip">✓ Based on ${c.verified_percent}% verified data</span>
      </div>
    </section>

    <div class="r-tiles">
      <div class="r-tile"><small>Price vs category</small><strong>${pc ? `${money(pc.price).replace(' CAD', '')}${pc.vs_average_percent !== null && pc.category_count > 1 ? ` · ${Math.abs(pc.vs_average_percent)}% ${pc.vs_average_percent <= 0 ? 'below' : 'above'} avg` : ''}` : 'Price unknown'}</strong></div>
      <div class="r-tile"><small>Nearest store</small><strong id="nearest">Finding…</strong></div>
    </div>

    ${c.could_change ? `<p class="r-note">${esc(c.could_change)}</p>` : ''}

    ${alts.length ? `<div class="r-alts"><h2 class="r-h2">Consider instead</h2>
    ${alts.map(a => `<a class="r-alt" href="/result.html?product=${encodeURIComponent(a.product_id)}">
        <span class="r-alt-score">${a.score}</span>
        <span><strong>${esc(a.name)}</strong><small>+${a.score_delta} points${a.price_delta === null ? '' : a.price_delta === 0 ? ' · same price' : ` · $${Math.abs(a.price_delta).toFixed(2)} ${a.price_delta > 0 ? 'more' : 'less'}`}${a.same_category ? '' : ` · ${esc(a.category)}`}</small></span>
        <span class="r-chev">›</span></a>`).join('')}</div>` : ''}

    <div class="r-actions">
      <button class="r-btn ghost" id="whereBuy">Where to buy</button>
      <button class="r-btn solid" id="compareBtn">＋ Compare</button>
    </div>
    </div>
    <div class="r-col">
    <section class="r-card r-why">
      <div class="r-head"><h2>Why this score</h2>
        <span class="r-legend"><i class="dot verified"></i>Verified <i class="dot claimed"></i>Claimed <i class="dot unknown"></i>Unknown</span></div>
      ${c.breakdown.filter(r => r.weight > 0).map(r => `
        <div class="r-row">
          <i class="${DOT[r.status] || 'dot unknown'}" title="${esc(r.status)}"></i>
          <div><strong>${esc(r.dimension)}</strong><small>${esc(r.note || '')}</small></div>
          <b class="${r.score === null ? 'na' : ''}">${r.score ?? 'n/a'}</b>
        </div>`).join('')}
    </section>

    <details class="r-card r-dispose"><summary>♻️ How to dispose of the packaging</summary>${disposalView(res.disposal)}</details>

    <section class="r-card" id="stores" hidden>
      <h2>Where to buy near you</h2>
      <div id="storeList"><p class="r-muted">Finding stores…</p></div>
    </section>

    <p class="r-muted r-foot">${off ? 'Open Food Facts data comes from product labels and volunteers, so it is shown as Claimed.' : 'Demo product: its claims and prices are fictional.'} Scoring model ${esc(c.model_version)}.</p>

    </div>
    </div>`);

  $('#back').onclick = () => (history.length > 1 ? history.back() : (location.href = '/'));
  $('#whereBuy').onclick = () => { $('#stores').hidden = false; $('#stores').scrollIntoView({ behavior: 'smooth' }); };
  $('#compareBtn').onclick = () => {
    const item = barcode ? { kind: 'barcode', id: barcode, name: c.name } : { kind: 'product', id: productId, name: c.name };
    if (addToCompare(item) === 'full') {
      if (!confirm(`You already have ${TRAY_MAX} products to compare (${getTray().map(x => x.name).join(', ')}). Open the comparison to remove one?`)) return;
    }
    location.href = '/#compare';
  };
  loadStores(c.category);
}

async function loadStores(category) {
  const loc = await getLocation();
  try {
    const res = await api.stores(loc.lat, loc.lon, category || undefined);
    const s = res.items[0];
    $('#nearest').textContent = s ? `${s.name} · ${s.distance_km} km` : 'None found';
    $('#storeList').innerHTML = `<p class="r-muted">${loc.source === 'browser' ? 'Near you' : 'Near downtown Regina (location not shared)'}. Stock is not confirmed.</p>` + placeList(res.items.slice(0, 5));
  } catch (e) {
    $('#nearest').textContent = 'Unavailable';
    $('#storeList').innerHTML = `<p class="r-muted">${esc(e.message)}</p>`;
  }
}

function message(title, text) {
  app.innerHTML = shell(`<section class="r-card r-empty"><h1 class="r-title">${esc(title)}</h1><p>${esc(text)}</p>
    <a class="r-btn solid" href="/#scanner">Scan another product</a></section>`);
  $('#back').onclick = () => (location.href = '/');
}

async function init() {
  app.innerHTML = shell('<div class="r-loading"><span></span><p>Checking the evidence…</p></div>');
  $('#back').onclick = () => (location.href = '/');
  try {
    if (barcode) {
      const res = await api.barcode(barcode, user.weights);
      if (!res.found) return message(`Barcode ${barcode}`, res.error);
      render(res);
    } else if (productId) {
      const [card, disposal] = await Promise.all([api.card(productId, user.weights), api.disposal(productId)]);
      render({ found: true, source: 'demo', card, disposal });
    } else {
      message('No product selected', 'Scan, upload or type a barcode on the main page first.');
    }
  } catch (e) {
    message('Something went wrong', e.message);
  }
}
init();

import './styles.css';
// Bundled copies of the demo data: used only if the backend is unreachable, so the page never goes blank.
import fbProducts from './data/products.json';
import fbCompanies from './data/companies.json';
import fbCertifications from './data/certifications.json';
import fbProductCertifications from './data/productCertifications.json';
import fbClaims from './data/claims.json';
import fbSources from './data/dataSources.json';
import fbDimensions from './data/ethicalDimensions.json';
import users from './data/userProfiles.json';
import priorityWeights from './data/priorityWeights.json';
import fbRetailers from './data/retailers.json';
import fbPrices from './data/priceObservations.json';
import { api } from './api.js';
import { calculateMatch, rankProducts } from './services/scoringService.js';
import { loadUser, saveUser } from './services/customerValuesService.js';
import { scoreExplanation } from './components/ScoreExplanation.js';
import { saveFeedback } from './services/feedbackService.js';
import { getLocation, mapEmbedUrl } from './services/locationService.js';
import { alternativeRecommendations } from './services/recommendationService.js';
import { esc, money, placeList, disposalView, locationLine, verdictPill, scanResultView } from './components/views.js';
import { startCamera, stopCamera, scanImage } from './services/barcodeScanner.js';
import { getTray, toggle as toggleTray, inTray, clearTray, MAX as TRAY_MAX } from './services/compareTray.js';

let products = fbProducts, companies = fbCompanies, certifications = fbCertifications,
  productCertifications = fbProductCertifications, claims = fbClaims, sources = fbSources,
  dimensions = fbDimensions, retailers = fbRetailers, prices = fbPrices;
let online = false;

const user = loadUser(users[0], priorityWeights);
const state = { user, search: '', selected: new Set(['p1', 'p3']), details: 'p1', budgetOnly: false,
  location: null, nearTab: 'stores', storeCategory: '' };
const $ = s => document.querySelector(s);
const priceFor = p => { const obs = prices.filter(o => o.product_id === p.product_id); return obs.length ? Math.min(...obs.map(o => o.price)) : null; };
const match = p => calculateMatch(p, dimensions, state.user.weights, claims, state.user.user_id);
const categories = () => [...new Set(products.map(p => p.category))];

$('#app').innerHTML = `
<header class="topbar">
  <a class="brand" href="#home">🌿 TrueValue</a>
  <nav aria-label="Main navigation">
    <a href="#values">My Values</a>
    <a href="#find">🔎 Find a product</a>
    <a href="#compare">Compare</a>
    <a href="#transparency">Evidence</a>
    <a href="#local">Near Me</a>
    <a href="#feedback">Feedback</a>
    <a class="nav-cta" href="/chat.html">💬 Ask TrueValue</a>
  </nav>
</header>

<main>
  <section class="hero" id="home">
    <div class="hero-inner">
      <p class="welcome-message">🌿 Hello, TrueValuer! 👋</p>
      <span class="eyebrow">THE ETHICAL CONSUMER COMPASS</span>
      <h1>Shop by your values.<br><em>Trust the evidence.</em></h1>
      <p>Find products that fit your priorities, understand the claims behind every score, find them near you, and learn how to dispose of the packaging responsibly.</p>
      <a class="button" href="#values">Set my values →</a>
      <a class="button outline" href="#find">Scan or search a product</a>
      <a class="button outline" href="/chat.html">💬 Ask the assistant</a>
    </div>
  </section>

  <div class="notice" role="note">
    <strong>Real data:</strong> products you scan or search (Open Food Facts), the federal company registry, nearby stores and recycling drop-offs (OpenStreetMap), and City of Regina recycling rules.
    🧪 <strong>Demo data:</strong> the two sample products and their prices are fictional.
    <span id="apiStatus" class="api-status"></span>
  </div>

  <section class="section" id="values">
    <div class="section-head">
      <span class="eyebrow">01 · CUSTOMER VALUES</span>
      <h2>What matters most to you?</h2>
      <p>Drag to set how much each value matters. Changes apply instantly and are saved in this browser automatically, so every result, comparison and the assistant use them.</p>
    </div>
    <div class="panel">
      <div id="sliders"></div>
      <div class="budget">
        <label for="budget">Maximum price (CAD)</label>
        <input id="budget" type="number" min="0" step="0.50" value="${state.user.budget_cad}" />
      </div>
      <p id="saveStatus" role="status" class="muted">✓ Saved automatically</p>
    </div>
  </section>

  <section class="section alternate" id="find">
    <div class="section-head">
      <span class="eyebrow">02 · FIND A PRODUCT</span>
      <h2>Scan it, snap it, type it or search it</h2>
      <p>Pick how you want to find the product. Real products come from Open Food Facts; your result opens on its own page with the score, the reasons and better options.</p>
    </div>
    <div class="panel finder">
      <div class="mode-tabs" role="tablist" aria-label="How to find a product">
        <button type="button" role="tab" class="mode-tab active" data-mode="scan">📷 Scan barcode</button>
        <button type="button" role="tab" class="mode-tab" data-mode="upload">🖼️ Upload photo</button>
        <button type="button" role="tab" class="mode-tab" data-mode="type">🔢 Type barcode</button>
        <button type="button" role="tab" class="mode-tab" data-mode="search">🔎 Search by name</button>
      </div>
      <div class="mode-panel" data-panel="scan">
        <div id="barcode-reader" class="barcode-reader"></div>
        <button type="button" class="camera-box" id="startScanner"><span>📷</span><strong>Tap to open the camera</strong><small>Point it at the barcode on the package</small></button>
        <button type="button" class="secondary" id="stopScanner" hidden>Stop camera</button>
      </div>
      <div class="mode-panel" data-panel="upload" hidden>
        <label class="camera-box" for="barcodeImage"><span>🖼️</span><strong>Choose a photo of the barcode</strong><small>A close, sharp, well-lit photo works best</small></label>
        <input type="file" id="barcodeImage" accept="image/*" hidden>
        <div id="barcode-file-reader" hidden></div>
      </div>
      <div class="mode-panel" data-panel="type" hidden>
        <form id="barcodeForm" class="finder-form">
          <input id="barcodeInput" inputmode="numeric" autocomplete="off" placeholder="Barcode number, e.g. 3017620422003" maxlength="20" aria-label="Barcode number">
          <button type="submit">Look up</button>
        </form>
        <p class="muted">The number under the barcode lines (8 to 14 digits).</p>
      </div>
      <div class="mode-panel" data-panel="search" hidden>
        <form id="searchForm" class="finder-form">
          <input id="searchInput" type="search" autocomplete="off" placeholder="Product or brand, e.g. peanut butter, Kraft, oat milk" aria-label="Product name">
          <button type="submit">Search</button>
        </form>
        <div id="searchResults" class="search-results"></div>
      </div>
      <p id="scannerStatus" role="status" class="muted"></p>
    </div>
    <h3 class="sub-head">Or try a demo product</h3>
    <div id="productsList" class="products-grid"></div>
  </section>

  <section class="section" id="compare">
    <div class="section-head">
      <span class="eyebrow">03 · COMPARE</span>
      <h2>Compare products fairly</h2>
      <p>Add up to three products with “＋ Compare” (from search results, demo products or a result page). They are scored with exactly the same model and your values.</p>
    </div>
    <div class="panel" id="comparison"></div>
  </section>

  <section class="section alternate" id="transparency">
    <div class="section-head">
      <span class="eyebrow">04 · EVIDENCE</span>
      <h2>Why this score?</h2>
      <p>Every assessment is linked to a status and source. Unknown is not zero, and claimed is not verified.</p>
    </div>
    <div class="panel verdict-panel" id="verdictPanel" hidden></div>
    <div class="panel" id="evidencePanel"></div>
    <div class="panel recommendations">
      <h3>Better-matching alternatives</h3>
      <div id="alternatives"></div>
    </div>
    <div class="two-col">
      <div class="panel">
        <h3>🛒 Where to buy near you</h3>
        <div id="buyNear"><p class="muted">Finding stores…</p></div>
      </div>
      <div class="panel">
        <h3>♻️ How to dispose of the packaging</h3>
        <div id="disposeInfo"></div>
      </div>
    </div>
  </section>

  <section class="section" id="local">
    <div class="section-head">
      <span class="eyebrow">05 · NEAR YOU</span>
      <h2>Shop and recycle nearby</h2>
      <p>Real stores and recycling drop-offs from OpenStreetMap, sorted by distance from you. We can't see store inventory, so stock is always shown as Unknown.</p>
    </div>
    <div class="near-head">
      <span id="locationStatus" class="muted">Finding your location…</span>
      <button class="secondary" id="useLocation">📍 Use my location</button>
    </div>
    <div class="tabs" role="tablist">
      <button role="tab" class="tab active" data-tab="stores">🛒 Stores</button>
      <button role="tab" class="tab" data-tab="dropoffs">♻️ Recycling drop-offs</button>
      <select id="storeCategory" aria-label="Product category"><option value="">All groceries</option></select>
    </div>
    <div class="near-grid">
      <div class="panel" id="nearList"><p class="muted">Loading…</p></div>
      <iframe class="map" id="nearMap" title="Map of your area" loading="lazy"></iframe>
    </div>
  </section>

  <section class="section alternate" id="feedback">
    <div class="section-head">
      <span class="eyebrow">06 · FEEDBACK</span>
      <h2>Help improve the evidence</h2>
      <p>Report an error or missing source. It goes straight to the TrueValue team for review; it never automatically changes scores.</p>
    </div>
    <form id="feedbackForm" class="panel feedback-form">
      <label>Product <select name="product" id="feedbackProduct"></select></label>
      <label>Issue
        <select name="issue">
          <option value="incorrect-claim">Incorrect claim</option>
          <option value="missing-source">Missing source</option>
          <option value="outdated-price">Outdated price</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>Explanation <textarea name="message" required maxlength="1000" rows="4" placeholder="What should be reviewed?"></textarea></label>
      <button type="submit">Submit feedback</button>
      <p role="status" id="feedbackStatus"></p>
    </form>
  </section>
</main>

<a class="chat-fab" href="/chat.html" aria-label="Ask the TrueValue assistant">💬</a>
<footer>🌿 TrueValue · Shop by your values. Trust the evidence. · Tech Skills Showcase 2026 prototype</footer>`;

function renderStatic() {
  $('#sliders').innerHTML = dimensions.map(d => `<label class="slider-row"><span>${d.icon} <strong>${esc(d.label)}</strong><small>${esc(d.description)}</small></span><input type="range" min="0" max="100" step="5" data-weight="${d.dimension_id}" value="${state.user.weights[d.dimension_id] ?? d.default_weight}"><output data-output="${d.dimension_id}">${state.user.weights[d.dimension_id] ?? d.default_weight}</output></label>`).join('');
  $('#feedbackProduct').innerHTML = products.map(p => `<option value="${p.product_id}">${esc(p.name)}</option>`).join('');
  $('#storeCategory').innerHTML = '<option value="">All groceries</option>' + categories().map(c => `<option ${c === state.storeCategory ? 'selected' : ''}>${esc(c)}</option>`).join('');
}

function render() {
  const ranked = rankProducts(products, dimensions, state.user.weights, claims);
  const demos = ranked.length > 1 ? [ranked[0], ranked[ranked.length - 1]] : ranked; // best and weakest fit, for contrast
  $('#productsList').innerHTML = demos.map(p => { const s = match(p); return `<article class="product-card"><div class="product-icon">${p.emoji}</div><div class="product-info"><p class="muted">${esc(p.brand)} · ${esc(p.category)} · demo</p><h3>${esc(p.name)}</h3><p class="muted">${esc(p.size)} · GTIN ${p.barcode}</p><strong>${money(priceFor(p))}</strong></div><div class="match"><strong>${s.raw_score === null ? 'N/A' : s.raw_score + '/100'}</strong><span>Match on known criteria</span><small>${s.coverage_percent}% evidence coverage</small></div><div class="card-actions"><a class="button" href="/result.html?product=${p.product_id}">See result →</a><button class="secondary" data-details="${p.product_id}">Evidence</button>${compareButton('product', p.product_id, p.name)}</div></article>`; }).join('');
  renderCompare();
  const p = products.find(x => x.product_id === state.details) || products[0];
  $('#evidencePanel').innerHTML = scoreExplanation(p, match(p), companies, sources, certifications, productCertifications);
  const alternatives = alternativeRecommendations(p, products, dimensions, state.user.weights, claims, prices);
  $('#alternatives').innerHTML = alternatives.length ? alternatives.map(a => `<p><strong>${esc(a.product.name)}</strong> · Match +${a.score_delta} points · Price difference ${a.price_delta >= 0 ? '+' : ''}${money(a.price_delta)} · <button class="link" data-details="${a.product.product_id}">See evidence</button></p>`).join('') : '<p class="muted">No better-matching alternative among the current demo products.</p>';
  renderVerdict(p);
}

// ----- True Value Card verdict (from the backend; hidden if offline) -----
let verdictTimer;
function renderVerdict(p) {
  clearTimeout(verdictTimer);
  if (!online) { $('#verdictPanel').hidden = true; return; }
  verdictTimer = setTimeout(async () => {
    try {
      const card = await api.card(p.product_id, state.user.weights);
      const current = products.find(x => x.product_id === state.details) || products[0];
      if (current.product_id !== p.product_id) return; // user already picked another product
      $('#verdictPanel').hidden = false;
      $('#verdictPanel').innerHTML = `<div class="verdict-head"><span class="big-score">${card.score ?? 'N/A'}<small>/100</small></span>
        <div><p class="muted">True Value Score for ${esc(card.name)}, matched to your priorities</p>
        <h3>${verdictPill(card.verdict)} ${esc(card.verdict.sentence)}</h3>
        <p>${esc(card.verdict.reason || '')}</p>
        <p class="muted">Based on ${card.verified_percent}% verified data · ${card.coverage_percent}% evidence coverage</p></div></div>`;
    } catch { $('#verdictPanel').hidden = true; }
  }, 250);
}

// ----- Evidence: where to buy + disposal for the selected product -----
async function renderProductContext() {
  const p = products.find(x => x.product_id === state.details) || products[0];
  const loc = state.location;
  $('#disposeInfo').innerHTML = '<p class="muted">Loading…</p>';
  if (online) {
    try { $('#disposeInfo').innerHTML = disposalView(await api.disposal(p.product_id)); }
    catch (e) { $('#disposeInfo').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  } else {
    $('#disposeInfo').innerHTML = `<p class="muted">Start the backend to see Regina recycling guidance. Materials: ${esc(p.packaging.materials.join(', '))}.</p>`;
  }
  if (!loc) return;
  if (!online) { $('#buyNear').innerHTML = '<p class="muted">Start the backend to find real stores near you.</p>'; return; }
  $('#buyNear').innerHTML = '<p class="muted">Finding stores…</p>';
  try {
    const res = await api.stores(loc.lat, loc.lon, p.category);
    $('#buyNear').innerHTML = `<p class="muted">${esc(p.name)} is demo data, so stock can't be confirmed. These real stores sell ${esc(p.category.toLowerCase())}:</p>` + placeList(res.items.slice(0, 3));
  } catch (e) { $('#buyNear').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}

// ----- Near you section -----
async function renderNear() {
  const loc = state.location;
  $('#locationStatus').textContent = locationLine(loc).replace(/<[^>]+>/g, '');
  if (!loc) return;
  $('#nearMap').src = mapEmbedUrl(loc.lat, loc.lon);
  $('#storeCategory').hidden = state.nearTab !== 'stores';
  if (!online) { $('#nearList').innerHTML = '<p class="muted">Start the backend (FastAPI) to load real nearby places.</p>'; return; }
  $('#nearList').innerHTML = '<p class="muted">Searching OpenStreetMap…</p>';
  try {
    if (state.nearTab === 'stores') {
      const res = await api.stores(loc.lat, loc.lon, state.storeCategory || undefined);
      $('#nearList').innerHTML = placeList(res.items, { kind: 'stores' });
    } else {
      const res = await api.dropOffs(loc.lat, loc.lon);
      $('#nearList').innerHTML = `<p class="muted">SARCAN depots take glass, flexible plastics and deposit containers (refund).</p>` + placeList(res.items, { kind: 'dropoffs', emptyText: 'No drop-off points found nearby.' }) + '<p class="muted"><a href="https://www.sarcan.ca/" target="_blank" rel="noopener">All SARCAN depots ↗</a></p>';
    }
  } catch (e) { $('#nearList').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
}

async function locate(force = false) {
  $('#locationStatus').textContent = 'Finding your location…';
  state.location = await getLocation({ force });
  renderNear();
  renderProductContext();
}

// ----- barcode scanner -----
function lookupBarcode(code) {
  // Inputs live on this page; the answer opens on the result page.
  location.href = `/result.html?barcode=${encodeURIComponent(code)}`;
}

function wireScanner() {
  const status = $('#scannerStatus');
  $('#startScanner').addEventListener('click', async () => {
    status.textContent = 'Opening camera…';
    try {
      await startCamera('barcode-reader', code => { $('#stopScanner').hidden = true; lookupBarcode(code); });
      $('#stopScanner').hidden = false; $('#startScanner').hidden = true;
      status.textContent = 'Point the camera at the barcode and hold steady.';
    } catch (e) { status.textContent = e.message; }
  });
  $('#stopScanner').addEventListener('click', async () => { await stopCamera(); $('#stopScanner').hidden = true; $('#startScanner').hidden = false; status.textContent = 'Camera stopped.'; });
  $('#barcodeImage').addEventListener('change', async e => {
    const file = e.target.files?.[0]; if (!file) return;
    status.textContent = 'Reading the barcode in your photo…';
    try { lookupBarcode(await scanImage(file, 'barcode-file-reader')); }
    catch (err) { status.textContent = err.message; }
    e.target.value = '';
  });
  $('#barcodeForm').addEventListener('submit', e => {
    e.preventDefault();
    const code = $('#barcodeInput').value.replace(/\D/g, '');
    if (code.length < 8 || code.length > 14) { status.textContent = 'Enter an 8 to 14 digit barcode.'; return; }
    lookupBarcode(code);
  });
  document.querySelectorAll('.mode-tab').forEach(tab => tab.addEventListener('click', async () => {
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.mode-panel').forEach(p => { p.hidden = p.dataset.panel !== tab.dataset.mode; });
    status.textContent = '';
    if (tab.dataset.mode !== 'scan') { await stopCamera(); $('#stopScanner').hidden = true; $('#startScanner').hidden = false; }
    tab.dataset.mode === 'type' && $('#barcodeInput').focus();
    tab.dataset.mode === 'search' && $('#searchInput').focus();
  }));
  $('#searchForm').addEventListener('submit', e => { e.preventDefault(); searchProducts($('#searchInput').value); });
}

// ----- compare (dynamic: whatever the shopper added) -----
function compareButton(kind, id, name) {
  const on = inTray(kind, id);
  return `<button type="button" class="compare-btn ${on ? 'on' : ''}" data-compare-kind="${kind}" data-compare-id="${esc(id)}" data-compare-name="${esc(name)}">${on ? '✓ In compare' : '＋ Compare'}</button>`;
}

let compareRun = 0;
async function renderCompare() {
  const run = ++compareRun;
  const tray = getTray();
  const box = $('#comparison');
  if (!tray.length) { box.innerHTML = '<p class="muted">Nothing to compare yet. Search or scan products and tap “＋ Compare” on up to three of them.</p>'; return; }
  if (!online) { box.innerHTML = '<p class="muted">Start the backend to compare products.</p>'; return; }
  box.innerHTML = '<p class="muted">Scoring your products…</p>';
  const cards = await Promise.all(tray.map(async t => {
    try {
      if (t.kind === 'product') return { t, card: await api.card(t.id, state.user.weights) };
      const res = await api.barcode(t.id, state.user.weights);
      return res.found ? { t, card: res.card } : { t, error: res.error };
    } catch (e) { return { t, error: e.message }; }
  }));
  if (run !== compareRun) return; // a newer render started
  const ok = cards.filter(x => x.card);
  const dims = ok.length ? ok[0].card.breakdown.map(r => r.dimension) : [];
  const cell = (card, d) => { const r = card.breakdown.find(x => x.dimension === d); return r ? `${r.score === null ? 'Unknown' : r.score + '/100'}<br><small>${esc(r.status)}</small>` : '-'; };
  const link = t => t.kind === 'product' ? `/result.html?product=${encodeURIComponent(t.id)}` : `/result.html?barcode=${encodeURIComponent(t.id)}`;
  box.innerHTML = `
    <div class="table-scroll"><table><thead><tr><th>Value</th>${ok.map(x => `<th><a href="${link(x.t)}">${esc(x.card.name)}</a><br><small>${x.card.demo_data ? 'Demo product' : 'Real · Open Food Facts'}</small></th>`).join('')}</tr></thead><tbody>
      <tr><th>True Value score</th>${ok.map(x => `<td><strong>${x.card.score ?? 'N/A'}/100</strong><br>${verdictPill(x.card.verdict)}</td>`).join('')}</tr>
      ${dims.map(d => `<tr><th>${esc(d)}</th>${ok.map(x => `<td>${cell(x.card, d)}</td>`).join('')}</tr>`).join('')}
      <tr><th>Evidence</th>${ok.map(x => `<td>${x.card.verified_percent}% verified<br><small>${x.card.coverage_percent}% coverage</small></td>`).join('')}</tr>
      <tr><th>Price</th>${ok.map(x => `<td>${money(x.card.price)}</td>`).join('')}</tr>
      <tr><th></th>${ok.map(x => `<td><button type="button" class="link" data-compare-kind="${x.t.kind}" data-compare-id="${esc(x.t.id)}">Remove</button></td>`).join('')}</tr>
    </tbody></table></div>
    ${cards.filter(x => x.error).map(x => `<p class="muted">Couldn't score ${esc(x.t.name)}: ${esc(x.error)}</p>`).join('')}
    <p><button type="button" class="link" id="clearCompare">Clear comparison</button></p>`;
}

function onCompareClick(btn) {
  const item = { kind: btn.dataset.compareKind, id: btn.dataset.compareId, name: btn.dataset.compareName || btn.dataset.compareId };
  const result = toggleTray(item);
  if (result === 'full') { $('#scannerStatus').textContent = `You can compare up to ${TRAY_MAX} products. Remove one first.`; return; }
  document.querySelectorAll(`[data-compare-kind="${item.kind}"][data-compare-id="${CSS.escape(item.id)}"].compare-btn`).forEach(b => {
    const on = result === 'added'; b.classList.toggle('on', on); b.textContent = on ? '✓ In compare' : '＋ Compare';
  });
  renderCompare();
}

// ----- search by name (Open Food Facts, plus matching demo products) -----
async function searchProducts(query) {
  const status = $('#scannerStatus'), out = $('#searchResults');
  if (query.trim().length < 2) { status.textContent = 'Type at least two letters.'; return; }
  if (!online) { status.textContent = 'Start the backend to search products.'; return; }
  status.textContent = `Searching for “${query}”…`; out.innerHTML = '';
  try {
    const res = await api.search(query);
    status.textContent = res.error || (res.items.length ? `${res.items.length} products found. Products sold in Canada are listed first.` : 'No products found. Try fewer or different words, or scan the barcode.');
    out.innerHTML = res.items.map(i => {
      const href = i.source === 'demo' ? `/result.html?product=${encodeURIComponent(i.product_id)}` : `/result.html?barcode=${encodeURIComponent(i.barcode)}`;
      const kind = i.source === 'demo' ? 'product' : 'barcode', id = i.source === 'demo' ? i.product_id : i.barcode;
      return `<article class="search-item">
        ${i.image ? `<img src="${esc(i.image)}" alt="" loading="lazy">` : `<div class="search-emoji">${esc(i.emoji || '📦')}</div>`}
        <div><strong>${esc(i.name)}</strong><small>${esc([i.brand, i.quantity].filter(Boolean).join(' · '))}</small>
          <small>${i.source === 'demo' ? 'Demo product' : (i.sold_in_canada ? '🍁 Sold in Canada · ' : '') + 'Open Food Facts'}</small></div>
        <div class="search-actions"><a class="button" href="${href}">See result →</a>${compareButton(kind, id, i.name)}</div>
      </article>`;
    }).join('');
  } catch (e) { status.textContent = e.message; }
}

// ----- events -----
function wire() {
  // Values apply instantly and auto-save, so result, compare and assistant pages always use the latest ones
  let saveTimer;
  const autosave = () => { clearTimeout(saveTimer); $('#saveStatus').textContent = 'Saving…'; saveTimer = setTimeout(() => { saveUser(state.user); $('#saveStatus').textContent = '✓ Saved automatically'; }, 400); };
  $('#sliders').addEventListener('input', e => { const id = e.target.dataset.weight; if (!id) return; state.user.weights[id] = Number(e.target.value); $(`[data-output="${id}"]`).textContent = e.target.value; render(); autosave(); });
  $('#budget').addEventListener('input', e => { state.user.budget_cad = Math.max(0, Number(e.target.value) || 0); render(); autosave(); });
  document.addEventListener('click', e => {
    const c = e.target.closest('[data-compare-kind]'); if (c) { onCompareClick(c); return; }
    if (e.target.id === 'clearCompare') { clearTray(); render(); }
  });
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-details]'); if (!btn) return;
    state.details = btn.dataset.details; render(); renderProductContext();
    $('#transparency').scrollIntoView({ behavior: 'smooth' });
  });
  $('#useLocation').addEventListener('click', () => locate(true));
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === t));
    state.nearTab = t.dataset.tab; renderNear();
  }));
  $('#storeCategory').addEventListener('change', e => { state.storeCategory = e.target.value; renderNear(); });
  $('#feedbackForm').addEventListener('submit', async e => {
    e.preventDefault();
    const form = new FormData(e.target); const message = String(form.get('message') || '').trim(); if (!message) return;
    const record = { product_id: form.get('product'), issue: form.get('issue'), message };
    try { const r = await api.feedback(record); $('#feedbackStatus').textContent = r.emailed ? 'Thanks! Your feedback was sent to the TrueValue team.' : 'Thanks! Feedback saved for review.'; }
    catch { saveFeedback(record); $('#feedbackStatus').textContent = 'Server unavailable: feedback saved in this browser as pending review.'; }
    e.target.reset();
  });
}

async function init() {
  try {
    const data = await api.catalog();
    ({ products, companies, certifications, productCertifications, claims, retailers } = data);
    sources = data.dataSources; dimensions = data.ethicalDimensions; prices = data.priceObservations;
    online = true;
    $('#apiStatus').textContent = '· Live data from the TrueValue server';
  } catch {
    $('#apiStatus').textContent = '· Offline mode: server unreachable, showing bundled demo data';
  }
  dimensions.forEach(d => { if (state.user.weights[d.dimension_id] === undefined) state.user.weights[d.dimension_id] = d.default_weight; });
  renderStatic();
  render();
  wire();
  wireScanner();
  locate(); // asks the browser for location automatically; falls back to downtown Regina
}
init();

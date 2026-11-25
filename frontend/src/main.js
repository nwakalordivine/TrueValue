// Home page: set your values, then find a product. Results open on /result.html.
import { mountShell } from './components/shell.js';
import './styles/home.css';
// Bundled copies of the demo data: used only if the backend is unreachable, so the page never goes blank.
import fbProducts from './data/products.json';
import fbClaims from './data/claims.json';
import fbDimensions from './data/ethicalDimensions.json';
import fbPrices from './data/priceObservations.json';
import users from './data/userProfiles.json';
import priorityWeights from './data/priorityWeights.json';
import { api } from './api.js';
import { calculateMatch, rankProducts } from './services/scoringService.js';
import { loadUser, saveUser } from './services/customerValuesService.js';
import { saveFeedback } from './services/feedbackService.js';
import { esc, money } from './components/views.js';
import { icon, DIMENSION_ICONS } from './components/icons.js';
import { wireTabs } from './components/tabs.js';
import { compareButton, wireCompareButtons } from './components/compare.js';
import { getTray, MAX as TRAY_MAX } from './services/compareTray.js';
import { startCamera, stopCamera, scanImage } from './services/barcodeScanner.js';

const content = mountShell({ active: 'home' });

let products = fbProducts, claims = fbClaims, dimensions = fbDimensions, prices = fbPrices;
let online = false;

const state = { user: loadUser(users[0], priorityWeights) };
// A result page's "Report a problem" link opens /?report=<name>&product=<id>#feedback
const params = new URLSearchParams(location.search);
const report = { name: (params.get('report') || '').trim().slice(0, 120), id: params.get('product') || '' };
const $ = s => document.querySelector(s);
const priceFor = p => { const obs = prices.filter(o => o.product_id === p.product_id); return obs.length ? Math.min(...obs.map(o => o.price)) : null; };
const match = p => calculateMatch(p, dimensions, state.user.weights, claims, state.user.user_id);

content.innerHTML = `
<div class="content-inner home">
  <div class="home-grid">
    <section class="section" id="values" aria-labelledby="valuesTitle">
      <div class="section-head">
        <h1 id="valuesTitle">Your values</h1>
        <p>Set how much each value matters to you. Every score, comparison and assistant answer uses these.</p>
      </div>
      <div class="panel">
        <div id="sliders" class="sliders"></div>
        <div class="budget">
          <label for="budget">Maximum price (CAD)</label>
          <input id="budget" type="number" inputmode="decimal" min="0" step="0.50" value="${esc(state.user.budget_cad)}">
        </div>
        <p id="saveStatus" class="save-status muted" role="status">Saved in this browser</p>
      </div>
    </section>

    <section class="section" id="find" aria-labelledby="findTitle">
      <div class="section-head">
        <h2 id="findTitle">Find a product</h2>
        <p>Scan the barcode, upload a photo of it, or search by name. The result shows the score, the reasons and better options.</p>
      </div>
      <div class="panel finder">
        <div class="tabs" role="tablist" aria-label="How to find a product">
          <button type="button" role="tab" class="tab" id="tab-scan" aria-controls="panel-scan" aria-selected="true" data-mode="scan">${icon('camera')}<span class="tab-label">Scan<span class="tab-more"> barcode</span></span></button>
          <button type="button" role="tab" class="tab" id="tab-upload" aria-controls="panel-upload" aria-selected="false" data-mode="upload">${icon('upload')}<span class="tab-label">Upload<span class="tab-more"> photo</span></span></button>
          <button type="button" role="tab" class="tab" id="tab-search" aria-controls="panel-search" aria-selected="false" data-mode="search">${icon('search')}<span class="tab-label">Search<span class="tab-more"> by name</span></span></button>
        </div>
        <div class="mode-panel" id="panel-scan" role="tabpanel" aria-labelledby="tab-scan">
          <div id="barcode-reader" class="barcode-reader"></div>
          <button type="button" class="finder-action" id="startScanner">${icon('camera', 20)}<span><strong>Open the camera</strong><small>Point it at the barcode on the package</small></span></button>
          <button type="button" class="button secondary" id="stopScanner" hidden>Stop camera</button>
        </div>
        <div class="mode-panel" id="panel-upload" role="tabpanel" aria-labelledby="tab-upload" hidden>
          <button type="button" class="finder-action" id="pickPhoto">${icon('upload', 20)}<span><strong>Choose a photo of the barcode</strong><small>A close, sharp, well lit photo works best</small></span></button>
          <input type="file" id="barcodeImage" accept="image/*" hidden>
        </div>
        <div class="mode-panel" id="panel-search" role="tabpanel" aria-labelledby="tab-search" hidden>
          <form id="searchForm" class="finder-form" role="search">
            <label class="sr-only" for="searchInput">Product or brand</label>
            <input id="searchInput" type="search" autocomplete="off" placeholder="Product or brand, e.g. peanut butter, oat milk">
            <button type="submit" class="button">${icon('search')}Search</button>
          </form>
          <div id="searchArea" class="search-area" hidden>
            <h3 id="resultsTitle" class="results-title" tabindex="-1"></h3>
            <p id="searchSummary" class="muted" role="status"></p>
            <div id="searchResults" class="search-results"></div>
            <nav id="searchPager" class="pager" aria-label="Search result pages"></nav>
          </div>
        </div>
        <p id="scannerStatus" role="status" class="finder-status" data-compare-status></p>
        <p id="apiStatus" class="muted"></p>
      </div>
    </section>
  </div>

  <section class="section" id="demo" aria-labelledby="demoTitle">
    <div class="section-head">
      <h2 id="demoTitle">Try a demo product</h2>
      <p>The best and the weakest fit for your current values. Demo products and their prices are fictional.</p>
    </div>
    <div id="productsList" class="products-grid"></div>
    <p class="finder-status" role="status" data-compare-status></p>
  </section>

  <section class="section about" id="about" aria-labelledby="aboutTitle">
    <div class="section-head">
      <h2 id="aboutTitle">About TrueValue</h2>
      <p>TrueValue helps shoppers in Regina buy products that match their own values, and shows the evidence behind every score.</p>
    </div>
  </section>

  <section class="section" id="feedback" aria-labelledby="feedbackTitle">
    <div class="section-head">
      <h2 id="feedbackTitle">Report a problem</h2>
      <p>Found a wrong claim or a missing source? It goes to the TrueValue team for review. It never changes a score automatically.</p>
    </div>
    <form id="feedbackForm" class="panel feedback-form">
      <label>Product (optional) <input type="text" name="product_name" id="feedbackProduct" maxlength="120" autocomplete="off" placeholder="Product name or barcode"></label>
      <label>Issue
        <select name="issue">
          <option value="incorrect-claim">Incorrect claim</option>
          <option value="missing-source">Missing source</option>
          <option value="outdated-price">Outdated price</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label>Explanation <textarea name="message" required maxlength="1000" rows="4" placeholder="What should be reviewed?"></textarea></label>
      <button type="submit" class="button">Send report</button>
      <p role="status" id="feedbackStatus" class="muted"></p>
    </form>
  </section>

  <footer class="page-foot muted">TrueValue, a Tech Skills Showcase 2026 prototype. Real data: Open Food Facts, OpenStreetMap, Corporations Canada and City of Regina recycling rules.</footer>
</div>`;

function renderStatic() {
  $('#sliders').innerHTML = dimensions.map(d => {
    const v = state.user.weights[d.dimension_id] ?? d.default_weight;
    return `<div class="slider-row">
      <label class="slider-label" for="w-${esc(d.dimension_id)}">${icon(DIMENSION_ICONS[d.dimension_id] || 'info')}<span><span class="slider-name">${esc(d.label)}</span><small>${esc(d.description)}</small></span></label>
      <input type="range" id="w-${esc(d.dimension_id)}" min="0" max="100" step="5" data-weight="${esc(d.dimension_id)}" value="${esc(v)}">
      <output for="w-${esc(d.dimension_id)}" data-output="${esc(d.dimension_id)}">${esc(v)}</output>
    </div>`;
  }).join('');
}

function render() {
  const ranked = rankProducts(products, dimensions, state.user.weights, claims);
  const demos = ranked.length > 1 ? [ranked[0], ranked[ranked.length - 1]] : ranked; // best and weakest fit, for contrast
  $('#productsList').innerHTML = demos.map(p => {
    const s = match(p);
    return `<article class="product-card">
      <div class="product-top">
        <div class="thumb">${icon('package', 24)}</div>
        <div class="product-info">
          <p class="muted">${esc(p.brand)} · ${esc(p.category)} · Demo</p>
          <h3>${esc(p.name)}</h3>
          <p class="muted">${esc(p.size)} · ${money(priceFor(p))}</p>
        </div>
        <div class="match"><span class="match-score">${s.raw_score === null ? 'N/A' : s.raw_score}<small>/100</small></span><small>${s.coverage_percent}% coverage</small></div>
      </div>
      <div class="card-actions"><a class="button" href="/result.html?product=${encodeURIComponent(p.product_id)}">See result</a>${compareButton('product', p.product_id, p.name)}</div>
    </article>`;
  }).join('');
}

// ----- finder: camera, photo, search -----
function lookupBarcode(code) {
  // Inputs live on this page; the answer opens on the result page.
  location.href = `/result.html?barcode=${encodeURIComponent(code)}`;
}

async function resetCamera() { await stopCamera(); $('#stopScanner').hidden = true; $('#startScanner').hidden = false; }

function wireFinder() {
  const status = $('#scannerStatus');
  $('#startScanner').addEventListener('click', async () => {
    status.textContent = 'Opening camera...';
    try {
      await startCamera('barcode-reader', code => { $('#stopScanner').hidden = true; lookupBarcode(code); });
      $('#stopScanner').hidden = false; $('#startScanner').hidden = true;
      status.textContent = 'Point the camera at the barcode and hold steady.';
    } catch (e) { status.textContent = e.message; }
  });
  $('#stopScanner').addEventListener('click', async () => { await resetCamera(); status.textContent = 'Camera stopped.'; });
  $('#pickPhoto').addEventListener('click', () => $('#barcodeImage').click());
  $('#barcodeImage').addEventListener('change', async e => {
    const file = e.target.files?.[0]; if (!file) return;
    status.textContent = 'Reading the barcode in your photo...';
    try { lookupBarcode(await scanImage(file)); }
    catch (err) { status.textContent = err.message; }
    e.target.value = '';
  });
  wireTabs(document.querySelector('.finder .tabs'), async tab => {
    status.textContent = '';
    if (tab.dataset.mode !== 'scan') await resetCamera();
    if (tab.dataset.mode === 'search') $('#searchInput').focus();
  });
  $('#searchForm').addEventListener('submit', e => { e.preventDefault(); searchProducts($('#searchInput').value); });
  wireResults();
}

// Search results are fetched once (up to 48) and paged here, without calling the backend again.
const results = { query: '', items: [], page: 1, seq: 0 };
const wide = matchMedia('(min-width: 768px)');
const perPage = () => (wide.matches ? 8 : 6);
const pageCount = () => Math.max(1, Math.ceil(results.items.length / perPage()));

function searchItem(i) {
  const demo = i.source === 'demo';
  const href = demo ? `/result.html?product=${encodeURIComponent(i.product_id)}` : `/result.html?barcode=${encodeURIComponent(i.barcode)}`;
  const details = [i.brand, i.quantity].filter(Boolean).join(' · ');
  return `<article class="search-item">
    ${i.image ? `<img class="thumb" src="${esc(i.image)}" alt="" loading="lazy">` : `<div class="thumb">${icon('package', 24)}</div>`}
    <div><strong>${esc(i.name)}</strong><small>${details ? esc(details) : 'Brand not listed'}</small>
      <small>${demo ? 'Demo product' : (i.sold_in_canada ? 'Sold in Canada · ' : '') + 'Open Food Facts'}</small></div>
    <div class="search-actions"><a class="button small" href="${href}">See result</a>${compareButton(demo ? 'product' : 'barcode', demo ? i.product_id : i.barcode, i.name)}</div>
  </article>`;
}

// Page numbers to show: all of them up to 7, otherwise first, last and the current page with its neighbours.
function pageList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const keep = [...new Set([1, current - 1, current, current + 1, total])].filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
  return keep.flatMap((n, i) => (i && n - keep[i - 1] > 1 ? ['gap', n] : [n]));
}

function pagerView(page, total) {
  if (total <= 1) return '';
  const nums = pageList(page, total).map(n => n === 'gap'
    ? '<span class="pager-gap" aria-hidden="true">…</span>'
    : `<button type="button" class="button secondary pager-num" data-page="${n}" aria-label="Page ${n}"${n === page ? ' aria-current="page"' : ''}>${n}</button>`).join('');
  return `<button type="button" class="button secondary pager-step" data-page="${page - 1}" aria-label="Previous page"${page === 1 ? ' disabled' : ''}>${icon('back')}Previous</button>
    <div class="pager-pages">${nums}</div>
    <button type="button" class="button secondary pager-step" data-page="${page + 1}" aria-label="Next page"${page === total ? ' disabled' : ''}>Next${icon('next')}</button>`;
}

function renderResults() {
  const n = results.items.length;
  $('#searchArea').hidden = n === 0;
  if (!n) return;
  const total = pageCount();
  results.page = Math.min(Math.max(1, results.page), total);
  const start = (results.page - 1) * perPage(), shown = results.items.slice(start, start + perPage());
  $('#resultsTitle').textContent = `Results for "${results.query}"`;
  $('#searchSummary').textContent = `Showing ${start + 1} to ${start + shown.length} of ${n} result${n === 1 ? '' : 's'}. Products sold in Canada are listed first.`;
  $('#searchResults').innerHTML = shown.map(searchItem).join('');
  const pager = $('#searchPager');
  pager.innerHTML = pagerView(results.page, total);
  pager.hidden = total <= 1;
}

function goToPage(page) {
  results.page = page;
  renderResults();
  // Bring the list (not the whole page) back into view, and move focus to its heading for keyboard and screen reader users
  $('#resultsTitle').focus({ preventScroll: true });
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('#searchArea').scrollIntoView({ block: 'start', behavior: smooth ? 'smooth' : 'auto' });
}

function wireResults() {
  $('#searchPager').addEventListener('click', e => {
    const btn = e.target.closest('button[data-page]');
    if (!btn || btn.disabled) return;
    const page = Number(btn.dataset.page);
    if (page !== results.page) goToPage(page);
  });
  // Crossing 768px changes the page size: stay on the page that holds the first result you were looking at
  wide.addEventListener('change', e => {
    if (!results.items.length) return;
    const first = (results.page - 1) * (e.matches ? 6 : 8);
    results.page = Math.floor(first / perPage()) + 1;
    renderResults();
  });
}

async function searchProducts(query) {
  const status = $('#scannerStatus');
  query = query.trim();
  if (query.length < 2) { status.textContent = 'Type at least two letters.'; return; }
  if (!online) { status.textContent = 'Start the backend to search products.'; return; }
  status.textContent = `Searching for "${query}"...`;
  const seq = ++results.seq; // a slow earlier search must not replace a newer one
  Object.assign(results, { query, items: [], page: 1 });
  renderResults();
  try {
    const res = await api.search(query);
    if (seq !== results.seq) return;
    results.items = res.items || [];
    status.textContent = res.error || (results.items.length ? '' : 'No products found. Try fewer or different words, or scan the barcode.');
    renderResults();
  } catch (e) { if (seq === results.seq) status.textContent = e.message; }
}

// ----- compare: the buttons add to the tray; the table is on /compare.html -----
function onCompare(result, item, btn) {
  const box = btn?.closest('section')?.querySelector('[data-compare-status]') || $('#scannerStatus');
  const link = '<a href="/compare.html">View comparison</a>';
  box.innerHTML = result === 'full'
    ? `You can compare up to ${TRAY_MAX} products. <a href="/compare.html">Open the comparison</a> to remove one first.`
    : result === 'added' ? `${esc(item.name)} added to compare (${getTray().length} of ${TRAY_MAX}). ${link}`
      : `${esc(item.name)} removed from compare.`;
}

// ----- events -----
function wire() {
  // Values apply instantly and auto-save, so result, compare and assistant pages always use the latest ones
  let saveTimer;
  const autosave = () => {
    clearTimeout(saveTimer); $('#saveStatus').textContent = 'Saving...';
    saveTimer = setTimeout(() => { saveUser(state.user); $('#saveStatus').textContent = 'Saved in this browser'; }, 400);
  };
  $('#sliders').addEventListener('input', e => {
    const id = e.target.dataset.weight; if (!id) return;
    state.user.weights[id] = Number(e.target.value); $(`[data-output="${id}"]`).textContent = e.target.value;
    render(); autosave();
  });
  $('#budget').addEventListener('input', e => { state.user.budget_cad = Math.max(0, Number(e.target.value) || 0); autosave(); });
  wireCompareButtons(onCompare);
  if (report.name) $('#feedbackProduct').value = report.name;
  $('#feedbackForm').addEventListener('submit', async e => {
    e.preventDefault();
    const form = new FormData(e.target); const message = String(form.get('message') || '').trim(); if (!message) return;
    const name = String(form.get('product_name') || '').trim();
    const record = { issue: form.get('issue'), message };
    if (name) record.product_name = name;
    // Send the catalog id only when the name is still the one the result page filled in
    if (report.id && name && name === report.name) record.product_id = report.id;
    try { const r = await api.feedback(record); $('#feedbackStatus').textContent = r.emailed ? 'Thanks. Your report was sent to the TrueValue team.' : 'Thanks. Your report was saved for review.'; }
    catch { saveFeedback(record); $('#feedbackStatus').textContent = 'The server is unavailable, so your report was saved in this browser for later review.'; }
    e.target.reset();
  });
}

async function init() {
  try {
    const data = await api.catalog();
    products = data.products; claims = data.claims; dimensions = data.ethicalDimensions; prices = data.priceObservations;
    online = true;
    $('#apiStatus').textContent = 'Live data from the TrueValue server.';
  } catch {
    $('#apiStatus').textContent = 'Offline: the server is unreachable, so the bundled demo data is shown.';
  }
  dimensions.forEach(d => { if (state.user.weights[d.dimension_id] === undefined) state.user.weights[d.dimension_id] = d.default_weight; });
  renderStatic();
  render();
  wire();
  wireFinder();
  // Arriving from another page with /#values, /#find, /#about or /#feedback: scroll once the content exists
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}
init();

// Result page: one product, one clear answer. Opened as
//   /result.html?barcode=3017620422003   (scan or photo)
//   /result.html?product=p5              (a product picked from a list)
import { mountShell } from './components/shell.js';
import './result.css';
import users from './data/userProfiles.json';
import priorityWeights from './data/priorityWeights.json';
import { api } from './api.js';
import { loadUser } from './services/customerValuesService.js';
import { getLocation } from './services/locationService.js';
import { esc, money, placeList, disposalView, statusBadge, verdictPill } from './components/views.js';
import { icon } from './components/icons.js';
import { add as addToCompare, MAX as TRAY_MAX } from './services/compareTray.js';

const content = mountShell();
const user = loadUser(users[0], priorityWeights);
const params = new URLSearchParams(location.search);
const barcode = params.get('barcode');
const productId = params.get('product');
const $ = s => document.querySelector(s);

const page = inner => {
  content.innerHTML = `<div class="content-inner result">
    <button type="button" class="button ghost small r-back" id="back">${icon('back')}Back</button>
    ${inner}</div>`;
  $('#back').onclick = () => (history.length > 1 ? history.back() : (location.href = '/'));
};

const DOT = { Verified: 'dot verified', Claimed: 'dot claimed', Unknown: 'dot unknown' };

function evidence(c, facts) {
  const chain = c.company_chain || [];
  const owner = chain.length
    ? `${chain.map((x, i) => `${i ? 'owned by ' : ''}${esc(x.name)}${x.ownership_type ? ` (${esc(x.ownership_type)}${x.city ? `, ${esc(x.city)}` : ''})` : ''}`).join(', ')} ${statusBadge(chain[0].status)}`
    : facts?.brand_owner ? `${esc(facts.brand_owner)} ${statusBadge('Claimed')}` : `Unknown ${statusBadge('Unknown')}`;
  const certs = (c.certifications || []).map(x => `${esc(x.name)} ${statusBadge(x.status)}`).join('<br>');
  return `<section class="r-card r-evidence" aria-labelledby="evidenceTitle">
    <h2 id="evidenceTitle">Evidence and sources</h2>
    <dl class="r-facts">
      <div><dt>Owner</dt><dd>${owner}</dd></div>
      <div><dt>Made in</dt><dd>${esc(c.made_in || 'Unknown')}</dd></div>
      <div><dt>Ingredients</dt><dd>${esc((c.components || []).join(', ') || 'Unknown')}</dd></div>
      <div><dt>Packaging</dt><dd>${esc((c.packaging || []).join(', ') || 'Unknown')} ${statusBadge(c.packaging_status)}</dd></div>
      <div><dt>Certifications</dt><dd>${certs || 'None recorded'}</dd></div>
      ${facts?.labels ? `<div><dt>Labels on pack</dt><dd>${esc(facts.labels)}</dd></div>` : ''}
    </dl>
    <p class="muted">Unknown is not zero: it is left out of the score but lowers coverage. Claimed means the company or the label says so, and nobody has checked it independently. Confidence (${Math.round((c.confidence || 0) * 100)}%) is a demo estimate, not a probability.</p>
  </section>`;
}

function render(res) {
  const c = res.card;
  const off = res.source === 'openfoodfacts';
  const pc = c.price_context;
  const sub = [c.brand, pc ? `${money(pc.price).replace(' CAD', '')} at ${pc.retailer}` : null].filter(Boolean).join(' · ');
  const score = c.score ?? 0;
  const alts = (c.alternatives || []).slice(0, 3);

  page(`
    <p class="r-kicker">${barcode ? 'Scanned product' : 'Product'} <span class="source-tag ${off ? 'real' : 'demo'}">${off ? 'Real · Open Food Facts' : 'Demo product'}</span></p>
    <h1 class="r-title">${esc(c.name)}${c.size ? `, ${esc(c.size)}` : ''}</h1>
    <p class="r-sub">${esc(sub || (off ? 'Label and community data' : ''))}</p>

    <div class="r-grid">
    <div class="r-col">
      <section class="r-card r-hero" aria-label="Score">
        <div class="r-score"><b>${c.score ?? 'N/A'}</b><span>out of 100, matched to your values</span></div>
        <div class="r-bar" aria-hidden="true"><i style="width:${score}%"></i></div>
        <p>${esc(c.verdict.sentence)}</p>
        <div class="r-chips">${verdictPill(c.verdict)}<span class="r-chip">${icon('check', 14)}Based on ${c.verified_percent}% verified data</span></div>
      </section>

      <div class="r-actions">
        <button type="button" class="button secondary" id="whereBuy">${icon('store')}Where to buy</button>
        <button type="button" class="button" id="compareBtn">${icon('plus')}Compare</button>
      </div>
      <p class="r-muted" id="compareStatus" role="status"></p>

      <div class="r-tiles">
        <div class="r-tile"><small>Price vs category</small><strong>${pc ? `${money(pc.price).replace(' CAD', '')}${pc.vs_average_percent !== null && pc.category_count > 1 ? ` · ${Math.abs(pc.vs_average_percent)}% ${pc.vs_average_percent <= 0 ? 'below' : 'above'} average` : ''}` : 'Price unknown'}</strong></div>
        <div class="r-tile"><small>Nearest store</small><strong id="nearest">Finding...</strong></div>
      </div>

      ${c.could_change ? `<p class="r-note">${esc(c.could_change)}</p>` : ''}

      ${alts.length ? `<section class="r-alts" aria-labelledby="altsTitle"><h2 class="r-h2" id="altsTitle">Consider instead</h2>
      ${alts.map(a => `<a class="r-alt" href="/result.html?product=${encodeURIComponent(a.product_id)}">
          <span class="r-alt-score">${a.score}</span>
          <span><strong>${esc(a.name)}</strong><small>+${a.score_delta} points${a.price_delta === null ? '' : a.price_delta === 0 ? ' · same price' : ` · $${Math.abs(a.price_delta).toFixed(2)} ${a.price_delta > 0 ? 'more' : 'less'}`}${a.same_category ? '' : ` · ${esc(a.category)}`}</small></span>
          ${icon('next')}</a>`).join('')}</section>` : ''}
    </div>
    <div class="r-col">
      <section class="r-card r-why" aria-labelledby="whyTitle">
        <div class="r-head"><h2 id="whyTitle">Why this score</h2>
          <span class="r-legend"><i class="dot verified"></i>Verified <i class="dot claimed"></i>Claimed <i class="dot unknown"></i>Unknown</span></div>
        ${c.breakdown.filter(r => r.weight > 0).map(r => `
          <div class="r-row">
            <i class="${DOT[r.status] || 'dot unknown'}" title="${esc(r.status)}"></i>
            <div><strong>${esc(r.dimension)}</strong><span class="sr-only">, ${esc(r.status)}</span><small>${esc(r.note || '')}</small>${r.source ? `<small class="r-source">Source: ${esc(r.source)}</small>` : ''}</div>
            <b class="${r.score === null ? 'na' : ''}">${r.score ?? 'n/a'}</b>
          </div>`).join('')}
      </section>

      ${evidence(c, res.facts)}

      <details class="r-card r-dispose"><summary>${icon('recycle')}How to dispose of the packaging</summary>${disposalView(res.disposal)}</details>

      <section class="r-card" id="stores" aria-labelledby="storesTitle" hidden>
        <h2 id="storesTitle">Where to buy near you</h2>
        <div id="storeList"><p class="r-muted">Finding stores...</p></div>
      </section>

      <p class="r-muted r-foot">${off ? 'Open Food Facts data comes from product labels and volunteers, so it is shown as Claimed.' : 'Demo product: its claims and prices are fictional.'} Scoring model ${esc(c.model_version)}. <a href="/#feedback">Report a problem</a></p>
    </div>
    </div>`);

  $('#whereBuy').onclick = () => { $('#stores').hidden = false; $('#stores').scrollIntoView({ behavior: 'smooth' }); };
  $('#compareBtn').onclick = () => {
    const item = barcode ? { kind: 'barcode', id: barcode, name: c.name } : { kind: 'product', id: productId, name: c.name };
    if (addToCompare(item) === 'full') {
      $('#compareStatus').innerHTML = `You already have ${TRAY_MAX} products to compare. <a href="/compare.html">Open the comparison</a> to remove one first.`;
      return;
    }
    location.href = '/compare.html';
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
  page(`<section class="r-card r-empty"><h1 class="r-title">${esc(title)}</h1><p>${esc(text)}</p>
    <a class="button" href="/#find">${icon('scan')}Find another product</a></section>`);
}

async function init() {
  page('<div class="r-loading" role="status"><span aria-hidden="true"></span><p>Checking the evidence...</p></div>');
  try {
    if (barcode) {
      const res = await api.barcode(barcode, user.weights);
      if (!res.found) return message(`Barcode ${barcode}`, res.error);
      render(res);
    } else if (productId) {
      const [card, disposal] = await Promise.all([api.card(productId, user.weights), api.disposal(productId)]);
      render({ found: true, source: 'demo', card, disposal });
    } else {
      message('No product selected', 'Scan, upload or search for a product on the home page first.');
    }
  } catch (e) {
    message('Something went wrong', e.message);
  }
}
init();

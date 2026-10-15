import './styles.css';
import './chat.css';
import users from './data/userProfiles.json';
import priorityWeights from './data/priorityWeights.json';
import dimensions from './data/ethicalDimensions.json';
import { api } from './api.js';
import { loadUser } from './services/customerValuesService.js';
import { getLocation, mapEmbedUrl } from './services/locationService.js';
import { esc, money, statusBadge, verdictPill, placeList, disposalView, locationLine, scanResultView } from './components/views.js';
import { startCamera, stopCamera, scanImage } from './services/barcodeScanner.js';

const user = loadUser(users[0], priorityWeights); // same saved values as the main page
const state = { location: null, busy: false, cards: new Map() };
const $ = s => document.querySelector(s);

const EXAMPLES = [
  'Canadian coffee under $15 with less plastic',
  'Which spread is best for local and fair trade?',
  'Compare Prairie Morning Coffee and Everyday Ground Coffee',
  'Is Loblaw a Canadian company?',
  'Where can I buy Wascana Wildflower Honey?',
  'How do I dispose of a glass jar?',
  '3017620422003',
];

$('#app').innerHTML = `
<header class="topbar">
  <a class="brand" href="/">🌿 TrueValue</a>
  <nav aria-label="Main navigation">
    <a href="/#values">My Values</a>
    <a href="/#products">Products</a>
    <a href="/#local">Near Me</a>
    <a class="nav-cta" href="/chat.html" aria-current="page">💬 Assistant</a>
  </nav>
</header>
<main class="chat-layout">
  <section class="chat-main" aria-label="TrueValue assistant">
    <div class="chat-log" id="log" aria-live="polite">
      <div class="msg bot intro">
        <div class="bubble">
          <p><strong>Hi, I'm the TrueValue assistant.</strong> Ask me which products fit your values, why something got its score,
          whether a company is federally registered in Canada, where to buy something nearby, or which Regina bin your packaging goes in.</p>
          <p class="muted">I always show what is <span class="status verified">Verified</span>, <span class="status claimed">Claimed</span> or <span class="status unknown">Unknown</span>. Unknown never means bad.</p>
        </div>
        <div class="chips">${EXAMPLES.map(q => `<button class="chip" data-ask="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      </div>
    </div>
    <form class="composer" id="composer">
      <label class="sr-only" for="input">Ask TrueValue</label>
      <button type="button" class="icon-btn" id="camBtn" title="Scan a barcode with your camera" aria-label="Scan a barcode with your camera">📷</button>
      <label class="icon-btn" title="Upload a photo of a barcode" aria-label="Upload a photo of a barcode">🖼️<input type="file" id="photo" accept="image/*" hidden></label>
      <input id="input" autocomplete="off" maxlength="400" placeholder="Ask, or scan 📷 / upload 🖼️ a barcode…" />
      <button type="submit" id="send">Send</button>
    </form>
  </section>
  <div class="cam-modal" id="camModal" hidden>
  <div class="cam-box">
    <div class="cam-head"><strong>📷 Point at a barcode</strong><button type="button" class="secondary" id="camClose">Close</button></div>
    <div id="chat-reader"></div>
    <p class="muted" id="camStatus">Opening camera…</p>
  </div>
</div>
<div id="chat-file-reader" hidden></div>
<aside class="chat-side">
    <div class="panel">
      <h3>Your priorities</h3>
      <ul class="weights">${[...dimensions].sort((a, b) => (user.weights[b.dimension_id] ?? 0) - (user.weights[a.dimension_id] ?? 0)).map(d => `
        <li><span>${d.icon} ${esc(d.label)}</span><span class="bar"><i style="width:${user.weights[d.dimension_id] ?? d.default_weight}%"></i></span><b>${user.weights[d.dimension_id] ?? d.default_weight}</b></li>`).join('')}
      </ul>
      <a class="small-link" href="/#values">Change my values →</a>
    </div>
    <div class="panel">
      <h3>Location</h3>
      <p id="loc" class="muted">Finding your location…</p>
      <button class="secondary" id="relocate">📍 Use my location</button>
    </div>
    <div class="panel tiny" id="serverStatus">Checking the server…</div>
  </aside>
</main>`;

const log = $('#log');
const scrollDown = () => log.scrollTo({ top: log.scrollHeight, behavior: 'smooth' });

function addUser(text) {
  log.insertAdjacentHTML('beforeend', `<div class="msg user"><div class="bubble">${esc(text)}</div></div>`);
  scrollDown();
}

function typing() {
  const el = document.createElement('div');
  el.className = 'msg bot'; el.innerHTML = '<div class="bubble typing"><span></span><span></span><span></span></div>';
  log.appendChild(el); scrollDown();
  return el;
}

// ---------- answer rendering ----------
function productCard(p) {
  state.cards.set(p.product_id, p);
  return `<article class="pcard" data-card="${esc(p.product_id)}" tabindex="0" role="button" aria-expanded="false">
    <div class="pcard-top">
      <div class="pcard-emoji">${esc(p.emoji || '🛍️')}</div>
      <div class="pcard-info">
        <small>${esc(p.brand)} · ${esc(p.category)}</small>
        <strong>${esc(p.name)}</strong>
        <span>${money(p.price)} <small>(demo price)</small></span>
      </div>
      <div class="ring" style="--p:${p.score ?? 0}"><span>${p.score ?? 'N/A'}</span></div>
    </div>
    <div class="pcard-mid">${verdictPill(p.verdict)} <small>${p.verified_percent}% verified · ${p.coverage_percent}% coverage</small></div>
    <div class="badges">${p.highlights.map(h => `<span class="hl">${esc(h.label)} ${statusBadge(h.status)}</span>`).join('')}</div>
    <div class="pcard-more" hidden></div>
    <small class="tap">Tap for details ▾</small>
  </article>`;
}

function cardDetails(p) {
  return `
    <p>${esc(p.verdict.sentence)} ${esc(p.verdict.reason || '')}</p>
    <table class="mini"><thead><tr><th>Value</th><th>Weight</th><th>Score</th><th>Status</th></tr></thead><tbody>
    ${p.breakdown.map(r => `<tr><td>${esc(r.dimension)}</td><td>${r.weight}</td><td>${r.score ?? 'n/a'}</td><td>${statusBadge(r.status)}</td></tr>`).join('')}
    </tbody></table>
    <p><strong>Ownership:</strong> ${p.company_chain.length ? p.company_chain.map(c => `${esc(c.name)} (${esc(c.ownership_type)}, ${esc(c.city)})`).join(' → ') + ' ' + statusBadge(p.company_chain[0].status) : 'Unknown'}</p>
    <p><strong>Made in:</strong> ${esc(p.made_in || 'Unknown')} · <strong>Ingredients:</strong> ${esc(p.components.join(', ') || 'Unknown')}</p>
    <p><strong>Packaging:</strong> ${esc(p.packaging.join(', ') || 'Unknown')} ${statusBadge(p.packaging_status)}</p>
    ${p.certifications.length ? `<p><strong>Certifications:</strong> ${p.certifications.map(c => `${esc(c.name)} ${statusBadge(c.status)}`).join(' ')}</p>` : ''}
    ${p.alternatives.length ? `<p><strong>Consider instead:</strong> ${p.alternatives.map(a => `<button class="chip small" data-ask="Why did ${esc(a.name)} get its score?">${esc(a.name)} +${a.score_delta}${a.price_delta !== null ? `, ${a.price_delta >= 0 ? '+' : '-'}$${Math.abs(a.price_delta).toFixed(2)}` : ''}</button>`).join(' ')}</p>` : ''}
    <div class="chips">
      <button class="chip small" data-ask="Where can I buy ${esc(p.name)}?">🛒 Where to buy</button>
      <button class="chip small" data-ask="How do I dispose of ${esc(p.name)}?">♻️ How to dispose</button>
    </div>
    <p class="muted">Scoring model ${esc(p.model_version)}. Product data is fictional demo data.</p>`;
}

function companyCard(c) {
  return `<article class="ccard">
    <div class="ccard-head"><strong>🏢 ${esc(c.name)}</strong><span class="match ${esc(c.match_type)}">${{ exact: 'Exact match', contains: 'Name match', similar: 'Possible match' }[c.match_type]}</span></div>
    <ul>
      <li>Federally registered, active ${statusBadge('Verified', true)}</li>
      <li>Registered office: ${esc(c.facts.registered_office.value || 'Unknown')} ${statusBadge('Verified', true)}</li>
      <li>Canadian-owned? ${statusBadge('Unknown')}</li>
      ${c.incorporated_on ? `<li>Incorporated ${esc(c.incorporated_on)}${c.last_filing_year ? ` · last annual filing ${esc(c.last_filing_year)}` : ''}</li>` : ''}
    </ul>
    ${c.status_detail ? `<p class="warn">⚠️ ${esc(c.status_detail)}</p>` : ''}
    <p class="muted">${esc(c.what_it_proves)} Corporation #${esc(c.corporation_number)} · <a href="${esc(c.source.url)}" target="_blank" rel="noopener">Source ↗</a></p>
  </article>`;
}

function comparison(cmp) {
  if (!cmp) return '';
  return `<div class="table-scroll"><table class="mini"><thead><tr><th>Value</th>${cmp.products.map(n => `<th>${esc(n)}</th>`).join('')}</tr></thead><tbody>
    ${cmp.rows.map(r => `<tr><td>${esc(r.dimension)}</td>${r.cells.map(c => `<td>${c?.score ?? 'n/a'} ${statusBadge(c?.status)}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div>`;
}

function placesBlock(pl) {
  if (!pl) return '';
  const where = pl.location.source === 'browser' ? 'you' : 'downtown Regina';
  return `<div class="block">
    <h4>${pl.kind === 'stores' ? '🛒 Stores near ' + where : '♻️ Drop-off points near ' + where}</h4>
    ${pl.error ? `<p class="muted">${esc(pl.error)}</p>` : placeList(pl.items.slice(0, 5), { kind: pl.kind === 'stores' ? 'stores' : 'dropoffs' })}
    ${pl.demo_prices?.length ? `<p class="muted">Demo prices: ${pl.demo_prices.map(d => `${esc(d.retailer)} ${money(d.price)}`).join(' · ')}</p>` : ''}
    ${pl.items.length ? `<iframe class="map small-map" loading="lazy" title="Map" src="${mapEmbedUrl(pl.items[0].lat, pl.items[0].lon, 0.02)}"></iframe>` : ''}
    <p class="muted">${esc(pl.note)}${pl.kind !== 'stores' ? ' <a href="https://www.sarcan.ca/" target="_blank" rel="noopener">All SARCAN depots ↗</a>' : ''}</p>
  </div>`;
}

function addAnswer(r) {
  const applied = [...(r.applied.priorities || []), r.applied.category, r.applied.max_price ? `Under $${r.applied.max_price}` : null].filter(Boolean);
  const html = `<div class="msg bot">
    <div class="bubble">
      <p>${esc(r.summary)}</p>
      ${applied.length ? `<div class="applied">${applied.map(a => `<span>${esc(a)}</span>`).join('')}</div>` : ''}
      ${r.notes.map(n => `<p class="muted">ℹ️ ${esc(n)}</p>`).join('')}
    </div>
    ${r.products.length ? `<div class="cards">${r.products.map(productCard).join('')}</div>` : ''}
    ${comparison(r.comparison)}
    ${r.companies.length ? `<div class="cards">${r.companies.slice(0, 3).map(companyCard).join('')}</div>` : ''}
    ${r.intent === 'company_check' && !r.companies.length && r.registry_note ? `<p class="muted block">${esc(r.registry_note)}</p>` : ''}
    ${r.catalog_companies.length ? `<p class="muted block">Demo catalog: ${r.catalog_companies.map(c => `${esc(c.name)} says it is ${esc(c.ownership_type)}-owned ${statusBadge(c.status)}`).join('; ')}</p>` : ''}
    ${r.scan ? `<div class="block">${scanResultView(r.scan)}</div>` : ''}
    ${r.disposal ? `<div class="block"><h4>♻️ Which bin?</h4>${disposalView(r.disposal)}</div>` : ''}
    ${placesBlock(r.places)}
    ${r.suggestions.length ? `<div class="chips">${r.suggestions.map(s => `<button class="chip" data-ask="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
    <p class="tiny">${r.ai_summary ? '✨ Worded by AI from facts computed by TrueValue.' : 'Answer built from TrueValue data.'} ${esc(r.data_note)}</p>
  </div>`;
  log.insertAdjacentHTML('beforeend', html);
  scrollDown();
}

async function ask(text) {
  const message = text.trim();
  if (!message || state.busy) return;
  state.busy = true; $('#send').disabled = true; $('#input').value = '';
  addUser(message);
  const t = typing();
  try {
    const res = await api.chat(message, user.weights, state.location);
    t.remove(); addAnswer(res);
  } catch (e) {
    t.remove();
    log.insertAdjacentHTML('beforeend', `<div class="msg bot"><div class="bubble error">⚠️ ${esc(e.message)} <button class="chip small" data-ask="${esc(message)}">Try again</button></div></div>`);
    scrollDown();
  } finally {
    state.busy = false; $('#send').disabled = false; $('#input').focus();
  }
}

// ---------- events ----------
$('#composer').addEventListener('submit', e => { e.preventDefault(); ask($('#input').value); });
document.addEventListener('click', e => {
  const chip = e.target.closest('[data-ask]');
  if (chip) { e.stopPropagation(); ask(chip.dataset.ask); return; }
  if (e.target.closest('a, button, table')) return;
  const card = e.target.closest('[data-card]');
  if (card) toggleCard(card);
});
document.addEventListener('keydown', e => {
  const card = e.target.closest?.('[data-card]');
  if (card && (e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); toggleCard(card); }
});
function toggleCard(card) {
  const more = card.querySelector('.pcard-more');
  const open = more.hidden;
  if (open && !more.innerHTML) more.innerHTML = cardDetails(state.cards.get(card.dataset.card));
  more.hidden = !open;
  card.setAttribute('aria-expanded', String(open));
  card.querySelector('.tap').textContent = open ? 'Hide details ▴' : 'Tap for details ▾';
}
async function locate(force = false) {
  $('#loc').textContent = 'Finding your location…';
  state.location = await getLocation({ force });
  $('#loc').textContent = locationLine(state.location).replace(/<[^>]+>/g, '');
}
$('#relocate').addEventListener('click', () => locate(true));

// ---------- barcode: camera + photo upload ----------
async function closeCam() { await stopCamera(); $('#camModal').hidden = true; }
$('#camBtn').addEventListener('click', async () => {
  $('#camModal').hidden = false; $('#camStatus').textContent = 'Opening camera…';
  try {
    await startCamera('chat-reader', code => { $('#camModal').hidden = true; ask(code); });
    $('#camStatus').textContent = 'Hold the barcode steady inside the box.';
  } catch (e) { $('#camStatus').textContent = e.message; }
});
$('#camClose').addEventListener('click', closeCam);
$('#photo').addEventListener('change', async e => {
  const file = e.target.files?.[0]; if (!file) return;
  e.target.value = '';
  try { ask(await scanImage(file, 'chat-file-reader')); }
  catch (err) {
    log.insertAdjacentHTML('beforeend', `<div class="msg bot"><div class="bubble error">⚠️ ${esc(err.message)}</div></div>`);
    scrollDown();
  }
});

locate();
api.health().then(h => {
  $('#serverStatus').innerHTML = `✅ Server online · AI wording: ${h.ai ? 'on' : 'off (rule-based answers)'} · Registry: ${h.registry_rows ? Number(h.registry_rows).toLocaleString() + ' companies' : 'not loaded'}`;
}).catch(() => { $('#serverStatus').textContent = '⚠️ Cannot reach the TrueValue server. Start the backend to chat.'; });
$('#input').focus();

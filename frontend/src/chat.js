import { mountShell } from './components/shell.js';
import './chat.css';
import users from './data/userProfiles.json';
import priorityWeights from './data/priorityWeights.json';
import dimensions from './data/ethicalDimensions.json';
import { api } from './api.js';
import { loadUser } from './services/customerValuesService.js';
import { getLocation, mapEmbedUrl } from './services/locationService.js';
import { esc, money, statusBadge, verdictPill, placeList, disposalView, locationLine, scanResultView } from './components/views.js';
import { startCamera, stopCamera, scanImage } from './services/barcodeScanner.js';
import { icon, DIMENSION_ICONS } from './components/icons.js';

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

const content = mountShell({ active: 'assistant' });
content.classList.add('chat-content');
content.innerHTML = `
<div class="chat-layout">
  <section class="chat-main" aria-label="TrueValue assistant">
    <div class="chat-log" id="log" aria-live="polite">
      <div class="msg bot intro">
        <div class="bubble">
          <p><strong>Hi, I'm the TrueValue assistant.</strong> Ask me which products fit your values, why something got its score,
          whether a company is federally registered in Canada, where to buy something nearby, or which Regina bin your packaging goes in.</p>
          <p class="muted">I always show what is <span class="status verified">Verified</span>, <span class="status claimed">Claimed</span> or <span class="status unknown">Unknown</span>. Unknown never means bad.</p>
        </div>
        <div class="chips">${EXAMPLES.map(q => `<button type="button" class="chip" data-ask="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      </div>
    </div>
    <form class="composer" id="composer">
      <label class="sr-only" for="input">Ask TrueValue</label>
      <button type="button" class="icon-button" id="camBtn" aria-label="Scan a barcode with your camera">${icon('camera', 20)}</button>
      <button type="button" class="icon-button" id="photoBtn" aria-label="Upload a photo of a barcode">${icon('upload', 20)}</button>
      <input type="file" id="photo" accept="image/*" hidden>
      <input id="input" autocomplete="off" maxlength="400" placeholder="Ask a question, or scan a barcode" />
      <button type="submit" class="button" id="send">${icon('send')}<span class="send-label">Send</span></button>
    </form>
  </section>
  <aside class="chat-side" aria-label="Your settings">
    <div class="panel">
      <h2>Your priorities</h2>
      <ul class="weights">${[...dimensions].sort((a, b) => (user.weights[b.dimension_id] ?? 0) - (user.weights[a.dimension_id] ?? 0)).map(d => `
        <li><span>${icon(DIMENSION_ICONS[d.dimension_id] || 'info', 14)}${esc(d.label)}</span><span class="bar" aria-hidden="true"><i style="width:${user.weights[d.dimension_id] ?? d.default_weight}%"></i></span><b>${user.weights[d.dimension_id] ?? d.default_weight}</b></li>`).join('')}
      </ul>
      <a class="small-link" href="/#values">Change my values</a>
    </div>
    <div class="panel">
      <h2>Location</h2>
      <p id="loc" class="muted">Finding your location...</p>
      <button type="button" class="button secondary small" id="relocate">${icon('locate')}Use my location</button>
    </div>
    <p class="muted server-status" id="serverStatus">Checking the server...</p>
  </aside>
</div>
<div class="cam-modal" id="camModal" role="dialog" aria-modal="true" aria-labelledby="camTitle" hidden>
  <div class="cam-box">
    <div class="cam-head"><h2 id="camTitle">Point the camera at a barcode</h2><button type="button" class="button secondary small" id="camClose">Close</button></div>
    <div id="chat-reader"></div>
    <p class="muted" id="camStatus" role="status">Opening camera...</p>
  </div>
</div>`;

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
// Real Open Food Facts products have a photo and a pack size but no price; demo products have a demo price
function productCard(p) {
  state.cards.set(p.product_id, p);
  const real = !p.demo_data;
  const meta = [p.brand, p.category].filter(Boolean).map(esc).join(' · ');
  return `<article class="pcard" data-card="${esc(p.product_id)}" tabindex="0" role="button" aria-expanded="false">
    <div class="pcard-top">
      ${p.image ? `<img class="thumb" src="${esc(p.image)}" alt="" loading="lazy">` : `<div class="thumb">${icon('package', 20)}</div>`}
      <div class="pcard-info">
        ${meta ? `<small>${meta}</small>` : ''}
        <strong>${esc(p.name)}</strong>
        ${real ? `<small>${esc(p.size || '')}${p.size ? ' · ' : ''}Real product, Open Food Facts</small>`
               : `<span>${money(p.price)} <small>(demo price)</small></span>`}
      </div>
      <div class="pscore"><b>${p.score ?? 'N/A'}</b><small>/100</small></div>
    </div>
    <div class="pcard-mid">${verdictPill(p.verdict)} <small>${p.verified_percent}% verified · ${p.coverage_percent}% coverage</small></div>
    <div class="badges">${p.highlights.map(h => `<span class="hl">${esc(h.label)} ${statusBadge(h.status)}</span>`).join('')}</div>
    <div class="pcard-more" hidden></div>
    <small class="tap">Show details</small>
  </article>`;
}

// "Consider instead": a real alternative opens by its barcode (a real lookup); a demo one asks about its score
const altChip = (a, real) => `<button class="chip small" data-ask="${esc(real && a.barcode ? a.barcode : `Why did ${a.name} get its score?`)}">${esc(a.name)} +${a.score_delta}${a.price_delta !== null && a.price_delta !== undefined ? `, ${a.price_delta >= 0 ? '+' : '-'}$${Math.abs(a.price_delta).toFixed(2)}` : ''}</button>`;

function cardDetails(p) {
  const real = !p.demo_data;
  const dispose = real ? (p.packaging.length ? `How do I dispose of a ${p.packaging[0].toLowerCase()}?` : '') : `How do I dispose of ${p.name}?`;
  const where = real ? `Where can I buy ${(p.category || p.name).toLowerCase()} near me?` : `Where can I buy ${p.name}?`;
  return `
    <p>${esc(p.verdict.sentence)} ${esc(p.verdict.reason || '')}</p>
    <div class="table-scroll"><table class="mini breakdown"><thead><tr><th>Value</th><th>Weight</th><th>Score</th><th>Status</th></tr></thead><tbody>
    ${p.breakdown.map(r => `<tr><td>${esc(r.dimension)}${r.note && real ? `<small>${esc(r.note)}</small>` : ''}</td><td>${r.weight}</td><td>${r.score ?? 'n/a'}</td><td>${statusBadge(r.status)}</td></tr>`).join('')}
    </tbody></table></div>
    <p><strong>Ownership:</strong> ${p.company_chain.length ? p.company_chain.map(c => `${esc(c.name)} (${esc(c.ownership_type)}, ${esc(c.city)})`).join(', owned by ') + ' ' + statusBadge(p.company_chain[0].status) : 'Unknown'}</p>
    <p><strong>Made in:</strong> ${esc(p.made_in || 'Unknown')} · <strong>Ingredients:</strong> ${esc(p.components.join(', ') || 'Unknown')}</p>
    <p><strong>Packaging:</strong> ${esc(p.packaging.join(', ') || 'Unknown')} ${statusBadge(p.packaging_status)}</p>
    ${p.certifications.length ? `<p><strong>Certifications:</strong> ${p.certifications.map(c => `${esc(c.name)} ${statusBadge(c.status)}`).join(' ')}</p>` : ''}
    ${p.alternatives.length ? `<p><strong>Consider instead:</strong></p><div class="chips">${p.alternatives.map(a => altChip(a, real)).join('')}</div>` : ''}
    <div class="chips">
      <button class="chip small" data-ask="${esc(where)}">${icon('store', 14)}Where to buy</button>
      ${dispose ? `<button class="chip small" data-ask="${esc(dispose)}">${icon('recycle', 14)}How to dispose</button>` : ''}
    </div>
    <p class="muted">Scoring model ${esc(p.model_version)}. ${real
      ? `Label and community data from Open Food Facts, not independently verified.${p.off_url ? ` <a href="${esc(p.off_url)}" target="_blank" rel="noopener noreferrer">See it on Open Food Facts${icon('external', 14)}<span class="sr-only"> (opens in a new tab)</span></a>` : ''}`
      : 'Product data is fictional demo data.'}</p>`;
}

function companyCard(c) {
  return `<article class="ccard">
    <div class="ccard-head"><strong>${icon('building')}${esc(c.name)}</strong><span class="match ${esc(c.match_type)}">${{ exact: 'Exact match', contains: 'Name match', similar: 'Possible match' }[c.match_type]}</span></div>
    <ul>
      <li>Federally registered, active ${statusBadge('Verified', true)}</li>
      <li>Registered office: ${esc(c.facts.registered_office.value || 'Unknown')} ${statusBadge('Verified', true)}</li>
      <li>Canadian-owned? ${statusBadge('Unknown')}</li>
      ${c.incorporated_on ? `<li>Incorporated ${esc(c.incorporated_on)}${c.last_filing_year ? ` · last annual filing ${esc(c.last_filing_year)}` : ''}</li>` : ''}
    </ul>
    ${c.status_detail ? `<p class="warn">${icon('warning')}${esc(c.status_detail)}</p>` : ''}
    <p class="muted">${esc(c.what_it_proves)} Corporation #${esc(c.corporation_number)} · <a href="${esc(c.source.url)}" target="_blank" rel="noopener noreferrer">Source${icon('external', 14)}<span class="sr-only"> (opens in a new tab)</span></a></p>
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
    <h4>${pl.kind === 'stores' ? icon('store') + 'Stores near ' + where : icon('recycle') + 'Drop-off points near ' + where}</h4>
    ${pl.error ? `<p class="muted">${esc(pl.error)}</p>` : placeList(pl.items.slice(0, 5), { kind: pl.kind === 'stores' ? 'stores' : 'dropoffs' })}
    ${pl.demo_prices?.length ? `<p class="muted">Demo prices: ${pl.demo_prices.map(d => `${esc(d.retailer)} ${money(d.price)}`).join(' · ')}</p>` : ''}
    ${pl.items.length ? `<iframe class="map small-map" loading="lazy" title="Map" src="${mapEmbedUrl(pl.items[0].lat, pl.items[0].lon, 0.02)}"></iframe>` : ''}
    <p class="muted">${esc(pl.note)}${pl.kind !== 'stores' ? ` <a href="https://www.sarcan.ca/" target="_blank" rel="noopener noreferrer">All SARCAN depots${icon('external', 14)}<span class="sr-only"> (opens in a new tab)</span></a>` : ''}</p>
  </div>`;
}

function addAnswer(r) {
  const applied = [...(r.applied.priorities || []), r.applied.category, r.applied.max_price ? `Under $${r.applied.max_price}` : null].filter(Boolean);
  const html = `<div class="msg bot">
    <div class="bubble">
      <p>${esc(r.summary)}</p>
      ${applied.length ? `<div class="applied">${applied.map(a => `<span>${esc(a)}</span>`).join('')}</div>` : ''}
      ${r.notes.map(n => `<p class="muted note">${icon('info', 14)}${esc(n)}</p>`).join('')}
    </div>
    ${r.products.length ? `<div class="cards">${r.products.map(productCard).join('')}</div>` : ''}
    ${comparison(r.comparison)}
    ${r.companies.length ? `<div class="cards">${r.companies.slice(0, 3).map(companyCard).join('')}</div>` : ''}
    ${r.intent === 'company_check' && !r.companies.length && r.registry_note ? `<p class="muted block">${esc(r.registry_note)}</p>` : ''}
    ${r.catalog_companies.length ? `<p class="muted block">Demo catalog: ${r.catalog_companies.map(c => `${esc(c.name)} says it is ${esc(c.ownership_type)}-owned ${statusBadge(c.status)}`).join('; ')}</p>` : ''}
    ${r.scan ? `<div class="block">${scanResultView(r.scan)}</div>` : ''}
    ${r.disposal ? `<div class="block"><h4>${icon('recycle')}Which bin?</h4>${disposalView(r.disposal)}</div>` : ''}
    ${placesBlock(r.places)}
    ${r.suggestions.length ? `<div class="chips">${r.suggestions.map(s => `<button class="chip" data-ask="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
    <p class="tiny">${r.ai_summary ? 'Worded by AI from facts computed by TrueValue.' : 'Answer built from TrueValue data.'} ${esc(r.data_note)}</p>
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
    log.insertAdjacentHTML('beforeend', `<div class="msg bot"><div class="bubble error">${icon('warning')}${esc(e.message)} <button type="button" class="chip small" data-ask="${esc(message)}">Try again</button></div></div>`);
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
  card.querySelector('.tap').textContent = open ? 'Hide details' : 'Show details';
}
async function locate(force = false) {
  $('#loc').textContent = 'Finding your location…';
  state.location = await getLocation({ force });
  $('#loc').textContent = locationLine(state.location).replace(/<[^>]+>/g, '');
}
$('#relocate').addEventListener('click', () => locate(true));

// ---------- barcode: camera + photo upload ----------
async function closeCam() { await stopCamera(); $('#camModal').hidden = true; $('#camBtn').focus(); }
$('#camBtn').addEventListener('click', async () => {
  $('#camModal').hidden = false; $('#camStatus').textContent = 'Opening camera...'; $('#camClose').focus();
  try {
    await startCamera('chat-reader', code => { $('#camModal').hidden = true; $('#input').focus(); ask(code); });
    $('#camStatus').textContent = 'Hold the barcode steady inside the box.';
  } catch (e) { $('#camStatus').textContent = e.message; }
});
$('#camClose').addEventListener('click', closeCam);
$('#camModal').addEventListener('keydown', e => {
  if (e.key === 'Escape') closeCam();
  else if (e.key === 'Tab') { e.preventDefault(); $('#camClose').focus(); } // Close is the dialog's only control: keep focus in it
});
$('#photoBtn').addEventListener('click', () => $('#photo').click());
$('#photo').addEventListener('change', async e => {
  const file = e.target.files?.[0]; if (!file) return;
  e.target.value = '';
  try { ask(await scanImage(file, 'chat-file-reader')); }
  catch (err) {
    log.insertAdjacentHTML('beforeend', `<div class="msg bot"><div class="bubble error">${icon('warning')}${esc(err.message)}</div></div>`);
    scrollDown();
  }
});

locate();
api.health().then(h => {
  $('#serverStatus').innerHTML = `${icon('ok', 14)}Server online · AI wording: ${h.ai ? 'on' : 'off (rule-based answers)'} · Registry: ${h.registry_rows ? Number(h.registry_rows).toLocaleString() + ' companies' : 'not loaded'}`;
}).catch(() => { $('#serverStatus').innerHTML = `${icon('warning', 14)}Cannot reach the TrueValue server. Start the backend to chat.`; });
$('#input').focus();

// Small HTML builders shared by the main page and the assistant page.
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = p => (p === null || p === undefined ? 'Price unknown' : `$${Number(p).toFixed(2)} CAD`);

const STATUS_TEXT = { Verified: 'Verified (demo only)', Claimed: 'Claimed / not verified', Unknown: 'Unknown', Expired: 'Expired', Disputed: 'Disputed' };
export const statusBadge = (status, real = false) => {
  const s = status || 'Unknown';
  const text = real && s === 'Verified' ? 'Verified' : (STATUS_TEXT[s] || s);
  const tip = { Verified: 'Confirmed by an official record or certification', Claimed: 'Stated by the company, not independently confirmed', Unknown: 'No information found. This does not mean it is bad.' }[s] || '';
  return `<span class="status ${esc(s.toLowerCase())}" title="${esc(tip)}">${esc(text)}</span>`;
};

export const verdictPill = v => v ? `<span class="verdict ${esc(v.tone)}">${esc(v.label)}</span>` : '';

export function placeList(items, { kind = 'stores', emptyText = 'Nothing found nearby.' } = {}) {
  if (!items?.length) return `<p class="muted">${esc(emptyText)}</p>`;
  return `<ul class="place-list">${items.map(p => `
    <li class="place">
      <div>
        <strong>${kind === 'stores' ? '🛒' : (p.is_sarcan ? '♻️' : '🗑️')} ${esc(p.name)}</strong>
        <small>${esc([p.kind && p.kind.replace(/_/g, ' '), p.address].filter(Boolean).join(' · '))}</small>
        ${p.opening_hours ? `<small>🕒 ${esc(p.opening_hours)}</small>` : ''}
        ${p.accepts?.length ? `<small>Accepts: ${esc(p.accepts.join(', '))}</small>` : ''}
        ${kind === 'stores' ? `<small class="stock">Stock: ${statusBadge('Unknown')}</small>` : ''}
      </div>
      <div class="place-actions">
        <span class="distance">${esc(p.distance_km)} km</span>
        <a href="${esc(p.directions_url)}" target="_blank" rel="noopener">Directions ↗</a>
      </div>
    </li>`).join('')}</ul>`;
}

export function disposalView(guide) {
  if (!guide) return '';
  return `<div class="disposal">
    ${guide.product_name ? `<p class="muted">Packaging materials for ${esc(guide.product_name)}: ${statusBadge(guide.materials_status)}</p>` : ''}
    <ul class="bin-list">${guide.items.map(i => `
      <li><span class="bin bin-${esc(i.bin)}">${esc(i.icon)} ${esc(i.label)}</span>
        <div><strong>${esc(i.material)}</strong><small>${esc(i.tip)}</small></div></li>`).join('')}
    </ul>
    <p class="muted">Rules: City of Regina recycling program (blue cart changes from July 1, 2025).
      ${guide.sources.map(s => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)} ↗</a>`).join(' · ')}</p>
  </div>`;
}

export function locationLine(loc) {
  if (!loc) return 'Finding your location…';
  return loc.source === 'browser'
    ? `📍 Using your location (±${esc(loc.accuracy ?? '?')} m)`
    : `📍 Using downtown Regina. ${esc(loc.reason || '')}`;
}

// Result of a barcode scan (demo catalog or Open Food Facts), as a compact True Value Card.
export function scanResultView(res) {
  if (!res) return '';
  if (!res.found) return `<div class="scan-result empty"><p>🔎 <strong>${esc(res.barcode)}</strong>: ${esc(res.error)}</p></div>`;
  const c = res.card, f = res.facts || {};
  const off = res.source === 'openfoodfacts';
  const reg = res.registry;
  return `<div class="scan-result">
    <div class="scan-head">
      ${f.image ? `<img src="${esc(f.image)}" alt="" loading="lazy">` : `<div class="scan-emoji">${esc(c.emoji || '📦')}</div>`}
      <div class="scan-title">
        <span class="source-tag ${off ? 'real' : 'demo'}">${off ? 'Real product · Open Food Facts' : 'Demo catalog product'}</span>
        <h3>${esc(c.name)}</h3>
        <p class="muted">${esc([c.brand, c.size, `Barcode ${res.barcode}`].filter(Boolean).join(' · '))}</p>
      </div>
      <div class="big-score">${c.score ?? 'N/A'}<small>/100</small></div>
    </div>
    <p>${verdictPill(c.verdict)} ${esc(c.verdict.sentence)} ${esc(c.verdict.reason || '')}</p>
    <p class="muted">Based on ${c.verified_percent}% verified data · ${c.coverage_percent}% evidence coverage${off ? ' · Open Food Facts data is label and community information, so it counts as Claimed' : ''}</p>
    <div class="table-scroll"><table class="mini"><thead><tr><th>Value</th><th>Weight</th><th>Score</th><th>Status</th><th>What we found</th></tr></thead><tbody>
      ${c.breakdown.map(r => `<tr><td>${esc(r.dimension)}</td><td>${r.weight}</td><td>${r.score ?? 'n/a'}</td><td>${statusBadge(r.status)}</td><td>${esc(r.note || r.source || '')}</td></tr>`).join('')}
    </tbody></table></div>
    ${off ? `<p><strong>Made in:</strong> ${esc(f.manufacturing_places || 'Not reported')} · <strong>Ingredient origins:</strong> ${esc(f.origins || 'Not reported')} · <strong>Labels:</strong> ${esc(f.labels || 'None reported')}</p>` : ''}
    ${reg ? `<p><strong>Company check (${esc(reg.query)}):</strong> ${reg.match
      ? `${esc(reg.match.name)}, registered office ${esc(reg.match.facts.registered_office.value || 'Canada')} ${statusBadge('Verified', true)} · Ownership ${statusBadge('Unknown')}`
      : reg.possible ? `possible match ${esc(reg.possible.name)} (not confirmed) ${statusBadge('Unknown')}`
      : `${esc(reg.error ? 'Registry not loaded yet.' : 'not in the federal registry')} ${statusBadge('Unknown')}`}</p>` : ''}
    ${c.alternatives?.length ? `<p><strong>Consider instead:</strong> ${c.alternatives.map(a => `${esc(a.name)} (+${a.score_delta})`).join(', ')} <small class="muted">(demo catalog)</small></p>` : ''}
    <details><summary>♻️ How to dispose of the packaging</summary>${disposalView(res.disposal)}</details>
    <p class="muted"><a href="/result.html?barcode=${encodeURIComponent(res.barcode)}"><strong>Open full result →</strong></a>${off ? ` · <a href="${esc(f.url)}" target="_blank" rel="noopener">View on Open Food Facts ↗</a>` : ''}</p>
  </div>`;
}

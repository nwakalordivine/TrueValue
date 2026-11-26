// "Compare" buttons used on the home page (search results, demo products) and the result page.
// The tray itself lives in services/compareTray.js; the comparison table is on /compare.html.
import { esc } from './views.js';
import { icon } from './icons.js';
import { toggle, inTray } from '../services/compareTray.js';

// The text sits in a span so narrow layouts can show the icon only; the aria-label keeps the button named.
const label = on => on ? `${icon('check')}<span class="btn-text">In compare</span>` : `${icon('plus')}<span class="btn-text">Compare</span>`;

export function compareButton(kind, id, name) {
  const on = inTray(kind, id);
  return `<button type="button" class="button secondary small compare-btn ${on ? 'on' : ''}" aria-pressed="${on}" aria-label="Compare ${esc(name)}" data-compare-kind="${esc(kind)}" data-compare-id="${esc(id)}" data-compare-name="${esc(name)}">${label(on)}</button>`;
}

export const notifyCompareChanged = () => window.dispatchEvent(new Event('truevalue:compare'));

// Handles clicks on every compare button on the page. onChange(result, item, button): result is 'added', 'removed' or 'full'.
export function wireCompareButtons(onChange = () => {}) {
  document.addEventListener('click', e => {
    const btn = e.target.closest('.compare-btn[data-compare-kind]');
    if (!btn) return;
    const item = { kind: btn.dataset.compareKind, id: btn.dataset.compareId, name: btn.dataset.compareName || btn.dataset.compareId };
    const result = toggle(item);
    if (result !== 'full') {
      const on = result === 'added';
      document.querySelectorAll(`.compare-btn[data-compare-kind="${CSS.escape(item.kind)}"][data-compare-id="${CSS.escape(item.id)}"]`).forEach(b => {
        b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on)); b.innerHTML = label(on);
      });
      notifyCompareChanged();
    }
    onChange(result, item, btn);
  });
}

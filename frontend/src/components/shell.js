// The app shell shared by every page: top bar (mobile), sidebar (slide-in on mobile, fixed on desktop),
// account popup card and the main content slot. Each page calls mountShell() and then renders into
// the element it returns.
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/shell.css';
import { icon } from './icons.js';
import { getTray } from '../services/compareTray.js';
import { mountAccount } from './account.js';
import { checkSession } from '../services/auth.js';

const NAV = [
  { id: 'home', href: '/', label: 'Home', icon: 'home' },
  { id: 'assistant', href: '/chat.html', label: 'Assistant', icon: 'assistant' },
  { id: 'compare', href: '/compare.html', label: 'Compare', icon: 'compare' },
  { id: 'nearme', href: '/nearme.html', label: 'Near me', icon: 'pin' },
  { id: 'about', href: '/#about', label: 'About', icon: 'info' },
];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const desktop = window.matchMedia('(min-width: 1024px)');
// Focusable elements that are actually shown (skips the desktop-only head inside the mobile menu)
const focusables = root => [...root.querySelectorAll(FOCUSABLE)].filter(el => el.getClientRects().length > 0);

const avatarButton = cls => `<button type="button" class="avatar-button ${cls}" data-open-profile aria-label="Open your profile" aria-controls="profilePanel" aria-expanded="false">
    <span class="avatar" data-avatar>${icon('user', 18)}</span></button>`;

export function mountShell({ active = '' } = {}) {
  const app = document.getElementById('app');
  app.innerHTML = `
  <a class="skip-link" href="#content">Skip to content</a>
  <header class="topbar" data-shell-part>
    ${avatarButton('topbar-avatar')}
    <a class="wordmark" href="/">TrueValue</a>
    <button type="button" class="icon-button menu-button" id="menuButton" aria-label="Open menu" aria-controls="sidebar" aria-expanded="false">${icon('menu', 20)}</button>
  </header>

  <aside class="sidebar drawer" id="sidebar" aria-label="Main menu" data-shell-part>
    <div class="sidebar-head desktop-only">
      ${avatarButton('')}
      <a class="wordmark" href="/">TrueValue</a>
    </div>
    <div class="drawer-head mobile-only">
      <span class="drawer-title">Menu</span>
      <button type="button" class="icon-button" data-close-drawer aria-label="Close menu">${icon('close', 20)}</button>
    </div>
    <nav class="sidebar-nav" aria-label="Main">
      ${NAV.map(n => `<a class="nav-link" href="${n.href}" ${n.id === active ? 'aria-current="page"' : ''}>
        ${icon(n.icon, 20)}<span>${n.label}</span>${n.id === 'compare' ? '<span class="nav-count" data-compare-count hidden></span>' : ''}</a>`).join('')}
    </nav>
    <div class="sidebar-foot">
      <div class="account-area" data-account-area></div>
      <a class="foot-link" href="/#feedback">${icon('report')}Report a problem</a>
    </div>
  </aside>

  <div class="backdrop" id="backdrop" hidden></div>

  <div class="profile-panel modal-card" id="profilePanel" role="dialog" aria-modal="true" aria-labelledby="profileTitle" data-shell-part>
    <div class="drawer-head">
      <h2 class="drawer-title" id="profileTitle">Account</h2>
      <button type="button" class="icon-button" data-close-drawer aria-label="Close">${icon('close', 20)}</button>
    </div>
    <div class="drawer-body" id="profileBody"></div>
  </div>

  <main id="content" class="content" tabindex="-1" data-shell-part></main>`;

  const sidebar = app.querySelector('#sidebar');
  const panel = app.querySelector('#profilePanel');
  const backdrop = app.querySelector('#backdrop');
  const menuButton = app.querySelector('#menuButton');
  let openDrawer = null, returnFocus = null;

  // On desktop the sidebar is plain navigation; on mobile it is a modal dialog.
  const syncSidebarRole = () => {
    if (desktop.matches) {
      sidebar.removeAttribute('role'); sidebar.removeAttribute('aria-modal');
      if (openDrawer === sidebar) close({ restoreFocus: false });
    } else {
      sidebar.setAttribute('role', 'dialog'); sidebar.setAttribute('aria-modal', 'true');
    }
  };

  function setExpanded(drawer, value) {
    const sel = drawer === sidebar ? '[aria-controls="sidebar"]' : '[data-open-profile]';
    app.querySelectorAll(sel).forEach(b => b.hasAttribute('aria-expanded') && b.setAttribute('aria-expanded', String(value)));
  }

  function open(drawer, trigger) {
    if (openDrawer) close({ restoreFocus: false });
    openDrawer = drawer;
    returnFocus = trigger || document.activeElement;
    drawer.classList.add('is-open');
    backdrop.hidden = false;
    requestAnimationFrame(() => backdrop.classList.add('is-open'));
    document.body.classList.add('drawer-open');
    // Everything else on the page becomes unreachable while the drawer is open
    app.querySelectorAll('[data-shell-part]').forEach(el => { if (el !== drawer) el.inert = true; });
    setExpanded(drawer, true);
    const first = focusables(drawer)[0];
    first && first.focus();
  }

  function close({ restoreFocus = true } = {}) {
    if (!openDrawer) return;
    const drawer = openDrawer;
    openDrawer = null;
    drawer.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    backdrop.hidden = true;
    document.body.classList.remove('drawer-open');
    app.querySelectorAll('[data-shell-part]').forEach(el => { el.inert = false; });
    setExpanded(drawer, false);
    if (restoreFocus && returnFocus && document.contains(returnFocus)) returnFocus.focus();
  }

  menuButton.addEventListener('click', () => open(sidebar, menuButton));
  // Delegated: the account area's button is redrawn when you sign in or out
  app.addEventListener('click', e => { const b = e.target.closest('[data-open-profile]'); if (b) open(panel, b); });
  app.querySelectorAll('[data-close-drawer]').forEach(b => b.addEventListener('click', () => close()));
  backdrop.addEventListener('click', () => close());
  // Choosing a link closes the mobile menu (also for same-page links like /#about)
  sidebar.addEventListener('click', e => { if (e.target.closest('a') && openDrawer === sidebar) close({ restoreFocus: false }); });

  document.addEventListener('keydown', e => {
    if (!openDrawer) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = focusables(openDrawer);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  desktop.addEventListener('change', syncSidebarRole);
  syncSidebarRole();

  // Number of products waiting in the compare tray, next to the Compare link
  const updateCount = () => {
    const n = getTray().length;
    app.querySelectorAll('[data-compare-count]').forEach(el => { el.hidden = !n; el.innerHTML = `${n}<span class="sr-only"> in compare</span>`; });
  };
  window.addEventListener('truevalue:compare', updateCount);
  window.addEventListener('storage', e => { if (e.key === 'truevalue-compare-v1') updateCount(); });
  updateCount();

  // Sign-in state: the Account panel, the sidebar's account area and the avatars
  mountAccount({
    panelBody: app.querySelector('#profileBody'),
    accountArea: app.querySelector('[data-account-area]'),
    avatars: [...app.querySelectorAll('[data-avatar]')],
    isPanelOpen: () => openDrawer === panel,
    closePanel: () => { if (openDrawer === panel) close(); },
  });
  checkSession(); // once per page: proves the session still works and syncs saved values

  return app.querySelector('#content');
}

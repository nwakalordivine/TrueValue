// Accessible tabs: click or Left/Right/Home/End to switch. Tabs carry aria-selected and aria-controls.
export function wireTabs(tablist, onSelect) {
  const tabs = () => [...tablist.querySelectorAll('[role=tab]')];
  const select = (tab, focus = false) => {
    tabs().forEach(t => {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = t.getAttribute('aria-controls') && document.getElementById(t.getAttribute('aria-controls'));
      if (panel) panel.hidden = !on;
    });
    if (focus) tab.focus();
    onSelect?.(tab);
  };
  tablist.addEventListener('click', e => { const t = e.target.closest('[role=tab]'); if (t) select(t); });
  tablist.addEventListener('keydown', e => {
    const list = tabs(), i = list.indexOf(document.activeElement);
    if (i < 0) return;
    const next = { ArrowRight: list[(i + 1) % list.length], ArrowLeft: list[(i - 1 + list.length) % list.length],
      Home: list[0], End: list[list.length - 1] }[e.key];
    if (next) { e.preventDefault(); select(next, true); }
  });
  tabs().forEach(t => { t.tabIndex = t.getAttribute('aria-selected') === 'true' ? 0 : -1; });
}

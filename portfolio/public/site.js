(() => {
  if (window.__dihlabsSite) return;
  window.__dihlabsSite = true;
  const root = document.documentElement;
  const system = matchMedia('(prefers-color-scheme: dark)');
  let preference = null;
  try { preference = localStorage.getItem('dihlabs-theme'); } catch {}
  if (preference !== 'light' && preference !== 'dark') preference = null;
  const sync = () => {
    const dark = root.dataset.theme === 'dark';
    for (const button of document.querySelectorAll('[data-theme-toggle]')) {
      const label = dark ? 'Switch to light mode' : 'Switch to dark mode';
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
    }
  };
  const apply = () => {
    root.dataset.theme = preference || (system.matches ? 'dark' : 'light');
    sync();
  };
  apply();
  system.addEventListener('change', () => { if (!preference) apply(); });
  addEventListener('storage', (event) => {
    if (event.key === 'dihlabs-theme') {
      preference = event.newValue === 'dark' || event.newValue === 'light' ? event.newValue : null;
      apply();
    }
  });
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-theme-toggle]')) {
      preference = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('dihlabs-theme', preference); } catch {}
      apply();
    }
    for (const menu of document.querySelectorAll('.product-menu[open]')) {
      if (!target || !menu.contains(target) || target.closest('a')) menu.removeAttribute('open');
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') for (const menu of document.querySelectorAll('.product-menu[open]')) {
      menu.removeAttribute('open');
      menu.querySelector('summary')?.focus();
    }
  });
  const ready = () => {
    sync();
    new MutationObserver(sync).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
})();

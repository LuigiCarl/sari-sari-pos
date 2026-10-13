(function () {
  const root = document.documentElement;
  const menu = document.querySelector('.mobile-menu');
  if (menu) menu.addEventListener('click', () => {
    const expanded = menu.getAttribute('aria-expanded') !== 'true';
    menu.setAttribute('aria-expanded', String(expanded));
    document.querySelector('.topbar').classList.toggle('menu-open', expanded);
  });
  const savedTheme = localStorage.getItem('sari-theme');
  if (savedTheme === 'dark') root.dataset.theme = 'dark';

  document.querySelectorAll('.topbar-nav a').forEach((link) => {
    const path = new URL(link.href).pathname;
    if (location.pathname === path || (path !== '/pos' && location.pathname.startsWith(path + '/'))) {
      link.setAttribute('aria-current', 'page');
    }
  });

  const toggle = document.querySelector('[data-theme-toggle]');
  if (toggle) {
    toggle.addEventListener('click', () => {
      const dark = root.dataset.theme !== 'dark';
      root.dataset.theme = dark ? 'dark' : '';
      localStorage.setItem('sari-theme', dark ? 'dark' : 'light');
    });
  }

  document.querySelectorAll('form').forEach((form) => {
    form.addEventListener('submit', () => {
      const button = form.querySelector('button[type="submit"]');
      if (!button || button.disabled) return;
      button.disabled = true;
      button.dataset.originalText = button.textContent;
      button.textContent = 'Processing…';
    });
  });

  document.querySelectorAll('.alert').forEach((alert) => {
    window.setTimeout(() => alert.classList.add('alert-dismissed'), 5000);
  });

  document.querySelectorAll('[data-filter-table]').forEach((input) => {
    input.addEventListener('input', () => {
      const query = input.value.toLowerCase().trim();
      document.querySelectorAll(`#${input.dataset.filterTable} tbody tr`).forEach((row) => {
        row.hidden = !(row.dataset.search || row.textContent).toLowerCase().includes(query);
      });
    });
  });

  document.querySelectorAll('[data-export-table]').forEach((button) => {
    button.addEventListener('click', () => {
      const table = document.getElementById(button.dataset.exportTable);
      if (!table) return;
      const csv = Array.from(table.rows).map((row) => Array.from(row.cells)
        .map((cell) => `"${cell.textContent.trim().replace(/"/g, '""')}"`).join(',')).join('\n');
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      link.download = button.dataset.exportName || 'export.csv';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    });
  });
})();

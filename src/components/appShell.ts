export function renderAppShell(): string {
  return `
    <div class="app-shell">
      <svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute;">
        <defs>
          <linearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#1f70ff"></stop>
            <stop offset="100%" stop-color="#22d3ee"></stop>
          </linearGradient>
        </defs>
      </svg>
      <header id="app-header" class="layout-column app-header" aria-label="Header"></header>
      <main id="app-main" class="layout-column app-main" tabindex="-1"></main>
      <div id="app-toast" class="layout-column app-toast-host" aria-live="polite" aria-atomic="true"></div>
      <div id="app-overlay"></div>
      <nav id="app-tabbar" class="layout-column app-tabbar" aria-label="Primary"></nav>
    </div>
  `;
}

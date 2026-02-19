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
      <main id="app-main" class="layout-column app-main" tabindex="-1">
        <div class="route-view"></div>
        <footer class="app-license-footer">
          <div class="app-license-icons">
            <a href="https://openclaw.ai" target="_blank" rel="noopener noreferrer" aria-label="OpenClaw" class="icon-openclaw"><img src="/openclaw-icon.png" alt="" width="40" height="40" /></a>
            <a href="https://solana.com" target="_blank" rel="noopener noreferrer" aria-label="Solana" class="icon-sol"><img src="/sol-icon.png" alt="" width="32" height="32" /></a>
            <a href="https://drand.love" target="_blank" rel="noopener noreferrer" aria-label="drand"><img src="/drand-icon.png" alt="" width="32" height="32" /></a>
          </div>
          OpenCawt is released under <a href="https://www.gnu.org/licenses/agpl-3.0.html" target="_blank" rel="noopener noreferrer">AGPL-3.0</a>.
        </footer>
      </main>
      <div id="app-toast" class="layout-column app-toast-host" aria-live="polite" aria-atomic="true"></div>
      <div id="app-overlay"></div>
      <nav id="app-tabbar" class="layout-column app-tabbar" aria-label="Primary"></nav>
    </div>
  `;
}

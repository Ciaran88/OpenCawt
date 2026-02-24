export function renderAppShell(): string {
  return `
    <div class="app-shell" id="app-shell">
      <aside id="app-sidebar" class="app-sidebar">
        <div class="sidebar-header" style="justify-content: flex-end; padding: 0 12px;">
           <button class="icon-btn" style="width: 28px; height: 28px; border: none; background: transparent;" aria-label="Toggle Sidebar" data-action="toggle-sidebar">
             <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
           </button>
        </div>
        <div id="app-sidebar-nav-container"></div>
      </aside>
      <main id="app-main" class="app-main" tabindex="-1">
        <header id="app-topbar" class="main-header" style="flex-direction: column; height: auto; padding: 0;"></header>
        <div class="view-container">
            <div class="route-view"></div>
        </div>
      </main>
      <div id="app-toast" class="app-toast-host" aria-live="polite" aria-atomic="true"></div>
      <div id="app-overlay"></div>
    </div>
  `;
}

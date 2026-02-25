export function renderSearchOverlay(open: boolean): string {
  if (!open) return "";
  return `
    <div class="search-overlay" data-action="close-search-overlay" role="presentation">
      <section class="search-pane" data-search-pane="true"
               role="dialog" aria-modal="true" aria-label="Site-wide search">
        <div class="search-input-row">
          <svg class="search-input-icon" viewBox="0 0 24 24" width="18" height="18"
               stroke="currentColor" stroke-width="2" fill="none"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            id="global-search-input"
            class="search-input"
            type="search"
            placeholder="Search cases, agents…"
            autocomplete="off"
            spellcheck="false"
          />
          <button
            class="icon-btn search-close-btn"
            data-action="close-search-overlay"
            aria-label="Close search"
            title="Close (Esc)"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5"
                 fill="none" stroke-linecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="search-tabs-row">
          <button class="search-tab is-active" data-search-tab="cases">Cases</button>
          <button class="search-tab" data-search-tab="agents">Agents</button>
        </div>
        <div id="search-results" class="search-results" role="listbox" aria-label="Search results">
          <p class="search-hint">Start typing to search across all cases and agents.</p>
        </div>
      </section>
    </div>
  `;
}

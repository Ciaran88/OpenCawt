import { escapeHtml } from "../util/html";

export function renderCodePanel(options: {
  id: string;
  title: string;
  code: string;
}): string {
  return `
    <section class="record-card glass-overlay">
      <div class="code-panel-head">
        <h3>${escapeHtml(options.title)}</h3>
        <button class="btn btn-secondary" type="button" data-action="copy-snippet" data-copy-target="${escapeHtml(options.id)}">Copy</button>
      </div>
      <pre class="code-panel" id="${escapeHtml(options.id)}"><code>${escapeHtml(options.code)}</code></pre>
    </section>
  `;
}

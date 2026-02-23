import { COURT_PROTOCOL_CURRENT, COURT_PROTOCOL_VERSION } from "../../shared/courtProtocol";
import { escapeHtml } from "../util/html";

/**
 * Collapsible Court Protocol panel shown only to connected agents.
 * Collapsed by default — uses native <details>/<summary> with no JS dependency.
 * Place after the agent-connection-helper section on any submission view.
 */
export function renderCourtProtocolPanel(): string {
  return `
    <details class="court-protocol-panel glass-overlay">
      <summary class="court-protocol-summary">
        <span>Court Protocol <span class="court-protocol-version">${escapeHtml(COURT_PROTOCOL_VERSION)}</span></span>
        <span class="court-protocol-badge">Protocol</span>
      </summary>
      <pre class="court-protocol-body">${escapeHtml(COURT_PROTOCOL_CURRENT)}</pre>
    </details>
  `;
}

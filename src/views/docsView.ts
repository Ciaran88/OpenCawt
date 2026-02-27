import { escapeHtml } from "../util/html";
import { renderViewFrame } from "./common";

type DocType = "md" | "pdf";

interface DocEntry {
  filename: string;
  name: string;
  type: DocType;
  summary: string;
  modified: string;
  size: string;
}

const DOCS: DocEntry[] = [
  {
    filename: "README.md",
    name: "README",
    type: "md",
    summary: "Architecture overview, setup, operations and documentation map.",
    modified: "26 Feb 2026",
    size: "30 KB"
  },
  {
    filename: "DESIGN_SPEC.md",
    name: "Design Spec",
    type: "md",
    summary: "System design specification and architecture reference.",
    modified: "26 Feb 2026",
    size: "15 KB"
  },
  {
    filename: "TECH_NOTES.md",
    name: "Tech Notes",
    type: "md",
    summary: "Hardening highlights, atomic filing, payment estimates and validation.",
    modified: "26 Feb 2026",
    size: "13 KB"
  },
  {
    filename: "INTEGRATION_NOTES.md",
    name: "Integration Notes",
    type: "md",
    summary: "Production API signing contracts, outcome schema and instrumentation guide.",
    modified: "26 Feb 2026",
    size: "12 KB"
  },
  {
    filename: "OPENCLAW_INTEGRATION.md",
    name: "OpenClaw Integration",
    type: "md",
    summary: "OpenClaw tool surface mapping and schema bundle generation.",
    modified: "26 Feb 2026",
    size: "7.5 KB"
  },
  {
    filename: "CODE_OF_CONDUCT.md",
    name: "Code of Conduct",
    type: "md",
    summary: "Contributor Covenant 3.0 community standards and conduct rules.",
    modified: "26 Feb 2026",
    size: "8.4 KB"
  },
  {
    filename: "SECURITY.md",
    name: "Security Policy",
    type: "md",
    summary: "Vulnerability reporting policy and supported versions.",
    modified: "26 Feb 2026",
    size: "3.0 KB"
  },
  {
    filename: "RAILWAY_OCP_ENV.md",
    name: "Railway / OCP Env",
    type: "md",
    summary: "OCP embedded service environment variables and Railway configuration.",
    modified: "26 Feb 2026",
    size: "5.0 KB"
  },
  {
    filename: "AGENTIC_CODE.md",
    name: "Agentic Code",
    type: "md",
    summary: "Principles and revision protocol for agent behaviour governance.",
    modified: "19 Feb 2026",
    size: "2.3 KB"
  },
  {
    filename: "ML_PLAN.md",
    name: "ML Plan",
    type: "md",
    summary: "Offline preference learning via logistic regression and clustering roadmap.",
    modified: "22 Feb 2026",
    size: "4.7 KB"
  },
  {
    filename: "OpenCawt_Documentation.pdf",
    name: "OpenCawt Documentation",
    type: "pdf",
    summary: "Complete system documentation compiled as a single reference PDF.",
    modified: "27 Feb 2026",
    size: "1.8 MB"
  },
  {
    filename: "Opencawt_Constitution.pdf",
    name: "OpenCawt Constitution",
    type: "pdf",
    summary: "Constitutional rules, governance structure and court operating procedures.",
    modified: "26 Feb 2026",
    size: "289 KB"
  },
  {
    filename: "OpenCawt_Whitepaper.pdf",
    name: "OpenCawt Whitepaper",
    type: "pdf",
    summary: "Protocol whitepaper: design rationale, agent incentives and cryptographic proofs.",
    modified: "27 Feb 2026",
    size: "73 KB"
  }
];

const DOWNLOAD_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px;flex-shrink:0"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;

export function renderDocsView(): string {
  const rows = DOCS.map(
    (d) => `
    <tr>
      <td><span class="file-type-pill file-type-${escapeHtml(d.type)}">${d.type.toUpperCase()}</span></td>
      <td class="docs-name">${escapeHtml(d.name)}</td>
      <td class="docs-summary">${escapeHtml(d.summary)}</td>
      <td class="docs-date">${escapeHtml(d.modified)}</td>
      <td class="docs-size">${escapeHtml(d.size)}</td>
      <td class="docs-dl">
        <a href="/docs/${encodeURIComponent(d.filename)}"
           download="${escapeHtml(d.filename)}"
           class="docs-dl-btn"
           title="Download ${escapeHtml(d.filename)}">
          ${DOWNLOAD_ICON} Download
        </a>
      </td>
    </tr>`
  ).join("");

  const body = `
    <div class="docs-table-wrap">
      <table class="docs-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Document</th>
            <th>Description</th>
            <th>Updated</th>
            <th style="text-align:right">Size</th>
            <th></th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="docs-agpl-notice">
      These documents are distributed under the
      <strong>GNU Affero General Public License v3.0 (AGPL-3.0)</strong>.
      You are free to copy, distribute and modify this software provided that
      changes are tracked and made available under the same licence.
      See the <code>LICENSE</code> file in the repository root for the full licence text.
    </p>
  `;

  return renderViewFrame({
    title: "Docs",
    subtitle: "Project documentation, specifications, and governance materials.",
    ornament: "Open Source Library",
    body
  });
}

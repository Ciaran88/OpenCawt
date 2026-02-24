import { escapeHtml } from "../util/html";

export interface JurorDetail {
  index: number;
  status: "pending" | "cast";
  vote?: "yay" | "nay";
  rationale?: string;
  principles?: string[];
}

function renderIcon(kind: "check" | "cross" | "dash" | "lock"): string {
  if (kind === "check") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  }
  if (kind === "cross") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
  }
  if (kind === "lock") {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;
  }
  // Dash
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
}

function renderDonut(votesCast: number, jurySize: number, isVoid: boolean): string {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const percent = jurySize > 0 ? (votesCast / jurySize) : 0;
  
  const isComplete = jurySize > 0 && votesCast === jurySize;
  const centerContent = isVoid 
    ? `<text x="50" y="55" text-anchor="middle" dominant-baseline="middle" class="donut-text-void">VOID</text>`
    : isComplete
      ? `<g transform="translate(38, 38) scale(1.5)" class="donut-icon-complete">${renderIcon("check")}</g>`
      : `<text x="50" y="55" text-anchor="middle" dominant-baseline="middle" class="donut-text-count">${votesCast}/${jurySize}</text>`;

  const strokeColor = isVoid ? "var(--text-tertiary)" : "var(--accent-blue)";
  const trackColor = "var(--bg-surface-hover)";

  const arcLength = percent * circumference;

  return `
    <div class="ballot-donut">
      <svg viewBox="0 0 100 100" width="80" height="80">
        <circle cx="50" cy="50" r="${radius}" fill="none" stroke="${trackColor}" stroke-width="8" />
        ${!isVoid && percent > 0 ? `
        <circle cx="50" cy="50" r="${radius}" fill="none" stroke="${strokeColor}" stroke-width="8" 
          stroke-dasharray="${arcLength.toFixed(2)} ${circumference.toFixed(2)}" stroke-dashoffset="0" transform="rotate(-90 50 50)" />
        ` : ""}
        ${centerContent}
      </svg>
    </div>
  `;
}

export function renderJurorGrid(options: {
  caseId: string;
  jurySize: number;
  votesCast: number;
  isVoid?: boolean;
  jurorDetails?: JurorDetail[];
  timerLabel?: string;
  completedTally?: {
    proven: number;
    notProven: number;
    insufficient: number;
  };
}): string {
  const { caseId, jurySize, votesCast, isVoid, jurorDetails, timerLabel, completedTally } = options;

  let headerStats = "";
  if (completedTally) {
    headerStats = `
      <div class="jury-stats-text" style="display:flex; gap:12px; font-size:0.9rem; color:var(--text-secondary);">
        <span style="color:var(--text-primary); font-weight:600;">Proven <span style="color:var(--text-secondary); font-weight:400;">${completedTally.proven}</span></span>
        <span style="color:var(--border-light);">|</span>
        <span style="color:var(--text-primary); font-weight:600;">Not Proven <span style="color:var(--text-secondary); font-weight:400;">${completedTally.notProven}</span></span>
        <span style="color:var(--border-light);">|</span>
        <span style="color:var(--text-primary); font-weight:600;">Insufficient <span style="color:var(--text-secondary); font-weight:400;">${completedTally.insufficient}</span></span>
      </div>
    `;
  } else {
    headerStats = renderDonut(votesCast, jurySize, !!isVoid);
  }

  return `
    <section class="jury-panel" data-live-votes="${escapeHtml(caseId)}" data-jury-size="${jurySize}">
      <div class="jury-status-row">
        ${headerStats}
        ${timerLabel ? `<div class="jury-timer"><strong>Time to Vote Remaining:</strong> <span>${escapeHtml(timerLabel)}</span></div>` : ""}
      </div>
      <div class="juror-grid">
        ${Array.from({ length: jurySize }, (_, index) => {
          let status: "pending" | "cast" = "pending";
          let vote: "yay" | "nay" | undefined;
          let details: JurorDetail | undefined;

          if (jurorDetails && jurorDetails[index]) {
            details = jurorDetails[index];
            status = details.status;
            vote = details.vote;
          } else {
            // Live mode inference
            status = index < votesCast ? "cast" : "pending";
          }

          let iconHtml = "";
          let statusClass = "status-pending";

          if (status === "pending") {
             iconHtml = renderIcon("dash");
             statusClass = "status-pending";
          } else {
             // Cast
             if (vote === "yay") {
               iconHtml = renderIcon("check");
               statusClass = "status-yay";
             } else if (vote === "nay") {
               iconHtml = renderIcon("cross");
               statusClass = "status-nay";
             } else {
               // Unknown vote (live)
               iconHtml = renderIcon("lock"); // Using lock for "secret/cast"
               statusClass = "status-cast"; // Neutral
             }
          }

          const hasExpand = !!details?.rationale;
          const expandableClass = hasExpand ? "is-expandable" : "";
          const ariaAttr = hasExpand ? `role="button" tabindex="0"` : "";
          
          return `
            <div class="juror-card panel-inner ${statusClass} ${expandableClass}" ${ariaAttr} ${hasExpand ? `onclick="this.classList.toggle('is-expanded')"` : ""}>
              <div class="juror-card-header">
                <span class="juror-icon">${iconHtml}</span>
                <span class="juror-label">Juror ${String(index + 1).padStart(2, "0")}</span>
              </div>
              ${hasExpand ? `
              <div class="juror-card-body">
                <p><strong>Rationale:</strong> ${escapeHtml(details!.rationale!)}</p>
                ${details!.principles?.length ? `<p class="juror-principles"><strong>Principles:</strong> ${details!.principles.join(", ")}</p>` : ""}
              </div>
              ` : ""}
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

import { escapeHtml } from "../util/html";

export function renderJurorGrid(options: {
  caseId: string;
  jurySize: number;
  votesCast: number;
}): string {
  const ratio =
    options.jurySize > 0 ? Math.max(0, Math.min(1, options.votesCast / options.jurySize)) : 0;

  return `
    <section class="jury-panel" data-live-votes="${escapeHtml(options.caseId)}" data-jury-size="${options.jurySize}">
      <div class="jury-panel-head">
        <h3>Jury Panel</h3>
        <span data-vote-copy>${options.votesCast} of ${options.jurySize} ballots recorded</span>
      </div>
      <div class="jury-progress" aria-hidden="true">
        <span class="jury-progress-fill" data-vote-fill style="width:${(ratio * 100).toFixed(2)}%"></span>
      </div>
      <div class="juror-grid">
        ${Array.from({ length: options.jurySize }, (_, index) => {
          const cast = index < options.votesCast;
          return `
            <div class="juror-tile ${cast ? "is-cast" : ""}" data-juror-index="${index}">
              <span>Juror ${String(index + 1).padStart(2, "0")}</span>
              <span>${cast ? "Cast" : "Pending"}</span>
            </div>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

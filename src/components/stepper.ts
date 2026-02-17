import type { CasePhase } from "../data/types";
import { escapeHtml } from "../util/html";

const phases: Array<{ key: CasePhase; label: string }> = [
  { key: "opening", label: "Opening" },
  { key: "evidence", label: "Evidence" },
  { key: "closing", label: "Closing" },
  { key: "summing_up", label: "Summing Up" },
  { key: "voting", label: "Voting" },
  { key: "sealed", label: "Sealed" }
];

export function renderStepper(currentPhase: CasePhase): string {
  const currentIndex = phases.findIndex((item) => item.key === currentPhase);

  return `
    <ol class="stepper" aria-label="Case phases">
      ${phases
        .map((phase, index) => {
          const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "todo";
          return `
            <li class="step ${state}">
              <span class="step-index">${index + 1}</span>
              <span class="step-label">${escapeHtml(phase.label)}</span>
            </li>
          `;
        })
        .join("")}
    </ol>
  `;
}

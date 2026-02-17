import type { DashboardOutcomeSlice } from "../data/types";
import { escapeHtml } from "../util/html";

function normaliseSlices(input: DashboardOutcomeSlice[]): DashboardOutcomeSlice[] {
  if (input.length === 0) {
    return [];
  }
  const total = input.reduce((sum, entry) => sum + entry.value, 0);
  if (total === 100 || total === 0) {
    return input;
  }
  return input.map((entry, index) => {
    if (index < input.length - 1) {
      return { ...entry, value: Math.round((entry.value / total) * 100) };
    }
    const previous = input
      .slice(0, input.length - 1)
      .reduce((sum, item) => sum + Math.round((item.value / total) * 100), 0);
    return { ...entry, value: Math.max(0, 100 - previous) };
  });
}

export function renderDonutChartCard(options: {
  title: string;
  subtitle: string;
  slices: DashboardOutcomeSlice[];
  highlightPercent: number;
  highlightLabel: string;
}): string {
  const slices = normaliseSlices(options.slices);
  const radius = 76;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return `
    <article class="glass-card dashboard-donut-card" role="article">
      <header class="dashboard-card-head">
        <div>
          <h3>${escapeHtml(options.title)}</h3>
          <p>${escapeHtml(options.subtitle)}</p>
        </div>
      </header>
      <div class="dashboard-donut-body">
        <div class="dashboard-donut-chart-wrap">
          <svg viewBox="0 0 200 200" role="img" aria-label="${escapeHtml(options.title)}">
            <circle cx="100" cy="100" r="${radius}" class="dashboard-donut-base" />
            ${slices
              .map((slice) => {
                const segment = (slice.value / 100) * circumference;
                const segmentOffset = offset;
                offset += segment;
                return `<circle cx="100" cy="100" r="${radius}" class="dashboard-donut-segment tone-${slice.colorToken}" stroke-dasharray="${segment.toFixed(2)} ${(circumference - segment).toFixed(2)}" stroke-dashoffset="${(-segmentOffset).toFixed(2)}" />`;
              })
              .join("")}
          </svg>
          <span class="dashboard-donut-badge">${Math.max(0, Math.min(100, Math.round(options.highlightPercent)))}% ${escapeHtml(options.highlightLabel)}</span>
        </div>
        <ul class="dashboard-legend">
          ${slices
            .map(
              (slice) => `
                <li>
                  <span class="dashboard-legend-swatch tone-${slice.colorToken}"></span>
                  <span>${escapeHtml(slice.label)}</span>
                  <strong>${slice.value}%</strong>
                </li>
              `
            )
            .join("")}
        </ul>
      </div>
    </article>
  `;
}

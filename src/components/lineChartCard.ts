import type { DashboardTrendPoint } from "../data/types";
import { escapeHtml } from "../util/html";

function buildPath(points: DashboardTrendPoint[], width: number, height: number, pad: number): string {
  if (points.length === 0) {
    return "";
  }
  const max = Math.max(...points.map((point) => point.value), 1);
  const min = 0;
  const plotWidth = width - pad * 2;
  const plotHeight = height - pad * 2;

  return points
    .map((point, index) => {
      const x = pad + (index / Math.max(1, points.length - 1)) * plotWidth;
      const ratio = (point.value - min) / Math.max(1, max - min);
      const y = pad + (1 - ratio) * plotHeight;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function buildArea(path: string, points: DashboardTrendPoint[], width: number, height: number, pad: number): string {
  if (!path || points.length === 0) {
    return "";
  }
  const plotWidth = width - pad * 2;
  const endX = pad + plotWidth;
  const startX = pad;
  const bottom = height - pad;
  return `${path} L${endX.toFixed(2)} ${bottom.toFixed(2)} L${startX.toFixed(2)} ${bottom.toFixed(2)} Z`;
}

function pointPosition(
  point: DashboardTrendPoint,
  index: number,
  points: DashboardTrendPoint[],
  width: number,
  height: number,
  pad: number
): { x: number; y: number } {
  const max = Math.max(...points.map((entry) => entry.value), 1);
  const plotWidth = width - pad * 2;
  const plotHeight = height - pad * 2;
  const x = pad + (index / Math.max(1, points.length - 1)) * plotWidth;
  const y = pad + (1 - point.value / max) * plotHeight;
  return { x, y };
}

export function renderLineChartCard(options: {
  title: string;
  subtitle: string;
  points: DashboardTrendPoint[];
  hoverLabel: string;
  hoverValue: string;
}): string {
  const width = 760;
  const height = 290;
  const pad = 24;
  const path = buildPath(options.points, width, height, pad);
  const area = buildArea(path, options.points, width, height, pad);

  return `
    <article class="glass-card dashboard-chart-card" role="article">
      <header class="dashboard-card-head">
        <div>
          <h3>${escapeHtml(options.title)}</h3>
          <p>${escapeHtml(options.subtitle)}</p>
        </div>
        <div class="dashboard-chart-controls" aria-hidden="true">
          <span></span><span></span><span></span>
        </div>
      </header>
      <div class="dashboard-line-wrap">
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(options.title)} trend">
          <defs>
            <linearGradient id="dashboardLineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stop-color="var(--accent-blue)"></stop>
              <stop offset="100%" stop-color="var(--accent-orange)"></stop>
            </linearGradient>
            <linearGradient id="dashboardAreaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="rgba(92, 161, 255, 0.32)"></stop>
              <stop offset="100%" stop-color="rgba(92, 161, 255, 0)"></stop>
            </linearGradient>
          </defs>
          <g class="dashboard-guides">
            ${Array.from({ length: 10 })
              .map((_, index) => {
                const x = pad + (index / 9) * (width - pad * 2);
                return `<line x1="${x.toFixed(2)}" y1="${pad}" x2="${x.toFixed(2)}" y2="${height - pad}"/>`;
              })
              .join("")}
          </g>
          ${area ? `<path class="dashboard-area" d="${area}"></path>` : ""}
          ${path ? `<path class="dashboard-line" d="${path}"></path>` : ""}
          <g>
            ${options.points
              .map((point, index, all) => {
                const pos = pointPosition(point, index, all, width, height, pad);
                return `<circle class="dashboard-dot" cx="${pos.x.toFixed(2)}" cy="${pos.y.toFixed(2)}" r="3" />`;
              })
              .join("")}
          </g>
        </svg>
        <div class="dashboard-chart-tooltip" role="note">
          <span>${escapeHtml(options.hoverLabel)}</span>
          <strong>${escapeHtml(options.hoverValue)}</strong>
        </div>
      </div>
      <footer class="dashboard-chart-axis" aria-hidden="true">
        ${options.points.map((point) => `<span>${escapeHtml(point.label)}</span>`).join("")}
      </footer>
    </article>
  `;
}

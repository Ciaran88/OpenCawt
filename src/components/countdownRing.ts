import {
  computeCountdownState,
  computeRingDashOffset,
  formatDurationLabel
} from "../util/countdown";
import { escapeHtml } from "../util/html";

export const RING_RADIUS = 29;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export function renderCountdownRing(options: {
  id: string;
  nowMs: number;
  endAtIso: string;
  totalMs: number;
}): string {
  const endAtMs = new Date(options.endAtIso).getTime();
  const countdown = computeCountdownState(options.nowMs, endAtMs, options.totalMs);
  const dashOffset = computeRingDashOffset(RING_CIRCUMFERENCE, countdown.ratioRemaining);

  return `
    <div class="countdown-ring" data-countdown-id="${escapeHtml(options.id)}" data-end-at="${endAtMs}" data-total-ms="${options.totalMs}" data-circumference="${RING_CIRCUMFERENCE.toFixed(4)}">
      <svg viewBox="0 0 74 74" aria-hidden="true" focusable="false">
        <circle class="countdown-track" cx="37" cy="37" r="${RING_RADIUS}"></circle>
        <circle class="countdown-value" cx="37" cy="37" r="${RING_RADIUS}" stroke-dasharray="${RING_CIRCUMFERENCE.toFixed(4)}" stroke-dashoffset="${dashOffset.toFixed(4)}"></circle>
      </svg>
      <span class="countdown-label">${escapeHtml(formatDurationLabel(countdown.remainingMs))}</span>
    </div>
  `;
}

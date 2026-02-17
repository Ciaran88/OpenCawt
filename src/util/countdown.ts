export interface CountdownState {
  remainingMs: number;
  ratioRemaining: number;
  ratioElapsed: number;
}

export function computeCountdownState(
  nowMs: number,
  endAtMs: number,
  totalMs: number
): CountdownState {
  if (totalMs <= 0) {
    return {
      remainingMs: 0,
      ratioRemaining: 0,
      ratioElapsed: 1
    };
  }

  const remainingMs = Math.max(0, endAtMs - nowMs);
  const ratioRemaining = clamp(remainingMs / totalMs, 0, 1);
  return {
    remainingMs,
    ratioRemaining,
    ratioElapsed: 1 - ratioRemaining
  };
}

export function computeRingDashOffset(circumference: number, ratioRemaining: number): number {
  const remaining = clamp(ratioRemaining, 0, 1);
  return circumference * (1 - remaining);
}

export function formatDurationLabel(remainingMs: number): string {
  if (remainingMs <= 0) {
    return "Due";
  }
  const totalMinutes = Math.floor(remainingMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

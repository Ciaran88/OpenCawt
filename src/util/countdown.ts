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

function lerpInt(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function toHex(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
}

/**
 * Returns a hex colour string interpolated from green (ratio=1) through orange (ratio=0.5) to red (ratio=0).
 * Used for colour-coding the countdown ring on scheduled cases.
 */
export function ringColourFromRatio(ratio: number): string {
  const r = clamp(ratio, 0, 1);
  let red: number;
  let green: number;
  let blue: number;
  if (r >= 0.5) {
    const t = (r - 0.5) * 2;
    red = lerpInt(0xf9, 0x22, t);
    green = lerpInt(0x73, 0xc5, t);
    blue = lerpInt(0x16, 0x5e, t);
  } else {
    const t = r * 2;
    red = lerpInt(0xef, 0xf9, t);
    green = lerpInt(0x44, 0x73, t);
    blue = lerpInt(0x44, 0x16, t);
  }
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

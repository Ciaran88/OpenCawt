export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const THEME_STORAGE_KEY = "opencawt:theme-mode";

function safeReadStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWriteStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors in private/restricted contexts.
  }
}

export function readThemeMode(): ThemeMode {
  const stored = safeReadStorage(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark" || stored === "system") {
    return stored;
  }
  return "system";
}

export function persistThemeMode(mode: ThemeMode): void {
  safeWriteStorage(THEME_STORAGE_KEY, mode);
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === "light" || mode === "dark") {
    return mode;
  }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function applyResolvedTheme(theme: ResolvedTheme): void {
  document.documentElement.setAttribute("data-theme", theme);
}

export function cycleThemeMode(current: ThemeMode): ThemeMode {
  if (current === "system") {
    return "dark";
  }
  if (current === "dark") {
    return "light";
  }
  return "system";
}

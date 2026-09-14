export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "shiftflow.theme";
const MODES: readonly ThemeMode[] = ["light", "dark", "system"];

function isThemeMode(value: string | null): value is ThemeMode {
  return !!value && MODES.includes(value as ThemeMode);
}

function storage(): Storage | null {
  try {
    return globalThis.window?.localStorage ?? null;
  } catch {
    return null;
  }
}

export function getThemeMode(): ThemeMode {
  const stored = storage()?.getItem(STORAGE_KEY) ?? null;
  return isThemeMode(stored) ? stored : "system";
}

export function setThemeMode(mode: ThemeMode): void {
  storage()?.setItem(STORAGE_KEY, mode);
  applyThemeMode(mode);
}

export function applyThemeMode(mode = getThemeMode()): void {
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme =
    mode === "system" ? "light dark" : mode;
}

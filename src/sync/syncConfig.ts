// ShiftFlow PWA — Sync Layer
// sync/syncConfig.ts
//
// Single source for the Google Apps Script Web App URL. No secrets live in the
// frontend — the GAS URL is a public deployment endpoint, not a credential.
//
// Resolution order:
//   1. localStorage "shiftflow.gasApiUrl" (user-set at runtime, per install)
//   2. Vite env var VITE_GAS_API_URL (build-time, optional)
//   3. empty string -> sync is DISABLED (app stays fully local-first)

const LS_KEY = "shiftflow.gasApiUrl";

function fromEnv(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env;
  return env?.VITE_GAS_API_URL ?? "";
}

export function getGasApiUrl(): string {
  try {
    const ls = globalThis.localStorage?.getItem(LS_KEY);
    if (ls && ls.trim()) return ls.trim();
  } catch {
    /* localStorage may be unavailable (e.g. tests) — fall through */
  }
  return fromEnv().trim();
}

export function setGasApiUrl(url: string): void {
  try {
    globalThis.localStorage?.setItem(LS_KEY, url.trim());
  } catch {
    /* ignore */
  }
}

export function isSyncConfigured(): boolean {
  return getGasApiUrl().length > 0;
}

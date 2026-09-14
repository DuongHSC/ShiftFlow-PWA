// ShiftFlow PWA — Sync Layer
// sync/gasClient.ts
//
// Thin HTTPS client for the Google Apps Script Web App. The browser talks ONLY
// to this endpoint — never directly to Google Sheets. All calls funnel through
// a single POST endpoint (GAS Web Apps expose one doGet/doPost), with an
// `action` field for routing, to avoid CORS preflight complications.
//
// Injectable `fetchImpl` makes this unit-testable without real network.

import { getGasApiUrl } from "./syncConfig";
import type {
  ApiEnvelope,
  HealthData,
  PullResponseData,
  PushRequest,
  PushResponseData,
} from "./syncTypes";

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: "follow" | "error" | "manual";
    mode?: "cors" | "no-cors" | "same-origin";
  },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export class GasApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "GasApiError";
  }
}

export class GasClient {
  constructor(
    private urlProvider: () => string = getGasApiUrl,
    private fetchImpl?: FetchLike,
  ) {}

  private get fetcher(): FetchLike {
    if (this.fetchImpl) return this.fetchImpl;
    const f = (globalThis as { fetch?: unknown }).fetch;
    if (typeof f !== "function") {
      throw new GasApiError("NO_FETCH", "fetch is not available in this environment");
    }
    return f as unknown as FetchLike;
  }

  private async call<T>(action: string, payload: unknown): Promise<T> {
    const url = this.urlProvider();
    if (!url) throw new GasApiError("NOT_CONFIGURED", "GAS_API_URL is not configured");

    let resText: string;
    try {
      const res = await this.fetcher(url, {
        method: "POST",
        // IMPORTANT (Apps Script): send NO custom Content-Type header. A POST
        // with a plain string body defaults to text/plain and stays a CORS
        // "simple request" (no preflight). Setting an explicit Content-Type can
        // trigger a preflight that breaks the /exec -> script.googleusercontent
        // redirect (seen as a 302 then a 404 on the echo URL). GAS still reads
        // the JSON via e.postData.contents.
        body: JSON.stringify({ action, ...(payload as object) }),
        redirect: "follow",
      });
      resText = await res.text();
      if (!res.ok) {
        throw new GasApiError("HTTP_" + res.status, `HTTP ${res.status}`);
      }
    } catch (err) {
      if (err instanceof GasApiError) throw err;
      throw new GasApiError("NETWORK", err instanceof Error ? err.message : "network error");
    }

    let env: ApiEnvelope<T>;
    try {
      env = JSON.parse(resText) as ApiEnvelope<T>;
    } catch {
      throw new GasApiError("BAD_JSON", "Malformed response from server");
    }
    if (!env.ok) {
      throw new GasApiError(env.error.code, env.error.message);
    }
    return env.data as T;
  }

  health(): Promise<HealthData> {
    return this.call<HealthData>("health", {});
  }

  push(req: PushRequest): Promise<PushResponseData> {
    return this.call<PushResponseData>("push", req);
  }

  pull(deviceId: string, since: string): Promise<PullResponseData> {
    return this.call<PullResponseData>("pull", { deviceId, since });
  }
}

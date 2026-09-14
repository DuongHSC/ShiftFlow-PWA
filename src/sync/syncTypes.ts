// ShiftFlow PWA — Sync Layer
// sync/syncTypes.ts
//
// Types for the cloud synchronization layer (Google Sheets via a Google Apps
// Script Web App). This layer sits BESIDE the existing domain/repository/
// IndexedDB stack — it never replaces IndexedDB, which stays the local-first
// source of truth for the UI.
//
// Design notes:
// - Domain models (WorkDay, ShiftDefinition, ...) are NOT modified. They have
//   no version/deleted columns. Versioning + soft-delete are tracked by the
//   sync queue (locally) and by the cloud (server-side), keyed on the entity's
//   stable UUID `id`. This preserves existing data and migrations.
// - Remote changes applied during Pull are marked so they never re-enqueue as
//   local changes (avoids sync loops).

/** Entity kinds that participate in synchronization. */
export type SyncEntityType =
  | "WorkDay"
  | "ShiftDefinition"
  | "ScheduleRule"
  | "TaskDefinition"
  | "WorkDayTask"
  | "WorkDayEvent"
  | "ReminderConfiguration";

export const SYNC_ENTITY_TYPES: SyncEntityType[] = [
  "WorkDay",
  "ShiftDefinition",
  "ScheduleRule",
  "TaskDefinition",
  "WorkDayTask",
  "WorkDayEvent",
  "ReminderConfiguration",
];

export type SyncOperation = "CREATE" | "UPDATE" | "DELETE";

export type SyncStatus = "PENDING" | "SYNCED" | "CONFLICT" | "FAILED";

/**
 * A pending local mutation queued for push to the cloud. Stored in IndexedDB
 * (store: syncQueue). One record per local mutation.
 */
export interface SyncChange {
  /** Idempotency key — unique per mutation. The server dedupes on this. */
  changeId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  /** Last cloud version this device knew for the entity (0 if never synced). */
  baseVersion: number;
  /** Local monotonic version proposed by this device (baseVersion + 1). */
  version: number;
  modifiedAt: string; // ISO
  deviceId: string;
  /**
   * Full entity snapshot for CREATE/UPDATE (the domain record), or null for
   * DELETE. Stored as-is so the server can persist canonical config.
   */
  payload: Record<string, unknown> | null;
  status: SyncStatus;
  /** Retry bookkeeping to avoid infinite retries. */
  attempts: number;
  lastError?: string | null;
  /** Server data captured when a CONFLICT is detected (for the client to keep). */
  serverRecord?: Record<string, unknown> | null;
  serverVersion?: number | null;
  createdAt: string; // ISO
}

/** Local sync metadata (store: syncMeta) — single-row-per-key key/value. */
export interface SyncMetaRecord {
  key: string;
  value: string;
}

export const SYNC_META_KEYS = {
  deviceId: "deviceId",
  pullCursor: "pullCursor",
  lastSyncedAt: "lastSyncedAt",
} as const;

// ---- Wire protocol (client <-> GAS Web App) ----

export interface ApiEnvelopeOk<T> {
  ok: true;
  data?: T;
}
export interface ApiEnvelopeErr {
  ok: false;
  error: { code: string; message: string };
}
export type ApiEnvelope<T> = ApiEnvelopeOk<T> | ApiEnvelopeErr;

export interface HealthData {
  status: "healthy";
}

/** One change as sent to /sync/push. */
export interface PushChange {
  changeId: string;
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  baseVersion: number;
  payload: Record<string, unknown> | null;
  modifiedAt: string;
}

export interface PushRequest {
  deviceId: string;
  changes: PushChange[];
}

/** Per-change result returned by the server. */
export type PushResultStatus = "APPLIED" | "DUPLICATE" | "CONFLICT" | "INVALID";

export interface PushResult {
  changeId: string;
  entityId: string;
  entityType: SyncEntityType;
  status: PushResultStatus;
  /** New cloud version after apply (APPLIED/DUPLICATE). */
  version?: number;
  /** On CONFLICT: the current server version + record. */
  serverVersion?: number;
  serverRecord?: Record<string, unknown> | null;
  message?: string;
}

export interface PushResponseData {
  results: PushResult[];
}

/** A change row as returned by /sync/pull. */
export interface PullChange {
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  version: number;
  deleted: boolean;
  modifiedAt: string;
  deviceId: string;
  payload: Record<string, unknown> | null;
  /** Monotonic cloud sequence used as the pull cursor. */
  seq: number;
}

export interface PullResponseData {
  changes: PullChange[];
  nextCursor: string;
}

// ShiftFlow PWA — Sync Layer
// sync/syncService.ts
//
// Orchestrates cloud synchronization. Local-first: the UI never waits on this.
//   push()  — send PENDING/FAILED queue records to the cloud (idempotent).
//   pull()  — fetch cloud changes since the cursor and apply them locally
//             WITHOUT re-enqueueing (loop-safe via changeTracker.runAsRemote).
//   sync()  — single-flight push-then-pull.
//
// Conflicts use optimistic concurrency (baseVersion). On CONFLICT we keep the
// local change (marked CONFLICT, server record attached) and keep server data —
// never silent last-write-wins.

import type { ShiftFlowDB } from "@/storage/db/db";
import type { ChangeTracker } from "./changeTracker";
import type { GasClient } from "./gasClient";
import type { SyncMetaStore, SyncQueueStore } from "./syncStore";
import { isSyncConfigured } from "./syncConfig";
import type {
  PullChange,
  PushChange,
  SyncEntityType,
} from "./syncTypes";

export type SyncState = "idle" | "syncing" | "synced" | "offline" | "conflict";

export interface SyncResult {
  pushed: number;
  applied: number;
  conflicts: number;
  failed: number;
  offline: boolean;
}

/** Maps a syncable entity type to its Dexie table (for remote apply). */
function tableFor(db: ShiftFlowDB, type: SyncEntityType) {
  switch (type) {
    case "WorkDay":
      return db.workDays;
    case "ShiftDefinition":
      return db.shiftDefinitions;
    case "ScheduleRule":
      return db.scheduleRules;
    case "TaskDefinition":
      return db.taskDefinitions;
    case "WorkDayTask":
      return db.workDayTasks;
    case "WorkDayEvent":
      return db.workDayEvents;
    case "ReminderConfiguration":
      return db.reminders;
  }
}

const MAX_ATTEMPTS = 5; // avoid infinite retries

export class SyncService {
  private inFlight: Promise<SyncResult> | null = null;
  private _state: SyncState = "idle";
  private listeners = new Set<(s: SyncState) => void>();

  constructor(
    private db: ShiftFlowDB,
    private client: GasClient,
    private queue: SyncQueueStore,
    private meta: SyncMetaStore,
    private tracker: ChangeTracker,
    /** Called after remote changes are applied, so the UI can refresh. */
    private onRemoteApplied?: () => void,
    /**
     * Whether sync is configured. Defaults to the global config (GAS URL set).
     * Injectable so tests can drive the service without localStorage.
     */
    private configured: () => boolean = isSyncConfigured,
  ) {}

  get state(): SyncState {
    return this._state;
  }

  /** Sets/updates the callback invoked after remote changes are applied. */
  setOnRemoteApplied(fn: () => void): void {
    this.onRemoteApplied = fn;
  }

  onStateChange(fn: (s: SyncState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private setState(s: SyncState): void {
    this._state = s;
    for (const fn of this.listeners) fn(s);
  }

  private online(): boolean {
    const nav = (globalThis as { navigator?: { onLine?: boolean } }).navigator;
    // Default to online when the flag is unavailable (e.g. tests / SSR).
    return nav?.onLine !== false;
  }

  /** Single-flight: concurrent callers share the same in-flight run. */
  sync(): Promise<SyncResult> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runSync().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runSync(): Promise<SyncResult> {
    const empty: SyncResult = { pushed: 0, applied: 0, conflicts: 0, failed: 0, offline: false };
    if (!this.configured()) return empty;
    if (!this.online()) {
      this.setState("offline");
      return { ...empty, offline: true };
    }
    this.setState("syncing");
    try {
      const pushRes = await this.push();
      const pullRes = await this.pull();
      const conflicts = pushRes.conflicts + (await this.queue.byStatus("CONFLICT")).length;
      await this.meta.setLastSyncedAt(new Date().toISOString());
      const result: SyncResult = {
        pushed: pushRes.pushed,
        applied: pullRes.applied,
        conflicts: pushRes.conflicts,
        failed: pushRes.failed,
        offline: false,
      };
      this.setState(conflicts > 0 ? "conflict" : "synced");
      return result;
    } catch {
      // Network/other failure — remain usable, surface offline/idle.
      this.setState(this.online() ? "idle" : "offline");
      return { ...empty, offline: !this.online() };
    }
  }

  // ---- PUSH ----

  async push(): Promise<{ pushed: number; conflicts: number; failed: number }> {
    if (!this.configured()) return { pushed: 0, conflicts: 0, failed: 0 };
    const deviceId = await this.meta.getOrCreateDeviceId();
    const pending = (await this.queue.pending()).filter((c) => c.attempts < MAX_ATTEMPTS);
    if (pending.length === 0) return { pushed: 0, conflicts: 0, failed: 0 };

    const changes: PushChange[] = pending.map((c) => ({
      changeId: c.changeId,
      entityType: c.entityType,
      entityId: c.entityId,
      operation: c.operation,
      baseVersion: c.baseVersion,
      payload: c.payload,
      modifiedAt: c.modifiedAt,
    }));

    let pushed = 0;
    let conflicts = 0;
    let failed = 0;

    try {
      const res = await this.client.push({ deviceId, changes });
      for (const r of res.results) {
        if (r.status === "APPLIED" || r.status === "DUPLICATE") {
          await this.queue.markSynced(r.changeId, r.version ?? 0);
          if (r.version != null) await this.meta.setEntityVersion(r.entityId, r.version);
          pushed += 1;
        } else if (r.status === "CONFLICT") {
          await this.queue.markConflict(
            r.changeId,
            r.serverVersion ?? 0,
            r.serverRecord ?? null,
          );
          conflicts += 1;
        } else {
          await this.queue.markFailed(r.changeId, r.message ?? "invalid");
          failed += 1;
        }
      }
      await this.queue.clearSynced();
    } catch (err) {
      // Whole-request failure: mark all attempted as FAILED (bounded retries).
      const msg = err instanceof Error ? err.message : "push failed";
      for (const c of pending) await this.queue.markFailed(c.changeId, msg);
      failed += pending.length;
      throw err;
    }

    return { pushed, conflicts, failed };
  }

  // ---- PULL ----

  async pull(): Promise<{ applied: number }> {
    if (!this.configured()) return { applied: 0 };
    const deviceId = await this.meta.getOrCreateDeviceId();
    let cursor = await this.meta.getPullCursor();
    let applied = 0;
    let guard = 0;

    // Loop in case the server pages results; bounded to avoid runaway loops.
    while (guard < 100) {
      guard += 1;
      const res = await this.client.pull(deviceId, cursor);
      for (const change of res.changes) {
        // Ignore our own echoes to reduce needless writes (server also filters,
        // but this is a cheap safety net).
        if (change.deviceId === deviceId) continue;
        await this.applyRemote(change);
        applied += 1;
      }
      if (res.nextCursor && res.nextCursor !== cursor) {
        cursor = res.nextCursor;
        await this.meta.setPullCursor(cursor);
        if (res.changes.length === 0) break;
      } else {
        break;
      }
    }

    if (applied > 0) this.onRemoteApplied?.();
    return { applied };
  }

  /** Applies one pulled change locally, suppressing re-enqueue (loop-safe). */
  private async applyRemote(change: PullChange): Promise<void> {
    const table = tableFor(this.db, change.entityType);
    await this.tracker.runAsRemote(async () => {
      if (change.deleted || change.operation === "DELETE") {
        await table.delete(change.entityId);
      } else if (change.payload) {
        // Ensure the record carries its id (payload is the domain record).
        const record = { ...change.payload, id: change.entityId } as unknown;
        await table.put(record as never);
      }
    });
    // Record the applied cloud version so a later LOCAL edit of this entity
    // uses the correct baseVersion (and doesn't false-conflict).
    await this.meta.setEntityVersion(change.entityId, change.version);
  }
}

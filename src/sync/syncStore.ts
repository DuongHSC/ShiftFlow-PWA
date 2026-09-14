// ShiftFlow PWA — Sync Layer
// sync/syncStore.ts
//
// Repositories over the sync IndexedDB stores (syncQueue, syncMeta) plus
// device-id / cursor helpers. No network here — pure local persistence.

import type { ShiftFlowDB } from "@/storage/db/db";
import { newId } from "@/services/id";
import {
  SYNC_META_KEYS,
  type SyncChange,
  type SyncStatus,
} from "./syncTypes";

/** Local key/value sync metadata (deviceId, pull cursor, lastSyncedAt). */
export class SyncMetaStore {
  constructor(private db: ShiftFlowDB) {}

  async get(key: string): Promise<string | undefined> {
    return (await this.db.syncMeta.get(key))?.value;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.syncMeta.put({ key, value });
  }

  /**
   * Returns the stable device id, generating and persisting one on first use.
   * Never regenerated on subsequent launches.
   */
  async getOrCreateDeviceId(): Promise<string> {
    const existing = await this.get(SYNC_META_KEYS.deviceId);
    if (existing) return existing;
    const id = newId();
    await this.set(SYNC_META_KEYS.deviceId, id);
    return id;
  }

  async getPullCursor(): Promise<string> {
    return (await this.get(SYNC_META_KEYS.pullCursor)) ?? "0";
  }
  async setPullCursor(cursor: string): Promise<void> {
    await this.set(SYNC_META_KEYS.pullCursor, cursor);
  }

  async setLastSyncedAt(iso: string): Promise<void> {
    await this.set(SYNC_META_KEYS.lastSyncedAt, iso);
  }
  async getLastSyncedAt(): Promise<string | undefined> {
    return this.get(SYNC_META_KEYS.lastSyncedAt);
  }

  // Per-entity last-synced cloud version. Needed so a NEW local edit after a
  // successful sync uses the correct baseVersion (the queue row for the synced
  // change is cleared, so it can't be the source of truth).
  private entityVersionKey(entityId: string): string {
    return "ev:" + entityId;
  }
  async getEntityVersion(entityId: string): Promise<number> {
    const v = await this.get(this.entityVersionKey(entityId));
    return v ? Number(v) || 0 : 0;
  }
  async setEntityVersion(entityId: string, version: number): Promise<void> {
    await this.set(this.entityVersionKey(entityId), String(version));
  }
}

/** The pending-changes queue. */
export class SyncQueueStore {
  constructor(private db: ShiftFlowDB) {}

  put(change: SyncChange): Promise<string> {
    return this.db.syncQueue.put(change);
  }

  get(changeId: string): Promise<SyncChange | undefined> {
    return this.db.syncQueue.get(changeId);
  }

  all(): Promise<SyncChange[]> {
    return this.db.syncQueue.toArray();
  }

  byStatus(status: SyncStatus): Promise<SyncChange[]> {
    return this.db.syncQueue.where("status").equals(status).toArray();
  }

  /** Pending or previously-failed changes, oldest first (retry order). */
  async pending(): Promise<SyncChange[]> {
    const rows = (await this.all()).filter(
      (c) => c.status === "PENDING" || c.status === "FAILED",
    );
    return rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  /** Latest known base version for an entity from any queue record (0 if none). */
  async latestVersionFor(entityId: string): Promise<number> {
    const rows = (await this.all()).filter((c) => c.entityId === entityId);
    let max = 0;
    for (const r of rows) max = Math.max(max, r.version, r.baseVersion);
    return max;
  }

  delete(changeId: string): Promise<void> {
    return this.db.syncQueue.delete(changeId);
  }

  async markSynced(changeId: string, version: number): Promise<void> {
    const c = await this.get(changeId);
    if (!c) return;
    await this.put({ ...c, status: "SYNCED", version, lastError: null });
  }

  async markConflict(
    changeId: string,
    serverVersion: number,
    serverRecord: Record<string, unknown> | null,
  ): Promise<void> {
    const c = await this.get(changeId);
    if (!c) return;
    await this.put({ ...c, status: "CONFLICT", serverVersion, serverRecord });
  }

  async markFailed(changeId: string, error: string): Promise<void> {
    const c = await this.get(changeId);
    if (!c) return;
    await this.put({
      ...c,
      status: "FAILED",
      attempts: c.attempts + 1,
      lastError: error,
    });
  }

  async clearSynced(): Promise<void> {
    const keys = await this.db.syncQueue.where("status").equals("SYNCED").primaryKeys();
    await this.db.syncQueue.bulkDelete(keys);
  }
}

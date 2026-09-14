// ShiftFlow PWA — Sync Layer
// sync/changeTracker.ts
//
// The single choke point domain services call after a local mutation. It turns
// a mutation into a PENDING queue record (idempotency key = changeId), computes
// baseVersion/version, and (optionally) triggers a background sync.
//
// LOOP PREVENTION: when the SyncService applies a change pulled FROM the cloud,
// it wraps the local write in `runAsRemote(...)`. While that flag is set, the
// tracker does NOT enqueue — so remote changes never bounce back to the cloud.

import { newId } from "@/services/id";
import type { SyncMetaStore, SyncQueueStore } from "./syncStore";
import type { SyncEntityType, SyncOperation } from "./syncTypes";

export interface RecordChangeInput {
  entityType: SyncEntityType;
  entityId: string;
  operation: SyncOperation;
  /** Domain record snapshot (CREATE/UPDATE) or null (DELETE). */
  payload: Record<string, unknown> | null;
}

export class ChangeTracker {
  private remoteDepth = 0;
  /** Optional hook invoked after enqueue so a scheduler can trigger sync. */
  onEnqueued?: () => void;

  constructor(
    private queue: SyncQueueStore,
    private meta: SyncMetaStore,
  ) {}

  /** True while applying a remote (pulled) change — suppresses enqueueing. */
  get applyingRemote(): boolean {
    return this.remoteDepth > 0;
  }

  /**
   * Runs `fn` (a local write of a pulled change) with enqueueing suppressed.
   * Reentrant-safe.
   */
  async runAsRemote<T>(fn: () => Promise<T>): Promise<T> {
    this.remoteDepth += 1;
    try {
      return await fn();
    } finally {
      this.remoteDepth -= 1;
    }
  }

  /** Enqueues a local mutation (no-op while applying a remote change). */
  async record(input: RecordChangeInput): Promise<void> {
    if (this.applyingRemote) return;

    const deviceId = await this.meta.getOrCreateDeviceId();
    // baseVersion = the highest version this device knows for the entity:
    // the last SYNCED cloud version (persisted in meta) OR any still-pending
    // queued version, whichever is higher.
    const syncedVersion = await this.meta.getEntityVersion(input.entityId);
    const queuedVersion = await this.queue.latestVersionFor(input.entityId);
    const baseVersion = Math.max(syncedVersion, queuedVersion);
    const now = new Date().toISOString();

    await this.queue.put({
      changeId: newId(),
      entityType: input.entityType,
      entityId: input.entityId,
      operation: input.operation,
      baseVersion,
      version: baseVersion + 1,
      modifiedAt: now,
      deviceId,
      payload: input.payload,
      status: "PENDING",
      attempts: 0,
      lastError: null,
      createdAt: now,
    });

    this.onEnqueued?.();
  }
}

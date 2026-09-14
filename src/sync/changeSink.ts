// ShiftFlow PWA — Sync Layer
// sync/changeSink.ts
//
// Minimal structural interface that domain services depend on to report a local
// mutation, without importing the full ChangeTracker/sync stack. ChangeTracker
// satisfies this shape. Services accept it OPTIONALLY, so existing tests that
// construct services without sync keep working unchanged (no-op).

import type { SyncEntityType, SyncOperation } from "./syncTypes";

export interface EntityChangeSink {
  record(input: {
    entityType: SyncEntityType;
    entityId: string;
    operation: SyncOperation;
    payload: Record<string, unknown> | null;
  }): Promise<void>;
}

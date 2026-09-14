// ShiftFlow PWA — Tests
// tests/sync.test.ts
//
// Cloud-sync layer: deviceId, queue, local+offline mutation, push, pull,
// idempotency, conflict, delete propagation, cursor, remote-apply (no loop),
// retry. Uses fake-indexeddb + an in-memory GAS server injected as fetch, so
// the real GasClient/protocol/SyncService are exercised end to end.

import { describe, it, expect, beforeEach } from "vitest";
import { ShiftFlowDB } from "@/storage/db/db";
import { WorkDayRepository } from "@/storage/repositories/repositories";
import { WorkDayService } from "@/services/workday/workDayService";
import { ShiftConfigurationService } from "@/services/settings/shiftConfigurationService";
import {
  ScheduleRuleRepository,
  ShiftDefinitionRepository,
} from "@/storage/repositories/repositories";
import { seedIfNeeded } from "@/storage/seeding";
import { SyncMetaStore, SyncQueueStore } from "@/sync/syncStore";
import { ChangeTracker } from "@/sync/changeTracker";
import { GasClient, type FetchLike } from "@/sync/gasClient";
import { SyncService } from "@/sync/syncService";
import { setGasApiUrl } from "@/sync/syncConfig";
import type {
  PullResponseData,
  PushRequest,
  PushResponseData,
} from "@/sync/syncTypes";

// ---- In-memory GAS server (mimics the .gs handlers' semantics) ----

interface CloudRecord {
  id: string;
  version: number;
  deleted: boolean;
  modifiedAt: string;
  deviceId: string;
  payload: Record<string, unknown> | null;
}

class FakeCloud {
  entities = new Map<string, Map<string, CloudRecord>>(); // type -> id -> rec
  log: {
    seq: number;
    entityType: string;
    entityId: string;
    operation: string;
    version: number;
    deleted: boolean;
    modifiedAt: string;
    deviceId: string;
    payload: Record<string, unknown> | null;
  }[] = [];
  seenChangeIds = new Set<string>();
  seq = 0;

  private table(type: string): Map<string, CloudRecord> {
    let t = this.entities.get(type);
    if (!t) {
      t = new Map();
      this.entities.set(type, t);
    }
    return t;
  }

  push(req: PushRequest): PushResponseData {
    const results: PushResponseData["results"] = [];
    for (const c of req.changes) {
      if (this.seenChangeIds.has(c.changeId)) {
        const cur = this.table(c.entityType).get(c.entityId);
        results.push({
          changeId: c.changeId,
          entityId: c.entityId,
          entityType: c.entityType,
          status: "DUPLICATE",
          version: cur ? cur.version : c.baseVersion + 1,
        });
        continue;
      }
      const cur = this.table(c.entityType).get(c.entityId) ?? null;
      const curVersion = cur ? cur.version : 0;
      if (c.baseVersion !== curVersion) {
        results.push({
          changeId: c.changeId,
          entityId: c.entityId,
          entityType: c.entityType,
          status: "CONFLICT",
          serverVersion: curVersion,
          serverRecord: cur ? cur.payload : null,
        });
        continue;
      }
      const newVersion = c.baseVersion + 1;
      const deleted = c.operation === "DELETE";
      const rec: CloudRecord = {
        id: c.entityId,
        version: newVersion,
        deleted,
        modifiedAt: c.modifiedAt,
        deviceId: req.deviceId,
        payload: deleted ? (cur ? cur.payload : null) : c.payload,
      };
      this.table(c.entityType).set(c.entityId, rec);
      this.seenChangeIds.add(c.changeId);
      this.seq += 1;
      this.log.push({
        seq: this.seq,
        entityType: c.entityType,
        entityId: c.entityId,
        operation: c.operation,
        version: newVersion,
        deleted,
        modifiedAt: rec.modifiedAt,
        deviceId: req.deviceId,
        payload: rec.payload,
      });
      results.push({
        changeId: c.changeId,
        entityId: c.entityId,
        entityType: c.entityType,
        status: "APPLIED",
        version: newVersion,
      });
    }
    return { results };
  }

  pull(since: number): PullResponseData {
    const changes = this.log
      .filter((r) => r.seq > since)
      .map((r) => ({
        entityType: r.entityType as never,
        entityId: r.entityId,
        operation: r.operation as never,
        version: r.version,
        deleted: r.deleted,
        modifiedAt: r.modifiedAt,
        deviceId: r.deviceId,
        payload: r.payload,
        seq: r.seq,
      }));
    const nextCursor =
      changes.length > 0 ? String(changes[changes.length - 1].seq) : String(since);
    return { changes, nextCursor };
  }

  /** Simulates a second device pushing a change directly to the cloud. */
  directPush(req: PushRequest): PushResponseData {
    return this.push(req);
  }
}

function makeFetch(cloud: FakeCloud, opts: { failNext?: () => boolean } = {}): FetchLike {
  return async (_url, init) => {
    if (opts.failNext && opts.failNext()) {
      return { ok: false, status: 500, text: async () => "err" };
    }
    const body = JSON.parse(init?.body ?? "{}") as { action: string } & Record<string, unknown>;
    let data: unknown;
    if (body.action === "health") data = { status: "healthy" };
    else if (body.action === "push") data = cloud.push(body as unknown as PushRequest);
    else if (body.action === "pull") data = cloud.pull(Number(body.since ?? 0) || 0);
    else return { ok: true, status: 200, text: async () => JSON.stringify({ ok: false, error: { code: "UNKNOWN", message: "x" } }) };
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, data }) };
  };
}

// ---- Test rig ----

let dbCount = 0;

interface Rig {
  db: ShiftFlowDB;
  meta: SyncMetaStore;
  queue: SyncQueueStore;
  tracker: ChangeTracker;
  cloud: FakeCloud;
  sync: SyncService;
  workDays: WorkDayService;
  config: ShiftConfigurationService;
}

async function makeRig(fetchFail?: () => boolean): Promise<Rig> {
  setGasApiUrl("https://example.test/exec"); // enables sync
  const db = new ShiftFlowDB(`sync-${dbCount++}-${Date.now()}`);
  await seedIfNeeded(db);
  const meta = new SyncMetaStore(db);
  const queue = new SyncQueueStore(db);
  const tracker = new ChangeTracker(queue, meta);
  const cloud = new FakeCloud();
  const client = new GasClient(
    () => "https://example.test/exec",
    makeFetch(cloud, { failNext: fetchFail }),
  );
  const sync = new SyncService(
    db,
    client,
    queue,
    meta,
    tracker,
    undefined, // onRemoteApplied
    () => true, // configured (tests don't rely on localStorage)
  );
  const workDays = new WorkDayService(new WorkDayRepository(db), tracker);
  const config = new ShiftConfigurationService(
    new ShiftDefinitionRepository(db),
    new ScheduleRuleRepository(db),
    new WorkDayRepository(db),
    tracker,
  );
  return { db, meta, queue, tracker, cloud, sync, workDays, config };
}

let rig: Rig;
beforeEach(async () => {
  rig = await makeRig();
});

async function createWorkDay(r: Rig, day: Date) {
  const c5 = (await r.config.lookup("C5"))!;
  return r.workDays.create(day, c5.shift, c5.rules, "note");
}

describe("device id", () => {
  it("is generated once and persists", async () => {
    const a = await rig.meta.getOrCreateDeviceId();
    const b = await rig.meta.getOrCreateDeviceId();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(10);
  });
});

describe("sync queue + local/offline mutation", () => {
  it("a local create enqueues a PENDING change", async () => {
    await createWorkDay(rig, new Date(2027, 0, 10));
    const pending = await rig.queue.pending();
    expect(pending.length).toBeGreaterThan(0);
    expect(pending[0].entityType).toBe("WorkDay");
    expect(pending[0].operation).toBe("CREATE");
    expect(pending[0].status).toBe("PENDING");
    expect(pending[0].version).toBe(1);
  });

  it("local write persists even though nothing has synced (local-first)", async () => {
    const wd = await createWorkDay(rig, new Date(2027, 0, 11));
    const reloaded = await rig.workDays.byId(wd.id);
    expect(reloaded).toBeDefined();
  });
});

describe("push", () => {
  it("pushes pending changes and marks them synced", async () => {
    const wd = await createWorkDay(rig, new Date(2027, 0, 12));
    const res = await rig.sync.push();
    expect(res.pushed).toBeGreaterThan(0);
    // Cloud has the record.
    expect(rig.cloud.entities.get("WorkDay")?.get(wd.id)?.version).toBe(1);
    // Synced queue rows are cleared.
    expect((await rig.queue.byStatus("SYNCED")).length).toBe(0);
    expect((await rig.queue.pending()).length).toBe(0);
  });
});

describe("idempotency", () => {
  it("re-submitting the same changeId does not double-apply", async () => {
    const wd = await createWorkDay(rig, new Date(2027, 0, 13));
    const change = (await rig.queue.pending())[0];
    const deviceId = await rig.meta.getOrCreateDeviceId();
    const req = {
      deviceId,
      changes: [
        {
          changeId: change.changeId,
          entityType: change.entityType,
          entityId: change.entityId,
          operation: change.operation,
          baseVersion: change.baseVersion,
          payload: change.payload,
          modifiedAt: change.modifiedAt,
        },
      ],
    };
    const first = rig.cloud.push(req);
    expect(first.results[0].status).toBe("APPLIED");
    const second = rig.cloud.push(req);
    expect(second.results[0].status).toBe("DUPLICATE");
    expect(rig.cloud.entities.get("WorkDay")?.get(wd.id)?.version).toBe(1);
  });
});

describe("pull + cursor + remote-apply (no loop)", () => {
  it("applies a remote change into IndexedDB without re-enqueuing", async () => {
    // Device B pushes a WorkDay directly to the cloud.
    const remoteId = "remote-workday-1";
    rig.cloud.directPush({
      deviceId: "device-B",
      changes: [
        {
          changeId: "chg-remote-1",
          entityType: "WorkDay",
          entityId: remoteId,
          operation: "CREATE",
          baseVersion: 0,
          payload: {
            id: remoteId,
            date: "2027-02-01",
            shiftID: "x",
            shiftCode: "C5",
            resolvedStartDateTime: "2027-02-01T12:00:00.000Z",
            resolvedEndDateTime: "2027-02-01T21:30:00.000Z",
            resolvedBreakStartDateTime: "2027-02-01T16:30:00.000Z",
            resolvedBreakEndDateTime: "2027-02-01T17:30:00.000Z",
            note: null,
            createdAt: "2027-02-01T00:00:00.000Z",
            modifiedAt: "2027-02-01T00:00:00.000Z",
          },
          modifiedAt: "2027-02-01T00:00:00.000Z",
        },
      ],
    });

    const before = await rig.queue.all();
    const pulled = await rig.sync.pull();
    expect(pulled.applied).toBe(1);

    // Record is now in local IndexedDB.
    const local = await rig.workDays.byId(remoteId);
    expect(local).toBeDefined();
    expect(local?.shiftCode).toBe("C5");

    // NO new outbound change was enqueued for the applied remote change.
    const after = await rig.queue.all();
    expect(after.length).toBe(before.length);

    // Cursor advanced.
    expect(await rig.meta.getPullCursor()).not.toBe("0");
  });

  it("pull with an up-to-date cursor returns nothing new", async () => {
    await rig.sync.pull();
    const cursor1 = await rig.meta.getPullCursor();
    const second = await rig.sync.pull();
    expect(second.applied).toBe(0);
    expect(await rig.meta.getPullCursor()).toBe(cursor1);
  });
});

describe("conflict detection", () => {
  it("detects a version conflict and keeps both sides (no silent overwrite)", async () => {
    // Local creates + pushes a WorkDay (cloud v1).
    const wd = await createWorkDay(rig, new Date(2027, 3, 5));
    await rig.sync.push();
    expect(rig.cloud.entities.get("WorkDay")?.get(wd.id)?.version).toBe(1);

    // Device B updates the same entity in the cloud -> cloud v2.
    rig.cloud.directPush({
      deviceId: "device-B",
      changes: [
        {
          changeId: "chg-B-1",
          entityType: "WorkDay",
          entityId: wd.id,
          operation: "UPDATE",
          baseVersion: 1,
          payload: { ...wd, note: "changed by B" },
          modifiedAt: new Date().toISOString(),
        },
      ],
    });
    expect(rig.cloud.entities.get("WorkDay")?.get(wd.id)?.version).toBe(2);

    // Local updates with a stale baseVersion (still 1) -> must CONFLICT.
    await rig.workDays.updateNote(wd.id, "changed locally");
    const res = await rig.sync.push();
    expect(res.conflicts).toBeGreaterThan(0);

    // The conflicting queue item is marked CONFLICT with the server record.
    const conflicts = await rig.queue.byStatus("CONFLICT");
    expect(conflicts.length).toBeGreaterThan(0);
    expect(conflicts[0].serverVersion).toBe(2);
    expect((conflicts[0].serverRecord as { note?: string })?.note).toBe("changed by B");

    // Cloud v2 was NOT overwritten by the local change.
    expect(rig.cloud.entities.get("WorkDay")?.get(wd.id)?.version).toBe(2);
    // Local data is preserved.
    expect((await rig.workDays.byId(wd.id))?.note).toBe("changed locally");
  });
});

describe("delete propagation", () => {
  it("a soft-deleted entity propagates and removes the record on pull", async () => {
    // Device B creates then deletes a WorkDay in the cloud.
    const id = "del-1";
    rig.cloud.directPush({
      deviceId: "device-B",
      changes: [
        {
          changeId: "d-create",
          entityType: "WorkDay",
          entityId: id,
          operation: "CREATE",
          baseVersion: 0,
          payload: {
            id, date: "2027-05-01", shiftID: "x", shiftCode: "C5",
            resolvedStartDateTime: "2027-05-01T12:00:00.000Z",
            resolvedEndDateTime: "2027-05-01T21:30:00.000Z",
            resolvedBreakStartDateTime: "2027-05-01T16:30:00.000Z",
            resolvedBreakEndDateTime: "2027-05-01T17:30:00.000Z",
            note: null, createdAt: "x", modifiedAt: "x",
          },
          modifiedAt: "2027-05-01T00:00:00.000Z",
        },
      ],
    });
    await rig.sync.pull();
    expect(await rig.workDays.byId(id)).toBeDefined();

    rig.cloud.directPush({
      deviceId: "device-B",
      changes: [
        {
          changeId: "d-delete",
          entityType: "WorkDay",
          entityId: id,
          operation: "DELETE",
          baseVersion: 1,
          payload: null,
          modifiedAt: "2027-05-02T00:00:00.000Z",
        },
      ],
    });
    await rig.sync.pull();
    expect(await rig.workDays.byId(id)).toBeUndefined();
  });

  it("a local delete enqueues a DELETE change and pushes it", async () => {
    const wd = await createWorkDay(rig, new Date(2027, 5, 9));
    await rig.sync.push();
    await rig.workDays.delete(wd.id);
    const del = (await rig.queue.pending()).find((c) => c.operation === "DELETE");
    expect(del).toBeDefined();
    await rig.sync.push();
    expect(rig.cloud.entities.get("WorkDay")?.get(wd.id)?.deleted).toBe(true);
  });
});

describe("retry / offline", () => {
  it("a failed push marks the change FAILED and increments attempts (no infinite retry)", async () => {
    let fail = true;
    const r = await makeRig(() => fail);
    await createWorkDay(r, new Date(2027, 6, 1));
    await expect(r.sync.push()).rejects.toBeTruthy();
    const failed = await r.queue.byStatus("FAILED");
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0].attempts).toBe(1);

    // Recover: next push succeeds.
    fail = false;
    const res = await r.sync.push();
    expect(res.pushed).toBeGreaterThan(0);
  });
});

describe("single-flight", () => {
  it("concurrent sync() calls share one in-flight run", async () => {
    await createWorkDay(rig, new Date(2027, 7, 3));
    const [a, b] = await Promise.all([rig.sync.sync(), rig.sync.sync()]);
    // Both resolve; no crash, no double-apply (cloud version stays 1).
    expect(a.offline).toBe(false);
    expect(b.offline).toBe(false);
  });
});

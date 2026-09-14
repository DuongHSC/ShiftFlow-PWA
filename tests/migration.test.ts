// ShiftFlow PWA — Tests
// tests/migration.test.ts
//
// Verifies the v1 -> v2 Dexie upgrade: existing WorkDayTask records (created
// before the isVisible field existed) survive and are backfilled with
// isVisible = true. No data is lost; the DB is not recreated.

import { describe, it, expect } from "vitest";
import Dexie from "dexie";
import { ShiftFlowDB } from "@/storage/db/db";

describe("v1 -> v2 migration", () => {
  it("preserves old WorkDayTask rows and defaults isVisible = true", async () => {
    const name = `test-migrate-${Date.now()}`;

    // 1) Open a v1-only database (no isVisible field) and write a legacy join.
    const v1 = new Dexie(name);
    v1.version(1).stores({
      workDays: "id, &date, shiftID, modifiedAt",
      shiftDefinitions: "id, code, isActive",
      scheduleRules: "id, shiftID, priority, isActive",
      taskDefinitions: "id, code, isActive",
      workDayTasks: "id, workDayID, taskDefinitionID",
      reminders: "id, workDayID",
    });
    await v1.open();
    await v1.table("workDayTasks").put({
      id: "legacy-join",
      workDayID: "wd-1",
      taskDefinitionID: "task-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      modifiedAt: "2026-01-01T00:00:00.000Z",
    });
    v1.close();

    // 2) Open the real (v2) database on the SAME name — triggers the upgrade.
    const v2 = new ShiftFlowDB(name);
    await v2.open();

    const row = await v2.workDayTasks.get("legacy-join");
    expect(row).toBeDefined();
    // Old row survived and was backfilled.
    expect(row!.id).toBe("legacy-join");
    expect(row!.isVisible).toBe(true);

    v2.close();
  });
});

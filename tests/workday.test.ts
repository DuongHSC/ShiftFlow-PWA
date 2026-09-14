// ShiftFlow PWA — Tests
// tests/workday.test.ts
//
// Historical snapshot immutability + MW/task/note independence + OFF behavior,
// exercised through the real services over an isolated fake-indexeddb database.

import { describe, it, expect, beforeEach } from "vitest";
import { ShiftFlowDB } from "@/storage/db/db";
import {
  ScheduleRuleRepository,
  ShiftDefinitionRepository,
  TaskDefinitionRepository,
  WorkDayRepository,
  WorkDayTaskRepository,
} from "@/storage/repositories/repositories";
import { seedIfNeeded } from "@/storage/seeding";
import { WorkDayService } from "@/services/workday/workDayService";
import { TaskService } from "@/services/tasks/taskService";
import { ShiftConfigurationService } from "@/services/settings/shiftConfigurationService";
import { formatTime } from "@/domain/resolver/datetime";
import { SEED_IDS } from "@/domain/seed/seed";

let dbCounter = 0;

interface Ctx {
  db: ShiftFlowDB;
  workDays: WorkDayService;
  tasks: TaskService;
  config: ShiftConfigurationService;
}

async function makeCtx(): Promise<Ctx> {
  const db = new ShiftFlowDB(`test-${dbCounter++}-${Date.now()}`);
  await seedIfNeeded(db);
  const workDays = new WorkDayService(new WorkDayRepository(db));
  const tasks = new TaskService(
    new TaskDefinitionRepository(db),
    new WorkDayTaskRepository(db),
  );
  const config = new ShiftConfigurationService(
    new ShiftDefinitionRepository(db),
    new ScheduleRuleRepository(db),
  );
  return { db, workDays, tasks, config };
}

let ctx: Ctx;
beforeEach(async () => {
  ctx = await makeCtx();
});

describe("historical snapshot", () => {
  it("C5 on day 15 snapshots 12:00-21:30", async () => {
    const lookup = await ctx.config.lookup("C5");
    expect(lookup).not.toBeNull();
    const wd = await ctx.workDays.create(
      new Date(2026, 7, 15),
      lookup!.shift,
      lookup!.rules,
    );
    expect(formatTime(new Date(wd.resolvedStartDateTime))).toBe("12:00");
    expect(formatTime(new Date(wd.resolvedEndDateTime))).toBe("21:30");
  });

  it("changing global C5 config does NOT rewrite an existing WorkDay", async () => {
    const lookup = await ctx.config.lookup("C5");
    const wd = await ctx.workDays.create(
      new Date(2026, 7, 15),
      lookup!.shift,
      lookup!.rules,
    );

    // Change global C5 default start to 13:00 (config edit only).
    await ctx.config.updateShift({ ...lookup!.shift, startHour: 13, startMinute: 0 });

    const reloaded = await ctx.workDays.byId(wd.id);
    // Snapshot unchanged (still 12:00 special from the rule at creation).
    expect(formatTime(new Date(reloaded!.resolvedStartDateTime))).toBe("12:00");
    expect(formatTime(new Date(reloaded!.resolvedEndDateTime))).toBe("21:30");
  });

  it("explicit shift change updates the snapshot", async () => {
    const c5 = await ctx.config.lookup("C5");
    const wd = await ctx.workDays.create(new Date(2026, 7, 5), c5!.shift, c5!.rules);
    expect(formatTime(new Date(wd.resolvedStartDateTime))).toBe("11:30");

    const c1 = await ctx.config.lookup("C1");
    const changed = await ctx.workDays.changeShift(wd.id, c1!.shift, c1!.rules);
    expect(changed.shiftCode).toBe("C1");
    expect(formatTime(new Date(changed.resolvedStartDateTime))).toBe("07:00");
  });
});

describe("independence invariants", () => {
  it("adding/removing MW does not change shift times", async () => {
    const c3 = await ctx.config.lookup("C3");
    const wd = await ctx.workDays.create(new Date(2026, 7, 3), c3!.shift, c3!.rules);
    const before = { ...wd };

    await ctx.tasks.addTask(SEED_IDS.mw, wd.id);
    await ctx.tasks.removeTask(SEED_IDS.mw, wd.id);

    const after = await ctx.workDays.byId(wd.id);
    expect(after!.resolvedStartDateTime).toBe(before.resolvedStartDateTime);
    expect(after!.resolvedEndDateTime).toBe(before.resolvedEndDateTime);
    expect(after!.shiftCode).toBe(before.shiftCode);
  });

  it("editing a note does not change shift times", async () => {
    const c2 = await ctx.config.lookup("C2");
    const wd = await ctx.workDays.create(new Date(2026, 7, 2), c2!.shift, c2!.rules);
    const start = wd.resolvedStartDateTime;
    const end = wd.resolvedEndDateTime;

    const noted = await ctx.workDays.updateNote(wd.id, "Họp team lúc 14:00");
    expect(noted.note).toBe("Họp team lúc 14:00");
    expect(noted.resolvedStartDateTime).toBe(start);
    expect(noted.resolvedEndDateTime).toBe(end);
  });

  it("MW assignment is idempotent (no duplicate join)", async () => {
    const c1 = await ctx.config.lookup("C1");
    const wd = await ctx.workDays.create(new Date(2026, 7, 1), c1!.shift, c1!.rules);
    await ctx.tasks.addTask(SEED_IDS.mw, wd.id);
    await ctx.tasks.addTask(SEED_IDS.mw, wd.id);
    const assigned = await ctx.tasks.tasksForWorkDay(wd.id);
    expect(assigned.length).toBe(1);
  });
});

describe("OFF behavior + one-per-date", () => {
  it("OFF means no WorkDay record exists for the date", async () => {
    const wd = await ctx.workDays.byDate(new Date(2026, 7, 25));
    expect(wd).toBeUndefined();
  });

  it("cannot create two WorkDays for the same date", async () => {
    const c1 = await ctx.config.lookup("C1");
    await ctx.workDays.create(new Date(2026, 7, 7), c1!.shift, c1!.rules);
    await expect(
      ctx.workDays.create(new Date(2026, 7, 7), c1!.shift, c1!.rules),
    ).rejects.toThrow();
  });
});

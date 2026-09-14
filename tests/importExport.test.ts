// ShiftFlow PWA — Tests
// tests/importExport.test.ts
//
// JSON backup round-trip, CSV compatibility (parse/validate/export), and
// IndexedDB persistence across a fresh DB instance.

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
import { CsvService } from "@/import-export/csv/csvService";
import {
  applyBackup,
  buildBackup,
  clearAllData,
  exportBackupJson,
  parseBackup,
} from "@/import-export/json/jsonBackup";
import { parseCsv, shiftAliasKey, validateCsv } from "@/import-export/csv/csv";
import { SEED_IDS } from "@/domain/seed/seed";

let dbCounter = 0;

function build(db: ShiftFlowDB) {
  const workDays = new WorkDayService(new WorkDayRepository(db));
  const tasks = new TaskService(
    new TaskDefinitionRepository(db),
    new WorkDayTaskRepository(db),
  );
  const config = new ShiftConfigurationService(
    new ShiftDefinitionRepository(db),
    new ScheduleRuleRepository(db),
  );
  const csvService = new CsvService(workDays, tasks, config);
  return { workDays, tasks, config, csvService };
}

let name: string;
beforeEach(() => {
  name = `test-ie-${dbCounter++}-${Date.now()}`;
});

describe("JSON backup round-trip", () => {
  it("clearAllData removes every persistent store", async () => {
    const db = new ShiftFlowDB(name);
    await seedIfNeeded(db);
    const s = build(db);
    const c1 = await s.config.lookup("C1");
    await s.workDays.create(new Date(2026, 7, 29), c1!.shift, c1!.rules, "note");
    await s.tasks.addTask(SEED_IDS.mw, (await s.workDays.byDate(new Date(2026, 7, 29)))!.id);

    await clearAllData(db);

    expect(await db.workDays.count()).toBe(0);
    expect(await db.shiftDefinitions.count()).toBe(0);
    expect(await db.scheduleRules.count()).toBe(0);
    expect(await db.taskDefinitions.count()).toBe(0);
    expect(await db.workDayTasks.count()).toBe(0);
    expect(await db.workDayEvents.count()).toBe(0);
    expect(await db.reminders.count()).toBe(0);
  });

  it("export then import into a fresh DB reproduces WorkDays", async () => {
    const db1 = new ShiftFlowDB(name);
    await seedIfNeeded(db1);
    const s1 = build(db1);

    const c5 = await s1.config.lookup("C5");
    const wd = await s1.workDays.create(new Date(2026, 7, 15), c5!.shift, c5!.rules, "test note");
    await s1.tasks.addTask(SEED_IDS.mw, wd.id);

    const json = await exportBackupJson(db1);
    const backup = parseBackup(json);
    expect(backup.data.workDays.length).toBe(1);
    expect(backup.data.workDayTasks.length).toBe(1);

    // Fresh DB, replace import.
    const db2 = new ShiftFlowDB(`${name}-2`);
    const summary = await applyBackup(db2, backup, "replace");
    expect(summary.workDays).toBe(1);

    const s2 = build(db2);
    const restored = await s2.workDays.byDate(new Date(2026, 7, 15));
    expect(restored).toBeDefined();
    expect(restored!.shiftCode).toBe("C5");
    expect(restored!.note).toBe("test note");
    expect(restored!.resolvedStartDateTime).toBe(wd.resolvedStartDateTime);
    // Task assignment restored.
    expect(await s2.tasks.hasTask(restored!.id)).toBe(true);
  });

  it("backup includes all seven stores", async () => {
    const db = new ShiftFlowDB(name);
    await seedIfNeeded(db);
    const backup = await buildBackup(db);
    expect(Object.keys(backup.data).sort()).toEqual(
      [
        "reminders",
        "scheduleRules",
        "shiftDefinitions",
        "taskDefinitions",
        "workDayEvents",
        "workDayTasks",
        "workDays",
      ].sort(),
    );
    expect(backup.data.shiftDefinitions.length).toBe(5);
    expect(backup.data.scheduleRules.length).toBe(1);
    expect(backup.data.taskDefinitions.length).toBe(1);
  });

  it("rejects a non-ShiftFlow JSON file", () => {
    expect(() => parseBackup('{"hello":"world"}')).toThrow();
  });
});

describe("CSV compatibility", () => {
  it("parses Date/Shift/Task/Note header and rows", () => {
    const content = "Date,Shift,Task,Note\n15/08/2026,C5,MW,Trực MW\n";
    const rows = parseCsv(content);
    expect(rows.length).toBe(1);
    expect(rows[0].dateString).toBe("15/08/2026");
    expect(rows[0].shiftString).toBe("C5");
    expect(rows[0].taskString).toBe("MW");
  });

  it("validates shift codes and flags invalid ones", () => {
    const rows = parseCsv("Date,Shift\n01/08/2026,C1\n02/08/2026,C9\n");
    const validated = validateCsv(rows, { existingWorkDayDates: new Set() });
    expect(validated[0].status.kind).toBe("valid");
    expect(validated[1].status.kind).toBe("error");
  });

  it("flags duplicate dates within the file", () => {
    const rows = parseCsv("Date,Shift\n01/08/2026,C1\n01/08/2026,C2\n");
    const validated = validateCsv(rows, { existingWorkDayDates: new Set() });
    expect(validated.every((r) => r.status.kind === "duplicateInFile")).toBe(true);
  });

  it("OFF is valid but importable=false", () => {
    const rows = parseCsv("Date,Shift\n01/08/2026,OFF\n");
    const validated = validateCsv(rows, { existingWorkDayDates: new Set() });
    expect(validated[0].status.kind).toBe("valid");
    expect(validated[0].shiftCode).toBe("OFF");
  });

  it("accepts renamed shift names and blank shift cells as OFF", () => {
    const rows = parseCsv(
      "Date,Shift,Task\n01/09/2026,Ca 5,\n02/09/2026,Ca5,MW\n03/09/2026,,\n",
    );
    const validated = validateCsv(rows, {
      existingWorkDayDates: new Set(),
      knownShiftAliases: new Map([[shiftAliasKey("Ca 5"), "C5"]]),
    });
    expect(validated.map((row) => row.shiftCode)).toEqual(["C5", "C5", "OFF"]);
    expect(validated.every((row) => row.status.kind === "valid")).toBe(true);
  });

  it("export then re-import produces the same WorkDay set (round-trip)", async () => {
    const db = new ShiftFlowDB(name);
    await seedIfNeeded(db);
    const s = build(db);
    const c1 = await s.config.lookup("C1");
    const c5 = await s.config.lookup("C5");
    await s.workDays.create(new Date(2026, 7, 1), c1!.shift, c1!.rules);
    await s.workDays.create(new Date(2026, 7, 15), c5!.shift, c5!.rules, "note");

    const csv = await s.csvService.exportCsv();

    // Fresh DB, import the CSV.
    const db2 = new ShiftFlowDB(`${name}-2`);
    await seedIfNeeded(db2);
    const s2 = build(db2);
    const preview = await s2.csvService.prepareImport(csv);
    const result = await s2.csvService.executeImport(preview, "skipExisting");
    expect(result.created).toBe(2);

    const w1 = await s2.workDays.byDate(new Date(2026, 7, 1));
    const w2 = await s2.workDays.byDate(new Date(2026, 7, 15));
    expect(w1!.shiftCode).toBe("C1");
    expect(w2!.shiftCode).toBe("C5");
    expect(w2!.note).toBe("note");
  });

  it("auto-detects tab and semicolon delimiters", () => {
    expect(parseCsv("Date\tShift\n01/08/2026\tC1\n")[0].shiftString).toBe("C1");
    expect(parseCsv("Date;Shift\n01/08/2026;C2\n")[0].shiftString).toBe("C2");
  });
});

describe("IndexedDB persistence", () => {
  it("data written by one instance is readable by a new instance of the same DB", async () => {
    const db1 = new ShiftFlowDB(name);
    await seedIfNeeded(db1);
    const s1 = build(db1);
    const c1 = await s1.config.lookup("C1");
    await s1.workDays.create(new Date(2026, 7, 9), c1!.shift, c1!.rules);
    db1.close();

    const db2 = new ShiftFlowDB(name);
    const s2 = build(db2);
    const w = await s2.workDays.byDate(new Date(2026, 7, 9));
    expect(w).toBeDefined();
    expect(w!.shiftCode).toBe("C1");
  });
});

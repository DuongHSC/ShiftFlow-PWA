// ShiftFlow PWA — Storage Layer
// storage/seeding.ts
//
// Idempotent first-run seeding of C1..C5, the C5 special rule, and MW.
// Only IDs not already present are added — existing user edits are preserved.

import type { ShiftFlowDB } from "@/storage/db/db";
import { defaultRules, defaultShifts, defaultTasks } from "@/domain/seed/seed";
import { nowISO } from "@/domain/resolver/datetime";

export async function seedIfNeeded(db: ShiftFlowDB): Promise<void> {
  const createdAt = nowISO();

  await db.transaction(
    "rw",
    db.shiftDefinitions,
    db.scheduleRules,
    db.taskDefinitions,
    async () => {
      const existingShiftIDs = new Set(
        await db.shiftDefinitions.toCollection().primaryKeys(),
      );
      const shiftsToAdd = defaultShifts(createdAt).filter(
        (s) => !existingShiftIDs.has(s.id),
      );
      if (shiftsToAdd.length) await db.shiftDefinitions.bulkPut(shiftsToAdd);

      const existingRuleIDs = new Set(
        await db.scheduleRules.toCollection().primaryKeys(),
      );
      const rulesToAdd = defaultRules(createdAt).filter(
        (r) => !existingRuleIDs.has(r.id),
      );
      if (rulesToAdd.length) await db.scheduleRules.bulkPut(rulesToAdd);

      const existingTaskIDs = new Set(
        await db.taskDefinitions.toCollection().primaryKeys(),
      );
      const tasksToAdd = defaultTasks(createdAt).filter(
        (t) => !existingTaskIDs.has(t.id),
      );
      if (tasksToAdd.length) await db.taskDefinitions.bulkPut(tasksToAdd);
    },
  );
}

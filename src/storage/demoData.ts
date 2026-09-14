// ShiftFlow PWA — Storage (DEV/DEMO ONLY)
// storage/demoData.ts
//
// Dev-only helper that populates the database with realistic sample WorkDays,
// tasks (incl. custom tasks), notes, and a hidden-task example for UI review.
//
// SAFETY (see TASK §18):
// - Never resets/clears IndexedDB.
// - Never overwrites a date the user already has a WorkDay for (skipped).
// - Only invoked from a dev-only "Load demo data" button (guarded by
//   import.meta.env.DEV in the UI) with a confirmation dialog.
// - Does NOT change the production seed (C1..C5 + C5 rule + MW).
// - Goes through the real services, so business rules are never bypassed.

import type { AppContainer } from "@/services/appContainer";

interface DemoRow {
  /** Fixed calendar date (year, month index 0-based, day). */
  y: number;
  m: number;
  d: number;
  /** Shift code, or "OFF" for no WorkDay. */
  shift: string;
  /** Visible task codes. */
  tasks?: string[];
  /** Task codes assigned but HIDDEN (isVisible=false) — proves the source of truth. */
  hiddenTasks?: string[];
  note?: string;
}

// Dataset from the task (Aug–Sep 2026), plus a hidden-task example on the first day.
const DEMO_ROWS: DemoRow[] = [
  // 26/08 proves the single source of truth: MW visible, Ticket HIDDEN.
  { y: 2026, m: 7, d: 26, shift: "C5", tasks: ["MW"], hiddenTasks: ["Ticket"], note: "Kiểm tra hệ thống" },
  { y: 2026, m: 7, d: 27, shift: "C3", tasks: ["Ticket"] },
  { y: 2026, m: 7, d: 28, shift: "C2", tasks: ["Inventory"] },
  { y: 2026, m: 7, d: 29, shift: "OFF" },
  { y: 2026, m: 7, d: 30, shift: "C1", tasks: ["MW"] },
  { y: 2026, m: 7, d: 31, shift: "C4", tasks: ["Report"] },
  { y: 2026, m: 8, d: 1, shift: "C5", tasks: ["MW", "Ticket"], note: "Bàn giao cuối ca" },
  { y: 2026, m: 8, d: 2, shift: "OFF" },
  { y: 2026, m: 8, d: 3, shift: "C1", tasks: ["Ticket"] },
  { y: 2026, m: 8, d: 4, shift: "C2", tasks: ["Report", "Inventory"], note: "Kiểm tra báo cáo" },
  { y: 2026, m: 8, d: 5, shift: "C3", tasks: ["MW"] },
  { y: 2026, m: 8, d: 6, shift: "OFF" },
  { y: 2026, m: 8, d: 7, shift: "C5", tasks: ["Ticket"] },
];

const CUSTOM_TASK_CODES = ["Ticket", "Inventory", "Report"];

async function ensureCustomTasks(app: AppContainer): Promise<void> {
  for (const code of CUSTOM_TASK_CODES) {
    const existing = await app.taskService.taskByCode(code);
    if (!existing) await app.taskService.createTask(code, code);
  }
}

export interface DemoLoadResult {
  created: number;
  skipped: number; // dates that already had a WorkDay (user data preserved)
}

/**
 * Loads demo data. Dates that already have a WorkDay are SKIPPED (never
 * overwritten). Returns counts of created and skipped days.
 */
export async function loadDemoData(app: AppContainer): Promise<DemoLoadResult> {
  await ensureCustomTasks(app);

  let created = 0;
  let skipped = 0;

  for (const row of DEMO_ROWS) {
    const date = new Date(row.y, row.m, row.d);

    const existing = await app.workDayService.byDate(date);
    if (existing) {
      skipped += 1; // preserve user data — do not overwrite.
      continue;
    }

    if (row.shift === "OFF") continue; // OFF = no WorkDay.

    const lookup = await app.configService.lookup(row.shift);
    if (!lookup) continue;

    const wd = await app.workDayService.create(
      date,
      lookup.shift,
      lookup.rules,
      row.note ?? null,
    );
    created += 1;

    for (const code of row.tasks ?? []) {
      const def = await app.taskService.taskByCode(code);
      if (def) await app.taskService.addTask(def.id, wd.id);
    }
    for (const code of row.hiddenTasks ?? []) {
      const def = await app.taskService.taskByCode(code);
      if (def) {
        await app.taskService.addTask(def.id, wd.id);
        await app.taskService.setTaskVisibility(def.id, wd.id, false);
      }
    }
  }

  return { created, skipped };
}

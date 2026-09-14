// ShiftFlow PWA — Import/Export
// import-export/csv/csvService.ts
//
// Orchestrates the CSV import workflow and CSV export, ported from iOS
// ShiftImportService / ShiftExportService.
//
// - Import NEVER calculates shift times itself: all resolution goes through
//   WorkDayService -> resolver.
// - Tasks/Notes do not influence resolution.
// - OFF rows do not create WorkDays.

import {
  buildCsv,
  isOffRow,
  parseCsv,
  shiftAliasKey,
  validateCsv,
  type CsvValidatedRow,
  type ExportWorkDayInput,
} from "./csv";
import type { WorkDayService } from "@/services/workday/workDayService";
import type { TaskService } from "@/services/tasks/taskService";
import type { ShiftConfigurationService } from "@/services/settings/shiftConfigurationService";
import { fromISODateLocal } from "@/domain/resolver/datetime";

export type ImportConflictStrategy = "skipExisting" | "replaceExisting";

export interface ImportPreview {
  rows: CsvValidatedRow[];
  total: number;
  validCount: number; // importable (valid, not OFF)
  offCount: number;
  errorCount: number;
  duplicateCount: number;
  conflictCount: number;
  canImport: boolean;
}

export interface ImportResult {
  created: number;
  replaced: number;
  skipped: number;
  offDays: number;
}

export class CsvService {
  constructor(
    private workDays: WorkDayService,
    private tasks: TaskService,
    private config: ShiftConfigurationService,
  ) {}

  /** Parse + validate (no mutation). Produces a preview for user review. */
  async prepareImport(content: string): Promise<ImportPreview> {
    const raw = parseCsv(content);

    // Existing WorkDay dates (for conflict detection) taken directly from the DB.
    const allWorkDays = await this.workDays.all();
    const existingDates = new Set(allWorkDays.map((w) => w.date));

    const knownTaskCodes = new Set(
      (await this.tasks.allTasks()).map((t) => t.code),
    );
    const knownShiftAliases = new Map<string, string>();
    for (const shift of await this.config.allShifts()) {
      knownShiftAliases.set(shiftAliasKey(shift.code), shift.code.toUpperCase());
      if (shift.name) {
        knownShiftAliases.set(shiftAliasKey(shift.name), shift.code.toUpperCase());
      }
      // Also accept the common human label "Ca 1"/"Ca1" for canonical
      // codes like C1, even when the configured display name is still C1.
      const numberedCode = /^C(\d+)$/i.exec(shift.code.trim());
      if (numberedCode) {
        knownShiftAliases.set(`CA${numberedCode[1]}`, shift.code.toUpperCase());
      }
    }

    const rows = validateCsv(raw, {
      existingWorkDayDates: existingDates,
      knownTaskCodes,
      knownShiftAliases,
    });

    const offCount = rows.filter((r) => isOffRow(r) && r.status.kind === "valid")
      .length;
    const validCount = rows.filter(
      (r) => r.status.kind === "valid" && !isOffRow(r),
    ).length;
    const errorCount = rows.filter((r) => r.status.kind === "error").length;
    const duplicateCount = rows.filter(
      (r) => r.status.kind === "duplicateInFile",
    ).length;
    const conflictCount = rows.filter((r) => r.status.kind === "conflict").length;

    return {
      rows,
      total: rows.length,
      validCount,
      offCount,
      errorCount,
      duplicateCount,
      conflictCount,
      canImport: validCount + conflictCount > 0,
    };
  }

  /** Executes an import after confirmation. */
  async executeImport(
    preview: ImportPreview,
    strategy: ImportConflictStrategy,
  ): Promise<ImportResult> {
    let created = 0;
    let replaced = 0;
    let skipped = 0;
    let offDays = 0;

    for (const row of preview.rows) {
      if (row.status.kind === "error" || row.status.kind === "duplicateInFile") {
        continue;
      }
      if (isOffRow(row)) {
        offDays += 1;
        continue;
      }
      if (!row.isoDate || !row.shiftCode) continue;

      const lookup = await this.config.lookup(row.shiftCode);
      if (!lookup) continue;
      const date = fromISODateLocal(row.isoDate);
      const note = row.note ?? null;

      if (row.status.kind === "valid") {
        const wd = await this.workDays.create(
          date,
          lookup.shift,
          lookup.rules,
          note,
        );
        await this.assignTasks(row.task, wd.id);
        created += 1;
      } else if (row.status.kind === "conflict") {
        if (strategy === "skipExisting") {
          skipped += 1;
          continue;
        }
        const existing = await this.workDays.byDate(date);
        if (existing) {
          await this.workDays.changeShift(existing.id, lookup.shift, lookup.rules);
          await this.workDays.updateNote(existing.id, note);
          await this.tasks.removeAllTasks(existing.id);
          await this.assignTasks(row.task, existing.id);
          replaced += 1;
        } else {
          const wd = await this.workDays.create(
            date,
            lookup.shift,
            lookup.rules,
            note,
          );
          await this.assignTasks(row.task, wd.id);
          created += 1;
        }
      }
    }

    return { created, replaced, skipped, offDays };
  }

  private async assignTasks(
    taskString: string | null,
    workDayID: string,
  ): Promise<void> {
    if (!taskString) return;
    const codes = taskString
      .split(";")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    for (const code of codes) {
      const def = await this.tasks.taskByCode(code);
      if (def) await this.tasks.addTask(def.id, workDayID);
    }
  }

  /** Exports all WorkDays to CSV text (sorted, with tasks). */
  async exportCsv(): Promise<string> {
    const workDays = await this.workDays.all();
    const inputs: ExportWorkDayInput[] = [];
    for (const w of workDays) {
      const taskCodes = (await this.tasks.tasksForWorkDay(w.id))
        .map((t) => t.code)
        .sort();
      inputs.push({
        isoDate: w.date,
        shiftCode: w.shiftCode,
        task: taskCodes.join(";"),
        note: w.note ?? "",
      });
    }
    return buildCsv(inputs);
  }
}

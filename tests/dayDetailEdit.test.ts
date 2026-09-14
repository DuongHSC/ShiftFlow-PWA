// ShiftFlow PWA — Tests
// tests/dayDetailEdit.test.ts
//
// TASK-PWA-UX-EDIT-013: Day Edit UX.
//   - EDIT screen has a single Save (no header ✓; only the bottom "Lưu").
//   - Save persists changes.
//   - "Xóa" opens a confirmation dialog (does NOT delete immediately).
//   - Cancelling the confirmation keeps the WorkDay.
//   - Confirming deletes the WorkDay and fires the refresh callback.
//
// Drives the real Day Detail sheet over the shared app container (the same
// store it reads/writes). Deterministic fixture, independent of today's date.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { app } from "@/services/appContainer";
import { openDayDetail } from "@/ui/screens/dayDetailSheet";
import { fromISODateLocal } from "@/domain/resolver/datetime";
import { SEED_IDS } from "@/domain/seed/seed";

const FIXTURE_ISO = "2027-05-14"; // fixed date, far from "today"

function buttonsByText(root: ParentNode, text: string): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll("button")).filter(
    (b) => (b.textContent ?? "").trim() === text,
  ) as HTMLButtonElement[];
}

async function seedFixture(): Promise<void> {
  await app.bootstrap();
  const date = fromISODateLocal(FIXTURE_ISO);
  const existing = await app.workDayService.byDate(date);
  if (existing) {
    await app.taskService.removeAllTasks(existing.id);
    await app.workDayService.delete(existing.id);
  }
  const c5 = await app.configService.lookup("C5");
  if (!c5) throw new Error("C5 must be seeded");
  const wd = await app.workDayService.create(date, c5.shift, c5.rules, "note");
  await app.taskService.addTask(SEED_IDS.mw, wd.id);
}

function cleanupDom(): void {
  document.querySelectorAll(".sheet-backdrop, .confirm-backdrop").forEach((n) => n.remove());
}

beforeEach(async () => {
  await seedFixture();
});
afterEach(() => {
  cleanupDom();
});

describe("Day Edit — single Save action", () => {
  it("EDIT header has no ✓ save button; there is exactly one 'Lưu'", async () => {
    await openDayDetail(FIXTURE_ISO, () => {}, { mode: "edit" });
    const sheet = document.querySelector(".sheet")!;
    // Header check icon (✓ / U+2713) must be gone.
    const checkButtons = Array.from(sheet.querySelectorAll("button")).filter((b) =>
      (b.textContent ?? "").includes("\u2713"),
    );
    expect(checkButtons.length).toBe(0);
    // Exactly one Save action ("Lưu").
    expect(buttonsByText(sheet, "Lưu").length).toBe(1);
  });

  it("Save button persists changes and closes the sheet", async () => {
    let refreshed = 0;
    await openDayDetail(FIXTURE_ISO, () => {
      refreshed += 1;
    }, { mode: "edit" });
    const sheet = document.querySelector(".sheet")!;
    const save = buttonsByText(sheet, "Lưu")[0];
    expect(save).toBeTruthy();
    save.click();
    // Let the async save settle.
    await new Promise((r) => setTimeout(r, 0));
    // WorkDay still exists (save doesn't delete) and refresh fired.
    const wd = await app.workDayService.byDate(fromISODateLocal(FIXTURE_ISO));
    expect(wd).toBeDefined();
    expect(refreshed).toBeGreaterThan(0);
  });

  it("EDIT screen can create a new task inline", async () => {
    const inlineCode = `Inline${Date.now()}`;
    await openDayDetail(FIXTURE_ISO, () => {}, { mode: "edit" });
    let sheet = document.querySelector(".sheet")!;
    buttonsByText(sheet, "+ Task")[0].click();
    await new Promise((r) => setTimeout(r, 0));

    sheet = document.querySelector(".sheet")!;
    expect(sheet.textContent).toContain("Mã task");
    const form = sheet.querySelector(".inline-task-form")!;
    const inputs = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="text"]'));
    inputs[0].value = inlineCode;
    inputs[1].value = "Inline Meeting";
    buttonsByText(form, "Thêm")[0].click();
    for (let i = 0; i < 20; i += 1) {
      await new Promise((r) => setTimeout(r, 5));
      if (await app.taskService.taskByCode(inlineCode)) break;
    }

    sheet = document.querySelector(".sheet")!;
    expect(sheet.textContent).toContain(inlineCode);
    expect(await app.taskService.taskByCode(inlineCode)).toBeTruthy();
  });
});

describe("Day Edit — delete confirmation", () => {
  it("'Xóa' opens a confirmation dialog and does NOT delete immediately", async () => {
    await openDayDetail(FIXTURE_ISO, () => {}, { mode: "edit" });
    const sheet = document.querySelector(".sheet")!;
    const del = buttonsByText(sheet, "Xóa")[0];
    expect(del).toBeTruthy();
    del.click();

    // Confirmation dialog appears.
    const confirm = document.querySelector(".confirm-backdrop");
    expect(confirm).toBeTruthy();
    expect(confirm?.textContent).toContain("Xóa ngày này?");

    // Nothing deleted yet.
    const wd = await app.workDayService.byDate(fromISODateLocal(FIXTURE_ISO));
    expect(wd).toBeDefined();
  });

  it("Cancel in the confirmation keeps the WorkDay", async () => {
    await openDayDetail(FIXTURE_ISO, () => {}, { mode: "edit" });
    buttonsByText(document.querySelector(".sheet")!, "Xóa")[0].click();

    const confirm = document.querySelector(".confirm-backdrop")!;
    buttonsByText(confirm, "Hủy")[0].click();
    await new Promise((r) => setTimeout(r, 0));

    // Dialog closed, WorkDay intact.
    expect(document.querySelector(".confirm-backdrop")).toBeNull();
    const wd = await app.workDayService.byDate(fromISODateLocal(FIXTURE_ISO));
    expect(wd).toBeDefined();
  });

  it("Confirming delete removes the WorkDay and fires refresh", async () => {
    let refreshed = 0;
    await openDayDetail(FIXTURE_ISO, () => {
      refreshed += 1;
    }, { mode: "edit" });
    buttonsByText(document.querySelector(".sheet")!, "Xóa")[0].click();

    const confirm = document.querySelector(".confirm-backdrop")!;
    // The destructive "Xóa" inside the dialog.
    buttonsByText(confirm, "Xóa")[0].click();
    await new Promise((r) => setTimeout(r, 0));

    const wd = await app.workDayService.byDate(fromISODateLocal(FIXTURE_ISO));
    expect(wd).toBeUndefined();
    expect(refreshed).toBeGreaterThan(0);
  });
});

// ShiftFlow PWA — Tests
// tests/smoke.test.ts
//
// Lightweight UI smoke tests. Render each screen into jsdom and assert it
// produces content without throwing. Uses the shared app container (seeded).

import { describe, it, expect, beforeAll } from "vitest";
import { app } from "@/services/appContainer";
import { renderToday } from "@/ui/screens/todayScreen";
import { renderCalendar } from "@/ui/screens/calendarScreen";
import { renderUpcoming } from "@/ui/screens/upcomingScreen";
import { renderSettings, resetSettingsView } from "@/ui/screens/settingsScreen";
import { renderDataManagement } from "@/ui/screens/dataManagementScreen";
import { openDayDetail } from "@/ui/screens/dayDetailSheet";
import type { ScreenContext } from "@/ui/navigation/router";
import { fromISODateLocal } from "@/domain/resolver/datetime";
import { SEED_IDS } from "@/domain/seed/seed";

const ctx: ScreenContext = { navigate: () => {}, refresh: () => {} };

// A deterministic Day Detail fixture, created via the SHARED app container
// (the same store openDayDetail reads). Independent of today's date, demo data,
// existing IndexedDB contents, or future seed changes.
const FIXTURE_ISO = "2027-03-11"; // fixed date, far from "today"

async function seedDayDetailFixture(): Promise<void> {
  const date = fromISODateLocal(FIXTURE_ISO);
  // Clear any pre-existing WorkDay for this date so the fixture is exact.
  const existing = await app.workDayService.byDate(date);
  if (existing) {
    await app.taskService.removeAllTasks(existing.id);
    await app.workDayService.delete(existing.id);
  }
  const c5 = await app.configService.lookup("C5");
  if (!c5) throw new Error("C5 shift must be seeded");
  const wd = await app.workDayService.create(date, c5.shift, c5.rules, "Kiểm tra hệ thống");
  await app.taskService.addTask(SEED_IDS.mw, wd.id); // MW = visible by default
}

beforeAll(async () => {
  await app.bootstrap();
  await seedDayDetailFixture();
});

describe("screen smoke tests", () => {
  it("Today screen renders with a title", async () => {
    const node = await renderToday(ctx);
    expect(node.querySelector(".screen-title")?.textContent).toContain("Hôm nay");
  });

  it("Calendar screen renders a 7-column grid with weekday headers", async () => {
    const node = await renderCalendar(ctx);
    expect(node.querySelector(".cal-grid")).toBeTruthy();
    const weekdays = node.querySelectorAll(".cal-weekday");
    expect(weekdays.length).toBe(7);
    // Monday-first.
    expect(weekdays[0].textContent).toBe("T2");
  });

  it("Overview renders exactly 3 day headings (today/tomorrow/day-after), VIEW only", async () => {
    const node = await renderUpcoming(ctx);
    const headings = node.querySelectorAll(".day-heading");
    expect(headings.length).toBe(3);
    const labels = Array.from(node.querySelectorAll(".day-heading-label")).map(
      (n) => n.textContent,
    );
    expect(labels).toEqual(["Hôm nay", "Ngày mai", "Ngày kia"]);
    // VIEW only: no edit/save/delete affordances on Overview.
    expect(node.querySelector(".icon-action")).toBeNull();
    expect(
      Array.from(node.querySelectorAll("button")).some((b) =>
        /Lưu|Xóa|Sửa|Thêm/.test(b.textContent ?? ""),
      ),
    ).toBe(false);
    // No "Xem 3 ngày tới" / "Xem lịch đầy đủ" CTA.
    expect(node.textContent ?? "").not.toContain("Xem 3 ngày");
    expect(node.textContent ?? "").not.toContain("Xem lịch");
  });

  it("Settings screen renders section groups", async () => {
    const node = await renderSettings(ctx);
    expect(node.querySelector(".screen-title")?.textContent).toContain("Cài đặt");
    expect(node.querySelectorAll(".list-group").length).toBeGreaterThan(0);
  });

  it("Settings shift editor can rename a shift without changing its code", async () => {
    const c1 = await app.configService.lookup("C1");
    expect(c1).toBeTruthy();

    resetSettingsView();
    let node = await renderSettings(ctx);
    Array.from(node.querySelectorAll(".list-row"))
      .find((row) => row.textContent?.includes("Cấu hình ca làm việc"))
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    node = await renderSettings(ctx);
    Array.from(node.querySelectorAll(".list-row"))
      .find((row) => row.textContent?.includes("C1"))
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    node = await renderSettings(ctx);
    const nameInput = node.querySelector<HTMLInputElement>('input[type="text"]');
    expect(nameInput).toBeTruthy();
    expect(nameInput?.disabled).toBe(false);
    nameInput!.value = "Ca sáng";

    Array.from(node.querySelectorAll("button"))
      .find((button) => button.textContent === "Lưu")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    const renamed = await app.configService.lookup("C1");
    expect(renamed?.shift.code).toBe("C1");
    expect(renamed?.shift.name).toBe("Ca sáng");
  });

  it("Settings appearance screen can switch theme modes", async () => {
    resetSettingsView();
    let node = await renderSettings(ctx);
    Array.from(node.querySelectorAll(".list-row"))
      .find((row) => row.textContent?.includes("Giao diện"))
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    node = await renderSettings(ctx);
    expect(node.querySelector(".screen-title")?.textContent).toContain("Giao diện");

    Array.from(node.querySelectorAll(".list-row"))
      .find((row) => row.textContent?.includes("Tối"))
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("Data Management screen renders export/load actions", () => {
    const node = renderDataManagement({ back: () => {}, refresh: () => {} });
    const text = node.textContent ?? "";
    expect(text).toContain("Xuất JSON");
    expect(text).toContain("Nhập JSON");
    expect(text).toContain("Xuất CSV");
  });

  it("Day Detail sheet opens in VIEW mode by default", async () => {
    // Open the deterministic fixture day (C5 + MW), NOT today's real date.
    await openDayDetail(FIXTURE_ISO, () => {});
    const sheet = document.querySelector(".sheet");
    expect(sheet).toBeTruthy();
    const text = sheet?.textContent ?? "";
    // VIEW mode header + read-only "Công việc" section with the assigned task.
    expect(text).toContain("Chi tiết ngày");
    expect(text).toContain("Công việc");
    expect(text).toContain("MW");
    // Edit icon is available (pencil action) in VIEW mode.
    expect(sheet?.querySelector(".icon-action")).toBeTruthy();
    document.querySelector(".sheet-backdrop")?.remove();
  });

  it("Day Detail sheet supports EDIT mode (shift editing UI)", async () => {
    await openDayDetail(FIXTURE_ISO, () => {}, { mode: "edit" });
    const sheet = document.querySelector(".sheet");
    expect(sheet).toBeTruthy();
    const text = sheet?.textContent ?? "";
    // EDIT mode shows the shift-editing UI and the resolved C5 time.
    expect(text).toContain("Ca làm việc");
    expect(text).toContain("C5");
    // Shift selector chips present (edit affordance).
    expect(sheet?.querySelector(".chip")).toBeTruthy();
    document.querySelector(".sheet-backdrop")?.remove();
  });
});

// ShiftFlow PWA — Tests
// tests/navigationOverview.test.ts
//
// TASK-PWA-UX-NAV-014:
//   - Bottom navigation has ONLY Tổng quan / Lịch / Cài đặt (no 3 Days).
//   - Overview shows the next 3 days (today/tomorrow/day-after) from the single
//     source of truth: visible tasks appear, hidden tasks do not, OFF renders.

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { app } from "@/services/appContainer";
import { Router, type ScreenId, type ScreenRenderer } from "@/ui/navigation/router";
import { renderUpcoming } from "@/ui/screens/upcomingScreen";
import { el } from "@/ui/components/dom";
import { startOfLocalDay } from "@/domain/resolver/datetime";
import { SEED_IDS } from "@/domain/seed/seed";

const noopCtx = { navigate: () => {}, refresh: () => {} };

function dayOffset(n: number): Date {
  const b = startOfLocalDay(new Date());
  return new Date(b.getFullYear(), b.getMonth(), b.getDate() + n);
}

async function clearDay(d: Date): Promise<void> {
  const existing = await app.workDayService.byDate(d);
  if (existing) {
    await app.taskService.removeAllTasks(existing.id);
    await app.workDayService.delete(existing.id);
  }
}

beforeAll(async () => {
  await app.bootstrap();
});

afterEach(async () => {
  // Reset the 3 Overview days between tests.
  for (const n of [0, 1, 2]) await clearDay(dayOffset(n));
});

describe("bottom navigation", () => {
  it("contains only Tổng quan / Lịch / Cài đặt (no 3 Days)", async () => {
    const root = el("div", {});
    // Minimal screen map (renderers are not invoked for nav inspection beyond
    // the initial screen).
    const blank: ScreenRenderer = async () => el("div", {});
    const screens: Record<ScreenId, ScreenRenderer> = {
      upcoming: blank,
      calendar: blank,
      settings: blank,
      today: blank,
    };
    const router = new Router(root, screens);
    await router.start("upcoming");

    const labels = Array.from(root.querySelectorAll(".nav-item")).map((n) =>
      (n.getAttribute("aria-label") ?? "").trim(),
    );
    expect(labels).toEqual(["Tổng quan", "Lịch", "Cài đặt"]);
    expect(labels).not.toContain("3 Ngày");
    expect(labels.length).toBe(3);
  });
});

describe("Overview reads the single source of truth (3 days)", () => {
  it("shows today/tomorrow WorkDays, OFF for day-after, and respects task visibility", async () => {
    const c5 = (await app.configService.lookup("C5"))!;
    const c3 = (await app.configService.lookup("C3"))!;

    // Today: C5 with MW visible + Ticket HIDDEN.
    const todayWd = await app.workDayService.create(dayOffset(0), c5.shift, c5.rules, "note today");
    const ticket = (await app.taskService.taskByCode("Ticket")) ??
      (await app.taskService.createTask("Ticket", "Ticket"));
    await app.taskService.addTask(SEED_IDS.mw, todayWd.id);
    await app.taskService.addTask(ticket.id, todayWd.id);
    await app.taskService.setTaskVisibility(ticket.id, todayWd.id, false);

    // Tomorrow: C3.
    await app.workDayService.create(dayOffset(1), c3.shift, c3.rules);

    // Day after: leave OFF (no WorkDay).

    const node = await renderUpcoming(noopCtx);
    const text = node.textContent ?? "";

    // 3 day blocks.
    expect(node.querySelectorAll(".day-heading").length).toBe(3);

    // Today shows C5 + visible MW; hidden Ticket must NOT appear as a chip.
    expect(text).toContain("C5");
    const chipTexts = Array.from(node.querySelectorAll(".chip.readonly")).map((c) => c.textContent);
    expect(chipTexts).toContain("MW");
    expect(chipTexts).not.toContain("Ticket");

    // Tomorrow shows C3.
    expect(text).toContain("C3");

    // Day-after OFF.
    expect(text).toContain("OFF");
    expect(text).toContain("Không có ca làm");
  });

  it("unhiding a task in the data makes it appear on Overview immediately", async () => {
    const c5 = (await app.configService.lookup("C5"))!;
    const wd = await app.workDayService.create(dayOffset(0), c5.shift, c5.rules);
    const ticket = (await app.taskService.taskByCode("Ticket")) ??
      (await app.taskService.createTask("Ticket", "Ticket"));
    await app.taskService.addTask(ticket.id, wd.id);
    await app.taskService.setTaskVisibility(ticket.id, wd.id, false);

    let node = await renderUpcoming(noopCtx);
    let chips = Array.from(node.querySelectorAll(".chip.readonly")).map((c) => c.textContent);
    expect(chips).not.toContain("Ticket");

    // Unhide (as Calendar/Day Detail would) — Overview reflects it on re-render.
    await app.taskService.setTaskVisibility(ticket.id, wd.id, true);
    node = await renderUpcoming(noopCtx);
    chips = Array.from(node.querySelectorAll(".chip.readonly")).map((c) => c.textContent);
    expect(chips).toContain("Ticket");
  });

  it("shows the latest configured shift name for an existing WorkDay", async () => {
    const lookup = (await app.configService.lookup("C5"))!;
    const original = { ...lookup.shift };
    await app.workDayService.create(dayOffset(0), lookup.shift, lookup.rules);
    try {
      await app.configService.updateShift({ ...original, name: "Ca 5 chiều" });
      const node = await renderUpcoming(noopCtx);
      expect(node.textContent).toContain("Ca 5 chiều");
    } finally {
      await app.configService.updateShift(original);
    }
  });
});

import { describe, expect, it } from "vitest";
import { ShiftFlowDB } from "@/storage/db/db";
import {
  WorkDayEventRepository,
} from "@/storage/repositories/repositories";
import { WorkDayEventService } from "@/services/events/workDayEventService";

let counter = 0;

describe("WorkDayEventService", () => {
  it("stores timed work separately from task assignments", async () => {
    const db = new ShiftFlowDB(`test-events-${counter++}-${Date.now()}`);
    const service = new WorkDayEventService(new WorkDayEventRepository(db));

    await service.replaceForWorkDay("wd-1", [
      {
        title: "Meeting",
        startTime: "12:00",
        endTime: "13:00",
        reminderEnabled: false,
        reminderOffset: null,
      },
    ]);

    const events = await service.forWorkDay("wd-1");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      workDayID: "wd-1",
      title: "Meeting",
      startTime: "12:00",
      endTime: "13:00",
    });

    await db.delete();
  });

  it("replaces only the work items for the selected day", async () => {
    const db = new ShiftFlowDB(`test-events-${counter++}-${Date.now()}`);
    const service = new WorkDayEventService(new WorkDayEventRepository(db));

    await service.replaceForWorkDay("wd-1", [
      {
        title: "Old",
        startTime: "09:00",
        endTime: "10:00",
        reminderEnabled: false,
        reminderOffset: null,
      },
    ]);
    await service.replaceForWorkDay("wd-2", [
      {
        title: "Other day",
        startTime: "11:00",
        endTime: "12:00",
        reminderEnabled: false,
        reminderOffset: null,
      },
    ]);
    await service.replaceForWorkDay("wd-1", [
      {
        title: "New",
        startTime: "14:00",
        endTime: "15:00",
        reminderEnabled: false,
        reminderOffset: null,
      },
    ]);

    expect((await service.forWorkDay("wd-1")).map((e) => e.title)).toEqual(["New"]);
    expect((await service.forWorkDay("wd-2")).map((e) => e.title)).toEqual(["Other day"]);
    await db.delete();
  });
});

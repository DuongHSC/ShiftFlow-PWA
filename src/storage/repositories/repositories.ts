// ShiftFlow PWA — Storage Layer
// storage/repositories/repositories.ts
//
// Thin repositories over Dexie tables. No business logic here — services own
// the rules. Repositories only read/write records.

import type { ShiftFlowDB } from "@/storage/db/db";
import type {
  ReminderConfiguration,
  ScheduleRule,
  ShiftDefinition,
  TaskDefinition,
  WorkDay,
  WorkDayEvent,
  WorkDayTask,
} from "@/domain/models/models";

export class WorkDayRepository {
  constructor(private db: ShiftFlowDB) {}

  all(): Promise<WorkDay[]> {
    return this.db.workDays.toArray();
  }
  byId(id: string): Promise<WorkDay | undefined> {
    return this.db.workDays.get(id);
  }
  byDate(isoDate: string): Promise<WorkDay | undefined> {
    return this.db.workDays.where("date").equals(isoDate).first();
  }
  async byDateRange(startISO: string, endISO: string): Promise<WorkDay[]> {
    return this.db.workDays
      .where("date")
      .between(startISO, endISO, true, true)
      .toArray();
  }
  put(w: WorkDay): Promise<string> {
    return this.db.workDays.put(w);
  }
  delete(id: string): Promise<void> {
    return this.db.workDays.delete(id);
  }
}

export class ShiftDefinitionRepository {
  constructor(private db: ShiftFlowDB) {}
  all(): Promise<ShiftDefinition[]> {
    return this.db.shiftDefinitions.toArray();
  }
  byCode(code: string): Promise<ShiftDefinition | undefined> {
    return this.db.shiftDefinitions.where("code").equals(code).first();
  }
  put(s: ShiftDefinition): Promise<string> {
    return this.db.shiftDefinitions.put(s);
  }
  delete(id: string): Promise<void> {
    return this.db.shiftDefinitions.delete(id);
  }
  bulkPut(items: ShiftDefinition[]): Promise<string> {
    return this.db.shiftDefinitions.bulkPut(items) as unknown as Promise<string>;
  }
}

export class ScheduleRuleRepository {
  constructor(private db: ShiftFlowDB) {}
  all(): Promise<ScheduleRule[]> {
    return this.db.scheduleRules.toArray();
  }
  byShift(shiftID: string): Promise<ScheduleRule[]> {
    return this.db.scheduleRules.where("shiftID").equals(shiftID).toArray();
  }
  put(r: ScheduleRule): Promise<string> {
    return this.db.scheduleRules.put(r);
  }
  delete(id: string): Promise<void> {
    return this.db.scheduleRules.delete(id);
  }
  bulkPut(items: ScheduleRule[]): Promise<string> {
    return this.db.scheduleRules.bulkPut(items) as unknown as Promise<string>;
  }
}

export class TaskDefinitionRepository {
  constructor(private db: ShiftFlowDB) {}
  all(): Promise<TaskDefinition[]> {
    return this.db.taskDefinitions.toArray();
  }
  put(t: TaskDefinition): Promise<string> {
    return this.db.taskDefinitions.put(t);
  }
  delete(id: string): Promise<void> {
    return this.db.taskDefinitions.delete(id);
  }
  bulkPut(items: TaskDefinition[]): Promise<string> {
    return this.db.taskDefinitions.bulkPut(items) as unknown as Promise<string>;
  }
}

export class WorkDayTaskRepository {
  constructor(private db: ShiftFlowDB) {}
  all(): Promise<WorkDayTask[]> {
    return this.db.workDayTasks.toArray();
  }
  forWorkDay(workDayID: string): Promise<WorkDayTask[]> {
    return this.db.workDayTasks.where("workDayID").equals(workDayID).toArray();
  }
  put(a: WorkDayTask): Promise<string> {
    return this.db.workDayTasks.put(a);
  }
  delete(id: string): Promise<void> {
    return this.db.workDayTasks.delete(id);
  }
  async deleteForWorkDay(workDayID: string): Promise<void> {
    const keys = await this.db.workDayTasks
      .where("workDayID")
      .equals(workDayID)
      .primaryKeys();
    await this.db.workDayTasks.bulkDelete(keys);
  }
}

export class WorkDayEventRepository {
  constructor(private db: ShiftFlowDB) {}
  all(): Promise<WorkDayEvent[]> {
    return this.db.workDayEvents.toArray();
  }
  forWorkDay(workDayID: string): Promise<WorkDayEvent[]> {
    return this.db.workDayEvents.where("workDayID").equals(workDayID).toArray();
  }
  put(event: WorkDayEvent): Promise<string> {
    return this.db.workDayEvents.put(event);
  }
  delete(id: string): Promise<void> {
    return this.db.workDayEvents.delete(id);
  }
  async deleteForWorkDay(workDayID: string): Promise<void> {
    const keys = await this.db.workDayEvents
      .where("workDayID")
      .equals(workDayID)
      .primaryKeys();
    await this.db.workDayEvents.bulkDelete(keys);
  }
}

export class ReminderRepository {
  constructor(private db: ShiftFlowDB) {}
  all(): Promise<ReminderConfiguration[]> {
    return this.db.reminders.toArray();
  }
  forWorkDay(workDayID: string): Promise<ReminderConfiguration | undefined> {
    return this.db.reminders.where("workDayID").equals(workDayID).first();
  }
  put(r: ReminderConfiguration): Promise<string> {
    return this.db.reminders.put(r);
  }
  async deleteForWorkDay(workDayID: string): Promise<void> {
    const keys = await this.db.reminders
      .where("workDayID")
      .equals(workDayID)
      .primaryKeys();
    await this.db.reminders.bulkDelete(keys);
  }
}

// ShiftFlow PWA — Services
// services/appContainer.ts
//
// Composition root. Wires repositories + services over the Dexie DB.
// Mirrors the iOS AppContainer at a conceptual level (UI -> services -> domain
// -> storage). UI code depends only on this container's services.

import { ShiftFlowDB, db as sharedDb } from "@/storage/db/db";
import {
  ReminderRepository,
  ScheduleRuleRepository,
  ShiftDefinitionRepository,
  TaskDefinitionRepository,
  WorkDayRepository,
  WorkDayEventRepository,
  WorkDayTaskRepository,
} from "@/storage/repositories/repositories";
import { seedIfNeeded } from "@/storage/seeding";
import { WorkDayService } from "@/services/workday/workDayService";
import { TaskService } from "@/services/tasks/taskService";
import { ReminderService } from "@/services/reminders/reminderService";
import { NotificationScheduler } from "@/services/reminders/notificationScheduler";
import { ShiftConfigurationService } from "@/services/settings/shiftConfigurationService";
import { CsvService } from "@/import-export/csv/csvService";
import { WorkDayEventService } from "@/services/events/workDayEventService";
import { SyncMetaStore, SyncQueueStore } from "@/sync/syncStore";
import { ChangeTracker } from "@/sync/changeTracker";
import { GasClient } from "@/sync/gasClient";
import { SyncService } from "@/sync/syncService";

export class AppContainer {
  readonly db: ShiftFlowDB;
  readonly workDayService: WorkDayService;
  readonly taskService: TaskService;
  readonly eventService: WorkDayEventService;
  readonly reminderService: ReminderService;
  readonly notificationScheduler: NotificationScheduler;
  readonly configService: ShiftConfigurationService;
  readonly csvService: CsvService;

  // Sync layer (sits beside the domain services; IndexedDB stays the source of truth).
  readonly syncMeta: SyncMetaStore;
  readonly syncQueue: SyncQueueStore;
  readonly changeTracker: ChangeTracker;
  readonly syncService: SyncService;

  constructor(db: ShiftFlowDB = sharedDb) {
    this.db = db;

    const workDayRepo = new WorkDayRepository(db);
    const shiftRepo = new ShiftDefinitionRepository(db);
    const ruleRepo = new ScheduleRuleRepository(db);
    const taskDefRepo = new TaskDefinitionRepository(db);
    const assignRepo = new WorkDayTaskRepository(db);
    const eventRepo = new WorkDayEventRepository(db);
    const reminderRepo = new ReminderRepository(db);

    // Sync stores + change tracker (the tracker is the change sink for services).
    this.syncMeta = new SyncMetaStore(db);
    this.syncQueue = new SyncQueueStore(db);
    this.changeTracker = new ChangeTracker(this.syncQueue, this.syncMeta);

    const sink = this.changeTracker;
    this.configService = new ShiftConfigurationService(shiftRepo, ruleRepo, workDayRepo, sink);
    this.workDayService = new WorkDayService(workDayRepo, sink);
    this.taskService = new TaskService(taskDefRepo, assignRepo, sink);
    this.eventService = new WorkDayEventService(eventRepo, sink);
    this.reminderService = new ReminderService(reminderRepo, sink);
    this.notificationScheduler = new NotificationScheduler(db);
    this.csvService = new CsvService(
      this.workDayService,
      this.taskService,
      this.configService,
    );

    this.syncService = new SyncService(
      db,
      new GasClient(),
      this.syncQueue,
      this.syncMeta,
      this.changeTracker,
    );

    // Trigger a debounced background sync whenever a local change is enqueued.
    this.changeTracker.onEnqueued = () => this.scheduleBackgroundSync();
  }

  private syncTimer: ReturnType<typeof setTimeout> | null = null;

  /** Debounced, best-effort background sync. Never blocks the UI. */
  private scheduleBackgroundSync(): void {
    if (this.syncTimer) return;
    const schedule = (globalThis as { setTimeout?: typeof setTimeout }).setTimeout;
    if (!schedule) return;
    this.syncTimer = schedule(() => {
      this.syncTimer = null;
      void this.syncService.sync().catch(() => {
        /* stay local-first; errors are reflected in sync state */
      });
    }, 800);
  }

  /** Idempotent first-run seed (C1..C5 + C5 rule + MW). */
  async bootstrap(): Promise<void> {
    await seedIfNeeded(this.db);
  }
}

/** The shared application container (used by the UI). */
export const app = new AppContainer();

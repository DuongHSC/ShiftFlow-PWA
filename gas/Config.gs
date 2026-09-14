/**
 * ShiftFlow GAS Backend — Config.gs
 *
 * Central configuration. The Spreadsheet ID is read from Script Properties
 * (File > Project Settings > Script properties) so it is NOT hard-coded here
 * and no secret lives in source. If unset, the bound spreadsheet is used.
 *
 * Script property (optional):
 *   SPREADSHEET_ID = <the Google Sheet id>
 */
var CONFIG = {
  // Sheet (tab) names.
  SHEETS: {
    WorkDay: 'WorkDays',
    ShiftDefinition: 'Shifts',
    ScheduleRule: 'ScheduleRules',
    TaskDefinition: 'Tasks',
    WorkDayTask: 'WorkDayTasks',
    WorkDayEvent: 'WorkDayEvents',
    ReminderConfiguration: 'Reminders',
    SyncChanges: 'SyncChanges'
  },

  // Entity types that the API accepts.
  ENTITY_TYPES: [
    'WorkDay',
    'ShiftDefinition',
    'ScheduleRule',
    'TaskDefinition',
    'WorkDayTask',
    'WorkDayEvent',
    'ReminderConfiguration'
  ],

  // Max changes returned per pull page.
  PULL_PAGE_SIZE: 500
};

/** Returns the target Spreadsheet (by Script Property id, else bound sheet). */
function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  var bound = SpreadsheetApp.getActiveSpreadsheet();
  if (!bound) {
    throw new Error('No SPREADSHEET_ID script property set and no bound spreadsheet.');
  }
  return bound;
}

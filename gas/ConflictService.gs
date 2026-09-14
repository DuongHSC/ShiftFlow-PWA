/**
 * ShiftFlow GAS Backend — ConflictService.gs
 * Optimistic concurrency check.
 */

/**
 * Decides whether an incoming change conflicts with the current cloud record.
 *
 * Rule: the change's baseVersion must equal the current cloud version.
 *   - No existing record  -> current version 0. baseVersion 0 => OK (CREATE).
 *   - Existing version V  -> baseVersion must equal V, else CONFLICT.
 *
 * Returns { conflict: boolean, currentVersion: number, current: recordOrNull }.
 */
function checkConflict_(current, baseVersion) {
  var currentVersion = current ? current.version : 0;
  return {
    conflict: baseVersion !== currentVersion,
    currentVersion: currentVersion,
    current: current || null
  };
}

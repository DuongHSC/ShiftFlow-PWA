/**
 * ShiftFlow GAS Backend — Validation.gs
 * Validates incoming push changes before they touch the sheets.
 */

var VALID_OPERATIONS = ['CREATE', 'UPDATE', 'DELETE'];

/** Returns null if valid, otherwise an error message string. */
function validateChange_(change) {
  if (!change || typeof change !== 'object') return 'change must be an object';
  if (!change.changeId) return 'missing changeId';
  if (CONFIG.ENTITY_TYPES.indexOf(change.entityType) === -1) {
    return 'invalid entityType: ' + change.entityType;
  }
  if (!change.entityId) return 'missing entityId';
  if (VALID_OPERATIONS.indexOf(change.operation) === -1) {
    return 'invalid operation: ' + change.operation;
  }
  if (typeof change.baseVersion !== 'number' || change.baseVersion < 0) {
    return 'invalid baseVersion';
  }
  if (change.operation !== 'DELETE' && (!change.payload || typeof change.payload !== 'object')) {
    return 'CREATE/UPDATE requires a payload object';
  }
  return null;
}

function validatePushRequest_(body) {
  if (!body || typeof body !== 'object') return 'request body must be an object';
  if (!body.deviceId) return 'missing deviceId';
  if (!Array.isArray(body.changes)) return 'changes must be an array';
  return null;
}

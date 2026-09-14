/**
 * ShiftFlow GAS Backend — Utils.gs
 * Response envelopes, JSON output, UUID, and a simple lock helper.
 */

function ok_(data) {
  return { ok: true, data: data === undefined ? {} : data };
}

function err_(code, message) {
  return { ok: false, error: { code: code, message: String(message || code) } };
}

/** Wraps a value into a ContentService JSON response. */
function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function uuid_() {
  return Utilities.getUuid();
}

function nowIso_() {
  return new Date().toISOString();
}

/**
 * Runs fn while holding the script lock, so concurrent push/pull requests do
 * not corrupt the sheets. Times out safely.
 */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000); // up to 25s
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/** Safe JSON parse; returns null on failure. */
function parseJson_(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

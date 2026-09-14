/**
 * ShiftFlow GAS Backend — SheetRepository.gs
 *
 * Batched access to entity sheets and the SyncChanges log.
 *
 * Entity sheet columns (row 1 = header):
 *   id | version | deleted | modifiedAt | deviceId | payload
 * `payload` is the full domain record as JSON text. Stable UUID `id` is the key
 * (row numbers are NEVER used as IDs).
 *
 * SyncChanges columns:
 *   seq | entityType | entityId | operation | version | deleted | modifiedAt | deviceId | changeId | payload
 */

var ENTITY_HEADER = ['id', 'version', 'deleted', 'modifiedAt', 'deviceId', 'payload'];
var SYNC_HEADER = ['seq', 'entityType', 'entityId', 'operation', 'version', 'deleted', 'modifiedAt', 'deviceId', 'changeId', 'payload'];

function getSheet_(name, header) {
  var ss = getSpreadsheet_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]);
  } else if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, header.length).setValues([header]);
  }
  return sh;
}

function entitySheet_(entityType) {
  return getSheet_(CONFIG.SHEETS[entityType], ENTITY_HEADER);
}

/**
 * Reads an entire entity sheet into a map: id -> { row, id, version, deleted,
 * modifiedAt, deviceId, payload }. row is the 1-based sheet row for updates.
 * Single batch read (no per-cell access).
 */
function readEntityMap_(entityType) {
  var sh = entitySheet_(entityType);
  var last = sh.getLastRow();
  var map = {};
  if (last < 2) return { sheet: sh, map: map };
  var values = sh.getRange(2, 1, last - 1, ENTITY_HEADER.length).getValues();
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var id = String(r[0]);
    if (!id) continue;
    map[id] = {
      row: i + 2,
      id: id,
      version: Number(r[1]) || 0,
      deleted: r[2] === true || r[2] === 'true' || r[2] === 1,
      modifiedAt: String(r[3] || ''),
      deviceId: String(r[4] || ''),
      payload: r[5] ? parseJson_(String(r[5])) : null
    };
  }
  return { sheet: sh, map: map };
}

/** Upserts one entity row (batched single write of the row). */
function writeEntity_(ctx, rec) {
  var rowValues = [
    rec.id,
    rec.version,
    rec.deleted === true,
    rec.modifiedAt,
    rec.deviceId,
    rec.payload ? JSON.stringify(rec.payload) : ''
  ];
  var existing = ctx.map[rec.id];
  if (existing) {
    ctx.sheet.getRange(existing.row, 1, 1, ENTITY_HEADER.length).setValues([rowValues]);
    ctx.map[rec.id] = {
      row: existing.row, id: rec.id, version: rec.version,
      deleted: rec.deleted === true, modifiedAt: rec.modifiedAt,
      deviceId: rec.deviceId, payload: rec.payload
    };
  } else {
    ctx.sheet.appendRow(rowValues);
    ctx.map[rec.id] = {
      row: ctx.sheet.getLastRow(), id: rec.id, version: rec.version,
      deleted: rec.deleted === true, modifiedAt: rec.modifiedAt,
      deviceId: rec.deviceId, payload: rec.payload
    };
  }
}

// ---- SyncChanges log ----

function syncSheet_() {
  return getSheet_(CONFIG.SHEETS.SyncChanges, SYNC_HEADER);
}

/** Next monotonic seq = current max + 1 (single batched read of the seq col). */
function nextSeq_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return 1;
  var seqs = sh.getRange(2, 1, last - 1, 1).getValues();
  var max = 0;
  for (var i = 0; i < seqs.length; i++) {
    var v = Number(seqs[i][0]) || 0;
    if (v > max) max = v;
  }
  return max + 1;
}

/** Whether a changeId was already processed (idempotency). */
function changeIdExists_(sh, changeId) {
  var last = sh.getLastRow();
  if (last < 2) return false;
  var col = sh.getRange(2, 9, last - 1, 1).getValues(); // column 9 = changeId
  for (var i = 0; i < col.length; i++) {
    if (String(col[i][0]) === String(changeId)) return true;
  }
  return false;
}

/** Appends a SyncChanges row and returns its seq. */
function appendSyncChange_(sh, seq, c) {
  sh.appendRow([
    seq,
    c.entityType,
    c.entityId,
    c.operation,
    c.version,
    c.deleted === true,
    c.modifiedAt,
    c.deviceId,
    c.changeId,
    c.payload ? JSON.stringify(c.payload) : ''
  ]);
}

/** Reads SyncChanges rows with seq > since (batched), up to pageSize. */
function readSyncSince_(sh, since, pageSize) {
  var last = sh.getLastRow();
  var out = [];
  if (last < 2) return out;
  var values = sh.getRange(2, 1, last - 1, SYNC_HEADER.length).getValues();
  for (var i = 0; i < values.length; i++) {
    var r = values[i];
    var seq = Number(r[0]) || 0;
    if (seq <= since) continue;
    out.push({
      seq: seq,
      entityType: String(r[1]),
      entityId: String(r[2]),
      operation: String(r[3]),
      version: Number(r[4]) || 0,
      deleted: r[5] === true || r[5] === 'true' || r[5] === 1,
      modifiedAt: String(r[6] || ''),
      deviceId: String(r[7] || ''),
      payload: r[9] ? parseJson_(String(r[9])) : null
    });
  }
  out.sort(function (a, b) { return a.seq - b.seq; });
  if (out.length > pageSize) out = out.slice(0, pageSize);
  return out;
}

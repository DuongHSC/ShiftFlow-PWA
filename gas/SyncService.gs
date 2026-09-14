/**
 * ShiftFlow GAS Backend — SyncService.gs
 * Push (apply changes + idempotency + conflict) and Pull (changes since cursor).
 */

/**
 * POST /sync/push
 * body: { deviceId, changes: [{ changeId, entityType, entityId, operation,
 *                               baseVersion, payload, modifiedAt }] }
 * Returns: { results: [{ changeId, entityId, entityType, status, version?,
 *                        serverVersion?, serverRecord?, message? }] }
 */
function handlePush_(body) {
  var reqErr = validatePushRequest_(body);
  if (reqErr) return err_('INVALID_REQUEST', reqErr);

  return withLock_(function () {
    var syncSh = syncSheet_();
    // Cache one entity map per type touched (batched reads).
    var ctxByType = {};
    function ctxFor(type) {
      if (!ctxByType[type]) ctxByType[type] = readEntityMap_(type);
      return ctxByType[type];
    }

    var results = [];
    var seq = nextSeq_(syncSh);

    for (var i = 0; i < body.changes.length; i++) {
      var c = body.changes[i];
      var vErr = validateChange_(c);
      if (vErr) {
        results.push({
          changeId: c && c.changeId, entityId: c && c.entityId,
          entityType: c && c.entityType, status: 'INVALID', message: vErr
        });
        continue;
      }

      // Idempotency: already processed -> DUPLICATE (do not apply twice).
      if (changeIdExists_(syncSh, c.changeId)) {
        var ctxDup = ctxFor(c.entityType);
        var curDup = ctxDup.map[c.entityId];
        results.push({
          changeId: c.changeId, entityId: c.entityId, entityType: c.entityType,
          status: 'DUPLICATE', version: curDup ? curDup.version : c.baseVersion + 1
        });
        continue;
      }

      var ctx = ctxFor(c.entityType);
      var current = ctx.map[c.entityId] || null;
      var conflict = checkConflict_(current, c.baseVersion);

      if (conflict.conflict) {
        results.push({
          changeId: c.changeId, entityId: c.entityId, entityType: c.entityType,
          status: 'CONFLICT',
          serverVersion: conflict.currentVersion,
          serverRecord: conflict.current ? conflict.current.payload : null
        });
        continue;
      }

      // Apply: version increments from the agreed base.
      var newVersion = c.baseVersion + 1;
      var deleted = c.operation === 'DELETE';
      var rec = {
        id: c.entityId,
        version: newVersion,
        deleted: deleted,
        modifiedAt: c.modifiedAt || nowIso_(),
        deviceId: body.deviceId,
        payload: deleted ? (current ? current.payload : null) : c.payload
      };
      writeEntity_(ctx, rec);

      appendSyncChange_(syncSh, seq, {
        entityType: c.entityType,
        entityId: c.entityId,
        operation: c.operation,
        version: newVersion,
        deleted: deleted,
        modifiedAt: rec.modifiedAt,
        deviceId: body.deviceId,
        changeId: c.changeId,
        payload: rec.payload
      });
      seq += 1;

      results.push({
        changeId: c.changeId, entityId: c.entityId, entityType: c.entityType,
        status: 'APPLIED', version: newVersion
      });
    }

    return ok_({ results: results });
  });
}

/**
 * GET/POST /sync/pull  (since = last cursor)
 * Returns: { changes: [...], nextCursor }
 */
function handlePull_(body) {
  var since = Number((body && body.since) || 0) || 0;
  return withLock_(function () {
    var syncSh = syncSheet_();
    var changes = readSyncSince_(syncSh, since, CONFIG.PULL_PAGE_SIZE);
    var nextCursor = String(since);
    if (changes.length > 0) {
      nextCursor = String(changes[changes.length - 1].seq);
    }
    return ok_({ changes: changes, nextCursor: nextCursor });
  });
}

function handleHealth_() {
  return ok_({ status: 'healthy' });
}

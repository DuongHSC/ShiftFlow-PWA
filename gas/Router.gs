/**
 * ShiftFlow GAS Backend — Router.gs
 * Dispatches an { action, ... } request to the right handler. Never leaks raw
 * exceptions — everything is wrapped in the ok/err envelope.
 */
function route_(body) {
  try {
    var action = body && body.action;
    switch (action) {
      case 'health':
        return handleHealth_();
      case 'push':
        return handlePush_(body);
      case 'pull':
        return handlePull_(body);
      default:
        return err_('UNKNOWN_ACTION', 'Unknown action: ' + action);
    }
  } catch (e) {
    // Do not expose raw stack/exception details to the client.
    return err_('INTERNAL', 'Internal server error');
  }
}

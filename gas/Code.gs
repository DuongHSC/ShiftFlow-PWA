/**
 * ShiftFlow GAS Backend — Code.gs  (Web App entry points)
 *
 * The PWA posts JSON `{ action, ... }` to the Web App URL. Apps Script Web Apps
 * expose doGet/doPost; we route both to the same dispatcher.
 *
 * DEPLOY:
 *   1. Create/attach a Google Sheet; put its id in Script property SPREADSHEET_ID
 *      (or bind the script to that sheet).
 *   2. Deploy > New deployment > Web app.
 *      - Execute as: Me
 *      - Who has access: Anyone  (the URL is the only "secret"; no user data
 *        is exposed without a valid request, and this is a personal app).
 *   3. Copy the /exec URL into the PWA (Settings) or VITE_GAS_API_URL.
 */

function doGet(e) {
  // Health check convenience: GET ?action=health
  var body = (e && e.parameter) ? e.parameter : {};
  if (!body.action) body.action = 'health';
  return jsonOut_(route_(body));
}

function doPost(e) {
  var body = {};
  if (e && e.postData && e.postData.contents) {
    body = parseJson_(e.postData.contents) || {};
  }
  return jsonOut_(route_(body));
}

// queue/apps-script.gs - Radar Lookup queue v2. Deploy as Web App (execute as me, access: anyone).
// Bound to a Google Sheet with header row: timestamp | type | query | status | detail
// Statuses: pending -> running -> done | failed
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var out = { ok: false };
  try {
    var d = JSON.parse(e.postData.contents);
    if (d.action === 'update') {
      // {action:'update', row: N, status:'running'|'done'|'failed', detail?: 'lookups/x.html'}
      var r = parseInt(d.row, 10);
      if (r >= 2 && ['pending', 'running', 'done', 'failed'].indexOf(d.status) !== -1) {
        sheet.getRange(r, 4).setValue(d.status);
        if (d.detail !== undefined) sheet.getRange(r, 5).setValue(String(d.detail).slice(0, 300));
        out.ok = true;
      }
    } else {
      // default: add. {type:'url'|'search', query:'...'}
      if (d.query && (d.type === 'url' || d.type === 'search')) {
        sheet.appendRow([new Date(), d.type, String(d.query).slice(0, 300), 'pending', '']);
        out.ok = true;
      }
    }
  } catch (err) {}
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}
function doGet() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var rows = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    out.push({ row: i + 1, ts: rows[i][0], type: rows[i][1], query: rows[i][2],
               status: rows[i][3], detail: rows[i][4] || '' });
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

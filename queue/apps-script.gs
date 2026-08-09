// queue/apps-script.gs - Radar Lookup queue. Deploy as Web App (execute as me, access: anyone).
// Bound to a Google Sheet with header row: timestamp | type | query | status
function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  try {
    var d = JSON.parse(e.postData.contents);
    if (!d.query || (d.type !== 'url' && d.type !== 'search')) throw new Error('bad payload');
    sheet.appendRow([new Date(), d.type, String(d.query).slice(0, 300), 'pending']);
    return ContentService.createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
function doGet() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  var rows = sheet.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    out.push({ row: i + 1, ts: rows[i][0], type: rows[i][1], query: rows[i][2], status: rows[i][3] });
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

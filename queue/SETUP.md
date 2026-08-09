# Radar Lookup queue - one-time setup (2 minutes, JJ's PERSONAL Google account)

1. In jack.jj.gilmore@gmail.com, create a Google Sheet named "Radar Lookup Queue".
   Row 1 headers: timestamp | type | query | status
2. Extensions -> Apps Script. Delete boilerplate, paste queue/apps-script.gs. Save.
3. Deploy -> New deployment -> type: Web app -> Execute as: Me -> Who has access: Anyone. Deploy.
4. Authorize when prompted. Copy the /exec URL.
5. Give the URL to Claude ("here's the queue endpoint: ...") - it goes into
   QUEUE_ENDPOINT in lookup.js, then redeploy.

Until this is done, queueing still works per-device via localStorage.
Never use the ASAAR Google account for this.

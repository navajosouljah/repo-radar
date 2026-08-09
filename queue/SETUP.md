# Radar Lookup queue - one-time setup (2 minutes, JJ's PERSONAL Google account)

1. In jack.jj.gilmore@gmail.com, create a Google Sheet named "Radar Lookup Queue".
   Row 1 headers: timestamp | type | query | status | detail
2. Extensions -> Apps Script. Delete boilerplate, paste queue/apps-script.gs. Save.
3. Deploy -> New deployment -> type: Web app -> Execute as: Me -> Who has access: Anyone. Deploy.
4. Authorize when prompted. Copy the /exec URL.
5. Give the URL to Claude ("here's the queue endpoint: ...") - Claude then:
   - puts it in QUEUE_ENDPOINT in lookup.js and redeploys the site
   - installs the auto-runner: copies queue/com.jjgilmore.repo-lookup-runner.plist
     to ~/Library/LaunchAgents/ and loads it (launchctl)
   - runs a live end-to-end test

## How it works after setup
- Queue buttons on the site write rows to the Sheet (status: pending).
- The runner (launchd, every 2 min while this Mac is awake) sees pending rows and
  spawns a headless Claude session that drains the queue, marking each row
  running -> done (with the page path) or failed (with a reason).
- The Library page polls the queue every 15s and shows Queued / Running / Live / Failed.

Notes:
- Runner only fires while this Mac is awake. Cloud backstop (hourly remote agent) is a
  later upgrade if needed.
- Until setup is done, queueing still works per-device via localStorage; nothing processes.
- Never use the ASAAR Google account for this.

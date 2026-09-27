# Repo Radar - rules for any Claude session in this folder

JJ's weekly radar of open-source tools worth knowing, live at https://repo-radar-weekly.vercel.app
(Vercel project `repo-radar`, team my-honey-co). GitHub `navajosouljah/repo-radar`, branch `main`.

## Non-negotiable

1. **Ship only with `scripts/ship.sh "message"`.** It syncs with GitHub, builds, verifies and pushes.
   The push deploys. **Never run `vercel deploy`.** A laptop deploy is silently overwritten by the
   next GitHub deploy, which is how the Aug 28 2026 security purge was undone on Sep 4.
2. **Every repo passes the security gate before it appears anywhere on the site.** That includes a
   page, a list row, the Claude Board, and a link that recommends it. The procedure is
   `docs/SECURITY_GATE.md`, the tool is `scripts/gate.mjs`, and the evidence goes in
   `data/gate-log.json`. A repo in `data/blocklist.json` never appears. Star count is never
   evidence of safety.
3. **Never invent** a number, person, post, URL or quote. Missing data says "no data found".
4. **No em dashes.** Use " - " for asides. Numbers are human-readable (85K, 1.2M). Dates are the
   publish date.

## Where things are
- `editions/YYYY-MM-DD/` holds the weekly editions (index plus one page per repo). `lookups/` holds
  on-demand briefings. `index.html` is the hub. `archive.html` lists every edition.
- `docs/SECURITY_GATE.md` is the gate. `docs/routine-prompt-v1.md` and `v2.md` record the Friday cloud
  routine's instructions.
- `scripts/catalog.mjs` lists every repo the site recommends. `gate.mjs` and `gate-recheck.mjs` run
  the gate. `ship.sh` deploys.

## The Friday routine
- A claude.ai cloud routine, `trig_01PhYQSJtUnr7YMPgBZErRJR` ("Repo Radar Weekly Edition"), runs
  Fridays at 12:00 UTC (6 AM Mountain). It clones this repo, builds the edition and pushes `main`.
- It reads this repo, not JJ's local skills, so rules it must follow live here in `docs/`.
- Change its instructions with RemoteTrigger `update` (prompt only), and save each version in
  `docs/`.

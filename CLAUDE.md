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
5. **The Friday run never edits the checker or the rules**: nothing in `scripts/`, and not this
   file, `docs/SECURITY_GATE.md`, `docs/EDITION_PLAYBOOK.md` or `docs/DATA_FORMAT.md`. A blocked
   check means stop and report, never a new exception. `verify.mjs` refuses a push that adds an
   edition and changes any of them, so script and rule changes ship on their own, from a session JJ
   is in. (Oct 2 2026: the run added an "under review" exception to the builder and the checker and
   kept KiroCrew, which had an open security advisory, on the site with its install steps.)

## How editions are made
The Friday job is `docs/EDITION_PLAYBOOK.md`. Pages are built from data (`docs/DATA_FORMAT.md`)
by `scripts/build.mjs`. Never hand-edit a generated page: change the data or the template, then
rebuild. Design context: `PRODUCT.md` (who it's for and the principles).

## Where things are
- `editions/YYYY-MM-DD/` holds the weekly editions (index plus one page per repo). `lookups/` holds
  on-demand briefings. `index.html` is the hub. `archive.html` lists every edition.
- `docs/SECURITY_GATE.md` is the gate. `docs/routine-prompt-v1.md` to `v4.md` record the Friday cloud
  routine's instructions. `docs/reports/<date>.md` is each Friday's saved report: read its
  "Needs JJ" section first. A line there that says "re-check from the Mac" is a job for any session
  on this Mac: run the command it gives (the API gate sees fixed versions the cloud can't), restore
  what passes, keep down what fails, and ship.
- `scripts/catalog.mjs` lists every repo the site recommends. `gate.mjs` runs the gate (and the
  weekly `--recheck`); `gate-recheck.mjs` is its Mac-only second look. `public-pages.mjs` reads
  GitHub's public pages when the API isn't there (the cloud). `candidates.mjs` gathers and scores
  the week's candidates (its GitHub search for the newest repos finds candidates only; it never
  counts as an independent source). `picks-lib.mjs` holds the gain cap and the line each Top 10
  card shows in place of total stars. `shots.mjs` finds a real picture of a product. `build.mjs` makes pages from
  data. `verify.mjs` and the `*.test.mjs` tests must pass. `ship.sh` deploys.
- `data/tips.md`: repos JJ spotted himself. When he says "add <repo> to the radar tips", append it
  there; the Friday run must evaluate it.

## The Friday routine
- A claude.ai cloud routine, `trig_01PhYQSJtUnr7YMPgBZErRJR` ("Repo Radar Weekly Edition"), runs
  Fridays at 12:00 UTC (6 AM Mountain). It clones this repo, builds the edition and pushes `main`.
- It reads this repo, not JJ's local skills, so rules it must follow live here in `docs/`.
- Change its instructions with RemoteTrigger `update` (prompt only), and save each version in
  `docs/`.

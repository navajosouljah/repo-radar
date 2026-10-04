# Repo Radar security gate

**Every repo passes this gate before it appears anywhere on the site**: a weekly Top 10 page, the
hub's Top 10, a Category Radar row, the Claude Board, an "Also this week" line, a lookup page, or a
link that recommends it as an alternative. Star count is never evidence of safety. JJ's rule, locked
Aug 28-29 2026 after CowAgent (confirmed remote-code flaw) was recommended as neutral; hardened
Sep 27 2026 after the purge was silently undone and ZCode was ranked #5.

## The four checks

1. **Blocklist.** Read `data/blocklist.json`. A repo listed there can never appear anywhere on the
   site: not picked, not listed, not linked as a recommendation. `verify.mjs` goes one step further
   (JJ, Oct 3 2026): no page may link a blocklisted repo at all, in any form of link (a deep link to
   an issue, a second link, a source). The one exception is that repo's own DO NOT INSTALL page, and
   a page counts as one only when its repo has a FAIL in the gate log; the words on their own excuse
   nothing. Links to other repos as plain citations stay ungated. Each entry has a `kind`:
   - `open-advisories`: it comes off the list automatically when a later full gate passes (the
     maintainers shipped fixes).
   - `conduct` (malware, scam, secret data upload, impersonation): only JJ can take it off.
2. **Advisories.** List the repo's published security advisories.
   - `scripts/gate.mjs` does this. On a Mac with `gh` signed in it uses the GitHub API. In the cloud
     routine (no API, no `gh`) it reads the public pages instead:
     `https://github.com/OWNER/REPO/security/advisories` and each advisory's own page. Same
     advisories, same rules (checked Sep 27 2026 against the API).
   - The public list shows 10 advisories per page. Reading it by hand in the Sep 27 2026 dry run
     missed one of OpenMAIC's 11, which is why the script, not a person, reads it.
   - For each advisory, find its **fix**. Any of these counts:
     - a patched version in the advisory data;
     - a version in the text ("fixed in 1.2.3", "before 1.2.3", "1.2.3 is the first patched
       version");
     - a strict `< 1.2.3` affected range;
     - a fix commit ("prior to commit abc1234");
     - a fix pull request linked from the record.
   - A fix confirmed by the original researcher's public disclosure also counts. Cite the disclosure
     (example: Check Point confirmed Codex CLI 0.23.0 fixed CVE-2025-61260).
   - The fix must already be **published**:
     - The latest version on the package registry the advisory names (npm, PyPI, crates.io, Go,
       Packagist, RubyGems), a GitHub release, or a published Docker image tag counts.
     - For a fix commit, the latest release must contain that commit, or the merge commit of the PR
       that carried it (a squash merge changes the commit ID).
     - For a fix pull request, the PR must be merged and its merge commit must be in the latest
       release. An unmerged PR is not a fix (for example laravel-crm's PR #2466).
   - An affected range written as `<= X` with no fix listed is **not** a fix.
   - A pre-release (alpha, beta) is not a published fix.
   - **A disputed fix must be resolved first.** When an issue or post says a published fix isn't in the
     shipped code, find the maintainers' answer before deciding.
     - If the hole is still open: FAIL.
     - If what remains is a setup requirement (for example, OpenMAIC stays open to anyone unless
       `ACCESS_CODE` is set; confirmed in issue #1587): PASS, and that requirement becomes a
       **mandatory watch-out** on the page.
   - Many advisories in a short window (for example, 11 in a month) is itself a watch-out the page
     must name, even when all are fixed.
   - When two checks disagree (a helper agent says FAIL, the log says PASS), the evidence decides:
     re-read the advisories and issues, record which way it went and why in the log's
     `settled.note`. An older log entry is never evidence on its own: in the Sep 27 2026 dry run
     the cloud agent dismissed a fresh FAIL because "the existing entry says PASS".
3. **Searches.** Search `OWNER/REPO CVE`, `OWNER/REPO vulnerability`, `OWNER/REPO malware` and
   `OWNER/REPO scam`.
   - The national CVE database (NVD) is also searched for every repo, locally and in the cloud.
     Web search alone missed firecrawl's CVE-2026-32857 (a high-severity flaw) on Sep 27 2026. If
     the CVE database can't be reached, the verdict is REVIEW, never PASS.
   - Hacker News is a keyword search, so a hit there counts only when it names the repo's owner or
     links the repo (a repo called "atlas" otherwise matches news about "Cloud Atlas" hackers).
   - A CVE record that names this repo is checked the same way as an advisory, through GitHub's
     global advisory database (the API on a Mac, `github.com/advisories` in the cloud).
   - A record counts against the repo when its source repo is this project, or when its own words or
     links name the project. A record about something else does not count, and the log says so; for
     example, a Go standard-library issue that turned up in a search for dagger. A record that links
     only a sibling repo of the same owner is about the sibling (firecrawl-mcp-server's CVE is not
     firecrawl's). The rule lives in `scripts/gate-lib.mjs` and is tested in
     `scripts/gate-lib.test.mjs`.
   - News or community reports of malware, a scam, a supply-chain compromise, or silent data upload
     are read in full, and a credible one is a FAIL.
   - Automated scanner scores (Mondoo, ClawSecure, Socket and similar) are recorded as information
     only. They are often false positives, so they never decide the verdict on their own.
4. **Activity.** Compare stars with contributors, commit history, watchers and issue discussion.
   Huge stars on 1-2 contributors or a handful of commits is a red flag that must be named on the
   page. A code drop that can't be tied to the distributed app counts against verification.

## The verdict is binary

- **PASS:** no open advisory or CVE, no credible malware, scam or data-exfiltration report, and the
  repo is the real project it claims to be.
- **FAIL:** anything else.
  - Drop the repo and take the next candidate; a Top 3 never ranks a FAIL with a caveat.
  - Add it to `data/blocklist.json` as `{"repo", "date", "reason"}`.
  - Only if leaving it out would look like a gap (it is in the news), publish a red **DO NOT
    INSTALL** page instead, never a normal page with a watch-out.
- **Can't check** (a page or source can't be reached): the repo is not published this week.
  "Not checked" is never an acceptable state for a published page.

## Evidence

Record every verdict in `data/gate-log.json`, keyed by `OWNER/REPO`:

```json
{
  "repo": "OWNER/REPO",
  "checked": "YYYY-MM-DD",
  "verdict": "PASS",
  "checks": {
    "advisories": { "source": "github-api | public-page", "url": "...", "count": 0, "items": [] },
    "searches": { "queries": ["..."], "results": 0, "hits": [], "notes": "..." },
    "activity": { "stars": 0, "contributors": 0, "commits": 0, "flags": [] }
  }
}
```

A PASS without advisory evidence (source, url, count) is invalid, and verify rejects it.

Every published repo page shows a **Safe to install** block with:
- the date and the verdict;
- the advisories checked (link and count);
- the four searches and what came back;
- the activity numbers and any flags.

## Rulings

A REVIEW is settled by a ruling: `node scripts/gate.mjs --settle owner/repo PASS|FAIL "why"`. A
ruling carries over later re-gates only while nothing new turns up: every advisory, CVE, report and
activity flag behind the new automatic verdict must already have been in front of whoever ruled,
and every check must have run. Anything new sends it back for a new ruling. (The rule is
`newConcerns` in `scripts/gate-lib.mjs`, with tests.)

### What the Friday routine may settle

The cloud routine runs unattended, so it may rule only on the harmless kind of REVIEW:

- **May settle PASS** when every reason is a search hit or an activity flag, and each hit is the
  repo's own page, an automated scanner score, or text that isn't about a security problem in this
  repo. The note cites each hit and why it doesn't count, and the command ends with `--by routine`.
  Every such ruling goes in the Friday report.
- **May settle FAIL** on a credible report of malware, a scam, or code or data taken without consent,
  citing it (`--by routine`).
- **Never settles** an advisory or CVE reason, a check that failed to run, or a fresh FAIL that an
  older log entry disagrees with. Those repos don't appear that week: a new pick is replaced by the
  next candidate, and a listed repo comes down (not blocklisted). The report names each one for JJ.

## Re-checks

- **Every Friday:** `node scripts/gate.mjs --recheck` re-reads the advisories of every repo shown
  anywhere on the site. A repo with a new advisory is gated again in full.
- **Rolling full gate:** the same run fully re-gates up to 60 listed repos whose last full gate is
  14 or more days old, oldest first. The build refuses a gate older than 30 days, so every listed
  repo is fully re-checked at least monthly.
- A new FAIL comes down everywhere it appears and goes on the blocklist.

## Shipping

- Ship only through `scripts/ship.sh` (pull, build, verify, push to GitHub), which deploys through
  GitHub.
- Never run `vercel deploy` from a laptop. A laptop deploy is silently overwritten by the next GitHub
  deploy; that is how the Aug 28 purge was undone.

## Tools

- `node scripts/gate.mjs owner/repo` gates repos and writes evidence (API or public pages,
  automatically; `--web` forces the public pages).
- `node scripts/gate.mjs --recheck` is the weekly re-check described above.
- `node scripts/gate.mjs --settle owner/repo PASS|FAIL "why"` records a ruling (`--by routine` when
  the Friday routine makes it).
- `node scripts/gate-recheck.mjs` re-reads open items against registries, releases, fix commits and
  fix pull requests. It needs the GitHub API, so it runs on a Mac only; in the cloud it refuses.
- `node scripts/catalog.mjs` lists every repo the live site recommends.
- `node --test scripts/*.test.mjs` runs the gate rule tests (they must pass before any ship).

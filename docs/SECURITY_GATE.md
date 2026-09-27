# Repo Radar security gate

**Every repo passes this gate before it appears anywhere on the site**: a weekly Top 10 page, the
hub's Top 10, a Category Radar row, the Claude Board, an "Also this week" line, a lookup page, or a
link that recommends it as an alternative. Star count is never evidence of safety. JJ's rule, locked
Aug 28-29 2026 after CowAgent (confirmed remote-code flaw) was recommended as neutral; hardened
Sep 27 2026 after the purge was silently undone and ZCode was ranked #5.

## The four checks

1. **Blocklist.** Read `data/blocklist.json`. A repo listed there can never appear anywhere on the
   site: not picked, not listed, not linked as a recommendation. Removing a repo from the blocklist is
   JJ's call only.
2. **Advisories.** List the repo's published security advisories.
   - Local: `gh api repos/OWNER/REPO/security-advisories`.
   - Cloud routine (direct GitHub API calls are blocked there): WebFetch
     `https://github.com/OWNER/REPO/security/advisories`. This public page lists the same advisories
     (checked Sep 27 2026: CowAgent 1, pi 4, impeccable 0 on both).
   - For each advisory, find its **fix**: a patched version in the advisory data; a version in the
     text ("fixed in 1.2.3", "before 1.2.3", "1.2.3 is the first patched version"); a strict `< 1.2.3`
     affected range; or a fix commit ("prior to commit abc1234").
   - The fix must already be **published**:
     - The latest version on the package registry the advisory names (npm, PyPI, crates.io, Go,
       Packagist, RubyGems), a GitHub release, or a published Docker image tag counts.
     - For a fix commit, the latest release must contain that commit, or the merge commit of the PR
       that carried it (a squash merge changes the commit ID).
   - An affected range written as `<= X` with no fix listed is **not** a fix.
   - A pre-release (alpha, beta) is not a published fix.
3. **Searches.** Search `OWNER/REPO CVE`, `OWNER/REPO vulnerability`, `OWNER/REPO malware` and
   `OWNER/REPO scam`.
   - A CVE record that names this repo is checked the same way as an advisory (GitHub's global
     advisory database first: `gh api "advisories?cve_id=CVE-..."`).
   - An unreviewed record with no package and no source repo (for example a Go standard-library
     issue that happens to mention the project) does not count against the repo. Say so in the log.
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

## Re-checks

- **Every Friday:** re-check advisories for every repo currently shown anywhere on the site.
- **First Friday of the month:** the full four-check gate for every listed repo.
- A new FAIL comes down everywhere it appears and goes on the blocklist.

## Shipping

- Ship only through `scripts/ship.sh` (pull, build, verify, push to GitHub), which deploys through
  GitHub.
- Never run `vercel deploy` from a laptop. A laptop deploy is silently overwritten by the next GitHub
  deploy; that is how the Aug 28 purge was undone.

## Tools

- `node scripts/gate.mjs owner/repo` gates repos locally and writes evidence.
- `node scripts/gate-recheck.mjs` re-reads open items against registries and releases.
- `node scripts/gate.mjs --settle owner/repo PASS|FAIL "why"` records a human verdict on a REVIEW.
- `node scripts/catalog.mjs` lists every repo the live site recommends.

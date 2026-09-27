# Repo Radar: the Friday edition playbook

This is the whole weekly job. The cloud routine ("Repo Radar Weekly Edition", Fridays 12:00 UTC)
follows it exactly. Edit this file to change how editions are made; the routine's prompt only points
here. The reader is JJ: a non-coder executive and a very visual learner who wants tools he can use.

## 0. Before anything

Read these, in this order: `CLAUDE.md`, `docs/SECURITY_GATE.md`, `docs/DATA_FORMAT.md`,
`PRODUCT.md`, then this file.

**Non-negotiables. Breaking any one means you do not push.**
1. Every repo passes the security gate before it appears anywhere: a pick, a list row, a Claude
   Board row, or an alternative. A repo in `data/blocklist.json` never appears.
2. Never invent a number, person, post, URL or quote. Missing data says "no data found".
3. `node scripts/verify.mjs` and `node --test scripts/*.test.mjs` pass, or you do not push.
4. No em or en dashes. Use " - " for asides. Numbers are human-readable (85K). Dates are this
   Friday's date.
5. Ship only with `scripts/ship.sh "Repo Radar Edition NNN: <date>"`.

Your sandbox blocks direct calls to `api.github.com`. Use your GitHub tool for repo facts, and
WebFetch for GitHub web pages (advisories, READMEs).

## 1. Gather candidates

Run `node scripts/candidates.mjs <this Friday's date>`. It scans GitHub Trending, Trendshift,
skills.sh, findarepo, Hacker News and `data/tips.md`, scores every repo, applies the floors and the
8-week cool-down, and writes `data/candidates/<date>.json`.

- The first output line lists each source as `ok` or `NO`. For every `NO`, open the source's page with
  WebFetch (URLs are in the appendix) and add what you find to the candidates file by hand, with the
  same fields.
- A source you still can't reach stays listed as "not scanned this week" in the edition's `method`
  line. Never drop it silently.
- **Fail closed:** if fewer than 3 of the 7 sources were scanned, stop. Do not push. Report which
  sources failed.
- Enrichment (stars, created, pushed) needs `gh`, which the cloud doesn't have. For the top 40
  candidates, fill `created`, `pushed` and current stars from your GitHub tool.
- YouTube: search for this week's "GitHub repos" videos from Github Awesome, The Next New Thing,
  Fireship, AI LABS, Chase AI and Better Stack. A repo named in a video with 25K+ views gets
  `sources.youtube`.

## 2. Safety re-check of everything already on the site

- Every Friday: for every repo in `node scripts/catalog.mjs --json`, re-read its public advisories
  page (`https://github.com/<o>/<r>/security/advisories`).
- First Friday of the month: run the full four-check gate on all of them.
- A repo that now fails comes down everywhere (page removed, rows removed, archive name removed) and
  goes on the blocklist. Say so in the edition's `method` line.

## 3. Choose the 10

From candidates that clear every floor (at least 3K stars; at least 1.5K stars in 7 days or 5K in
30; at least 2 independent sources; a commit in the last 30 days; not blocklisted; not featured in
the last 8 weeks; stars look earned):

- **Slots:** 6 by score, 3 "new this week" (under 45 days old), and 1 "still climbing" (over 90 days
  old, with the biggest 30-day gain).
- **JJ's lens:** label each pick `you`, `developers` or `news` (see DATA_FORMAT.md). At least 7 of
  the 10 are `you`, and at most 3 are `developers`. A `news` repo goes on the "Also this week" line
  instead of a slot.
- **Tips:** every repo in `data/tips.md` gets evaluated. If it doesn't make the 10, the `method`
  line says why in a few words.
- Ties go to the repo with more independent coverage.

## 4. Gate every repo that will appear

This covers the 10 picks, every alternative you plan to name, every Category Radar row and every
Claude Board row. Follow `docs/SECURITY_GATE.md` exactly and record each verdict in
`data/gate-log.json`. A FAIL is replaced by the next candidate. Only if its absence would look like a
gap (it's in the news) does it go in as a `status: "fail"` pick with a red DO NOT INSTALL page.

## 5. Write each answer sheet

For each pick, write `data/editions/<date>/<slug>.json` (format in DATA_FORMAT.md). Research in this
order:
1. **README and website:** what it is, the real demo, the homepage. Use WebFetch.
2. **The visual:** the product's own screenshot, GIF or demo frame (README images, the website's
   `og:image`). A real picture beats any description. If there is none, leave `visual` out; the page
   says so honestly.
3. **The board:** 4 notes, *your problem -> you give it -> it does -> you get*. The example comes
   from the product's own demo or docs, never made up.
4. **Real uses:** posts, videos and threads where someone used it, dated and cited. For
   `fit: "you"`, favor non-developer roles.
5. **Coverage:** Hacker News (points), YouTube (views), blogs, and critical takes too.
6. **Try it:** 3 plain steps. `paste` always starts with `/skillspector https://github.com/<o>/<r>`,
   then install and run its own demo, 10 minutes max.

**The writing test** (verify enforces the jargon rule):
- Could a smart non-coder repeat the tagline to a colleague? If not, rewrite it.
- Compare to something people know: a product, a bill, a job.
- No jargon in the tagline, sentence, board or before/after unless it is explained right next to
  it.
- Say what is early, thin or disputed, plainly.

Then write `data/editions/<date>/edition.json`: the number, a one-line theme that ties the week
together, the `method` line (sources scanned, what was pulled for safety, what happened to tips), and
the 10 picks.

## 6. Refresh the lists in `data/hub.json`

- **Category Radar:** 11 lanes, 3 each.
  - Build each lane's pool from GitHub topics, skills.sh topic pages and this week's candidates.
  - Rank by 50% 30-day star gain, 25% adoption (installs or downloads) and 25% total stars.
  - Gate every row. Fewer than 3 cleared means the page says the slot is open.
  - Design & Branding includes AI design skills (impeccable, taste-skill, ui-ux-pro-max and whatever
    rises).
- **Claude Board:** the 10 most-installed Claude skills and plugins.
  - Use each repo's total from its skills.sh page (`https://skills.sh/<o>/<r>`, "N total installs").
  - A repo needs 1K+ GitHub stars, is not a vendor-only pack, and passes the gate.
- **Growth history:** `scripts/candidates.mjs` already appended this week's stars to `metrics.json`.
  Commit it.

## 7. Build, verify, ship

1. `node scripts/build.mjs --edition <date> --hub`. It refuses to build if any repo lacks a PASS.
   Fix the cause; never work around it.
2. Add the previous edition to `archive.html`.
3. `node --test scripts/*.test.mjs` and `node scripts/verify.mjs` must pass.
4. `scripts/ship.sh "Repo Radar Edition NNN: <date>"`.

## 8. Report

Finish with a short summary:
- the 10 picks, with their fit and the one number that matters for each;
- which sources were scanned and which were not;
- what the gate pulled, and why;
- what happened to each tip.

## Appendix: sources

| # | Source | URL | Notes |
|---|---|---|---|
| 1 | GitHub Trending | `https://github.com/trending?since=daily|weekly|monthly`, plus `/javascript`, `/typescript`, `/python` | Each `<article class="Box-row">` has the repo, "N stars this week", and total stars |
| 2 | Trendshift | `https://trendshift.io/` and `/monthly` | `href="/repositories/ID">owner/repo` |
| 3 | skills.sh | `https://skills.sh/`, `/trending`, `/hot`; per repo `https://skills.sh/<o>/<r>` | Per-skill installs; repo pages give "N total installs" |
| 4 | findarepo | `https://findarepo.com/digest/<date>/`; per repo `https://findarepo.com/repo/<o>/<r>/` | Digests list the day's risers; repo pages give measured stars a day and a star-credibility check |
| 5 | Hacker News | `https://hn.algolia.com/api/v1/search?query=github.com&tags=story&numericFilters=created_at_i%3E<unix>,points%3E100` | URL-encode `>` as `%3E` |
| 6 | YouTube | web search for the named channels, last 14 days | 25K+ views; repo named or linked |
| 7 | npm / PyPI | `https://api.npmjs.org/downloads/point/last-month/<pkg>`, `https://pypistats.org/api/packages/<pkg>/recent` | Only for repos that publish a package |

If a page won't load through a plain request, `https://r.jina.ai/<url>` often returns readable text.

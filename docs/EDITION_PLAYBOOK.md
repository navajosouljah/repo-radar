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
6. Never edit `data/gate-log.json` or `data/blocklist.json` by hand. The gate script writes them.

Your sandbox blocks `api.github.com` and has no `gh`. You don't need either: every script here reads
GitHub's public pages instead, automatically. Use your GitHub tool only when a script says a fact is
missing, and WebFetch for reading pages yourself.

## 1. Gather candidates

Run `node scripts/candidates.mjs <this Friday's date>`. It scans GitHub Trending, Trendshift,
skills.sh, findarepo, Hacker News and `data/tips.md`, reads every candidate on GitHub (stars, age,
last commit), scores them, applies the floors and the 8-week cool-down, and writes
`data/candidates/<date>.json`.

- The first line says how many of the 6 discovery sources were reached. For each `NO`, try its page
  with WebFetch (URLs in the appendix). If you can read it, add what you find to the candidates file
  with the same fields, then run `node scripts/candidates.mjs <date> --rescore`.
- A source you still can't reach is listed as "not scanned this week" in the edition's `method`
  line. Never drop it silently.
- **Fail closed:** if the script prints `FAIL CLOSED` (fewer than 3 discovery sources reached), stop.
  Do not push. Report which sources failed.
- **YouTube** can't be read from the cloud (it answers with a CAPTCHA). Don't add YouTube coverage
  from search results unless the page you actually read shows the view count. Otherwise the `method`
  line says YouTube was not scanned.
- If it prints **"Missing facts only"**, look those repos up with your GitHub tool and write the
  facts to `data/candidates/<date>.facts.json` as
  `{"owner/repo": {"created": "YYYY-MM-DD", "pushed": "YYYY-MM-DD", "stars": 12345}}`, then run
  `--rescore`. A repo whose facts you can't find stays out.

## 2. Safety re-check of everything already on the site

Run `node scripts/gate.mjs --recheck`. For every repo the site lists, it re-reads the security
advisories. A repo with a new advisory is gated again in full, and so are up to 60 repos whose last
full gate is 14 or more days old, oldest first. The build refuses any gate older than 30 days, so
this rolling refresh keeps the site shippable.

- "Could not read": retry those with `node scripts/gate.mjs --recheck owner/repo ...`. Any still
  unreadable stay as they are, and the report lists them as not re-checked this week.
- A repo that is now **FAIL** comes down everywhere this week: its page, its rows, and its name in
  the archive. It is already on the blocklist. Say so in the `method` line.
- A repo that is now **REVIEW**: follow "What the Friday routine may settle" in
  `docs/SECURITY_GATE.md`. If you may not settle it, it comes down this week (not blocklisted), and
  the report names it for JJ.

## 3. Choose the 10

From candidates that clear every floor (at least 3K stars; at least 1.5K stars in 7 days or 5K in
30; at least 2 independent sources; a commit in the last 30 days; not blocklisted; not featured in
the last 8 weeks; stars look earned):

- **Slots:** 6 by score, 3 "new this week" (under 45 days old), and 1 "still climbing" (over 90 days
  old, with the biggest 30-day gain). The script prints each pool. When a pool has fewer repos than
  it has slots, fill the rest by score, and the `method` line says so.
- **Fewer than 10 clear:** publish the ones that do and say so in the `method` line. Never lower a
  floor to fill a slot.
- **JJ's lens:** label each pick `you`, `developers` or `news` (definitions in DATA_FORMAT.md). At
  least 7 of the 10 are `you`, and at most 3 are `developers`. A `news` repo goes on the "Also this
  week" line instead of a slot. A tool built for AI agents that JJ drives by asking Claude Code
  (HyperFrames makes videos this way) is `you`, not `developers`.
- **Tips:** every repo in `data/tips.md` gets evaluated. If it doesn't make the 10, the `method`
  line says why in a few words.
- Ties go to the repo with more independent coverage.

## 4. Gate every repo that will appear

This covers the 10 picks, every alternative you plan to name, and every new Category Radar or
Claude Board row.

1. Run `node scripts/gate.mjs owner/repo owner/repo ...`. It records every verdict and evidence in
   `data/gate-log.json` and blocklists every FAIL.
2. For each of the 10 picks, also search the web yourself for `<name> malware`, `<name> scam`,
   `<name> security incident` and `<name> uploads code OR data leak`, and read anything credible. (In
   the cloud the script's news search is only a Hacker News keyword search.) A credible report of
   malware, a scam, or code or data taken without consent is a FAIL: record it with
   `node scripts/gate.mjs --settle owner/repo FAIL "what happened, with the source" --by routine`.
3. A **FAIL** is replaced by the next candidate. Only if its absence would look like a gap (it's in
   the news) does it go in as a `status: "fail"` pick with a red DO NOT INSTALL page.
4. A **REVIEW** follows "What the Friday routine may settle" in `docs/SECURITY_GATE.md`. If you may
   not settle it, take the next candidate.

## 5. Write each answer sheet

For each pick, write `data/editions/<date>/<slug>.json` (format in DATA_FORMAT.md). Research in this
order:
1. **README and website:** what it is, the real demo, the homepage. Use WebFetch.
2. **The picture (required step):** run `node scripts/shots.mjs owner/repo --site <website>`. It
   downloads the README's images and the website's preview image and prints where they are. **Look
   at each one with Read before choosing.** Pick the image that best shows the product working
   (a screen, a result, a before/after), not a logo or a banner. Then:
   - under 2 MB: copy it to `assets/shots/<slug>.<ext>` and use that path as `visual.src`;
   - bigger: use the printed `url` as `visual.src`;
   - `alt` says what the picture really shows, with its real numbers and words;
   - for #1 to #3, the same picture is the `thumb` in edition.json.
   Only if the script finds nothing usable, leave `visual` out; the page then says so honestly.
   A demo video it finds goes in `links.demo`.
3. **The board:** 4 notes, *your problem -> you give it -> it does -> you get*. The example comes
   from the product's own demo or docs, never made up.
4. **Real uses:** a named person, team or publication who used it for a specific thing, with the
   result and a dated link. For `fit: "you"`, favor non-developer roles. Not a use: an adopters
   list, a crowd ("2,300 issues filed"), or the maker's own announcement. If fewer than 2 real uses
   exist, write only the real ones and add a `uses_note` saying real use is still early.
5. **Coverage:** Hacker News (points), YouTube (views), blogs, and critical takes too.
6. **Try it:** 3 plain steps. `paste` always starts with `/skillspector https://github.com/<o>/<r>`,
   then install and run its own demo, 10 minutes max.
7. **Links load:** open every URL you cite (WebFetch or curl). Drop any that doesn't.

**The writing test** (verify enforces the jargon rule):
- Could a smart non-coder repeat the tagline to a colleague? If not, rewrite it. About 20 words at
  most.
- Compare to something people know: a product, a bill, a job.
- No jargon in the tagline, sentence, board or before/after unless it is explained right next to
  it. That includes tool names a non-coder wouldn't know (FFmpeg, headless Chrome, GSAP).
- Say what is early, thin or disputed, plainly.

Then write `data/editions/<date>/edition.json`: the number, a one-line theme that ties the week
together, the `method` line (sources scanned, what was pulled for safety, what happened to tips,
any slot filled by score), and the 10 picks.

## 6. Refresh the lists in `data/hub.json`

- **Category Radar:** 11 lanes, 3 each.
  - Build each lane's pool from GitHub topics, skills.sh topic pages and this week's candidates.
  - Rank by 50% 30-day star gain, 25% adoption (installs or downloads) and 25% total stars.
  - Gate every new row (step 4). Fewer than 3 cleared means the page says the slot is open.
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
- what the gate pulled or held back, and why;
- every ruling you recorded with `--by routine`, one line each;
- repos the re-check could not read;
- what happened to each tip.

## Appendix: sources

| # | Source | URL | Notes |
|---|---|---|---|
| 1 | GitHub Trending | `https://github.com/trending?since=daily|weekly|monthly`, plus `/javascript`, `/typescript`, `/python` | Each `<article class="Box-row">` has the repo, "N stars this week", and total stars |
| 2 | Trendshift | `https://trendshift.io/` and `/monthly` | `href="/repositories/ID">owner/repo` |
| 3 | skills.sh | `https://skills.sh/`, `/trending`, `/hot`; per repo `https://skills.sh/<o>/<r>` | Per-skill installs; repo pages give "N total installs" |
| 4 | findarepo | `https://findarepo.com/digest/<date>/`; per repo `https://findarepo.com/repo/<o>/<r>/` | Digests list the day's risers; repo pages give measured stars a day and a star-credibility check |
| 5 | Hacker News | `https://hn.algolia.com/api/v1/search?query=github.com&tags=story&numericFilters=created_at_i%3E<unix>,points%3E100` | URL-encode `>` as `%3E` |
| 6 | YouTube | web search for the named channels, last 14 days | 25K+ views; repo named or linked. Local runs only (`--youtube`); the cloud gets a CAPTCHA |
| - | GitHub pages | `https://github.com/<o>/<r>` and its security, releases and contributors pages | Read by the scripts; not a discovery source |

npm and PyPI downloads are not wired in yet; adoption comes from skills.sh installs.
If a page won't load through a plain request, `https://r.jina.ai/<url>` often returns readable text.

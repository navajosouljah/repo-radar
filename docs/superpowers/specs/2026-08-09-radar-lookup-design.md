# Radar Lookup - Design Spec

Date: 2026-08-09
Status: Approved by JJ (design presented and approved in session)
Project: repo-radar (static site, Vercel project `repo-radar`, live at repo-radar-weekly.vercel.app)

## Goal

Add a search capability to Repo Radar with two modes from one search bar:

1. **URL mode** - paste a GitHub repo URL; get an instant data snapshot plus a queued deep briefing page (the full "senior researcher" breakdown).
2. **Describe mode** - type a description of what you need ("website builder"); get instant raw GitHub search results plus a queued, curated "Top 3 for [query]" page with a mini-brief per repo.

All deep research is agent-generated at edition-page quality. Every number comes from live APIs or cited sources - no fabricated data, gaps shown as "no data found."

## Architecture

Three layers:

### Layer 1 - Instant (browser only, no backend)

- `lookup.html`: search bar + results area. Mode detection: input matching
  `github.com/{owner}/{repo}` (or `owner/repo` shorthand) = URL mode; anything else = describe mode.
- URL mode: fetch `api.github.com/repos/{owner}/{repo}` unauthenticated. Render snapshot card: stars, forks, open issues, license, language, last push, created date, link to GitHub. 404/private = "couldn't verify this repo" card.
- Describe mode: fetch `api.github.com/search/repositories?q={query}&sort=stars` unauthenticated. Render top ~8 results labeled **"Raw radar - unverified."**
- Rate limit: 60 req/hr unauthenticated is sufficient for personal use. On 403 rate-limit response, show "GitHub rate limit hit - try again in a few minutes."

### Layer 2 - Queue (Google Apps Script -> Google Sheet)

- The bar's "Queue deep briefing" / "Queue Top 3 hunt" button POSTs `{type: "url"|"search", query, ts}` to a Google Apps Script web app endpoint that appends a row to a Google Sheet (columns: timestamp, type, query, status).
- Pattern proven by the Totem subscribe form. Uses JJ's **personal** Google account (jack.jj.gilmore@gmail.com), never the ASAAR account.
- One manual setup step by JJ: create the Apps Script from provided code, deploy as web app, hand the `/exec` URL back. The endpoint URL lives in one constant in `lookup.html`.
- Until the endpoint is configured, queueing still works device-locally (localStorage) so the feature is testable end to end; the Sheet makes it cross-device.
- Queued items are also mirrored to localStorage so `lookups/index.html` can show "in the queue" without a backend read.

### Layer 3 - Agent processing (manual trigger: "run repo lookups")

A durable skill at `~/.claude/skills/repo-lookup/SKILL.md` defines the pipeline. On trigger, the agent:

1. Reads pending rows from the Sheet (via the Apps Script `doGet` JSON endpoint, or JJ pastes the rows if simpler).
2. For each **url** row, researches and generates `/lookups/{owner}--{repo}.html` - the six-section scorecard (below).
3. For each **search** row, researches the space, picks the 3 best repos, generates `/lookups/search-{slug}.html` with a substantial mini-brief per repo and a "Full briefing" action per repo that re-queues its URL.
4. Rebuilds `/lookups/index.html` (the library): all completed lookups newest-first, plus client-side pending display.
5. Marks Sheet rows done, deploys via `vercel deploy --prod`, verifies live URLs, opens results in browser.

## The six-section scorecard (URL briefings)

Fixed structure, comparable across repos:

1. **Safe to install?** - commit recency, maintainer count/history, GitHub security advisories, install-script inspection (curl-pipe-bash, postinstall hooks), dependency risk.
2. **Adoption** - npm/PyPI download counts where applicable, GitHub dependents ("used by"), star velocity, fork/star ratio.
3. **Verified voices** - HN threads, Reddit, named YouTube channels covering it. Cited. Absence stated plainly.
4. **Problem it solves** - before/after framing (edition-page pattern).
5. **Why install + watchouts** - the honest pitch and honest limits.
6. **Built with it** - real shipped projects/use cases, cited.

Verdict line at top. Visual quality bar = edition briefing pages (unique theme per page, topbar, hero with stats chips, tabbed or sectioned layout, zero em dashes, back-link `../index.html` for lookups pages).

## Top 3 pages (describe mode)

- Hero restating the query. Three ranked entries, each: name/org, verdict sentence, the one number that matters, safety read, why it beat alternatives, GitHub link, "Full briefing" queue action.
- Curation method: GitHub search + community verification (same methodology as weekly edition curation), not raw star count.

## Site integration

- "Lookup" link added to nav on `index.html`, `archive.html`, and the lookup/library pages themselves.
- Weekly editions remain untouched and separate.
- Design language: existing Repo Radar system (Space Grotesk / Inter / JetBrains Mono, dark `#080b0f`, radar green `#4ade80`).

## Error handling / guardrails

- Dead, private, or non-GitHub URLs: "couldn't verify" card; never a generated page for an unverifiable repo.
- Missing data in briefings: "no data found," never estimated.
- No secrets in the browser. The Apps Script endpoint is write-only-ish (append + read of non-sensitive queue rows).

## Out of scope (v1)

- Automatic/cron processing of the queue (add later using the Market Pulse cloud-cron pattern).
- Non-GitHub sources (npm/PyPI/GitLab URLs as input).
- Server-side GitHub token, search-in-page over the library, RSS.

## Success criteria

- Paste a repo URL on the live site -> snapshot renders in ~2s; queue action records the request.
- Type a description -> raw results render; queue action records the request.
- "run repo lookups" produces briefing/Top 3 pages at edition quality, library updates, site deploys, pages open in browser.
- Zero fabricated numbers; zero em dashes; zero broken links.

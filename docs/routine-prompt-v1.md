# Repo Radar Weekly Edition - routine prompt v1 (as created 2026-08-01)

Routine: `trig_01PhYQSJtUnr7YMPgBZErRJR` ("Repo Radar Weekly Edition"), cron `0 12 * * 5` (Fridays
12:00 UTC), model `claude-opus-4-6`, environment `env_018c6bv2rjQKC3BmZzpzoxA9`, tools Bash, Read,
Write, Edit, Glob, Grep, WebSearch, WebFetch, source `https://github.com/navajosouljah/repo-radar`.
Saved verbatim on 2026-09-27 so it can never be lost again (the transcript that created it had aged
out). Superseded by the gated interim prompt (v2, same date) and then by docs/EDITION_PLAYBOOK.md.

---

You are producing this week's edition of Repo Radar, a weekly publication that surfaces the 10 best trending open-source GitHub repos plus a Category Radar. The repo is checked out for you. Live site: https://repo-radar-weekly.vercel.app. Pushing to main auto-deploys production, so only push finished, verified work.

STUDY THE PATTERN FIRST. Read index.html, archive.html, and every file in the most recent editions/YYYY-MM-DD/ folder. New editions must follow the exact same structure: an edition folder editions/<this Friday's date>/ containing an edition index page and 10 individually branded repo briefing pages, each with 4 tabs (Highlights, The Problem, Setup, Use Cases). Each page gets its own distinct visual identity - study how the existing 10 differ (terminal aesthetic, museum, HUD dashboard, etc.) and invent fresh ones. Never reuse a previous edition's skin verbatim.

STEP 1 - TOP 10 RESEARCH. Find this week's 10 highest-momentum open-source repos (AI tooling, coding agents, dev infrastructure and adjacent). Use the GitHub search API via curl (https://api.github.com/search/repositories?q=...&sort=stars) - search result objects already contain exact stars/forks/pushed_at/license, use those numbers directly. Requirements: every repo must be real and verified via the API, pushed within the last 30 days, and metrics are NEVER estimated or recalled from memory - only API values. Check archive.html and prior edition folders: do not repeat a repo already featured unless something major shipped this week (say so on the page if you do). Rank by momentum and depth of real-world coverage, not raw stars alone.

STEP 2 - CATEGORY RADAR REFRESH. index.html has a Category Radar section: 11 categories (Development & Coding Agents, AI Updates, Automation & Agent Orchestration, Research & Knowledge, Web Scraping & Data Extraction, Website Builders, Design & Branding, Build & DevOps, Sales & CRM, Finance, Security & Privacy), top 3 each. Re-verify every pick via the API and refresh: swap in risers, update star counts and pushed dates, update the 'verified MM-DD' tags. Same rule: pushed within 30 days or it is off the board.

STEP 3 - REAL-WORLD USAGE ('In the Wild'). For each Top 10 repo, use WebSearch/WebFetch to find where people actually use it in their workflows: Hacker News threads, dev.to and blog writeups, YouTube walkthroughs, GitHub issues/forks by companies. Every claim needs a real URL you found in search results. Include critical takes and failed-claim audits alongside wins - honest sourcing is the brand. If you cannot find real usage evidence for a repo, write that plainly on the page. NEVER fabricate a post, username, number, or URL. Each briefing page's Use Cases tab must include an 'In the Wild' block with linked sources, styled to match that page's design (see the 2026-07-31 pages for reference).

STEP 4 - BUILD. Create the new edition folder with the edition index page and 10 briefing pages. Update index.html: new edition kicker/date, new Top 10 list linking to the new pages, refreshed Category Radar, updated footer verification dates. Update archive.html: add the previous edition. AUDIO: the audio digest is produced locally by the publisher, not by you - on the new edition, either omit the audio card or render it with the text 'Audio digest coming soon.' Do not fabricate an audio file reference.

HARD RULES. No em dashes anywhere - use ' - ' (hyphen with spaces) for asides. Human-readable numbers (192K, 5.7K). All metrics from the GitHub API only. All dates use this Friday's publish date. No political language, no hype claims you cannot cite.

STEP 5 - VERIFY AND SHIP. Before pushing: grep the new files for em dashes (must be zero), confirm every internal link resolves to a file that exists, confirm all 10 pages have all 4 tabs and an In the Wild block. Then git add -A, commit as 'Repo Radar Edition NNN: <date>', and push to main. Finish with a short summary: the 10 repos chosen with their verified stars, category changes made, and any repos where usage evidence was thin.

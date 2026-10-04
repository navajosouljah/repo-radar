# Repo Radar data format

Pages are built from data by `scripts/build.mjs`. Nobody writes page HTML by hand any more. One file
per repo, one file per edition, one hub file. `scripts/verify.mjs` checks every rule below before
anything ships.

## `data/editions/<YYYY-MM-DD>/edition.json`

```json
{
  "number": "010",
  "date": "2026-10-02",
  "theme_short": "5-7 words",
  "theme": "**The story of the week in one bold line.** Then two plain sentences that tie the picks together.",
  "method": "**How this week was picked:** sources scanned, how many cleared, anything pulled for safety.",
  "picks": [
    { "rank": 1, "slug": "laya", "repo": "owner/name", "name": "laya", "fit": "you | developers | news",
      "slot": "score | new | climbing",
      "stars": 26096, "thumb": "assets/shots/laya-demo.webp", "oneliner": "Plain-English line, max about 20 words." },
    { "rank": 5, "slug": "zcode", "repo": "owner/name", "name": "ZCode", "status": "fail",
      "oneliner": "Why it was pulled, in one line." }
  ]
}
```

- `fit` is one of:
  - `you`: JJ can install it himself or drive it by asking Claude Code: a skill, a plugin, a desktop
    app, or a tool built for AI agents (HyperFrames, which Claude Code uses to make videos, is `you`).
  - `developers`: someone who writes code has to set it up or build it into something: a library, an
    SDK, a framework, a server to host.
  - `news`: a model or research result. It goes on the "Also this week" line, not in the 10.
- `slot` is which pool the pick came from (playbook step 3). The card does not show total stars: it
  shows why the repo is here this week, and `build.mjs` writes that line itself from
  `data/candidates/<date>.json` ("8 days old · 5.3K stars", "+2.7K stars this week", "Still climbing ·
  +38.1K stars this month"). Never write that line by hand. An edition with no candidates file shows
  total stars.
- `thumb` is only for #1 to #3, and only a real screenshot or demo frame of the product (the same
  picture as the page's `visual`). No auto-generated GitHub cards.

## `data/editions/<date>/<slug>.json`: one repo's answer sheet

Every string is plain English. Two kinds of markup are allowed: `**bold**` and `[a link](https://...)`.
Every number, person, post and URL is real and cited; if something is missing, say "no data found" or
leave the section's empty state to say so.

The page reads top to bottom: what it is (with the picture and the vitals), how it works (the board),
what changes for you, how hard it is to try (with what it takes on your computer), should you,
is it safe, and last, who's using it and who's talking about it, then the sources. (Order set by JJ
at Gate A, Sep 27 2026.)

| Field | What goes in it |
|---|---|
| `repo`, `name` | `owner/name` and the display name |
| `tagline` | "A [thing you know] that [one twist]." Max about 20 words, no jargon |
| `sentence` | One verb-first sentence on what it does for the reader, with a concrete example |
| `fit` | `you`, `developers` or `news` |
| `replaces` | Optional: a product or bill the reader knows ("TypeSafe's paid Jev service"). Only if sourced |
| `links` | `website` (the homepage, if it has one), `demo` (a live demo or video), `docs` |
| `visual` | Found with `node scripts/shots.mjs owner/repo --site <website>`, and looked at before choosing. `src` (under 2 MB: a copy in `assets/shots/`; bigger: the printed URL), `width`, `height`, `alt` (what it really shows, with its real numbers and words), `caption` |
| `board` | Exactly 5 notes, in order: `problem` (the headline across the top), `trigger` (what makes it run: a command you type, a message arriving, a schedule), `input` (what you hand it), `does` (with `steps`: 2 to 4 short steps of what happens inside), `result` (with `outputs`: 1 to 3 `{what, eg}`, the concrete things you get back). Every note has `say` (a short sentence); `eg` is a real example from the product's own demo or docs |
| `before`, `after` | 2-3 bullets each: the pain without it, then what you get with it |
| `uses_note` | Optional one line of context ("It's 9 days old, so real use is early") |
| `uses` | 2-4 real uses: a named person, team or publication that used it for a specific thing. `who`, `what`, `result`, `stat` (the headline number: "37 of 40", "178 pts"), `source {title, url, date}`. Not a use: an adopters list, a crowd ("2,300 issues filed"), the maker's own announcement. Fewer than 2 real ones: write those and a `uses_note` |
| `pulse` | `gain` (a plain line) and `history` ([[date, stars], ...] measured points only), shown in the Popularity vital at the top. `history_note` and `facts` are optional and not shown |
| `coverage` | 3-6 independent write-ups or threads, listed under real uses as "Who's talking about it": `plat`, `title`, `url`, `meta` ("178 points · Sep 20"), `tone: "critical"` for critical takes |
| `trending` | Optional short chips ("findarepo: star growth looks organic") |
| `star_check` | Optional one line from findarepo's star check |
| `try` | `effort` (`minutes`, `hour` or `developer`), `steps` (3 plain steps; a step that sends you somewhere (a demo, a download, the Releases page, a notebook, the docs) links there with `[label](url)`), `paste` (the Claude Code prompt: always `/skillspector <url>` first, then install and run its own demo, 10 minutes max) |
| `footprint` | What installing it takes: `disk` (download and install size), `memory` (what it needs while running), `runs_on` (Mac, Windows, Linux, versions, whether it needs a graphics card), `source {title, url}`. Only sourced numbers: the README's requirements, the Releases page's file sizes, model file sizes, package sizes. You may add sourced sizes up, and then say "about". A value you can't find is "no data found" |
| `verdict` | `best_for` (2-3), `skip_if` (2-3), `alternatives` (2-3: `name`, `repo` if it is a GitHub repo, which must be gated, `url`, `line`) |
| `watch` | 2-4 watch-outs, each starting with a **bold** summary |
| `sources` | Every source used, with a date where known |

The safety block on every page comes from `data/gate-log.json`, not from this file.

## Plain-English rules (verify enforces the first)
- These words may not appear in `tagline`, `sentence`, the board's notes, steps and outputs, or `before`/`after` unless explained
  right next to them (in brackets or after a colon): autoregressive, inference, embeddings, vector,
  RAG, LLM, orchestration, harness, SDK, CLI, latency, tokens, fine-tune, MCP, agentic, runtime,
  backbone, parameters, checkpoint, forward pass, calibrated, repo, dependency, deploy, endpoint,
  webhook, Docker, Kubernetes, monorepo, self-hosted.
- Compare to things people know: a product, a bill, a job ("a tiny AI sorting clerk").
- Say what is thin, early or disputed, plainly.

## `data/hub.json`
- `categories`: `[{id, name, checked, picks: [{repo, name, stars, perday?, url?, oneliner}]}]`, with
  3 picks per lane, all gated. Fewer than 3 cleared means the page says the slot is open.
- `claude_board`: `[{repo, name, installs_label, url, oneliner}]`, the top 10 Claude skills and
  plugins by skills.sh installs. A repo needs 1K+ GitHub stars (so install counts can't be gamed)
  and must be gated.
- `categories_note`, `claude_board_note`: one line each.

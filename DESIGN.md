---
name: Repo Radar
description: A weekly workshop whiteboard of the open-source tools worth your week, in plain English, with pictures.
colors:
  paper: "oklch(0.975 0.007 95)"
  paper-deep: "oklch(0.955 0.009 95)"
  dot-grid: "oklch(0.86 0.012 95)"
  card: "oklch(0.992 0.004 95)"
  marker-ink: "oklch(0.25 0.025 265)"
  ink-soft: "oklch(0.43 0.022 265)"
  ink-faint: "oklch(0.58 0.018 265)"
  rule: "oklch(0.87 0.012 265)"
  problem-yellow: "oklch(0.945 0.095 97)"
  problem-yellow-edge: "oklch(0.83 0.125 92)"
  problem-yellow-ink: "oklch(0.42 0.09 78)"
  how-blue: "oklch(0.925 0.05 238)"
  how-blue-light: "oklch(0.955 0.03 238)"
  how-blue-edge: "oklch(0.74 0.095 242)"
  how-blue-ink: "oklch(0.40 0.13 255)"
  result-green: "oklch(0.925 0.075 152)"
  result-green-edge: "oklch(0.75 0.12 152)"
  result-green-ink: "oklch(0.39 0.11 153)"
  watch-coral: "oklch(0.925 0.055 32)"
  watch-coral-edge: "oklch(0.72 0.14 30)"
  watch-coral-ink: "oklch(0.47 0.16 29)"
  link-blue: "oklch(0.44 0.16 262)"
typography:
  display:
    fontFamily: "Bricolage Grotesque, Avenir Next, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 1.6rem + 4vw, 4.25rem)"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Bricolage Grotesque, Avenir Next, system-ui, sans-serif"
    fontSize: "clamp(1.75rem, 1.2rem + 1.8vw, 2.5rem)"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Bricolage Grotesque, Avenir Next, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 500
    lineHeight: 1.3
  body:
    fontFamily: "Atkinson Hyperlegible Next, Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
  marker:
    fontFamily: "Shantell Sans, Comic Neue, system-ui, sans-serif"
    fontSize: "1.1875rem"
    fontWeight: 600
    lineHeight: 1.3
  label:
    fontFamily: "Atkinson Hyperlegible Next, Atkinson Hyperlegible, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 700
    letterSpacing: "0.09em"
rounded:
  note: "3px"
  card: "10px"
  board: "16px"
  pill: "999px"
spacing:
  s-1: "4px"
  s-2: "8px"
  s-3: "12px"
  s-4: "16px"
  s-5: "24px"
  s-6: "32px"
  s-7: "48px"
  s-8: "64px"
  s-9: "96px"
components:
  button-primary:
    backgroundColor: "{colors.marker-ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.card}"
    padding: "0 20px"
    height: "48px"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.marker-ink}"
    rounded: "{rounded.card}"
    padding: "0 20px"
    height: "48px"
  chip-fit-you:
    backgroundColor: "{colors.result-green}"
    textColor: "{colors.result-green-ink}"
    rounded: "{rounded.pill}"
    padding: "5px 10px"
  chip-fit-developers:
    backgroundColor: "{colors.how-blue-light}"
    textColor: "{colors.how-blue-ink}"
    rounded: "{rounded.pill}"
    padding: "5px 10px"
  note-problem:
    backgroundColor: "{colors.problem-yellow}"
    textColor: "{colors.marker-ink}"
    typography: "{typography.marker}"
    rounded: "{rounded.note}"
    padding: "16px 16px 24px"
  note-how:
    backgroundColor: "{colors.how-blue}"
    textColor: "{colors.marker-ink}"
    typography: "{typography.marker}"
    rounded: "{rounded.note}"
    padding: "16px 16px 24px"
  note-result:
    backgroundColor: "{colors.result-green}"
    textColor: "{colors.marker-ink}"
    typography: "{typography.marker}"
    rounded: "{rounded.note}"
    padding: "16px 16px 24px"
  vital:
    backgroundColor: "{colors.card}"
    textColor: "{colors.marker-ink}"
    rounded: "{rounded.card}"
    padding: "16px"
---

# Design System: Repo Radar

## 1. Overview

**Creative North Star: "The Workshop Whiteboard"**

Every page is a whiteboard after a good working session: a dotted board, sticky notes in four colors, a pinned photo of the real product, and a marker-drawn arrow from the problem to the result. PRODUCT.md's personality line is the brief: "A sharp friend at a whiteboard: **clear, visual, candid.**" The reader is a non-coder executive who skims ten tools in fifteen minutes, on a desk monitor or a phone, in a bright room, so the system is light, high-contrast and legible before it is clever.

The page is one scroll, in the same order every time, and its headers are the reader's own questions: What is it? How does it work? What changes for me? How hard is it to try? Should I? Is it safe? Who's using it? Structure carries meaning, so skimming becomes pattern recognition. Density is generous: one idea per note, one fact per line, big numbers only where they decide something.

It rejects, by name, everything in PRODUCT.md's anti-references: the old dark "terminal" pages with a random skin per page and four tabs hiding the content; SaaS landing templates with a big-number hero, identical icon-heading-text card grids and gradient accents; GitHub READMEs that lead with walls of text and install commands; and hype newsletters with "game-changer" language and star counts presented as proof.

**Key Characteristics:**
- A warm dotted paper canvas; ink is a deep blue-black, never pure black.
- Four legend colors with fixed meanings on every page, always paired with a label.
- Hand-lettered marker type only on sticky notes and captions; a sturdy grotesque for headings; a legibility-first sans for reading.
- Slight rotations (about 1 degree) and soft shadows make notes feel stuck on, not rendered.
- The same section order on every page, numbered, with question headers.
- Phone-first: every row stacks to one column, and every arrow turns to point down.

## 2. Colors: The Legend Palette

A full palette, used as a legend: four colors, each with one job, the same job on every page.

### Primary
- **Marker Ink** (oklch(0.25 0.025 265)): all body text, headings, the primary button, the numbered section dots, arrows. A blue-black that reads as a felt-tip marker, not a screen.
- **Link Blue** (oklch(0.44 0.16 262)): links and the focus ring. Nothing else.

### Secondary
- **Problem Yellow** (oklch(0.945 0.095 97), edge oklch(0.83 0.125 92), text oklch(0.42 0.09 78)): the problem, and only the problem. The headline note across the top of every board.
- **How Blue** (oklch(0.925 0.05 238), light oklch(0.955 0.03 238), edge oklch(0.74 0.095 242), text oklch(0.40 0.13 255)): how it works. The trigger, input and "it does" notes, and the "For developers" chip.

### Tertiary
- **Result Green** (oklch(0.925 0.075 152), edge oklch(0.75 0.12 152), text oklch(0.39 0.11 153)): what you get. The "you get" note, the "Use it yourself" chip, the passed safety vital, real-use numbers.
- **Watch Coral** (oklch(0.925 0.055 32), edge oklch(0.72 0.14 30), text oklch(0.47 0.16 29)): watch out and safety failures. Watch-out notes, the failed safety vital, and the whole DO NOT INSTALL page.

### Neutral
- **Paper** (oklch(0.975 0.007 95)): the page canvas, with a **Dot Grid** (oklch(0.86 0.012 95)) of 1px dots every 24px.
- **Paper Deep** (oklch(0.955 0.009 95)): quiet fills (effort levels, empty states).
- **Card** (oklch(0.992 0.004 95)): cards, vitals, the pinned photo's frame.
- **Ink Soft** (oklch(0.43 0.022 265)) for secondary text; **Ink Faint** (oklch(0.58 0.018 265)) for labels and metadata; **Rule** (oklch(0.87 0.012 265)) for borders and dividers.

### Named Rules
**The Legend Rule.** Yellow is the problem, blue is how it works, green is what you get, coral is watch out, on every page, forever. A color never appears in another role, and it never appears without its label.

**The No Pure Black Rule.** No #000 and no #fff anywhere. Every neutral is tinted: paper toward warm, ink toward blue.

## 3. Typography

**Display Font:** Bricolage Grotesque (with Avenir Next, system-ui)
**Body Font:** Atkinson Hyperlegible Next (with Atkinson Hyperlegible, system-ui)
**Marker Font:** Shantell Sans (with Comic Neue, system-ui)

**Character:** A confident, slightly quirky grotesque for the questions, a typeface designed for low-vision legibility for the reading, and a handwritten marker for the notes, so the board looks written, not typeset.

### Hierarchy
- **Display** (800, clamp(2.5rem, 1.6rem + 4vw, 4.25rem), 1.1, -0.025em): the repo's name at the top of its page, and the hub's masthead.
- **Headline** (700, clamp(1.75rem, 1.2rem + 1.8vw, 2.5rem), 1.1): section questions ("How does it work?"), each with a numbered ink dot.
- **Title** (500, 1.375rem, 1.3): the tagline under the name; card headings at 1.125rem.
- **Body** (400, 1.0625rem, 1.6): reading text, capped at 66ch. Never below 16px.
- **Marker** (600, 1.1875rem, 1.3): the one sentence on each sticky note, and photo captions. Never for paragraphs.
- **Label** (700, 0.8125rem, 0.09em, uppercase): note roles ("YOUR PROBLEM"), vital labels, footprint labels, platform names.

### Named Rules
**The Marker Is For Notes Rule.** Shantell Sans appears only on sticky notes, captions and small tags. A paragraph in marker type is prohibited.

## 4. Elevation

Mostly flat paper with a few objects "stuck on" it. Cards and vitals are flat with a 1.5px rule border. Sticky notes, the pinned photo and watch-out notes carry one soft shadow and a slight rotation, which is what makes them read as physical notes. Depth never signals interactivity; the buttons' hover lift does that.

### Shadow Vocabulary
- **Stuck-on note** (`box-shadow: 0 1px 0 oklch(0.25 0.025 265 / 0.06), 0 6px 18px -8px oklch(0.25 0.025 265 / 0.22)`): sticky notes, the pinned product photo, watch-out notes.
- **Button lift** (`box-shadow: 0 4px 0 var(--ink)` with `translateY(-2px)`): buttons on hover only.
- **Board inset** (`box-shadow: inset 0 0 0 6px oklch(0.975 0.007 95)`): the board's frame, a whiteboard rim.

### Named Rules
**The One Shadow Rule.** There is one shadow for things stuck on the board. If a card needs a shadow to be noticed, it should be a note, or it should not be there.

**The Steady Hand Rule.** Rotations stay between -1.1 and 1 degree, and every rotation is removed when the reader prefers reduced motion.

## 5. Components

### Buttons
Sturdy and inked, like a stamped label.
- **Shape:** gently rounded (10px), at least 48px tall.
- **Primary:** Marker Ink fill, Paper text, Bricolage Grotesque 700 at 1rem ("Visit the website").
- **Secondary:** Card fill, 2px Marker Ink border ("See it work").
- **Quiet:** no border, underlined text ("GitHub").
- **Hover / Focus:** lifts 2px with an ink drop shadow, 0.15s ease-out; focus shows a 3px Link Blue ring at 3px offset.

### Chips
- **Style:** pill (999px), 1.5px border, 0.8125rem bold, a small color dot.
- **Variants:** "Use it yourself" in Result Green; "For developers" in How Blue; "Replaces: ..." with a dashed border.

### Cards / Containers
- **Corner Style:** 10px.
- **Background:** Card, with a 1.5px Rule border.
- **Shadow Strategy:** flat (see Elevation).
- **Internal Padding:** 16px (vitals) to 24px (effort, footprint, should-I cards).

### Navigation
- **Style:** a plain top bar: the "Repo Radar" wordmark in marker type on the left, four text links on the right in Ink Soft, underlined on hover. On phones it wraps under the wordmark.

### The Board (signature component)
The heart of every page. A dotted board framed with a whiteboard rim (16px corners). Across the top, one wide Problem Yellow note: the problem in marker type, with a real example beside it. A marker arrow points down to a row of four notes joined by arrows: **When it kicks in** (the trigger) -> **You give it** -> **It does** (2 to 4 numbered steps) -> **You get** (1 to 3 output cards, each with a real example). Notes keep their natural heights. On phones the row becomes a column and every arrow points down.

### Vitals
Four flat cards under the hero: Popularity (with a sparkline of measured points only), Buzz, Effort to try, and Safety check. The safety vital turns Result Green when the repo passed and Watch Coral when it did not.

### The DO NOT INSTALL page
A repo that fails the safety check after publication gets a Watch Coral hero with a rotated "DO NOT INSTALL" stamp, then what happened, why it still fails, what to do if you already used it, and the safety record. No picture, no board, no try box.

## 6. Do's and Don'ts

### Do:
- **Do** keep the legend fixed: Problem Yellow (oklch(0.945 0.095 97)) for the problem, How Blue for how it works, Result Green for what you get, Watch Coral for watch out, each with its label.
- **Do** show the product working first: a real screenshot pinned in the hero, before any paragraph.
- **Do** keep the same section order on every page, with the reader's questions as headers.
- **Do** keep body text at 1.0625rem (17px) or larger, with lines capped at 66ch.
- **Do** make every step that sends the reader somewhere a link.
- **Do** stack every row to one column below 880px, with arrows pointing down.

### Don't:
- **Don't** bring back the old pages: a dark "terminal" look, a different random skin on every page, or four tabs hiding most of the content.
- **Don't** use SaaS landing templates: a big-number hero, identical icon-heading-text card grids, gradient accents.
- **Don't** open like a GitHub README: walls of text and install commands before any "why".
- **Don't** write like a hype newsletter: "game-changer" language, uncited claims, star counts presented as proof.
- **Don't** use a legend color outside its role, or a color without its label.
- **Don't** use pure black or pure white, gradient text, or colored side-stripe borders on cards or notes.
- **Don't** set paragraphs in the marker font, or rotate anything more than about 1 degree.

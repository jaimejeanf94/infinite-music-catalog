---
name: Infinite Music Catalog
description: A leaning shelf of 4,414 records — bone on warm ink, one sleeve red, square corners.
colors:
  ink-ground: "#121110"
  panel: "#1a1917"
  panel-raised: "#232220"
  hairline: "#4a4640"
  bone: "#efe9dd"
  bone-dim: "#9a938a"
  sleeve-red: "#d8321f"
  sleeve-red-text: "#ed6046"
  sleeve-red-lit: "#f4663f"
  on-red: "#ffffff"
  moss: "#7a9e5c"
  amber: "#d08a3a"
  rust: "#c0564a"
  rust-deep: "#b34c41"
  alarm: "#ff8a73"
typography:
  display:
    fontFamily: "Big Shoulders Display, Haettenschweiler, Impact, sans-serif"
    fontSize: "clamp(30px, 4.6vw, 56px)"
    fontWeight: 800
    lineHeight: 0.86
    letterSpacing: "-0.015em"
  headline:
    fontFamily: "Big Shoulders Display, Haettenschweiler, Impact, sans-serif"
    fontSize: "clamp(38px, 6vw, 76px)"
    fontWeight: 800
    lineHeight: 0.92
    letterSpacing: "0.005em"
  title:
    fontFamily: "Big Shoulders Display, Haettenschweiler, Impact, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.01em"
  body:
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "JetBrains Mono, ui-monospace, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "0.14em"
rounded:
  none: "0"
  hair: "2px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "32px"
  shelf-row: "52px"
components:
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.bone}"
    typography: "{typography.label}"
    rounded: "{rounded.hair}"
    padding: "11px 18px"
  button-primary:
    backgroundColor: "{colors.bone}"
    textColor: "{colors.ink-ground}"
    typography: "{typography.label}"
    rounded: "{rounded.hair}"
    padding: "11px 18px"
  button-primary-hover:
    backgroundColor: "#ffffff"
    textColor: "{colors.ink-ground}"
  score-key:
    backgroundColor: "transparent"
    textColor: "{colors.bone}"
    rounded: "{rounded.none}"
    padding: "14px 0"
    width: "56px"
  score-key-on:
    backgroundColor: "{colors.sleeve-red}"
    textColor: "{colors.on-red}"
  chip-filter:
    backgroundColor: "transparent"
    textColor: "{colors.bone-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.hair}"
    padding: "9px 14px"
  chip-filter-on:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.bone}"
  chip-genre:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.bone-dim}"
    rounded: "{rounded.pill}"
    padding: "3px 9px"
  input-search:
    backgroundColor: "transparent"
    textColor: "{colors.bone}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "10px 2px"
  input-field:
    backgroundColor: "{colors.panel-raised}"
    textColor: "{colors.bone}"
    rounded: "{rounded.hair}"
    padding: "10px"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.bone-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "6px 2px"
  nav-link-on:
    textColor: "{colors.bone}"
  badge-score:
    backgroundColor: "{colors.sleeve-red}"
    textColor: "{colors.on-red}"
    rounded: "{rounded.none}"
    padding: "3px 8px"
---

# Design System: Infinite Music Catalog

## Overview

**Creative North Star: "The Leaning Shelf"**

Four thousand four hundred records pushed unevenly into a shelf. The interface
is the shelf — hairlines, rules, a warm near-black ground with a faint paper
tooth — and the records are the only thing on it with colour. Every tile lifts
or drops by an amount derived from the album itself, so the wall zigs
regularly and by a different distance every time; nothing is centred, nothing
floats, and the grid never quite lines up because a shelf never does.

The character is severe, and warmer than it looks. The geometry is hard and the
display type shouts — condensed caps up to 86px, set to a line-height of 0.82
so the words stack like a poster — but the ground is `#121110` rather than
black and the text is bone `#efe9dd` rather than white, which takes the glare
off a screen read at night. Anything you actually read is set in a serif.
Anything that is data — a year, a score, a count, a control — is monospaced,
uppercased and tracked wide, so it reads as a figure rather than as prose. The
severity is structural, not cold: it is there to get out of the way of 4,414
sleeves, each of which brings its own palette to the page.

Restraint is the mechanism. The interface commits to three colours and one
accent, which means the covers supply everything else and a page of records
looks different every time without the design doing anything. When the accent
appears it means something: this is active, this is yours, this is open.

**Key Characteristics:**

- Warm near-black ground with a 1px paper tooth at 1.2% white; never pure black
- Bone, not white — `#efe9dd` on `#121110`
- One accent, Sleeve Red, carrying active state, artist names, scores and focus
- Three fonts doing three strictly separated jobs: names, prose, data
- Square by default (0–2px), pills reserved for genre and style words alone
- Flat: depth is tonal layering and rules, never shadow
- Nothing centred; the front page's folio is deliberately lopsided
- The shelf leans — every tile offset from the album's own id

## Colors

Three interface colours and one accent, on the principle that the artwork is
the palette. Every neutral in the set is warm: in each one the red channel is
the highest and the blue the lowest, which is what keeps `#121110` reading as
ink rather than as a switched-off screen.

### Primary

- **Sleeve Red** (`#d8321f`): the only accent, named for the red block a record
  sits on. It carries the active nav item, every artist name, the score badge on
  a tile and on the roll, mode and filter selection, the focus ring on every
  interactive element, the count of open items on Fix, and the rule under the
  current screen. It marks **state, identity and value** — never an action, and
  nothing decorative is ever this colour.
- **Sleeve Red, Text** (`#ed6046`): the same red lifted until it passes AA as
  small text on all three grounds (5.71 / 5.32 / 4.82). Every red word in the
  app uses this. `#d8321f` measured 3.95 / 3.68 / 3.33 and was being used at
  9–13px, so every artist name in the collection failed contrast.
- **Sleeve Red, Lit** (`#f4663f`): the hover state of anything already red — the
  primary button, a text link. Never a resting colour.

### Neutral

- **Ink Ground** (`#121110`): the page. Carries a repeating 1px horizontal
  gradient at 1.2% white so the ground reads as a surface rather than a void.
- **Panel** (`#1a1917`): one step up. Modal bodies, dropdown lists, the hover
  state of a whole row.
- **Panel Raised** (`#232220`): two steps up. Input fields, genre chips, the
  progress track, inline code, the well behind artwork that has not loaded.
- **Hairline** (`#4a4640`): every 1px border, divider and rule in the system.
  Lifted from `#34322e`, which measured 1.47:1 against the ground — invisible
  in daylight on the phone this is used on.
- **Bone** (`#efe9dd`): all primary text.
- **Bone Dim** (`#9a938a`): secondary text — labels, counts, styles, hints,
  inactive nav, placeholder text. The system's second most-used colour after the
  accent itself.
- **On Red** (`#ffffff`): text sitting on Sleeve Red, and the only place pure
  white appears.

### Tertiary

Status colours, used sparingly and never as a fourth accent:

- **Moss** (`#7a9e5c`): a section on Fix with nothing left open; the roll's
  confirmation flash.
- **Amber** (`#d08a3a`): a flagged maintenance row — a problem kept deliberately
  in view — and the warning band on Fix.
- **Rust** (`#c0564a`): destructive intent, and the only fill in the system
  that is a red. A genre chip armed for deletion, and the delete button once it
  is armed. White on it is 4.50:1, so its pressed state (`#b34c41`) goes
  *darker* — a lighter one would push the label under AA.
- **Alarm** (`#ff8a73`): error text and the resting colour of a danger button.

### Named Rules

**The Small-Text Red Rule.** `--accent` fills a shape and carries white on it.
It is never text below 24px; `--accent-text` is. They are the same red at two
lightnesses, and which one you reach for is decided by size, not by taste.

**The Bone Acts Rule.** The loudest thing on any screen is the primary action,
and it is bone — `--ink` filled, `--bg` lettered, 15.60:1. Red never means
"act on this". This is what keeps Sleeve Red readable as identity: the accent
and the armed-delete button used to be the same object in two shades of one
hue, so the control that committed a change and the control that destroyed one
were indistinguishable at a glance.

**The One Red Rule.** `#d8321f` is the only red in the system that carries
meaning. A second red on screen is a bug, not a variant: the armed-delete
button's `#c4392a` / `#d6412f` is drift and should resolve to either the accent
or Rust.

**The Warm Ground Rule.** Every neutral is warm — red channel highest, blue
lowest. A cool grey in this palette is visible immediately as a foreign object.
`#26262e`, `#3a3a44`, `#2c2c35`, `#1c1c22` and the sticky header's
`rgba(13, 13, 15, 0.92)` all predate the palette and all break it; the header
one is visible as a cooler band across the top of the page.

**The Covers Supply The Colour Rule.** The interface stops at three neutrals
plus one accent because 4,414 album sleeves are already on the page. Any new
hue must justify itself against artwork it will sit beside.

## Typography

**Display Font:** Big Shoulders Display (with Haettenschweiler, Impact)
**Body Font:** Newsreader (with Georgia, serif)
**Label/Mono Font:** JetBrains Mono (with ui-monospace, Menlo)

**Character:** A condensed signage face for names, a warm serif for reading, and
a monospace for everything countable. The pairing is a print shop rather than a
product: the display face is set enormous and tight, the serif is set at a
comfortable measure, and the mono is always small, always uppercase and always
tracked open so it reads as machine output rather than as text.

### Hierarchy

- **Display** (800, `clamp(30px, 4.6vw, 56px)`, line-height 0.86, tracking
  −0.015em, uppercase): the front page's folio title, and nothing else. The
  negative tracking and sub-1 line-height are what make it a slab rather than a
  heading.
- **Headline** (800, `clamp(38px, 6vw, 76px)`, line-height 0.92, uppercase): the
  album title on the roll, where it is the only thing on the page. Inside the
  detail sheet the same class is re-scaled to `clamp(22px, 2.4vw, 36px)`,
  because at hero size a long title wrapped to seven lines and pushed the
  controls out of view.
- **Title** (700, 26–30px, line-height 1): the running head, the figure in a
  statistic, the open-item count on a Fix section. Display type used at a size
  where it reads as a number rather than as a shout.
- **Body** (400, 15–17px, line-height 1.5): notes, explanations, album titles in
  a list, the description under a door. Measures are capped between 34ch and
  46ch wherever prose runs long.
- **Label** (400–500, 10–12px, tracking 0.08–0.24em, uppercase, tabular
  figures): every control, every count, every piece of metadata. The tracking
  scales with the smallness — a 10px label is tracked 0.18em, a 12px one 0.12em.

### Named Rules

**The Three Jobs Rule.** Display names things, the serif is read, the mono is
counted. A font used for a job that is not its own is the fastest way to make
this system look like something else. Never set a control in the serif; never
set prose in the mono.

**The Tracking Rule.** Mono is always uppercase and always tracked at least
0.08em. Untracked mono caps at 10px close up into a block and stop being
readable as a label.

**The Tabular Rule.** Any figure that updates in place — a progress count, a
total, a maintenance tally — carries `font-variant-numeric: tabular-nums`, so
the number changes without the layout twitching.

## Layout

Two containers, each sized to its screen's job: 1100px for the shelf, the roll
and the front page, 1040px for maintenance. Both are centred; the content
inside them is not.

The shelf is a `repeat(auto-fill, minmax(150px, 1fr))` grid dropping to 104px
below 720px, with a row gap of 52px against a column gap of 18px. That row gap
is structural, not aesthetic: a tile can be pushed 16px down while the one below
it is pulled 16px up, so 32px of the gap is spent before any text is drawn. At
the original 16px the two overlapped and titles printed across the next row's
artwork. On phones a `--jitter` multiplier halves the whole effect, because the
same offsets against a 104px column read as a fault rather than as a lean.

Tiles render 60 at a time and grow on scroll. Every tile reserves
`min-height: 2.5em` for its title and clamps at three lines, so a row of
one-word albums sits at the same height as its neighbours without the row having
to measure itself.

Division is by rule weight, and the weights mean different things: a **2px solid
bone rule** closes a major region — under the front page's folio, above the doors,
under the maintenance totals — while a **1px hairline** separates peers, like
one Fix section from the next. Breakpoints sit at 900px (the folio, the lead's
spread and the doors each go to one column), 820px (the maintenance bar drops its explanation to its own
row), 720px (the shelf and every two-column sheet collapse) and 560px (the five
become one column).

### Named Rules

**The Gap Pays For The Stagger Rule.** A transform does not affect layout, so
every pixel of lean has to be bought out of the row gap — twice over, since two
tiles can lean towards each other. Change the stagger and the gap changes with
it, or text lands on artwork.

**The Lopsided Folio Rule.** The front page's folio is `1fr / auto` with its two
halves set on the baseline, and the lead sits in a 7:5 spread against its margin
index. Nothing on this page is evenly divided. A symmetrical hero is the one
layout every generated page already has.

## Elevation & Depth

This system is flat. There are no ambient shadows anywhere in it, and depth is
carried entirely by three tonal steps — `#121110` → `#1a1917` → `#232220` — plus
hairline rules and the 1px paper tooth on the ground. A modal is a panel with a
border over a 70% black scrim, not a lifted card. A dropdown is a panel with a
border. A hovered row changes tone; it does not rise.

One exception survives in the code and is **deprecated by decision**: the roll
screen's sleeve carries `box-shadow: 14px 14px 0 var(--accent)`, a hard red slab
with no blur. It is the only `box-shadow` in the entire stylesheet. It should
not be extended to any other surface, and it should eventually come out.

### Named Rules

**The Flat Ground Rule.** Depth is tone and rule, never shadow. A blurred shadow
anywhere in this system is wrong on sight — there is no vocabulary for it to be
consistent with.

## Shapes

Square, with one sanctioned exception.

Corners are `0` on everything that shows or frames content — artwork, badges,
score keys, the progress track, dropdown lists, the search field — and `2px`
(`--radius`) on controls and containers where a hairline box wants the faintest
softening: buttons, filter chips, input fields, the modal shell. The difference
between 0 and 2px is not meant to be legible; it is the difference between a
blade and an edge.

The exception is the **pill** (`999px`), reserved for genre chips, tag chips and
the LOCAL / visitor badges. A pill in this system means *a word*, not a control:
it marks a piece of vocabulary that happens to be clickable. Styles, which are
description rather than vocabulary, are deliberately not pills — they are plain
serif text separated by middots, because nine identical capsules in a row were
indistinguishable from the genres beside them.

Borders are uniformly 1px `#34322e`, with 2px bone reserved for region rules.
Focus is a 2px Sleeve Red outline at 2px offset, never a glow.

### Named Rules

**The Square Rule.** 0 or 2px, plus the 999px pill and one 50% dot. The 4px,
5px, 6px and 10px radii are gone — the detector now reports zero radii outside
the scale. Anything that reappears is drift.

**The Pill Means A Word Rule.** A 999px radius marks vocabulary: a genre, a tag,
a mode badge. If it performs an action rather than naming a thing, it is not a
pill.

## Components

### Buttons

- **Shape:** near-square (2px), 1px hairline border, never filled at rest
- **Ghost (default):** transparent on hairline, bone text, mono micro-caps
  tracked 0.1em, `11px 18px`. Hover lifts the background one tone; active
  translates 1px down
- **Primary:** bone fill (`#efe9dd`), ink text (`#121110`), same geometry,
  weight 500. Hover goes to pure white. The loudest object on the screen, and
  deliberately not the accent
- **Danger:** Alarm text on a dark rust border, filling solid when armed. Two
  taps, never a browser dialog
- **Linkish:** a button that reads as a link — Sleeve Red, underlined at 3px
  offset — used where navigation is not what happens

### Score keys

The signature control of the rating flow. Seven flush cells sharing single
hairline borders (each suppresses its right border except the last), so the row
reads as one segmented block rather than seven buttons. Square, `14px 0`,
minimum 56px wide, mono at 15px. The selected score fills Sleeve Red. Sized for
a thumb first and a number key second.

Beneath it, set apart under a mono caption, *Out of rotation*, a single
quieter key: **Not Recommended**, the one grade below 70. Smaller type and dim
ink, never a smaller target: 44px tall, like everything you press. A verdict
that removes a record from rotation is a different kind of answer from how much
you liked it, and it sits apart so it is never one slip away from 70.

### Chips

- **Filter chip:** transparent on hairline, dim mono caps, 2px corners. Selected
  lifts to Panel Raised with bone text — state by tone, not by colour
- **Genre chip:** Panel Raised pill with hairline border, 12px, dim. Hovering a
  clickable one shifts its border to Sleeve Red
- **Style:** not a chip. Plain serif at 14px in Bone Dim, middot-separated
- **Tag chip (editor):** a pill that turns Rust on hover and fills Rust at 14%
  when armed for deletion — the only control that destroys data with no modal in
  front of it, so it is loud on purpose

### Cards / Containers

- **Corner:** 2px on the modal shell; 0 on everything it contains
- **Background:** Panel, with a hairline border, over a 70% black scrim
- **Shadow strategy:** none — see Elevation & Depth
- **Internal padding:** 28px desktop, 16px below 720px
- **Layout:** a fixed 340px artwork column beside a fluid body, collapsing to one
  column on phones

### Inputs / Fields

- **Search:** no box at all — a bottom hairline only, serif at 17px, 10px of
  padding. Focus turns the underline Sleeve Red. It reads as a writing line
  rather than as a form control
- **Field:** Panel Raised on a hairline, 2px corners, 15px, 10px padding. Focus
  shifts the border to Sleeve Red
- **Combobox:** a 150px mono chip that opens a Panel list, options ranked by how
  much of the collection each covers. The active option fills Sleeve Red. Inside
  an album sheet the same control widens to fill its field and drops its caps

### Navigation

Mono micro-caps at 12px tracked 0.14em, dim by default, going bone with a 2px
Sleeve Red underline when current. Roll sits after a 13px hairline divider
because it is a thing you do rather than a place you browse; Fix is always
Sleeve Red, because it only appears when you are signed in and it always means
work is waiting. The whole bar is sticky, 1px-ruled, and backdrop-blurred.

### Maintenance verdicts

Three mono micro-caps buttons on the right of a row, at opacity 0 until the row
is hovered or something inside it takes focus — and lit outright under
`(hover: none)`, because a control that only appears on hover does not exist on
the phone this is read on. A flagged row keeps an Amber 2px rule at its left
edge; a settled one drops to 40% and leaves the list, recoverable from a lit
control at the list's foot.

**The Button Names The Value Rule.** A control that writes something says what
it will write — `Use 2001`, `Rename` — never `Apply`, `Confirm` or `OK`. The
point of settling an item from a list is not having to open the record to find
out what you just agreed to, and a verb-labelled button gives that back. It
wears the accent outline of `.hs__act--go`, the one place a verdict control
takes colour, and it is the only button in a row that outlives a verdict:
flagging means *keep this in front of me*, which is not a reason to remove the
control that would end it.

### The leaning tile

The system's signature. A borderless button holding square artwork, a
three-line-clamped title and a mono artist line, offset by
`translate(drift, lift × direction × jitter)`. Direction alternates from the
tile's position in the wall via `:nth-child(odd/even)` so neighbours always
disagree; the magnitude comes from a multiplicative hash of the album id, so a
given record always sits at the same height and the wall does not reshuffle on
re-render. Hover outlines the artwork 2px in Sleeve Red. A score sits as a red
badge in the bottom-right corner of the sleeve, and that badge is the tile's
only overlay -- an album either carries a number or it does not.

### Generated cover art

When no artwork exists, the sleeve is generated rather than left empty: a 135°
linear gradient between `hsl(h 55% 32%)` and `hsl(h+40..120 45% 16%)`, where the
hue is a hash of artist plus title, carrying the artist's and album's first
letters at 26% of the tile size in 85% white. Deterministic, so the same record
always generates the same sleeve.

## Do's and Don'ts

### Do:

- **Do** keep every neutral warm — red channel highest, blue lowest. Test a new
  grey against `#1a1917` before committing it.
- **Do** give data `font-variant-numeric: tabular-nums` and mono; give prose the
  serif and a measure between 34ch and 46ch.
- **Do** reserve Sleeve Red for state, identity and focus. If it is decorative,
  it is wrong.
- **Do** buy stagger out of the row gap. Any change to `LIFTS` is also a change
  to `.grid`'s 52px.
- **Do** use `:focus-visible` with a 2px Sleeve Red outline at 2px offset, and
  keep recessive controls in the tab order — `opacity: 0`, never `display: none`.
- **Do** respect `prefers-reduced-motion`; the system already disables the deal,
  riseIn, progress-fill and cover-zoom animations under it.
- **Do** close a region with a 2px bone rule and separate peers with a 1px
  hairline. The weight is the meaning.

### Don't:

- **Don't** add a blurred shadow. There is no shadow vocabulary here, and the
  one hard slab that exists is deprecated rather than a precedent.
- **Don't** introduce a second red. `#c4392a` and `#d6412f` are already drift.
- **Don't** reach for a cool grey. Every neutral here has R > B. The five that
  did not — `#26262e`, `#3a3a44`, `#2c2c35`, `#1c1c22` and the header's
  `rgba(13, 13, 15, 0.92)` — have been removed, so a new one shows up at once.
- **Don't** round anything to 4px, 5px, 6px or 10px. 0, 2px, or a 999px pill.
- **Don't** set red text below 24px in `--accent`. That is what `--accent-text`
  is for, and the difference is an accessibility failure, not a preference.
- **Don't** give a callout a coloured left bar. The hue rides the 1px hairline:
  weight here means region (2px bone) or peer (1px), never severity.
- **Don't** fill a control with the accent to mean "act". Red fills mark state,
  identity and value; bone fills act; the red family fills only to destroy.
- **Don't** set a name in the serif. An album title is a name, so it wears the
  display face — on the shelf as well as on the roll.
- **Don't** make a style look like a genre. Pills are vocabulary you can act on;
  styles are description.
- **Don't** set a control in Newsreader or a paragraph in JetBrains Mono.
- **Don't** centre a hero. The folio's asymmetry is load-bearing.
- **Don't** put `env(safe-area-inset-top)` anywhere but `padding-top`.

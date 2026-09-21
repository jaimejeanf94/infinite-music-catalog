# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**The owner.** One person, one account, and the only account this system will
ever have — sign-ups are off in Supabase and `db/public_hardening.sql` names a
single user id. They keep a 4,414-album want-to-hear list that outgrew a Google
Sheet, and they are the only person who can rate, edit, delete or maintain
anything.

**People the owner sends a link to.** Confirmed as a genuine audience, not a
by-product of the database being public: a shared shelf view, a genre filter or
the day's five should read well to someone who is not the owner. Signed-out
visitors browse, search, filter, roll and follow streaming links. They are never
shown a control that would fail — the score buttons, notes, cover field, add,
delete and the Deleted filter are all absent, and Row Level Security rejects the
write regardless. `?as=visitor` on any view previews exactly what they see.

Multi-user is **not** a goal. Nothing needs to be built for a second owner.

## Product Purpose

Turn a spreadsheet of albums nobody was ever going to work through into
something that answers two questions:

1. **What do I play right now?** The app serves one album — the day's five on
   the front page, or a roll from the whole collection — so the decision is made
   for you rather than by scrolling 4,414 rows.
2. **Is the catalogue right?** Covers, genres, years and names being correct is
   an end in itself, not just upkeep. The collection is the thing being kept.

Both of these outrank the third activity, rating. 396 of 4,414 albums carry a
score and clearing that backlog is **not** the primary job; a rating is what
happens after listening, not a target to grind down. When speed-of-rating
conflicts with either question above, the question above wins.

Success is a collection that is correct, a front page worth opening, and a
maintenance list that can actually reach zero.

## Positioning

Three mechanisms a neighbouring "random album" tool could not truthfully claim:

- **Odds by tier, not by album.** Each score owns a fixed slice of the rolls and
  splits it evenly among its members, drawn from `crypto.getRandomValues()`
  rather than `Math.random()`. Carried over from the original spreadsheet with
  one deliberate correction: unrated albums are their own tier instead of
  diluting the 100s, so a real 100 now comes up ~50× more often than any one
  unrated album. Verified by 200,000 rolls against the real collection.
- **A genre/style split computed from this collection.** A tag is a *genre* when
  roughly 1.2% of the collection carries it; everything else is a *style*. The
  split is derived rather than imported because no source provides a usable one
  — MusicBrainz is a flat list of ~2,200 tags, Discogs files every kind of metal
  and shoegaze under "Rock", and Rate Your Music's robots.txt prohibits
  automated access. The bar being relative is what keeps `post-rock`, `idm` and
  `krautrock` browsable instead of collapsing into "rock".
- **Identified once, then artwork by id.** An album is matched to a MusicBrainz
  release-group and the cover is fetched by that id, so a sleeve cannot drift
  onto the wrong record. The first version searched iTunes and took result one,
  which quietly dressed albums in other bands' covers.

## Operating Context

- **Primary use is on a phone, away from the desk.** Confirmed. Not at the
  computer. This matters because the app's fastest path — the Roll screen's
  one-keystroke scoring (`1`–`7`, `0`, `space`, `p`, `x`) — does not exist in
  that context. Recorded as a standing fact about how the product is used, not
  as a defect to be fixed by this record.
- Listening happens elsewhere. The app does not play music; it links out to
  streaming services.
- The daily rhythm is: open the front page, read the day's five (`app/daily.json`,
  written by the nightly job), pick one.
- A nightly GitHub Actions run at 00:37 Mexico City time does the
  upkeep on GitHub's machines, whether or not the owner's computer is on:
  export → apply confident renames → enrich a batch → cache new artwork →
  import → re-export → reports → today's five → commit.
- **Fix** is where that run hands over what it could not decide alone — a year
  that could be yours or could be a reissue, a name it would not rename on its
  own. Where a row carries a suggestion the page offers to write it, naming the
  value rather than the verb ("Use 2001"), and an applied suggestion can be
  undone, album and all, until the next nightly run rewrites the list. Verdicts are durable
  (`dismissed` uncounts and leaves the list, `flagged` pins, still counts, and
  keeps the fix on offer) and stored in `review_flags`, so a settled row stays
  settled — out of the list, not greyed at the bottom of it forever.
- `git log data/albums.csv` is the collection's dated history; restoring a bad
  week is a checkout and `import.mjs --restore`.

## Capabilities and Constraints

- **No build step, and this is not up for revision.** React 18, Babel standalone
  and supabase-js load from a CDN; the `.jsx` files compile in the browser.
  There is no `npm install`, no `package.json`, and no `node_modules` anywhere
  in the project. Edit a file, refresh, see the change.
- **Two data sources behind one interface.** `app/supabase-client.js` talks to
  the cloud; `app/local-source.js` reads `data/albums.csv` and saves to
  `localStorage`. Local mode takes over automatically when `config.js` has no
  keys, and the rest of the app never notices.
- Postgres on Supabase is the source of truth. Anyone may read; exactly one
  account may write, enforced by Row Level Security rather than by hiding the
  anon key, which is designed to be public.
- **Everything runs on free tiers and the cost of running it is nothing.** That
  is a constraint on future work, not just a fact: ~4,200 cached covers already
  occupy roughly 340 MB of the Storage allowance.
- **Deleting is never destructive.** `deleted_at` is a timestamp, the row stays,
  the export leaves it out and the nightly import deliberately still counts it
  as present so it cannot be resurrected. Restore returns score, notes and
  artwork because they never went anywhere.
- **What a person typed is never touched by automation.** artist, title, year,
  score and notes are owner-written and the nightly run does not write them.
  A cover the owner set is `cover_locked` and kept. Year disagreements are
  reported, never applied.
- `artist::title` is the identity for enrichment records and local edits, which
  is why a rename goes through **Edit name** in the app or `scripts/rename.mjs`
  rather than an editor. Row position in the CSV is never an identity.
- The shelf renders 60 tiles at a time and grows on scroll; 4,414 at once
  crawls. PostgREST caps a response at 1,000 rows, so reads paginate.
- View state lives in the URL hash — search, filter, genre, sort, roll mode — so
  any view can be bookmarked and sent, and Back undoes one filter.
- Vocabulary, used consistently in the UI and in this record: **Roll** (the
  randomiser), **Shelf** (browse), **Fix** (maintenance), **pool** (what the
  randomiser may draw from), **tier** (a score's slice of the odds), **genre**
  (what you browse by) versus **style** (what the record actually is).
- Undecided, deliberately: whether the shared-link audience gets anything of its
  own beyond having owner controls hidden; and whether the release-group scoring
  is changed to prefer the earliest plain Album, which is the known cause of the
  remaining wrong covers, genres and years.

## Brand Commitments

- Name: **Infinite Music Catalog**. Live at
  <https://infinite-music-catalog.vercel.app>.
- The project declares its visual direction a committed one in README §11:
  bone-cream on ink, signal red, condensed signage type set large, monospace for
  every piece of data, hairline rules, square corners, and the covers supplying
  every other colour. Recorded here as binding, not expanded — the visual record
  belongs in DESIGN.md.
- Existing UI copy is plain and unhedged, states what a control does rather than
  selling it, and explains a decision where the reason is not obvious.

## Evidence on Hand

Real, in the repository, and the only evidence there is:

- `data/albums.csv` — 4,415 albums, 2,184 artists, 1953–2026. 397 rated; 4,415
  with a cover; 4,415 with genres; 4,273 matched to a MusicBrainz release-group.
- `app/health.json` — the current maintenance residue: 51 year gaps, 7
  near-duplicates, 5 held-back renames. No album is missing a cover, genres, or
  a browsable genre root. The year gaps were checked against MusicBrainz a
  second time with the corrected ranking and none of them moved, so they are
  reissue disagreements rather than wrong matches.
- `data/enrichment.json` — one record per album, keyed `artist::title`.
- `app/daily.json` — the five the front page opens on.
- Measured, in README: enrichment at 4.8s an album; Cover Art Archive at two
  redirects and 1.2–3.1s against ~0.3s once cached; and, on the twelve albums
  that actually broke, MusicBrainz 10/12, Discogs 6/12, Deezer 4/12 — which is
  why neither alternative is in the pipeline.
- `scripts/test-roller.mjs` — 200,000 rolls against the real collection,
  checking every figure in the odds table.
- `migration/raw_sheet.csv` — the original spreadsheet. Nothing in `migration/`
  runs any more.

There are no customers, testimonials, press, pricing, licensing or benchmarks
beyond the figures above, and there is one user. Future work must not invent
them.

## Product Principles

1. **The catalogue's correctness is the product.** A wrong sleeve or a wrong
   year is not cosmetic; it is the collection being wrong. Work that makes the
   record more accurate outranks work that makes it faster to get through.
2. **Nothing a person typed is ever overwritten, and nothing is ever destroyed.**
   Automation fills gaps and refreshes what it owns. Every other field is the
   owner's, deletion is a tombstone, and an override is respected permanently.
3. **Automation decides what it can and hands over a list that can reach zero.**
   An alert with no action behind it is not a maintenance item — it is retired,
   or turned into one. The residue is finishable by design.
4. **The page is complete the moment it opens.** What the nightly run already
   knows ships with the app rather than being fetched at load.
5. **A URL is the unit of sharing.** Any view worth looking at is a link worth
   sending, and it must still make sense to whoever opens it signed out.

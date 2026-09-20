# Infinite Music Catalog

A randomiser and rating tool for a 4,476-album listening list that outgrew its
spreadsheet. Roll an album, rate it in one keystroke, and browse the whole
collection by artist, year, score or genre.

| | |
|---|---|
| Albums | 4,476 (2,197 artists, 1953–2026) |
| Rated | 403 at migration — the other 91% is the point of the app |
| In the random pool | 4,377 |
| Cost to run | nothing; every service is on a free tier |

---

## 1. How it fits together

```
Supabase (Postgres)  ←→  app/  ─────→  Vercel
   source of truth       the UI       the URL
        │
        ├── export.mjs ──→ data/albums.csv ──→ committed to git (the backup)
        └── enrich.mjs ──→ data/enrichment.json (genres, artwork, ids)
```

Three things to understand and the rest follows:

**No build step.** React, Babel and the Supabase client load from a CDN and the
`.jsx` files compile in the browser. Edit a file, refresh, see the change. There
is no `npm install` anywhere in this project, and no `node_modules`.

**Two data sources behind one interface.** `app/supabase-client.js` talks to the
cloud; `app/local-source.js` reads the CSV and saves to `localStorage`. If
`config.js` has no Supabase keys, local mode takes over automatically and the
rest of the app never notices. That is your development environment — you can
work on the app without touching live data.

**Anyone can read, only you can write.** Enforced by Row Level Security in
`db/schema.sql`, not by hiding the key in `config.js` — that key is designed to
be public.

Visitors get a genuine read-only view: no score buttons (the score shows as a
badge), no notes box, no cover field, no add or delete, no Deleted filter. They
can browse, search, filter and roll, and follow the streaming links. The rules
in the database reject a write regardless, so the hiding is for clarity rather
than for safety — a visitor is never shown a control that would fail.

Append `?as=visitor` to any view to see exactly what they see without signing
out: `#/browse?as=visitor`. It can only take abilities away, never grant them.

---

## 2. Run it locally

From the project root:

```sh
python3 -m http.server 8777
```

Open <http://localhost:8777/app/index.html>.

**This talks to the live database.** `app/config.js` holds the project keys, so
a local server is the deployed app with a different address — rating an album
here rates it for real, and so does a delete. There is no separate development
copy.

A `LOCAL` badge in the header means the opposite: `config.js` still has its
placeholders, so the page is reading `data/albums.csv` and saving to that
browser only. A fresh clone by someone else behaves that way. If you see that
badge on your own machine, `config.js` has been reverted.

Serve from the **project root**, not from inside `app/` — in local mode the
page reaches up to `../data/`.

Rated things in local mode and want to keep them? `db.exportEdits()` in the
browser console prints SQL you can paste into Supabase.

---

## 3. The two screens

The app opens on the Shelf. Navigation sits top-left, where reading starts —
it was on the right past a wide gap, which read as trim rather than as the way
to the other screen.

### Roll — the randomiser

Built for speed: one album, one keystroke, next.

| Key | Does |
|-----|------|
| `1`–`7` | Score 70, 75, 80, 85, 90, 95, 100 |
| `0` | Clear the score |
| `space` / `enter` | Roll again |
| `p` | Log a play |
| `x` | Drop it from the random pool |

Three modes. **Weighted** is the day-to-day roll (section 7). **Unrated** draws
only from albums with no score — the mode for working through the backlog.
**Uniform** gives every album in the pool equal odds. Switching mode rolls
immediately rather than leaving the last album on screen.

### Shelf — browsing

Search across artist, album and year; filter by rated / unrated / out of pool /
deleted; filter by genre; sort four ways. All of it lives in the URL, so a view
can be bookmarked and shared and Back undoes a filter. Tiles render 60 at a time
and grow as you scroll, because 4,476 at once crawls.

**Genre and style are separate things.** Genre is what you browse by; style is
what the record actually is. Deafheaven's *Lonely People With Power* is genre
`black metal`, style `post-metal, blackgaze`. Genres are chips you can click to filter; styles are plain text, because half
of them sit on two albums or fewer and a bordered pill reads as something you
can press.

The split is computed from your collection rather than imported, because no
source provides a usable one. MusicBrainz tags are a flat list of 2,200 names
with no hierarchy. Discogs *does* have genre and style as separate fields, but
files every kind of metal, shoegaze and post-punk under "Rock" — too coarse to
browse by. Rate Your Music has the best taxonomy and no public API; its
robots.txt prohibits automated access outright.

So `app/genres.js` applies three rules:

1. A tag is a **genre** if enough albums here carry it (~1.2% of the
   collection). The bar is relative, so `post-rock`, `idm` and `krautrock` stay
   genres instead of collapsing into "rock".
2. A few tags sit on so many albums they say nothing when anything better is
   present — `rock` is on Nails' grindcore record. Those are dropped when the
   album has something specific, and kept when it does not, which is why
   Pavement is still `rock, indie rock`.
3. An album left with nothing then gets a family inferred from its tags.
   MusicBrainz has no plain `metal` tag, so Nails would otherwise have no genre
   at all. It now reads genre `metal`, style `grindcore, powerviolence`.

Everything else is a style. The genre filter is a combobox rather than a
dropdown — 69 genres, opened ranked by how much of the collection each covers,
and typing reaches the rest.

- **+ Add album** — artist and title required, year and an initial score
  optional. Duplicates are refused by the database and caught in the form first,
  so it tells you which album clashes.
- **Delete** — two taps, no browser dialog. Never destructive (section 5).
- **Cover image** — paste a URL in the detail sheet to override the artwork.
  That sets `cover_locked` and the nightly run stops touching it.

---

## 4. The data model

```sql
albums    artist, title, year, score, in_pool, notes, genres, mbid,
          cover_url, cover_locked, source, deleted_at
rolls     album_id, mode, outcome, rolled_at      -- what the randomiser served
```

`score` is `NULL` until you rate it, and stays distinct from 100 on purpose —
see section 7. `source` records whether an album came from the original
spreadsheet or was added in the app. `in_pool` is the sheet's old `RSP` column:
false means it never comes up on a roll, without being deleted.

### What overwrites what

| Field | Written by | Touched by the nightly run? |
|---|---|---|
| artist, title, year | you | **never** |
| score, notes, in_pool | you | **never** |
| genres, mbid | enrichment | yes — refreshed |
| cover_url | enrichment, or you | **yours is kept** (`cover_locked`) |
| deleted_at | you | never resurrected |

Nothing is stored against an album's position in `albums.csv`. Row numbers are
not identities — merging or re-sorting the file shifts every row below the
change, and anything keyed that way silently re-attaches itself to whatever
album slid into the slot. Local edits, tombstones and enrichment all key on
`artist::title` instead, which is also why renaming goes through
`scripts/rename.mjs` (section 10) rather than an editor.

---

## 5. Deleting is never destructive

Nothing is removed from the database. Deleting sets `deleted_at` and the row
stays where it was — a timestamp rather than a boolean, so you also know when.

Everything respects it: the app hides it, `export.mjs` leaves it out of the CSV,
and `import.mjs` deliberately still counts it as present so the nightly run
cannot bring it back.

To undo, open **Browse → Deleted** and press Restore. Score, notes and artwork
come back, because they never went anywhere. Local mode behaves identically,
with the tombstone as a list of ids in `localStorage`.

---

## 6. Genres and artwork

```sh
node scripts/enrich.mjs              # the whole collection, ~6 hours
node scripts/enrich.mjs --limit=50   # a batch
node scripts/enrich.mjs --retry      # re-attempt previous failures
```

No account, no keys. Results land in `data/enrichment.json`, keyed by artist and
title, and both the app and `import.mjs` merge them. Resumable — stop it
whenever, it picks up where it left off.

**The retry pass runs itself.** `--retry` re-attempts albums that failed and
albums that matched but carry no genres, with a 14-day cooldown per album so
the ones MusicBrainz genuinely lacks are not re-queried every night. The nightly
workflow runs it after each batch, and the nightly job sweeps the gaps on a
local backfill to exit and sweeps immediately. Nothing to remember.

### Why the covers are cached

A `coverartarchive.org/release-group/<id>/front-500` URL is not a file, it is a
lookup. It redirects to `archive.org`, which redirects again to whichever
storage node holds the image. Measured on this collection:

| Source | Redirects | Time | Size |
|---|---|---|---|
| Cover Art Archive | 2 | 1.2 – 3.1 s | 60 – 140 KB |
| A normal CDN | 0 | 0.3 s | ~160 KB |

The images are small. The cost is latency, not weight, which is why caching
them fixes it and serving them smaller would not.

`scripts/cache-covers.mjs` copies each one into a Supabase Storage bucket once
and rewrites `cover_url` to point there. About 4,200 covers at ~83 KB is
roughly **340 MB**, which fits the free storage allowance with room to spare —
worth checking your current usage in the dashboard, since the limits move.

The original URL is kept as `cover_source_url`, so a cached cover can always be
re-fetched from the source. Re-running the script resumes: anything already
pointing at Supabase is skipped.

Set-up is two steps, both one-off:

1. Supabase dashboard -> **Storage** -> **New bucket**, name `covers`, **Public
   ON**. Public makes *reads* keyless and CDN-served; it does not make writes
   public.
2. Run `db/storage.sql` with your UID pasted in, which pins writes to your
   account.

The browse grid renders 60 tiles at a time and grows on scroll, so a page load
asks for about a screenful of covers, never all 4,400.

### When a match fails

The query is relaxed in stages, and each stage only runs because the last one
failed, so the ~88% that match first time pay nothing:

1. The title as written, then with disc markers, bracketed editions and
   subtitles stripped.
2. An unquoted search, accepted only when artist *and* title agree.
3. **Anchored on the artist instead.** MusicBrainz's artist search is fuzzy, so
   "Gorilaz" still finds Gorillaz — then the title is matched against that one
   band's discography rather than the whole database, which is what makes a
   loose match safe. This recovers misspelled artists: "Freddie Gibs",
   "Mr. Morales".
4. Still nothing: Deezer is asked for artwork alone, and the album is recorded
   as a no-match — which doubles as a spelling report.

Albums MusicBrainz has but nobody tagged (~5%) fall back to the **artist's** own
tags, recorded as `genre_source: "artist"` since those describe a career rather
than a record.

Non-Latin titles are the one case nothing recovers: text queries and edit
distance are both meaningless across scripts.

**Measured at 4.8 seconds an album.** Not one request a second: an album that
misses its first query is retried with progressively looser ones, and each retry
is another request against MusicBrainz's limit. Albums that match immediately
take ~1.5s; awkward ones take seven.

### Why it works this way

The first version searched iTunes and took result number one. iTunes **always**
returns something, so albums it had never heard of quietly got other bands'
covers, and nothing checked the artist matched.

Now each album is identified once against MusicBrainz, which returns nothing
rather than a wrong guess. A match needs a score of 85+ **and** artist-name
agreement, and candidates are ranked so live, remix and compilation editions
lose to the studio album unless your title asks for one. Artwork then comes from
the Cover Art Archive **by id**, so it cannot drift onto the wrong record.

Deezer is a fallback for the handful MusicBrainz cannot place — it tolerates
misspelled artists. iTunes is the last resort, and its answer is now
artist-checked before use.

Genres come from MusicBrainz tags filtered against its 2,202 canonical genres
(cached in `data/mb-genres.json`), which is how you get `blackgaze` and
`third stream` rather than `Rock` and `Jazz`.

**Measured against three sources** on the twelve albums that actually broke:
MusicBrainz 10/12, Discogs 6/12, Deezer 4/12. Neither alternative found anything
MusicBrainz could not, so neither is in the pipeline.

Two side effects worth knowing:

- **Albums nothing can find are usually typos in your data.** The no-match list
  is a spelling report — it caught "Freddie Gibs" and "Gorilaz".
- **Year disagreements are reported, never applied.** Your entry may be the
  pressing you own rather than the first release.

---

## 7. How the randomiser works

Albums are weighted by **tier**, not individually: each score owns a fixed slice
of the odds and splits it evenly among its members.

| Tier | Share of rolls | Albums | Odds for one album |
|---|---|---|---|
| 100 | 18.75% | 59 | 0.318% |
| 95 | 11.25% | 27 | 0.417% |
| 90 | 11.25% | 61 | 0.184% |
| 85 | 9.75% | 60 | 0.163% |
| 80 | 9.75% | 74 | 0.132% |
| 75 | 7.13% | 58 | 0.123% |
| 70 | 7.13% | 60 | 0.119% |
| unrated | 25% | 3,978 | 0.006% |

A quirk that follows from the design: a 95 has better per-album odds than a 100,
because only 27 albums divide the 95 slice against 59 dividing the 100 slice.

**One change from the spreadsheet.** There, the 100 tier also held every unrated
album, so a genuine 100 was diluted to the odds of something never played. They
are separate tiers here, and a real 100 now comes up ~50× more often than any
one unrated album. The slider on the Roll screen moves the unrated share; at its
25% default the overall balance matches the sheet.

**The randomness is cryptographic.** `Math.random()` is a pseudo-random
generator with no guarantee of unpredictability, so the roller draws from
`crypto.getRandomValues()` — the operating system's entropy pool — 256 values at
a time, each divided by 2³² to give a float in [0, 1).

```sh
node scripts/test-roller.mjs
```

rolls 200,000 times against the real collection and checks every figure in that
table, confirms two runs differ, and spreads 100,000 raw draws across ten
buckets. Run it after touching the randomiser.

---

## 8. Going live

> **Done.** The app is at <https://infinite-music-catalog.vercel.app>, reading
> the `albums` table in Supabase. `DEPLOY.md` is the step-by-step, kept for
> reference or for standing it up again. What follows is why each piece is the
> way it is.

### a. Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query**, paste all of `db/schema.sql`, Run.
3. **Authentication → Users → Add user** — your email and a password. This is
   the only account that will ever exist.
4. **Authentication → Sign In / Providers → Email** — turn *Allow new users to
   sign up* **off**. The security rules depend on it.
5. **Table Editor → `albums` → Import data from CSV** — `data/albums.csv`.
   Leave `id` out; the database fills it in. Or `node scripts/import.mjs`.
6. **Project Settings → API** — copy the Project URL and the *anon /
   publishable* key into `app/config.js`.

Refresh: the `LOCAL` badge disappears and a Sign in button replaces it.

> None of this SQL has been run against a live database yet. It is written to
> fail loudly rather than silently, and `db/public_hardening.sql` ends with two
> verification queries. Check them rather than assuming.

### b. GitHub

```sh
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
gh auth login
gh repo create infinite-music-catalog --private --source=. --push
```

Then add four secrets under **Settings → Secrets and variables → Actions**:
`SUPABASE_URL`, `SUPABASE_KEY`, `IMC_EMAIL`, `IMC_PASSWORD`.

### c. Vercel

*Add New → Project*, import the repo, framework **Other**, root directory
**`app`**, no build command. Every future `git push` redeploys.

### d. Before making anything public

Run `db/public_hardening.sql` with your user id pasted in. Today, writes are
allowed for any *signed-in* user, which is safe only because sign-ups are off —
one checkbox between your collection and anyone who wants to edit it. The
hardening file names exactly one user id, and closes read access on `rolls` and
`rolls`, which is the only personal data here.

Then prove it: open the deployed site **signed out** and run
`await db.updateAlbum(1, { score: 70 })` in the console. It must fail.

---

## 9. The nightly flow

`.github/workflows/refresh.yml` runs at 07:00 UTC on GitHub's servers — your
computer can be closed:

1. `export.mjs` — database → `data/albums.csv`
2. `enrich.mjs --limit=300` — ~25 minutes while there is a backlog, about a
   minute once caught up
3. `import.mjs` — pushes genres and artwork back
4. commits the CSV

Step 4 is the point: `git log data/albums.csv` becomes a dated history of the
collection, and restoring a bad week is
`git checkout <commit> -- data/albums.csv && node scripts/import.mjs`.

Both database steps are skipped when the Supabase secrets are absent, so the
workflow is useful before the database exists. There is a **Run workflow**
button in the Actions tab; a full backfill needs two runs of 2,500, since a job
is capped at six hours.

### Why the spreadsheet was retired

Once the app could add and delete, keeping it meant two writable sources with
only one-way sync — we cannot write back to Google Sheets without OAuth, so the
sheet would have drifted wrong and stayed wrong. The original export is kept at
`migration/raw_sheet.csv` and `migration/clean.py` is the one-time migration that produced
the first `albums.csv`. Neither runs any more.

---

## 10. Running the scripts

Credentials come from the environment, so nothing sensitive is committed:

```sh
export SUPABASE_URL="https://xxxxxxxx.supabase.co"
export SUPABASE_KEY="sb_publishable_..."
export IMC_EMAIL="you@example.com"
export IMC_PASSWORD="..."

node scripts/export.mjs      # database -> albums.csv (the backup)
node scripts/enrich.mjs      # genres, artwork, MusicBrainz ids (no account)
node scripts/import.mjs      # push albums and enrichment to the database
node scripts/test-roller.mjs # check the randomiser's odds (no account)
node scripts/rename.mjs      # correct a misspelt artist or title (no account)
node scripts/suggest-renames.mjs  # work out what a misspelt album really is
node scripts/cache-covers.mjs     # copy artwork into Supabase Storage
```

### Correcting a name in the app

Once the app is on Supabase, open an album and use **Edit name** on the detail
sheet. There the album's id is the identity and `mbid`, `genres` and
`cover_url` are columns on its row, so a rename is an ordinary update with
nothing to keep in step. The next nightly run sees a name it has no enrichment
record for and re-matches it, which refreshes the genres and artwork.

In local mode the button is replaced by a pointer to the script, because
`enrichment.json` is keyed by `artist::title` and a rename has to move both
halves at once.

### Correcting a name from the command line

A title is an identity: `data/enrichment.json` is keyed by `artist::title`, and
so are the app's local edits. Editing `albums.csv` by hand orphans that album's
cover and genres. Use the script, which moves both halves together:

```sh
node scripts/rename.mjs --from "Bjork::Medula" --to "Björk::Medúlla" --dry-run
node scripts/rename.mjs --file renames.json --refresh
```

`--dry-run` prints the plan and writes nothing. `--refresh` throws the old
enrichment away instead of carrying it, so the next `enrich.mjs` re-matches on
the corrected name — worth it when the misspelling only ever got a fuzzy
fallback, since a correct title finds a MusicBrainz release-group and brings
genres with it.

If you own **both** spellings, that is a merge, not a rename. Add
`"merge": true` and the correctly-spelled row survives, taking whichever score
and year actually exist; the duplicate is dropped. Without the flag a rename
onto an existing album is refused, because silently collapsing two rows is how
a rating goes missing.

The script refuses to run while `enrich.mjs` is going: that job holds the whole
enrichment store in memory and would overwrite the changes on its next save.

---

## 11. Design

The look is a committed direction rather than a default: bone-cream on ink,
signal red, condensed signage type set large, monospace for every piece of data,
hairline rules, square corners. The covers supply every other colour.

Four agent skills are installed **project-locally** under `.agents/skills`
(symlinked into `.claude/skills`), so no other project on the machine sees them:
`frontend-design` and `web-design-guidelines` from Vercel, `supabase` and
`supabase-postgres-best-practices` from Supabase. They are guidance, not code.
The Supabase pair exist because the SQL here has never been run.

---

## Files

| Path | What it is |
|------|-----------|
| `app/index.html` | Shell, routing, sign-in, optimistic saves |
| `app/roll.jsx` | The randomiser screen |
| `app/browse.jsx` | Search, filters, grid, detail, add/delete/restore |
| `app/cover-art.jsx` | Artwork by id, verified fallback, generated art |
| `app/roller.js` | The weighting logic, kept plain so it can be tested |
| `app/supabase-client.js` | Every call to the cloud, in one place |
| `app/local-source.js` | The no-account fallback |
| `app/config.js` | Your Supabase URL and key — the only file to edit by hand |
| `db/schema.sql` | Tables, indexes, security rules |
| `db/public_hardening.sql` | Run before making the repo or site public |
| `scripts/enrich.mjs` | Genres, artwork, MusicBrainz ids |
| `scripts/export.mjs` | Database → CSV, the nightly backup |
| `scripts/import.mjs` | CSV and enrichment → database |
| `scripts/test-roller.mjs` | 200,000 rolls against the real collection |
| `data/enrichment.json` | What enrichment found, keyed by artist + title |
| `migration/` | How the data got here. Nothing in it runs any more |

---

## Known issues

Real, reproduced, and not yet fixed. None of them break the app.

### A large year gap means the wrong release-group

`enrich.mjs` reports albums whose year disagrees with MusicBrainz — currently
371, of which 52 differ by 15 years or more. Those large gaps are not wrong
years. They are wrong matches:

| Album | What was matched instead |
|---|---|
| The Beatles — A Hard Day's Night | *The Alternate A Hard Day's Night* (2004) |
| Art Blakey — Moanin' | a **Live** release-group (2001) |
| American Football — American Football | the **2016** album, not the 1999 debut |

MusicBrainz holds the right record in every case — `A Hard Day's Night`
(1964‑06‑26, Album/Soundtrack) is in the search results, just not the one
`candidateScore` chose. So these albums have the wrong **cover and genres**
too, not only the wrong year.

The fix is in the scoring: prefer a plain Album, and among equally good title
matches prefer the earliest first-release-date. Until then the year is
reported and never applied — applying it would write 2004 onto *A Hard Day's
Night*. The disagreement list is the best bad-match detector the pipeline has.

### 27 albums share a cover with another album

Same-artist over-matching, e.g. *Black Sabbath Vol. 4* wearing *Black
Sabbath*'s sleeve, *EMOTION: Side B* wearing *EMOTION*'s. Roughly half are
legitimately the same artwork, so this needs reading rather than a rule.

### ~310 albums MusicBrainz has never heard of

Genuinely obscure, or misspelt. `suggest-renames.mjs` works through 60 a night
and writes anything uncertain to `data/rename-suggestions-review.json` for you
to accept or ignore. It stamps each album it examines and leaves it alone for
30 days, so the backlog drains in about five nights and then goes quiet.

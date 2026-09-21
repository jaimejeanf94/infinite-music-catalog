# Infinite Music Catalog

A randomiser and rating tool for a listening list that outgrew its spreadsheet.
Open it and it hands you five records; roll one at random; rate it in a
keystroke; browse the whole shelf by artist, year, score or genre.

Live at **<https://infinite-music-catalog.vercel.app>**.

<!-- stats:start -->
| | |
|---|---|
| Albums | 4,418 — 2,184 artists, 1953–2026 |
| Rated | 397. The other 91% is the point of the app |
| Covers | 4,418 — 4,416 of them cached and CDN-served |
| Genres | 4,418 tagged, 26 of them browsable |
| Matched to MusicBrainz | 4,281 |
| Cost to run | nothing — every service is on a free tier |
<!-- stats:end -->

<sub>That table is rewritten by `health-report.mjs` on every nightly run, so it
is never out of date by more than a day.</sub>

---

## 1. How it fits together

```
            ┌──────────────────────────┐
            │  Supabase (Postgres)     │  ← the source of truth
            └────────────┬─────────────┘
                         │
      export.mjs ────────┴──────── import.mjs
           ↓                            ↑
   data/albums.csv                 enrichment
   (the backup, committed          (genres, artwork,
    nightly — git is the            MusicBrainz ids)
    dated history)
                         │
            ┌────────────┴─────────────┐
            │  app/  →  Vercel  →  URL │
            └──────────────────────────┘
```

Three things to understand and the rest follows.

**There is no build step, and this is not up for revision.** React, Babel and
the Supabase client load from a CDN; the `.jsx` files compile in the browser.
Edit a file, refresh, see the change. No `npm install`, no `package.json`, no
`node_modules` — anywhere in this project.

**Two data sources behind one interface.** `app/supabase-client.js` talks to
the cloud; `app/local-source.js` reads the CSV and saves to `localStorage`. If
`config.js` has no Supabase keys, local mode takes over automatically and the
rest of the app never notices. That is the development environment: you can
work on the app without touching live data.

**Anyone can read, only you can write.** Enforced by Row Level Security in
`db/schema.sql`, not by hiding the key in `config.js` — that key is designed to
be public. Sign-ups are off, so exactly one account exists.

Visitors get a genuine read-only view: no score buttons (the score shows as a
badge), no notes, no cover field, no add or delete, no Deleted filter. The
database rejects a write regardless, so the hiding is for clarity rather than
safety — a visitor is never shown a control that would fail. Append
`?as=visitor` to any view to see exactly what they see without signing out. It
can only take abilities away, never grant them.

---

## 2. The four screens

Navigation sits top-left, where reading starts.

### Home — the daily five

Three unrated records and two rated ones, chosen once a day and written to
`app/daily.json` by the nightly run, so the page is complete the moment it
opens with nothing to fetch. One leads at full size; the other four sit in the
margin. It is a doorway, not a decision — every record on it is a link into the
Shelf.

### Roll — the randomiser

Built for speed: one album, one keystroke, next.

| Key | Does |
|-----|------|
| `1`–`7` | Score 70, 75, 80, 85, 90, 95, 100 |
| `0` | Clear the score |
| `space` / `enter` | Roll again |

Three modes. **Uniform** is the default and gives every album equal odds:
with 91% of the shelf unrated, a weighted roll spends most of its odds on one
enormous unrated tier anyway, so it would behave almost like uniform while
looking as if it knew something. **Weighted** favours what you rated highly
(section 6). **Unrated** draws only from albums with no score — the mode for
working through the backlog. Switching mode rolls immediately rather than
leaving the last album on screen. The number keys ignore Cmd and Ctrl, so
switching browser tabs never rates the album on screen.

### Shelf — browsing

Search across artist, album and year; filter by rated, unrated or deleted; sort
four ways. All of it lives in the URL, so a view can be bookmarked and shared
and Back undoes a filter. Tiles render 60 at a time and grow as you scroll,
because four thousand at once crawls.

- **+ Add album** — artist and title required, year and score optional.
  Duplicates are refused by the database and caught in the form first, so it
  names the album that clashes — and one you deleted points you at Restore.
- **Delete** — two taps, no browser dialog. Never destructive (section 5).
- **Cover image** — paste a URL in the detail sheet to override the artwork.
  That sets `cover_locked` and the nightly run stops touching it.

### Fix — maintenance

Owner only. Everything the nightly run could not decide alone, in one list that
can actually reach zero. Each row carries two verdicts and, where the run has a
concrete suggestion, the fix itself:

- **Apply** — the button names the value it will write (`Use 2001`, `Rename`),
  never a bare "Apply", so you can settle an item without opening the record to
  find out what you just agreed to. Undo rewinds the album, not just the
  verdict — and still does after a reload, because each row carries the value
  its fix overwrote.
- **Fine** / **Reject** — checked, nothing wrong. The row leaves the list.
- **Flag** — something *is* wrong, keep it in front of me. It pins to the top,
  still counts, and keeps its fix button.

Verdicts live in `review_flags`, so a settled row stays settled. Rows settled
on an earlier visit leave the list entirely; a control at its foot brings them
back when you want to undo one. Held-back renames stay on the list until you
rename or reject them — the nightly run adds to that pile, it never replaces
it.

**Genre and style are separate things.** Genre is what you browse by; style is
what the record actually is. Deafheaven's *Lonely People With Power* is genre
`metal`, style `black metal, post-metal, blackgaze`. Genres are chips you can
click to filter; styles are plain text, because half of them sit on two albums
or fewer and a bordered pill reads as something you can press.

The split is computed from your collection rather than imported, because no
source provides a usable one. MusicBrainz tags are a flat list of 2,200 names
with no hierarchy. Discogs *does* separate genre and style, but files every
kind of metal, shoegaze and post-punk under "Rock" — too coarse to browse by.
Rate Your Music has the best taxonomy, no public API, and a robots.txt that
prohibits automated access outright.

So `app/genres.js` works from a short fixed list of 26 **roots** — rock split
into the scenes big enough to stand alone here (indie rock, post-punk,
metal…), plus electronic, jazz, hip hop and the rest — and decides an album's
genres in four steps across the ~700 distinct tags on the shelf:

1. Every root the album is tagged with, plus the root any of its tags is an
   **alias** of: soul *is* r&b, afrobeat *is* African. Pavement is tagged
   `rock, indie rock, lo-fi`, so it reads genre `indie rock, rock`, style
   `lo-fi`.
2. **`metal`** if it carries any metal subgenre, whatever else it carries.
   MusicBrainz tags black metal as "black metal", rarely as "metal", and most
   metal records here also carry "rock" — so until this rule existed, 306 of
   the 525 metal records were missing from the metal filter. Nails' grindcore
   record reads genre `metal, rock`, style `grindcore, powerviolence`.
3. Still nothing: the roots its styles attach to — a style belongs to the
   narrowest root it shares at least 40% of its albums with. A record tagged
   only `shoegaze, dream pop` is a rock record, and findable as one.
4. Still nothing: a family pattern. Hardcore is punk; baroque is classical.

Everything else is a style. Whether a style has grown big enough to deserve
its own root is a judgement, so `node scripts/genre-report.mjs` reports it and
never edits the list.

The filter offers all 26, `rock` and `electronic` the largest by some way. It
is a combobox rather than a dropdown, opened ranked by how much of the
collection each covers.

---

## 3. The scripts

Sixteen files in `scripts/`, plus two libraries. Nothing here is a framework
and nothing needs installing — every one is plain Node with no dependencies,
run directly.

Credentials come from the environment, never from a committed file:

```sh
cp .env.example .env && $EDITOR .env
set -a && source .env && set +a
node scripts/export.mjs
```

### Runs itself, nightly, on GitHub's machines

You never type these. `.github/workflows/refresh.yml` runs them in this order
at 00:37 Mexico City time, whether or not your computer is on. Section 4 has
the detail.

| Script | What it does |
|---|---|
| `export.mjs` | Database → `data/albums.csv`. Runs twice: once before the work and once after, so the committed backup reflects what the run actually did |
| `suggest-renames.mjs` | Works out what a misspelt album really is. Confident corrections go to `rename.mjs`; anything uncertain joins the standing pile in `data/rename-suggestions-review.json`, which the Fix screen shows until you rename or reject each one |
| `rename.mjs` | Applies a rename across both halves of an album's identity — the row *and* its enrichment record |
| `enrich.mjs` | Genres, artwork and MusicBrainz ids. The big one (388 lines), and the only script that talks to four external services |
| `cache-covers.mjs` | Copies artwork into Supabase Storage and rewrites `cover_url` to point there — both what enrichment found and what the app found on its own for albums enrichment could not cover. A cover you chose by hand is left alone |
| `import.mjs` | Pushes artwork, and genres for albums that have none, back into Postgres. Never overwrites a genre you edited in the app. Also the restore tool — see section 5 |
| `genre-report.mjs` | Reports whether any style has outgrown the fixed `ROOTS` list. Reports only — that call is a judgement, not a rule |
| `health-report.mjs` | Writes `app/health.json`, the Fix screen's list. Runs `find-duplicates` itself |
| `daily-picks.mjs` | Writes `app/daily.json`, tomorrow's five |

### Runs in CI, on every push

`.github/workflows/check.yml`, path-filtered so it only fires when the files it
reads have changed. Holds no secrets and finishes in seconds.

| Script | What it does |
|---|---|
| `check-app.mjs` | Compiles every `.jsx` that `index.html` loads, with the same Babel the browser loads. Without it a syntax error ships and arrives as a blank page. Exits 2 rather than 1 when the CDN is unreachable, so "I could not check" never reads as "your code is broken" |
| `test-roller.mjs` | 200,000 rolls against the real collection, checking every figure in section 6's table. The weighting is the one piece of logic that can be wrong without *looking* wrong — a bad edit still rolls albums, just at the wrong odds |

### You run by hand, when you need them

| Script | When |
|---|---|
| `rename.mjs` | Correcting one name from the terminal (see below) |
| `find-duplicates.mjs` | Reading the near-duplicate report in full, rather than the Fix screen's summary |
| `export.mjs` / `import.mjs --restore` | Taking a backup now; putting one back (section 5) |
| `enrich.mjs` | Forcing a backfill: `--limit=N`, `--retry`, `--prune` |
| `check-db.mjs` | After pasting SQL into the Supabase editor, where a failed statement is easy to miss. Reads only, apart from one probe row it writes and removes again to prove the policies let you write as well as read |

### One-off setup

| Script | What it does |
|---|---|
| `write-config.mjs` | Generates `app/config.js` from the environment. Both values it reads are meant to be public |
| `fill-sql.mjs` | Writes the policy files out with your user id filled in, into `db/local/`, which git ignores. The committed copies keep their `PASTE_YOUR_UID_HERE` placeholder |

### Libraries — not run directly

| File | Why it is its own file |
|---|---|
| `lib/match.mjs` | Deciding which MusicBrainz release-group an album *is*. The one piece of this pipeline that has been wrong in a way nothing caught: an album can be confidently matched to the wrong record, and then its cover, its genres and its year are all wrong together |
| `supabase-rest.mjs` | Every REST call and the sign-in, in one place |

### Correcting a name

In the app, open an album and use **Edit name** on the detail sheet. There the
album's id is the identity and `mbid`, `genres` and `cover_url` are columns on
its row, so a rename is an ordinary update with nothing to keep in step. The
next nightly run sees a name it has no enrichment record for and re-matches it,
which refreshes the genres and artwork.

From the terminal it is not that simple, and this is the reason the script
exists. A title is an *identity*: `data/enrichment.json` is keyed by
`artist::title`, and so are local-mode edits. Editing `albums.csv` by hand
orphans that album's cover and genres.

```sh
node scripts/rename.mjs --from "Bjork::Medula" --to "Björk::Medúlla" --dry-run
node scripts/rename.mjs --file renames.json --refresh --db
```

`--dry-run` prints the plan and writes nothing. `--refresh` throws the old
enrichment away rather than carrying it over, so the next `enrich.mjs`
re-matches on the corrected name — worth it when the misspelling only ever got
a fuzzy fallback. `--db` carries the rename into Postgres as well, which the
nightly run needs: `import.mjs` matches on artist and title, so a CSV-only
rename would be inserted as a *new* album beside the one it was correcting.

If you own **both** spellings, that is a merge, not a rename. Add
`"merge": true` and the correctly-spelled row survives, taking whichever score
and year actually exist. Without the flag a rename onto an existing album is
refused, because silently collapsing two rows is how a rating goes missing.

The script refuses to run while `enrich.mjs` is going: that job holds the whole
enrichment store in memory and would overwrite the changes on its next save.

---

## 4. The nightly flow

`.github/workflows/refresh.yml`, 00:37 Mexico City time. Your computer can be
closed.

1. **Export** — database → `data/albums.csv`
2. **Correct misspelled names** — `suggest-renames` proposes, `rename --db`
   applies only the confident tier. Anything that changes a sequence number
   (Pt. 2 is one edit from Pt. 1), gains or loses a whole word, or drops a
   credited artist is held back for the Fix screen
3. **Enrich a batch** — 300 albums, then a `--retry` pass over previous failures
4. **Cache any new artwork** into Supabase Storage
5. **Import** — genres and artwork back into Postgres
6. **Export again** — so the committed backup reflects what this run just did,
   rather than the state before it started
7. **Reports** — genre roots, the Fix list, tomorrow's five
8. **Commit** — `data/albums.csv`, `app/daily.json`, `app/health.json`, and
   the README's opening table

Step 8 is the point: `git log data/albums.csv` is a dated history of the
collection, and any night of it can be put back (section 5).

Both database steps are skipped when the Supabase secrets are absent, so the
workflow was useful before the database existed. There is a **Run workflow**
button in the Actions tab; a full backfill needs two runs of 2,500, since a job
is capped at six hours.

**Scheduled runs are neither punctual nor guaranteed.** GitHub queues them on
shared runners. The schedule used to be 07:00 UTC — on the hour, the busiest
slot there is — and its first two runs landed five and six and a half hours
late. It now sits at 00:37, off the hour, as GitHub's docs advise. The same
docs say that under enough load a queued run may be dropped altogether.
Nothing is lost when one is, because every step picks up where the last one
stopped; that day just has no backup commit, and the front page keeps the
previous five until the next run — or until you press **Run workflow**.

---

## 5. Deleting is never destructive

Nothing is removed from the database. Deleting sets `deleted_at` and the row
stays where it was — a timestamp rather than a boolean, so you also know when.

Everything respects it: the app hides it, `export.mjs` leaves it out of the
CSV, and `import.mjs` deliberately still counts it as present so the nightly
run cannot bring it back.

To undo, open **Shelf → Deleted** and press Restore. Score, notes and artwork
come back, because they never went anywhere. Local mode behaves identically,
with the tombstone kept in `localStorage`.

### Putting a backup back

Every night's `albums.csv` is in git, so any night can be restored — a week of
wrong scores, a bad bulk edit, a deletion you regret:

```sh
git checkout <commit> -- data/albums.csv
node scripts/import.mjs --restore --dry-run   # read what it would change
node scripts/import.mjs --restore
git checkout HEAD -- data/albums.csv          # the next export rewrites it anyway
```

`--restore` puts back the fields that are yours on every album the backup and
the database share — year, score, notes, genres, and a cover you had chosen —
brings back anything the backup had that has since been deleted, and adds any
album missing altogether. It never removes one: an album added after the
backup was taken is left where it is. Without the flag, `import.mjs` only adds
missing albums and pushes enrichment, which is why a restore used to restore
nothing.

### The data model

```sql
albums    artist, title, year, score, notes, genres, mbid,
          cover_url, cover_locked, source, deleted_at
rolls     album_id, mode, outcome, rolled_at     -- what the randomiser served
review_flags  kind, subject, album_id, state    -- your verdicts on the Fix list
```

`score` is `NULL` until you rate it, and stays distinct from 100 on purpose —
see section 6. `source` records whether an album came from the original
spreadsheet or was added in the app.

| Field | Written by | Touched by the nightly run? |
|---|---|---|
| artist, title, year | you | **never** |
| score, notes | you | **never** |
| mbid | enrichment | yes — refreshed |
| genres | enrichment, then you | **filled when empty**; replaced only if the album is matched to a different record |
| cover_url | enrichment, or you | **yours is kept** (`cover_locked`) |
| deleted_at | you | never resurrected |

Nothing is stored against an album's position in `albums.csv`. Row numbers are
not identities — merging or re-sorting the file shifts every row below the
change, and anything keyed that way silently re-attaches itself to whatever
album slid into the slot. Local edits, tombstones and enrichment all key on
`artist::title` instead, which is why renaming goes through `rename.mjs` rather
than an editor.

`rolls` is written on every spin you make and read by nothing yet — kept as
the one record of what the randomiser actually served.

Schema changes live in `db/migrations/`, one dated file each, and are folded
into `db/schema.sql` too, so that file still builds the whole database. It uses
`create table if not exists`, so editing a column into it does nothing on a
database that already exists — and re-running it resets the security rules to
their open defaults, so `public_hardening.sql` has to follow it.

---

## 6. How the randomiser works

Albums are weighted by **tier**, not individually: each score owns a fixed
slice of the odds and splits it evenly among its members.

| Tier | Share of rolls | Albums | Odds for one album |
|---|---|---|---|
| 100 | 18.75% | 57 | 0.329% |
| 95 | 11.25% | 27 | 0.417% |
| 90 | 11.25% | 60 | 0.188% |
| 85 | 9.75% | 59 | 0.165% |
| 80 | 9.75% | 76 | 0.128% |
| 75 | 7.13% | 58 | 0.123% |
| 70 | 7.13% | 60 | 0.119% |
| unrated | 25% | 4,018 | 0.006% |

The **shares** are constants and do not move; the album counts are a snapshot
and shift every time you rate something. `node scripts/test-roller.mjs` prints
the current figures and checks them.

A quirk that follows from the design: a 95 has better per-album odds than a
100, because far fewer albums divide the 95 slice than divide the 100 slice.

**One change from the spreadsheet.** There, the 100 tier also held every
unrated album, so a genuine 100 was diluted to the odds of something never
played. They are separate tiers here, and a real 100 now comes up **53× more
often** than any one unrated album. The slider on the Roll screen moves the
unrated share; at its 25% default the overall balance matches the sheet.

**The randomness is cryptographic.** `Math.random()` is a pseudo-random
generator with no guarantee of unpredictability, so the roller draws from
`crypto.getRandomValues()` — the operating system's entropy pool — 256 values
at a time, each divided by 2³² to give a float in [0, 1).

`node scripts/test-roller.mjs` checks every figure in that table, confirms two
runs differ, and spreads 100,000 raw draws across ten buckets. It runs in CI on
every push that touches `app/roller.js`.

---

## 7. Genres and artwork

```sh
node scripts/enrich.mjs              # the whole collection, ~6 hours
node scripts/enrich.mjs --limit=50   # a batch
node scripts/enrich.mjs --retry      # re-attempt previous failures
```

No account, no keys. Results land in `data/enrichment.json`, keyed by artist
and title, and both the app and `import.mjs` merge them. Resumable — stop it
whenever, it picks up where it left off.

**The retry pass runs itself.** `--retry` re-attempts albums that failed and
albums that matched but carry no genres, with a 14-day cooldown per album so
the ones MusicBrainz genuinely lacks are not re-queried every night. The
nightly workflow runs it after each batch. Nothing to remember.

### When a match fails

The query is relaxed in stages, and each stage only runs because the last one
failed, so the ~88% that match first time pay nothing:

1. The title as written, then with disc markers, bracketed editions and
   subtitles stripped.
2. An unquoted search, accepted only when artist *and* title agree.
3. **Anchored on the artist instead.** MusicBrainz's artist search is fuzzy, so
   "Gorilaz" still finds Gorillaz — then the title is matched against that one
   band's discography rather than the whole database, which is what makes a
   loose match safe. This recovers misspelled artists.
4. Still nothing: Deezer is asked for artwork alone, and the album is recorded
   as a no-match — which doubles as a spelling report.

Albums MusicBrainz has but nobody tagged fall back to the **artist's** own
tags, recorded as `genre_source: "artist"` since those describe a career rather
than a record.

Non-Latin titles are the one case nothing recovers: text queries and edit
distance are both meaningless across scripts.

**Measured at 4.8 seconds an album.** Not one request a second: an album that
misses its first query is retried with progressively looser ones, and each
retry is another request against MusicBrainz's limit. Albums that match
immediately take ~1.5s; awkward ones take seven.

### Why it identifies before it fetches

The first version searched iTunes and took result number one. iTunes **always**
returns something, so albums it had never heard of quietly got other bands'
covers, and nothing checked the artist matched.

Now each album is identified once against MusicBrainz, which returns nothing
rather than a wrong guess. A match needs a score of 85+ **and** artist-name
agreement, and candidates are ranked in tiers so live, remix and compilation
editions lose to the studio album unless your title asks for one. Artwork then
comes from the Cover Art Archive **by id**, so it cannot drift onto the wrong
record.

The tiers matter, and summing them does not work. `lib/match.mjs` carries the
scar: "The Alternate A Hard Day's Night" once beat "A Hard Day's Night",
because the alternate scored 70 for *containing* the title plus 10 for being a
plain Album, while the real one scored 100 for an exact match and was then
docked 45 for being a Soundtrack. An exact title match must never lose to a
longer title that merely contains it.

Deezer is a fallback for the handful MusicBrainz cannot place — it tolerates
misspelled artists. iTunes is the last resort, and its answer is artist-checked
before use.

Genres come from MusicBrainz tags filtered against its 2,202 canonical genres
(cached in `data/mb-genres.json`), which is how you get `blackgaze` and
`third stream` rather than `Rock` and `Jazz`.

**Measured against three sources** on the twelve albums that actually broke:
MusicBrainz 10/12, Discogs 6/12, Deezer 4/12. Neither alternative found
anything MusicBrainz could not, which is why neither is in the pipeline.

### Why the covers are cached

A `coverartarchive.org/release-group/<id>/front-500` URL is not a file, it is a
lookup. It redirects to `archive.org`, which redirects again to whichever
storage node holds the image. Measured on this collection:

| Source | Redirects | Time | Size |
|---|---|---|---|
| Cover Art Archive | 2 | 1.2 – 3.1 s | 60 – 140 KB |
| A normal CDN | 0 | 0.3 s | ~160 KB |

The images are small. The cost is latency, not weight, which is why caching
fixes it and serving them smaller would not.

`cache-covers.mjs` copies each one into a Supabase Storage bucket once and
rewrites `cover_url` to point there. About 4,400 covers at ~83 KB is roughly
**360 MB**, which fits the free allowance with room to spare — worth checking
usage in the dashboard, since the limits move. The original URL is kept as
`cover_source_url`, so a cached cover can always be re-fetched. Re-running the
script resumes: anything already pointing at Supabase is skipped.

The Shelf renders 60 tiles at a time and grows on scroll, so a page load asks
for about a screenful of covers, never the whole shelf.

---

## 8. Run it locally

From the project root:

```sh
python3 -m http.server 8777
```

Open <http://localhost:8777/app/index.html>.

**This talks to the live database.** `app/config.js` holds the project keys, so
a local server is the deployed app at a different address — rating an album
here rates it for real, and so does a delete. There is no separate development
copy.

A `LOCAL` badge in the header means the opposite: `config.js` still has its
placeholders, so the page is reading `data/albums.csv` and saving to that
browser only. A fresh clone by someone else behaves that way.

Serve from the **project root**, not from inside `app/` — in local mode the
page reaches up to `../data/`.

Rated things in local mode and want to keep them? `db.exportEdits()` in the
browser console prints SQL you can paste into Supabase.

---

## 9. Deploying

Already done, and `DEPLOY.md` is the step-by-step — kept as the record of how,
and for standing it up again. In outline: a Supabase project with `schema.sql`
run and exactly one user; sign-ups turned **off**; four secrets on the GitHub
repo (`SUPABASE_URL`, `SUPABASE_KEY`, `IMC_EMAIL`, `IMC_PASSWORD`); a Vercel
project with root directory `app` and no build command, so every push
redeploys.

Before making anything public, run `db/public_hardening.sql` with your user id
pasted in (`node scripts/fill-sql.mjs` writes a filled copy to `db/local/`).
Without it, writes are allowed for any *signed-in* user — safe only because
sign-ups are off, which is one checkbox between the collection and anyone who
wants to edit it. The hardening file names exactly one user id for every
write, and closes reads on `rolls` and `review_flags` to everyone but you.

It is safe to run again, and it has to be whenever a table is added —
`review_flags` arrived after it was first run and sat outside it, readable by
anyone with the site's public key. Then prove it: open the deployed site
**signed out** and run `await db.updateAlbum(1, { score: 70 })` in the
console. It must fail.

---

## 10. What is deliberately absent

Things that existed and were removed. They are listed because the reasoning is
the useful part, and because otherwise they get rebuilt.

| Gone | Why |
|---|---|
| The `plays` table and "log a play" | Nothing read it and it held 0 rows. A score already records that you heard an album |
| `in_pool` | Inherited from the spreadsheet's RSP column. It silently excluded 99 albums from every roll after the controls for it had been removed — an invisible effect on every draw. To stop seeing an album, delete it; that is a tombstone and it is undoable |
| "Same cover on several albums" | 31 rows nothing on the page could diagnose: a double album and a mis-filed sleeve read identically, and the note never said which record the sleeve belonged to |
| "Not in MusicBrainz" | 146 rows of genuinely obscure records. With covers and genres both at 100%, nothing about them is broken anywhere you can see |
| "Five or more genres" | 283 rows, accurate and unactionable. *Check Your Head* really is funk, psych, punk, hip hop and alternative rock |
| `find-covers.mjs`, `find-genres.mjs` | Fallback hunts for albums missing artwork or tags. `find-covers` used the same four sources `enrich.mjs` already does, and the project's own measurement found Discogs and Last.fm added nothing MusicBrainz could not. Both are at 100% coverage |
| `recheck-matches.mjs` | Remediation for the summing bug above. It ran, the flagship bad matches are corrected, and a fresh sample of eight now finds nothing to move |
| `fix-spaces.mjs` | Replaced 51 non-breaking spaces carried in from the spreadsheet. Zero remain and the spreadsheet is retired |
| Reading the roll log | The app had a reader for `rolls` and a "played / skipped" setter for its `outcome` column. No screen ever called either. The log is still written, so a screen for it is a later decision rather than a rebuild |
| The spreadsheet | Once the app could add and delete, keeping it meant two writable sources with one-way sync. The original export is at `migration/raw_sheet.csv` |

An alert with no action behind it is not a maintenance item, and a script with
no work left is not a tool. Git history has all of them.

---

## 11. Design

The look is a committed direction rather than a default: bone-cream on ink,
signal red, condensed signage type set large, monospace for every piece of
data, hairline rules, square corners. The covers supply every other colour.
`DESIGN.md` is the system of record and `PRODUCT.md` is the product one.

Four agent skills are installed **project-locally** under `.agents/skills`
(symlinked into `.claude/skills`), so no other project on the machine sees
them: `frontend-design` and `web-design-guidelines` from Vercel, `supabase` and
`supabase-postgres-best-practices` from Supabase. They are guidance, not code.

---

## Files

| Path | What it is |
|------|-----------|
| `app/index.html` | Shell, routing, sign-in, optimistic saves |
| `app/home.jsx` | The daily five |
| `app/roll.jsx` | The randomiser screen |
| `app/browse.jsx` | Search, filters, grid, detail, add/delete/restore |
| `app/admin.jsx` | The Fix list |
| `app/cover-art.jsx` | Artwork by id, verified fallback, generated art |
| `app/roller.js` | The weighting logic, kept plain so it can be tested |
| `app/genres.js` | The genre/style split, computed in the browser |
| `app/supabase-client.js` | Every call to the cloud, in one place |
| `app/local-source.js` | The no-account fallback |
| `app/config.js` | Your Supabase URL and key — the only file to edit by hand |
| `app/styles.css` | The whole design system |
| `app/daily.json`, `app/health.json` | Written nightly, shipped with the app |
| `db/schema.sql` | Tables, indexes, security rules |
| `db/migrations/` | Every change since, one dated file each |
| `db/public_hardening.sql` | Run before making the repo or site public |
| `db/queries.sql` | The reports that never earned a screen |
| `scripts/` | Section 3 |
| `data/albums.csv` | The backup, and the collection's dated history |
| `data/enrichment.json` | What enrichment found, keyed by artist + title |
| `migration/` | How the data got here. Nothing in it runs any more |

---

## Known issues

Real, reproduced, and not fixed. Neither breaks the app.

**Some albums disagree with MusicBrainz about the year by 15 years or more.**
These were re-checked with the corrected ranking and *none of them moved*, so
they are not wrong matches: roughly three in four are MusicBrainz having
matched a reissue, where the shelf is already right. The Fix screen offers the
MusicBrainz year as a one-click fix and makes the undo rewind the album,
precisely because the suggestion is usually the wrong answer. The live count is
on that screen.

**Around 140 albums MusicBrainz has never heard of.** Genuinely obscure or
misspelt — 2 Many DJ's mixtapes, bootleg nightcore, Japanese indie.
`suggest-renames.mjs` works through 60 a night, stamps each album it examines
and leaves it alone for 30 days, so the backlog drains and then goes quiet.
Every one of them still has a cover and genres, so nothing is broken anywhere
you can see. `albums` minus `matched` in the table above is the current
figure.

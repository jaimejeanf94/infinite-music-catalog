# Infinite Music Catalog

A randomiser and rating tool for a 4,476-album listening list that outgrew its
spreadsheet. Roll an album, rate it in one keystroke, and browse the whole
collection by artist, year or score.

The data started life in the Google Sheet tab *Infinite Hipster Eclectic CDs*.
That sheet stays the historical record; this app is where the ratings happen now.

---

## How it fits together

```
data/albums.csv ──> Supabase (Postgres)  <──> app/  ──> Vercel
   the catalog          the live data         the UI     the URL
```

- **No build step.** React, Babel and the Supabase client load from a CDN and
  the `.jsx` files compile in the browser. Edit a file, refresh, see the change.
- **Two data sources, one interface.** `app/supabase-client.js` talks to the
  cloud; `app/local-source.js` reads the CSV and saves to `localStorage`. If
  `config.js` has no Supabase keys, local mode takes over automatically and the
  rest of the app never notices.
- **Anyone can read, only you can write.** Enforced by Row Level Security in
  `db/schema.sql`, not by hiding the key in `config.js` — that key is meant to
  be public.

---

## 1. Run it locally

From the project root:

```sh
python3 -m http.server 8777
```

Open <http://localhost:8777/app/index.html>. A `LOCAL` badge in the header means
it is reading `data/albums.csv` and saving ratings to this browser only.

Serve from the **project root**, not from inside `app/` — the page reaches up to
`../data/albums.csv`.

Rated a few albums locally and want to keep them? Open the browser console and
run `db.exportEdits()` — it prints SQL you can paste into Supabase later.

### Keyboard shortcuts on the Roll screen

| Key | Does |
|-----|------|
| `1`–`7` | Score 70, 75, 80, 85, 90, 95, 100 |
| `0` | Clear the score |
| `space` / `enter` | Roll again |
| `p` | Log a play |
| `x` | Drop it from the random pool |

---

## 2. Put it in the cloud

### a. Create the Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a project. Any
   region near you is fine; save the database password somewhere safe even
   though this app never uses it directly.
2. **SQL Editor → New query.** Paste all of `db/schema.sql`, press Run. That
   creates the `albums`, `rolls` and `plays` tables and the security rules.
3. **Authentication → Users → Add user.** Create one user with your email and a
   password. This is the only account that will ever exist.
4. **Authentication → Sign In / Providers → Email.** Turn *Allow new users to
   sign up* **off**. Now "signed in" and "you" mean the same thing, which is
   what the security rules rely on.

### b. Load the albums

**Table Editor → `albums` → Insert → Import data from CSV**, and give it
`data/albums.csv`. Leave the `id` column out; the database fills it in.

It should report 4,476 rows. (Prefer the terminal? `node scripts/import.mjs`
does the same thing — see *Running the scripts* below.)

### c. Point the app at it

**Project Settings → API.** Copy the *Project URL* and the *anon / publishable*
key into `app/config.js`:

```js
window.IH_CONFIG = {
  SUPABASE_URL: "https://xxxxxxxx.supabase.co",
  SUPABASE_KEY: "sb_publishable_...",
};
```

Refresh <http://localhost:8777/app/index.html>. The `LOCAL` badge disappears and
a **Sign in** button appears — that is the cloud talking. Sign in with the user
from step (a)(3) and rate something to confirm writes work.

### d. Deploy to Vercel

1. Push to GitHub first (next section).
2. At [vercel.com](https://vercel.com), *Add New → Project*, import the repo.
3. Framework preset **Other**, root directory **`app`**, no build command.
4. Deploy. You get a `https://….vercel.app` URL, and every future `git push`
   redeploys it automatically.

Nothing secret ships in the bundle: the publishable key is designed to be
public, and the security rules are what protect the data.

---

## 3. Git and GitHub

One-time identity setup, so commits are stamped with your name:

```sh
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

The everyday loop:

```sh
git status                   # what changed
git add -A                   # stage everything
git commit -m "Add notes"    # save a snapshot locally
git push                     # send it to GitHub
```

Creating the GitHub side, once:

```sh
gh auth login                                   # sign in to GitHub
gh repo create infinite-music-catalog --private --source=. --push
```

`--private` keeps it to you; swap in `--public` to share. `--source=.` means
"use this folder", and `--push` uploads the commits you already made.

---

## 4. Genres and artwork

`scripts/enrich.mjs` gives every album a stable identity and the data that hangs
off it. It needs no account and no keys:

```sh
node scripts/enrich.mjs              # the whole collection, ~75 minutes
node scripts/enrich.mjs --limit=50   # a batch
node scripts/enrich.mjs --retry      # re-attempt previous failures
```

Results land in `data/enrichment.json`, keyed by artist and title, and the app
merges them. It is resumable — stop it whenever, it picks up where it left off.

### Why it is built this way

The first version searched iTunes by text and took the first result. iTunes
**always** returns something, so albums it had never heard of quietly got other
bands' covers, and nothing checked the artist even matched.

Now each album is identified once against MusicBrainz, which returns nothing
rather than a wrong guess and scores the matches it does make. A match is only
accepted when the score is at least 85 **and** the artist name agrees. From
there everything keys off the release-group id: artwork comes from the Cover Art
Archive *by id*, so it cannot drift onto the wrong record. iTunes survives only
as a fallback for albums the Archive has no image for, and its answer is now
checked against the artist name before being accepted.

MusicBrainz genres are also far better suited to this collection than iTunes'
handful of buckets — `blackgaze`, `third stream`, `hyperpop` rather than
`Rock`, `Jazz`, `Electronic`. Free-text tags like "artist on cover" are filtered
against MusicBrainz's list of 2,202 real genres, cached in `data/mb-genres.json`.

Two useful side effects:

- **Albums MusicBrainz cannot find are usually typos in the sheet.** The first
  run flagged "Freddie Gibs & Madlib" (it is Gibbs).
- **Year disagreements are reported, never applied** — the sheet may hold the
  pressing you own rather than the first release, so that is your call.

---

## 5. The data flow

**Postgres is the source of truth.** The Google Sheet was the seed, not the
engine, and the app is now where albums are added, rated and removed.

`.github/workflows/refresh.yml` runs nightly on GitHub:

1. `export.mjs` writes the database out to `data/albums.csv`
2. `enrich.mjs` works through 300 albums still missing genres or artwork
3. `import.mjs` pushes that enrichment back to the database
4. the CSV is committed

Step 4 is the point: `git log data/albums.csv` becomes a dated history of the
collection, and restoring a bad week is
`git checkout <commit> -- data/albums.csv && node scripts/import.mjs`.

Set four secrets under **Settings → Secrets and variables → Actions**:
`SUPABASE_URL`, `SUPABASE_KEY`, `IMC_EMAIL`, `IMC_PASSWORD`.

### Why the sheet was retired

Once the app could add and delete, keeping both meant two writable sources with
only one-way sync — we cannot write back to Google Sheets without OAuth, so the
sheet would have drifted wrong and stayed wrong. A weekly CSV in git is a better
backup than the spreadsheet was: versioned, diffable, and restorable to any
night.

The original export is kept at `data/raw_sheet.csv`, and `data/clean.py` is the
one-time migration that produced the first `albums.csv`. Neither runs any more.

---

## 6. Running the scripts

They read credentials from the environment, so nothing sensitive lands in the
repo:

```sh
export SUPABASE_URL="https://xxxxxxxx.supabase.co"
export SUPABASE_KEY="sb_publishable_..."
export IMC_EMAIL="you@example.com"
export IMC_PASSWORD="..."

node scripts/export.mjs      # database -> data/albums.csv (the backup)
node scripts/enrich.mjs      # genres, artwork, MusicBrainz ids
node scripts/import.mjs      # push local data and enrichment to the database
node scripts/test-roller.mjs # check the randomiser's odds
```

No `npm install` needed — the scripts use plain `fetch`.

---

## 7. How the randomiser works

The sheet weighted albums by **tier**, not individually: each score owns a fixed
share of the odds and splits it among its members.

| Score | Share of rolls | Albums | Effect |
|-------|----------------|--------|--------|
| 100 | 25% | 59 | ~19× a coin-flip pick |
| 95 | 15% | 27 | ~25× |
| 90 | 15% | 61 | ~11× |
| 85 | 13% | 60 | ~10× |
| 80 | 13% | 74 | ~8× |
| 75 | 9.5% | 58 | ~7× |
| 70 | 9.5% | 60 | ~7× |

**One change from the sheet.** There, the 100 tier also held all 4,076 unrated
albums, so a genuine 100 was diluted to the same odds as something you had never
played. Here, unrated albums are their own tier with their own share — the
slider on the Roll screen, 25% by default, which reproduces the sheet's overall
balance. A real 100 now comes up about 50× more often than any one unrated album.

Three modes:

- **Weighted** — the table above. Your day-to-day roll.
- **Unrated** — only albums with no score, for working through the backlog.
- **Uniform** — every album in the pool equally likely.

Albums with `in_pool = false` (the sheet's `RSP = No`) never come up in any mode.

`node scripts/test-roller.mjs` rolls 200,000 times against the real collection
and checks the results against this table.

---

## Files

| Path | What it is |
|------|-----------|
| `app/index.html` | Shell, routing, sign-in, optimistic saves |
| `app/roll.jsx` | The randomiser screen |
| `app/browse.jsx` | Search, filters, grid, album detail |
| `app/cover-art.jsx` | iTunes lookups, throttling, generated fallback art |
| `app/roller.js` | The weighting logic, kept plain so it can be tested |
| `app/supabase-client.js` | Every call to the cloud, in one place |
| `app/local-source.js` | The no-account fallback |
| `app/config.js` | Your Supabase URL and key — the only file to edit by hand |
| `db/schema.sql` | Tables, indexes, security rules |
| `scripts/export.mjs` | Database → `albums.csv`, the nightly backup |
| `data/clean.py` | One-time migration from the sheet (no longer run) |
| `data/raw_sheet.csv` | Untouched snapshot of the original sheet |
| `scripts/enrich.mjs` | Genres, artwork and MusicBrainz ids — needs no account |
| `data/enrichment.json` | What that pass found, keyed by artist + title |
| `.github/workflows/refresh.yml` | The scheduled data flow |
| `scripts/` | Import, enrichment, roller tests |

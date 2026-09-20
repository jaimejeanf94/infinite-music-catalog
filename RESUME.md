# Where this is up to

Snapshot for picking the work back up. Delete it once the list at the bottom
is empty — `README.md` is the permanent manual, this is just the bookmark.

_Last updated: 2026-09-19_

## State

- **4,420 albums**, 395 rated, 4,321 in the pool.
- Enrichment backfill **finished**: 94.6% have artwork, 92.6% matched a
  MusicBrainz release-group, 91% have genres.
- Repo is public at <https://github.com/jaimejeanf94/infinite-music-catalog>,
  clean tree, everything pushed.
- Supabase project exists and the tables were created, but **no data imported
  yet** and `db/schema.sql` has still never been run end to end against it.
- The app runs locally in `LOCAL` mode off `data/albums.csv`:
  `python3 -m http.server 8777` from the project root, then
  <http://localhost:8777/app/index.html>.

## Fixed this session

- **Covers appeared on the wrong albums.** Local edits were stored keyed by row
  number in `albums.csv`; `merge-discs.py` then collapsed 96 rows into 42 and
  every cached cover re-attached itself to whatever album slid into the slot.
  Edits, tombstones and the SQL export now key on `artist::title`. Storage keys
  moved to `:v2`; the old data is still under the v1 key, ignored.
- **24 misspelt names corrected** — 22 renamed, 2 merged (Gorilaz/Gorillaz kept
  the score of 100, Maroja/Maruja). Re-matched on the corrected names: 21 of 22
  now resolve to a real release-group and gained genres they never had.

## Running in the background

`scripts/suggest-renames.mjs` is scanning the 325 albums MusicBrainz could not
match, writing to the scratchpad. If the machine was restarted it is gone and
can simply be re-run:

```sh
node scripts/suggest-renames.mjs --out=suggested.json
```

It takes about 50 minutes (MusicBrainz allows one call a second). Review the
output, then feed it to `node scripts/rename.mjs --file suggested.json --refresh`.

## Next, in order

1. **Cache the covers** (biggest visible win — the shelf currently waits
   1.2–3.1s per image on archive.org redirects):
   - Supabase dashboard → Storage → New bucket, name `covers`, **Public ON**
   - Run `db/storage.sql` with your UID pasted in
   - `cp .env.example .env` and fill it in, then
     `set -a && source .env && set +a`
   - `node scripts/cache-covers.mjs --dry-run` then without the flag
   - ~4,180 covers, ~340 MB, inside the free storage allowance
2. **Run `db/schema.sql`** in the Supabase SQL editor, then verify:
   ```sql
   select relname, relrowsecurity from pg_class
   where relnamespace = 'public'::regnamespace
     and relname in ('albums','rolls','plays');
   ```
   All three must come back `true`.
3. **Create the Supabase user**, then turn sign-ups OFF.
4. **`node scripts/import.mjs`** to push albums + enrichment.
5. **`node scripts/write-config.mjs`** to generate `app/config.js` from the
   same `.env` (it refuses a secret key, and never reads the password).
6. **Run `db/public_hardening.sql`** with your UID, then check a signed-out
   `await db.deleteAlbum(1)` is refused.
7. **Deploy to Vercel** — root directory `app`, no build command.
8. **Add four Actions secrets**: `SUPABASE_URL`, `SUPABASE_KEY`, `IMC_EMAIL`,
   `IMC_PASSWORD`.

## Known, not yet fixed

- **27 albums share a cover with another album** — same-artist over-matching,
  e.g. *Black Sabbath Vol. 4* wearing *Black Sabbath*'s sleeve, *EMOTION Side B*
  wearing *EMOTION*'s. Roughly half are legitimately identical artwork.
- **139 albums MusicBrainz has never heard of** — the `suggest-renames` scan
  above is working through how many of those are really misspellings.
- Offered but never built: inline editing of artist/title in the app.

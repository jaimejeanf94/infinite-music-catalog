# Where things stand

_Last updated when the machine was shut down. Delete this file once the
backfill is finished; it describes a moment, not the project._

## Enrichment

**1,460 of 4,476 albums done** — 91% matched, 88% with genres, 95% with
artwork. Stopped cleanly, `data/enrichment.json` is valid and committed.

To carry on, from the project root:

```sh
nohup node scripts/enrich.mjs >> data/enrich-run.log 2>&1 &
nohup sh scripts/after-backfill.sh > data/retry-run.log 2>&1 &
```

The first works through the remaining ~3,000 (about four hours). The second
waits for it and then sweeps every album that failed or matched without
genres. Both resume from where they stopped and need no attention.

Optional, to stop the Mac idling to sleep while they run:

```sh
caffeinate -i -w $(pgrep -f after-backfill | head -1) &
```

To see the app while they run: `python3 -m http.server 8777` from the project
root, then <http://localhost:8777/app/index.html>.

## When the backfill finishes

**Review the fuzzy-sourced covers.** Around 80 albums get artwork from Deezer or
iTunes rather than the Cover Art Archive, which means it was matched on text
rather than by id — those are the ones that could be wrong. To list them:

```sh
python3 -c "
import json; d=json.load(open('data/enrichment.json'))
for k,v in d.items():
    if v.get('cover_from') in ('deezer','itunes'):
        print(f\"[{v['cover_from']:6}] {k.replace('::',' — ')[:60]}\")"
```

Do not simply delete them and re-run: the fallbacks only fire when the Cover
Art Archive has nothing, so a retry returns the same image or none at all, and
`--retry` selects on match status rather than cover source anyway.

Worth knowing before you start: about 80% of those have **no MusicBrainz id at
all** — mostly Korean and Japanese artists, plus typos like "Gorilaz" and
"Dogrels". For those, fixing the artist or album name is the real repair, and
the cover follows. Only the handful that *do* have an id are cases where
MusicBrainz knew the record but had no picture.

## Next real step

Two commands only you can run. Everything cloud-side is blocked on them:

```sh
git config --global user.name "Jaime Jean"
git config --global user.email "jaimejeanf94@gmail.com"
gh auth login
```

Then `gh repo create infinite-music-catalog --private --source=. --push`, and
section 8 of the README covers Supabase and Vercel from there.

## Still true and worth remembering

- `db/schema.sql` and `db/public_hardening.sql` have **never been run against a
  live database**. The Supabase agent skills installed in `.agents/skills` will
  check them when you get there.
- The app currently runs in local mode: ratings save to the browser only, and
  do not reach any database.

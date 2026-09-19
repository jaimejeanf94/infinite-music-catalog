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

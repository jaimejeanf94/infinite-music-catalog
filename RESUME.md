# Where things stand

_A snapshot, not documentation. Delete it once the site is live._

Full step-by-step with explanations: https://claude.ai/artifact/ES3wevTTiCCqYZLbw9FcWv

## Done

- **Repo is public**: https://github.com/jaimejeanf94/infinite-music-catalog
  30 commits, Issues/Wiki off, no personal email in the history.
- **Supabase project created**, Data API on, automatic RLS on.
- **4,422 albums** (multi-disc releases merged from 4,476).
- **Enrichment running**: ~2,400 done. A sweep job is queued behind it.

## If the backfill stopped

```sh
cd ~/infinite-music-catalog
nohup node scripts/enrich.mjs >> data/enrich-run.log 2>&1 &
nohup sh scripts/after-backfill.sh > data/retry-run.log 2>&1 &
caffeinate -i -w $(pgrep -f after-backfill | head -1) &
```

Check it: `tail -3 data/enrich-run.log`

## Next, in order

1. **Run `db/schema.sql`** in the Supabase SQL editor, then verify RLS is on:
   ```sql
   select relname, relrowsecurity from pg_class
   where relnamespace = 'public'::regnamespace
     and relname in ('albums','rolls','plays');
   ```
   All three must be `true`.
2. **Authentication → Users → Add user** (your email + a strong password).
3. **Authentication → Sign In / Providers → Email**: turn sign-ups **off**.
4. **Wait for the enrichment to finish**, then import `data/albums.csv` via
   Table Editor, and `node scripts/import.mjs` to push genres and artwork.
5. **Paste the URL and publishable key** into `app/config.js`.
6. **Run `db/public_hardening.sql`** with your UID, then prove it: signed out,
   `await db.deleteAlbum(1)` in the console must fail.
7. **Deploy to Vercel** — root directory `app`, no build command.
8. **Add the four Actions secrets** so the nightly job runs on GitHub.

Steps 3 and 6 are the two that matter for security. The rest can be fixed later.

## Also waiting

- **Review the fuzzy-sourced covers** once enrichment ends — about 80 albums
  got artwork from Deezer or iTunes rather than matched by id.
- **4 near-duplicates to fix**: Gorilaz/Gorillaz, Steve/Steven Wilson,
  Freddie Gibs/Gibbs, "Essential Joe Satrini". Run
  `node scripts/find-duplicates.mjs` to see them. Fixing means delete and
  re-add — there is no rename in the app yet, and the typo'd rows hold scores.

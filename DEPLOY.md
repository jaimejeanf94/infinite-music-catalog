# Deploying

Everything here is a one-off. Once it is done, the app is public, the nightly
job runs on GitHub's machines, and your laptop is no longer involved.

Anything marked **you** needs your Supabase or GitHub account. Anything marked
**terminal** can be run from the project root; they all read `.env`, so no
credential is ever typed.

---

## 1. Storage bucket for the covers — **you**

Supabase dashboard → **Storage** → **New bucket**

- name: `covers`
- **Public: ON**

Public makes *reads* keyless and CDN-served, which is the whole point. It does
not make writes public — step 2 handles that.

## 2. Storage policies — **terminal**, then **you**

```sh
set -a && source .env && set +a
node scripts/fill-sql.mjs
```

That reads your user id out of your own access token — no dashboard lookup —
and writes `db/local/storage.sql` and `db/local/public_hardening.sql` with it
filled in. `db/local/` is gitignored, so the id cannot reach the public repo.

Paste `db/local/storage.sql` into Supabase → **SQL Editor** and run it. It ends
with a query listing the policies it created — expect exactly four.

> The id is not a credential: RLS compares it against a cryptographically
> signed token, so knowing it grants nobody anything. This just keeps it out of
> a public repo for no cost.

## 3. Cache the covers — **terminal**

```sh
set -a && source .env && set +a
node scripts/cache-covers.mjs --dry-run     # confirms the count and size
node scripts/cache-covers.mjs               # ~4,050 covers, ~340 MB, ~30 min
node scripts/import.mjs                     # push the new URLs to the database
```

Safe to interrupt and re-run — it skips anything already cached. This is the
step that removes the 1.2–3.1s wait per cover.

## 4. Lock writes to your account — **you**

Currently any *authenticated* user can write. With sign-ups off that is only
you, so this is hardening rather than a hole, but do it before sharing the link.

Paste `db/local/public_hardening.sql` (step 2 already generated it) into the
SQL editor and run it.

Also confirm sign-ups are off: **Authentication** → **Sign In / Providers** →
Email → **Allow new users to sign up: OFF**. Without this, a stranger can
register and become an owner.

## 5. Let the nightly job reach the database — **terminal**

```sh
set -a && source .env && set +a
gh secret set SUPABASE_URL  --body "$SUPABASE_URL"
gh secret set SUPABASE_KEY  --body "$SUPABASE_KEY"
gh secret set IMC_EMAIL     --body "$IMC_EMAIL"
gh secret set IMC_PASSWORD  --body "$IMC_PASSWORD"
gh secret list
```

Until these exist, the workflow runs but skips every database step. The run is
at **07:00 UTC daily — 01:00 in Mexico City**.

To watch one immediately instead of waiting:

```sh
gh workflow run refresh.yml
gh run watch
```

## 6. Put it on the internet — **you**

<https://vercel.com> → **Add New** → **Project** → import
`jaimejeanf94/infinite-music-catalog`.

| Setting | Value |
|---|---|
| Framework Preset | **Other** |
| Root Directory | **`app`** |
| Build Command | leave empty (no build step) |
| Output Directory | leave empty |
| Install Command | leave empty |

No environment variables — the keys are in `app/config.js` on purpose, and RLS
is what protects the data.

After this, every `git push` redeploys automatically, including the nightly
job's own commit.

## 7. Check it — **you**

Open the Vercel URL in a **private window** (so you are signed out):

- the shelf loads, covers and genres show
- there are no score buttons, no Add Album, no Delete
- the Deleted filter is absent

Then in your normal window, **Sign in** with the `.env` credentials and confirm
scoring, **Edit name**, and delete all work.

---

## Then it is a real app

- Rate albums from anywhere, phone included.
- Correct a name with **Edit name** on the detail sheet.
- Work through `data/rename-suggestions-review.json` — the corrections that were
  too uncertain to apply automatically.
- Every night: 300 empty albums enriched, 150 retried, confident name
  corrections applied, a CSV backup committed to git.

## Still open

- **27 albums share a cover with another album** — same-artist over-matching,
  e.g. *Black Sabbath Vol. 4* wearing *Black Sabbath*'s sleeve. About half are
  legitimately the same artwork.
- **~310 albums MusicBrainz has never heard of.** The nightly scan works
  through 60 a night looking for misspellings.

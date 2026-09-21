// cache-covers.mjs — copy every album cover into Supabase Storage once, so the
// app stops fetching them from the Cover Art Archive on every page load.
//
//   node scripts/cache-covers.mjs [--limit=N] [--dry-run] [--bucket=covers]
//
// A coverartarchive.org URL is not a file, it is a lookup: it redirects to
// archive.org and then again to whichever storage node holds the image.
// Measured on this collection that is two extra round trips and 1.2-3.1s per
// cover, against 0.3s for a normal CDN. The images themselves are small
// (60-140KB), so this is latency, not weight -- which is why caching fixes it
// and resizing would not.
//
// Re-running is safe and resumes: anything already pointing at Supabase is
// skipped. The original URL is kept as cover_source_url in enrichment.json,
// so a cover can always be re-fetched from the source.

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { requireEnv, signIn, storage } from "./supabase-rest.mjs";

const DATA = new URL("../data/", import.meta.url);
const ENRICH = new URL("enrichment.json", DATA);

const args = process.argv.slice(2);
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || Infinity);
const BUCKET = args.find((a) => a.startsWith("--bucket="))?.split("=")[1] || "covers";
const DRY = args.includes("--dry-run");
// For the nightly job: a bucket that does not exist yet means "not set up",
// not "broken". Without this the workflow would fail every night until the
// bucket is created by hand.
const IF_CONFIGURED = args.includes("--if-configured");

// archive.org is slow per request but does not mind a few at once, and the
// whole job is latency-bound. Six is enough to matter without hammering them.
const PARALLEL = 6;
const SAVE_EVERY = 25;

if (!DRY) requireEnv();

// enrich.mjs holds the whole store in memory and writes it wholesale, so it
// would undo every rewrite below on its next save.
try {
  const running = execSync("pgrep -f 'node .*enrich\\.mjs' || true", { encoding: "utf8" }).trim();
  if (running && !DRY) {
    console.error(`enrich.mjs is running (pid ${running.split("\n").join(", ")}). Wait for it to finish.`);
    process.exit(1);
  }
} catch { /* no pgrep: carry on without the guard */ }

const store = JSON.parse(readFileSync(ENRICH, "utf8"));

function parseCsv(text) {
  const rows = [];
  let row = [], cur = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (c !== "\r") cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// An mbid is a stable, unique name. The few covers that came from Deezer or
// iTunes have no mbid, so they get a digest of the album key instead -- also
// stable, and it keeps the filename safe without inventing a slug scheme.
const nameFor = (key, rec, ext) =>
  `${rec.mbid || createHash("sha1").update(key).digest("hex").slice(0, 16)}.${ext}`;

const extFor = (contentType) =>
  contentType?.includes("png") ? "png" : contentType?.includes("webp") ? "webp" : "jpg";

// Recognised by the path rather than by SUPABASE_URL, so --dry-run gives the
// right answer without credentials. Keyed on the env var, a dry run with no
// .env loaded counted every cover in the catalogue as still to copy.
const isCached = (url) => /\/storage\/v1\/object\/public\//.test(url || "");

// The browser finds covers too. When an album has none, the app looks one up
// -- the Cover Art Archive by id, or iTunes -- and saves the answer straight
// to the database, where this script never looked: it only ever read
// enrichment.json, whose record for that album still says "no cover". Those
// covers were never cached, and the ones found at the Cover Art Archive kept
// its two redirects -- the exact latency this script exists to remove. So the
// backup is read as well, and a cover found that way is adopted by the
// album's record once it is cached. A cover you chose by hand is left alone:
// it is yours, and import.mjs would not overwrite it with the cached copy.
const [csvHead, ...csvRows] = parseCsv(readFileSync(new URL("albums.csv", DATA), "utf8"));
const at = Object.fromEntries(csvHead.map((h, i) => [h, i]));
const fromApp = new Map();
for (const r of csvRows) {
  const url = r[at.cover_url];
  if (url && r[at.cover_locked] !== "true" && !isCached(url)) fromApp.set(`${r[at.artist]}::${r[at.title]}`, url);
}

// Records only: one is never invented here, because enrich.mjs reads "has a
// record" as "already done" and would never look the album up.
const pending = Object.entries(store).map(([key, rec]) => {
  const src = rec.cover_url || fromApp.get(key);
  return src && !isCached(src) ? { key, rec, src } : null;
}).filter(Boolean).slice(0, LIMIT);

const total = Object.values(store).filter((r) => r.cover_url).length;
const adopted = pending.filter((p) => !p.rec.cover_url).length;
console.log(`${total} covers in the catalog, ${pending.length} to copy` +
            (adopted ? ` (${adopted} found by the app rather than by enrichment)` : "") + "\n");
if (!pending.length) { console.log("nothing to do"); process.exit(0); }

if (DRY) {
  for (const { key, src } of pending.slice(0, 5))
    console.log(`  ${key}\n    ${src}`);
  console.log(`\n${pending.length} would be copied into the "${BUCKET}" bucket`);
  console.log(`estimated ~${Math.round(pending.length * 83 / 1024)} MB at the measured ~83KB average`);
  process.exit(0);
}

const token = await signIn();
const store_ = storage(token);

if (!(await store_.bucketExists(BUCKET))) {
  if (IF_CONFIGURED) {
    console.log(`No "${BUCKET}" bucket yet — skipping. See DEPLOY.md step 1.`);
    process.exit(0);
  }
  console.error(
    `No storage bucket called "${BUCKET}".\n\n` +
    `Create it in the Supabase dashboard: Storage -> New bucket\n` +
    `  name:   ${BUCKET}\n` +
    `  public: ON   (covers are public art; the app fetches them with no key)\n\n` +
    `Then run db/storage.sql to pin writes to your account.`
  );
  process.exit(1);
}

let done = 0, failed = 0, bytes = 0;
const failures = [];

const save = () => {
  const tmp = new URL("enrichment.json.tmp", DATA);
  writeFileSync(tmp, JSON.stringify(store, null, 1));
  renameSync(tmp, ENRICH);
};

async function one({ key, rec, src }) {
  try {
    const res = await fetch(src, { redirect: "follow" });
    if (!res.ok) throw new Error(`source ${res.status}`);
    const type = res.headers.get("content-type") || "image/jpeg";
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength < 500) throw new Error("suspiciously small, treating as missing");

    const path = nameFor(key, rec, extFor(type));
    const url = await store_.upload(BUCKET, path, buf, type);

    // Keep where it came from: a cached copy should always be re-derivable.
    if (!rec.cover_source_url) rec.cover_source_url = src;
    if (!rec.cover_url) rec.cover_from = "app";
    rec.cover_url = url;
    rec.cover_cached = new Date().toISOString().slice(0, 10);
    bytes += buf.byteLength;
    done++;
  } catch (e) {
    failed++;
    failures.push(`${key}: ${e.message}`);
  }
}

// A small worker pool: PARALLEL tasks pulling from one shared queue.
const queue = [...pending];
let sinceSave = 0;
await Promise.all(Array.from({ length: PARALLEL }, async () => {
  while (queue.length) {
    await one(queue.shift());
    if (++sinceSave >= SAVE_EVERY) { sinceSave = 0; save(); }
    const seen = done + failed;
    if (seen % 50 === 0)
      console.log(`  ${seen}/${pending.length} — ${done} cached, ${failed} failed, ${(bytes / 1048576).toFixed(0)} MB`);
  }
}));
save();

console.log(`\ncached:  ${done}`);
console.log(`failed:  ${failed}`);
console.log(`storage: ${(bytes / 1048576).toFixed(0)} MB in the "${BUCKET}" bucket`);
if (failures.length) {
  console.log(`\nfailures (their cover_url is unchanged, so the app still works):`);
  for (const f of failures.slice(0, 20)) console.log(`  ${f}`);
  if (failures.length > 20) console.log(`  … and ${failures.length - 20} more`);
}
if (done) console.log(`\nnow run:  node scripts/import.mjs   # push the new URLs to the database`);

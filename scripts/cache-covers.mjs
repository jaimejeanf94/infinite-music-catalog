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
// skipped. The original URL is kept as cover_source_url so a cover can always
// be re-fetched from the source.

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

// An mbid is a stable, unique name. The few covers that came from Deezer or
// iTunes have no mbid, so they get a digest of the album key instead -- also
// stable, and it keeps the filename safe without inventing a slug scheme.
const nameFor = (key, rec, ext) =>
  `${rec.mbid || createHash("sha1").update(key).digest("hex").slice(0, 16)}.${ext}`;

const extFor = (contentType) =>
  contentType?.includes("png") ? "png" : contentType?.includes("webp") ? "webp" : "jpg";

const SUPA = process.env.SUPABASE_URL || "";
const pending = Object.entries(store).filter(([, rec]) => {
  const url = rec.cover_url;
  if (!url) return false;
  if (SUPA && url.startsWith(SUPA)) return false;    // already cached
  return true;
}).slice(0, LIMIT);

const total = Object.values(store).filter((r) => r.cover_url).length;
console.log(`${total} covers in the catalog, ${pending.length} to copy\n`);
if (!pending.length) { console.log("nothing to do"); process.exit(0); }

if (DRY) {
  let bytes = 0;
  for (const [key, rec] of pending.slice(0, 5))
    console.log(`  ${key}\n    ${rec.cover_url}`);
  console.log(`\n${pending.length} would be copied into the "${BUCKET}" bucket`);
  console.log(`estimated ~${Math.round(pending.length * 83 / 1024)} MB at the measured ~83KB average`);
  process.exit(0);
}

const token = await signIn();
const store_ = storage(token);

if (!(await store_.bucketExists(BUCKET))) {
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

async function one([key, rec]) {
  try {
    const res = await fetch(rec.cover_url, { redirect: "follow" });
    if (!res.ok) throw new Error(`source ${res.status}`);
    const type = res.headers.get("content-type") || "image/jpeg";
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength < 500) throw new Error("suspiciously small, treating as missing");

    const path = nameFor(key, rec, extFor(type));
    const url = await store_.upload(BUCKET, path, buf, type);

    // Keep where it came from: a cached copy should always be re-derivable.
    if (!rec.cover_source_url) rec.cover_source_url = rec.cover_url;
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
console.log(`\nnow run:  node scripts/import.mjs   # push the new URLs to the database`);

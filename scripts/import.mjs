// import.mjs — push data/albums.csv into the Supabase `albums` table.
//
//   node scripts/import.mjs
//
// The dashboard's CSV importer does the same job; this exists for when you
// have re-run clean.py and want the table rebuilt without clicking through the
// UI. It skips albums already present (matched on artist + title), so running
// it twice is safe.
import { readFileSync, existsSync } from "node:fs";
import { requireEnv, signIn, rest } from "./supabase-rest.mjs";

requireEnv();

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

const csv = readFileSync(new URL("../data/albums.csv", import.meta.url), "utf8");
const [header, ...rows] = parseCsv(csv);
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));

// Enrichment lives in its own file so re-running clean.py never clobbers it.
const enrichPath = new URL("../data/enrichment.json", import.meta.url);
const enrichment = existsSync(enrichPath)
  ? JSON.parse(readFileSync(enrichPath, "utf8"))
  : {};

const albums = rows.filter((r) => r[col.artist]).map((r) => {
  const extra = enrichment[`${r[col.artist]}::${r[col.title]}`];
  return {
    artist: r[col.artist],
    title: r[col.title],
    year: r[col.year] ? Number(r[col.year]) : null,
    score: r[col.score] ? Number(r[col.score]) : null,
    in_pool: r[col.in_pool] !== "false",
    mbid: extra?.mbid || null,
    genres: extra?.genres || [],
    cover_url: extra?.cover_url || null,
  };
});

const token = await signIn();
const api = rest(token);

// Deliberately includes tombstoned albums: an album deleted in the app is
// still in the spreadsheet, and skipping it here is what stops tonight's
// import putting it straight back.
const existing = new Set(
  (await api.selectAll("albums?select=artist,title&order=id.asc"))
    .map((a) => `${a.artist.toLowerCase()}::${a.title.toLowerCase()}`)
);
const fresh = albums.filter(
  (a) => !existing.has(`${a.artist.toLowerCase()}::${a.title.toLowerCase()}`)
);

console.log(`${albums.length} in CSV, ${existing.size} already in the database, ${fresh.length} to insert`);

const BATCH = 500;
for (let i = 0; i < fresh.length; i += BATCH) {
  await api.insert("albums", fresh.slice(i, i + BATCH));
  console.log(`  inserted ${Math.min(i + BATCH, fresh.length)}/${fresh.length}`);
}
// Albums already in the database still need their enrichment kept current --
// a cover that was missing last week may exist now.
const known = await api.selectAll(
  "albums?select=id,artist,title,mbid,genres,cover_url,cover_locked&deleted_at=is.null&order=id.asc");
let refreshed = 0;
for (const row of known) {
  const extra = enrichment[`${row.artist}::${row.title}`];
  // Not `status === "ok"`: an album MusicBrainz could not match still gets a
  // cover from a fallback, and once cache-covers.mjs has rewritten that URL to
  // Supabase Storage it has to reach the database like any other. Each field
  // below is guarded on its own, so a record with nothing useful patches
  // nothing.
  if (!extra) continue;
  const patch = {};
  if (extra.mbid && extra.mbid !== row.mbid) patch.mbid = extra.mbid;
  // A cover you picked yourself is never replaced.
  if (!row.cover_locked && extra.cover_url && extra.cover_url !== row.cover_url) {
    patch.cover_url = extra.cover_url;
  }
  // Compare before patching. Writing the same array back every night is
  // 4,000 pointless requests, and it makes the run's output say thousands of
  // albums changed when nothing did.
  const theirs = (row.genres || []).join("\u0000");
  const mine = (extra.genres || []).join("\u0000");
  if (extra.genres?.length && mine !== theirs) patch.genres = extra.genres;
  if (!Object.keys(patch).length) continue;
  await api.update("albums", `id=eq.${row.id}`, patch);
  refreshed++;
}
console.log(`refreshed enrichment on ${refreshed} existing albums`);
console.log("done");

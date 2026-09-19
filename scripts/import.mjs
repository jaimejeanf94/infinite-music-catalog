// import.mjs — push data/albums.csv into the Supabase `albums` table.
//
//   node scripts/import.mjs
//
// The dashboard's CSV importer does the same job; this exists for when you
// have re-run clean.py and want the table rebuilt without clicking through the
// UI. It skips albums already present (matched on artist + title), so running
// it twice is safe.
import { readFileSync } from "node:fs";
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

const albums = rows.filter((r) => r[col.artist]).map((r) => ({
  artist: r[col.artist],
  title: r[col.title],
  year: r[col.year] ? Number(r[col.year]) : null,
  score: r[col.score] ? Number(r[col.score]) : null,
  in_pool: r[col.in_pool] !== "false",
}));

const token = await signIn();
const api = rest(token);

const existing = new Set(
  (await api.select("albums?select=artist,title&limit=10000"))
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
console.log("done");

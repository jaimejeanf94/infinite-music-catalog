// import.mjs — push data/albums.csv into the Supabase `albums` table.
//
//   node scripts/import.mjs                       # the nightly: add what is missing,
//                                                 # push enrichment to what is there
//   node scripts/import.mjs --restore --dry-run   # what a restore would change
//   node scripts/import.mjs --restore             # put the database back to this CSV
//
// Albums are matched on artist + title, case aside -- the same rule as the
// database's unique index -- so running it twice is safe.
//
// ── restoring ───────────────────────────────────────────────────────────────
// albums.csv is committed every night, so git holds a dated copy of the whole
// collection. Restoring a bad week is:
//
//   git checkout <commit> -- data/albums.csv
//   node scripts/import.mjs --restore --dry-run
//   node scripts/import.mjs --restore
//
// Without --restore this could never do that. It skips every album already in
// the database, so a week of wrong scores on albums that still exist -- the
// realistic disaster -- was left exactly as it was, and the README promised a
// restore that restored nothing. --restore writes the fields a person owns
// back onto the matching rows (year, score, notes, genres, and the cover when
// you had chosen it), brings back anything the backup had that has since been
// deleted, and still only adds albums that are missing. It never removes one:
// an album added after the backup was taken is left where it is.
import { readFileSync, existsSync } from "node:fs";
import { requireEnv, signIn, rest } from "./supabase-rest.mjs";

const args = process.argv.slice(2);
const RESTORE = args.includes("--restore");
const DRY = args.includes("--dry-run");

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
const cellOf = (r, name) => (col[name] === undefined ? "" : r[col[name]] ?? "");

// Enrichment lives in its own file so rewriting albums.csv never clobbers it.
const enrichPath = new URL("../data/enrichment.json", import.meta.url);
const enrichment = existsSync(enrichPath)
  ? JSON.parse(readFileSync(enrichPath, "utf8"))
  : {};

const keyOf = (artist, title) => `${artist.toLowerCase()}::${title.toLowerCase()}`;

// What the CSV says about the fields a person owns. Older backups predate
// some columns, so a missing column reads as "not recorded", never as empty.
const owned = (r) => ({
  year: cellOf(r, "year") ? Number(cellOf(r, "year")) : null,
  score: cellOf(r, "score") ? Number(cellOf(r, "score")) : null,
  notes: cellOf(r, "notes") || null,
  genres: cellOf(r, "genres").split(";").map((g) => g.trim()).filter(Boolean),
  cover_locked: cellOf(r, "cover_locked") === "true",
  cover_url: cellOf(r, "cover_url") || null,
});

const albums = rows.filter((r) => cellOf(r, "artist")).map((r) => {
  const artist = cellOf(r, "artist"), title = cellOf(r, "title");
  const extra = enrichment[`${artist}::${title}`];
  const mine = owned(r);
  return {
    artist, title,
    year: mine.year,
    score: mine.score,
    // Notes used to be dropped on the way in, so a rebuilt row came back with
    // its rating and without what you had written about it.
    notes: mine.notes,
    source: cellOf(r, "source") === "app" ? "app" : "sheet",
    mbid: cellOf(r, "mbid") || extra?.mbid || null,
    // The CSV is an export of the database, so its genres already include
    // anything you edited by hand. Enrichment is only the fallback.
    genres: mine.genres.length ? mine.genres : (extra?.genres || []),
    // A cover chosen by hand wins over anything enrichment found, and the
    // flag comes back with it so a rebuilt row stays protected.
    cover_locked: mine.cover_locked,
    cover_url: (mine.cover_locked && mine.cover_url)
      ? mine.cover_url
      : (extra?.cover_url || mine.cover_url || null),
    _owned: mine,
  };
});

const token = await signIn();
const api = rest(token);

// One read of the whole table, deleted rows included. Skipping a tombstoned
// album is what stops the nightly import putting a deleted album straight
// back, because an older albums.csv can still carry it.
const inDb = await api.selectAll(
  "albums?select=id,artist,title,year,score,notes,genres,mbid,cover_url,cover_locked,deleted_at&order=id.asc");
const byKey = new Map(inDb.map((a) => [keyOf(a.artist, a.title), a]));

// A renamed album is a new name for a row that already exists, so matching on
// the name alone would insert it a second time and leave the original behind.
// That happens whenever albums.csv is older than the database -- a rename made
// in the app since the last export, for instance. The nightly run avoids it by
// exporting first, but nothing stops a hand-run import from being stale.
//
// The MusicBrainz id is the better identity: it survives a rename, because it
// names the record rather than the spelling.
const knownMbids = new Set(inDb.map((a) => a.mbid).filter(Boolean));

const renamed = [];
const fresh = albums.filter((a) => {
  if (byKey.has(keyOf(a.artist, a.title))) return false;
  if (a.mbid && knownMbids.has(a.mbid)) { renamed.push(a); return false; }
  return true;
});
if (renamed.length) {
  console.log(
    `${renamed.length} album(s) already in the database under a different name ` +
    `-- not inserting:`);
  for (const a of renamed.slice(0, 5)) console.log(`  ${a.artist} — ${a.title}`);
  if (renamed.length > 5) console.log(`  … and ${renamed.length - 5} more`);
  console.log(RESTORE
    ? `(renamed since this backup was taken; a restore matches on the name, so these are left as they are)`
    : `(albums.csv is older than the database — run export.mjs first)`);
}

console.log(`${albums.length} in CSV, ${inDb.length} already in the database, ${fresh.length} to insert`);

if (!DRY) {
  const BATCH = 500;
  for (let i = 0; i < fresh.length; i += BATCH) {
    await api.insert("albums", fresh.slice(i, i + BATCH).map(({ _owned, ...a }) => a));
    console.log(`  inserted ${Math.min(i + BATCH, fresh.length)}/${fresh.length}`);
  }
}

const sameList = (x, y) => (x || []).join("\u0000") === (y || []).join("\u0000");

if (RESTORE) {
  // ── put every matched row back to what the backup says ──────────────────
  const counts = { year: 0, score: 0, notes: 0, genres: 0, cover: 0, undeleted: 0 };
  const examples = [];
  let rowsChanged = 0;

  for (const a of albums) {
    const row = byKey.get(keyOf(a.artist, a.title));
    if (!row) continue;
    const want = a._owned, patch = {};

    if (want.year !== row.year) { patch.year = want.year; counts.year++; }
    if (want.score !== row.score) { patch.score = want.score; counts.score++; }
    if (want.notes !== (row.notes || null)) { patch.notes = want.notes; counts.notes++; }
    if (want.genres.length && !sameList(want.genres, row.genres)) {
      patch.genres = want.genres; counts.genres++;
    }
    // Only a cover you chose is yours to restore. An unlocked one belongs to
    // enrichment, and the next nightly run puts the right one back anyway.
    if (want.cover_locked !== !!row.cover_locked ||
        (want.cover_locked && want.cover_url !== row.cover_url)) {
      patch.cover_locked = want.cover_locked;
      if (want.cover_locked) patch.cover_url = want.cover_url;
      counts.cover++;
    }
    if (row.deleted_at) { patch.deleted_at = null; counts.undeleted++; }

    if (!Object.keys(patch).length) continue;
    rowsChanged++;
    if (examples.length < 8) {
      examples.push(`  ${a.artist} — ${a.title}: ` +
        Object.keys(patch).map((k) => `${k} ${JSON.stringify(row[k] ?? null)} -> ${JSON.stringify(patch[k])}`).join(", "));
    }
    if (!DRY) await api.update("albums", `id=eq.${row.id}`, patch);
  }

  console.log(`\n${DRY ? "would restore" : "restored"} ${rowsChanged} album(s)`);
  for (const [k, n] of Object.entries(counts)) if (n) console.log(`  ${k.padEnd(10)} ${n}`);
  if (examples.length) console.log("\n" + examples.join("\n"));
  if (DRY) console.log("\n--dry-run — nothing written");
  process.exit(0);
}

if (DRY) { console.log("--dry-run — nothing written"); process.exit(0); }

// ── the nightly: keep enrichment current on albums already there ───────────
let refreshed = 0;
for (const row of inDb) {
  if (row.deleted_at) continue;
  const extra = enrichment[`${row.artist}::${row.title}`];
  // Not `status === "ok"`: an album MusicBrainz could not match still gets a
  // cover from a fallback, and once cache-covers.mjs has rewritten that URL to
  // Supabase Storage it has to reach the database like any other. Each field
  // below is guarded on its own, so a record with nothing useful patches
  // nothing.
  if (!extra) continue;
  const patch = {};
  const rematched = !!extra.mbid && extra.mbid !== row.mbid;
  if (rematched) patch.mbid = extra.mbid;
  // A cover you picked yourself is never replaced.
  if (!row.cover_locked && extra.cover_url && extra.cover_url !== row.cover_url) {
    patch.cover_url = extra.cover_url;
  }
  // Genres are filled, not refreshed. enrichment.json only ever holds what
  // MusicBrainz said, and nothing copies an edit made in the app back into
  // it, so "refresh whenever the two differ" meant every genre you added or
  // removed on an album's sheet was put back the following night. A matched
  // album's genres never change on MusicBrainz's side anyway -- enrich.mjs
  // does not look at it again -- so a difference here IS an edit, and the
  // edit wins. The two exceptions: the row has none yet, or the album has
  // been matched to a different record, whose genres the old ones are not.
  if (extra.genres?.length && !sameList(extra.genres, row.genres) &&
      (!row.genres?.length || rematched)) {
    patch.genres = extra.genres;
  }
  if (!Object.keys(patch).length) continue;
  await api.update("albums", `id=eq.${row.id}`, patch);
  refreshed++;
}
console.log(`refreshed enrichment on ${refreshed} existing albums`);
console.log("done");

// export.mjs — write the live database back out to data/albums.csv.
//
//   node scripts/export.mjs
//
// Postgres is the source of truth; this is the backup. Committed every night
// by the workflow, which makes `git log data/albums.csv` a week-by-week
// history of the collection: what was added, what was rated, what was removed.
// Restoring is `git checkout <commit> -- data/albums.csv` then import.mjs.
//
// It is also what local mode reads, so an offline copy of the app is always
// working from the most recent backup.
import { writeFileSync } from "node:fs";
import { requireEnv, signIn, rest } from "./supabase-rest.mjs";

requireEnv();

// cover_locked travels with cover_url. Without it the backup records what
// the cover is but not that it was chosen by hand, so a database rebuilt
// from this file would have every manual cover unlocked -- and the next
// enrichment run would replace them.
//
// The Apple Music pair is last so a CSV written before it existed still lines
// up column for column with everything that reads this file by position.
const COLUMNS = ["artist", "title", "year", "score", "genres", "mbid", "cover_url", "cover_locked",
                 "notes", "source", "apple_music_url", "apple_music_locked"];

const cell = (v) => {
  if (v == null) return "";
  const s = Array.isArray(v) ? v.join("; ") : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const token = await signIn();
const api = rest(token);

// Deleted albums are left out: the tombstone has done its job, and older
// commits of this file still hold them if something needs recovering.
const rows = [];
for (let from = 0; ; from += 1000) {
  const page = await api.select(
    `albums?select=${COLUMNS.join(",")}&deleted_at=is.null` +
    `&order=artist.asc,title.asc&offset=${from}&limit=1000`);
  rows.push(...page);
  if (page.length < 1000) break;
}

const csv = [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
writeFileSync(new URL("../data/albums.csv", import.meta.url), csv);

const scored = rows.filter((r) => r.score != null).length;
const withGenres = rows.filter((r) => r.genres?.length).length;
console.log(`wrote data/albums.csv — ${rows.length} albums`);
console.log(`  rated:      ${scored}`);
console.log(`  genres:     ${withGenres}`);
console.log(`  added here: ${rows.filter((r) => r.source === "app").length}`);

// ── the playlist mirror ─────────────────────────────────────────────────────
// playlist_tracks is rewritten from the Music app every night by
// scripts/sync-playlist.mjs; this puts the same list in git, so
// `git log -p data/uberplaylist.csv` is the playlist's history -- what was
// added, what was dropped, and when -- going back further than the seven
// snapshots the Mac keeps, and held somewhere other than the Mac.
//
// There is no position column: a row's place in the file IS its position.
// With one, removing a single song renumbered every row after it and the
// night's diff was the whole playlist.
//
// One playlist is mirrored. Should there ever be two, the most recently
// synced one is the one written here.
//
// Never fatal: the album backup above is this script's job, and it has
// already been written by the time this runs.
const TRACK_COLUMNS = ["title", "artist", "album", "duration_s", "track_id"];
try {
  const [list] = await api.select(
    "playlists?select=id,name,track_count,synced_at&order=synced_at.desc&limit=1");
  if (!list) {
    console.log("no playlist mirrored yet — data/uberplaylist.csv left alone");
  } else {
    const tracks = await api.selectAll(
      `playlist_tracks?select=${TRACK_COLUMNS.join(",")}` +
      `&playlist_id=eq.${list.id}&order=position.asc`);
    // A sync caught half-way, or a table emptied by hand, should not replace
    // a good file with a short one.
    if (tracks.length !== list.track_count) {
      console.log(`playlist mirror holds ${tracks.length} rows but says ${list.track_count} ` +
        "— data/uberplaylist.csv left alone");
    } else {
      writeFileSync(new URL("../data/uberplaylist.csv", import.meta.url),
        [TRACK_COLUMNS.join(","),
         ...tracks.map((t) => TRACK_COLUMNS.map((c) => cell(t[c])).join(","))].join("\n") + "\n");
      console.log(`wrote data/uberplaylist.csv — ${tracks.length} songs from "${list.name}", ` +
        `synced ${list.synced_at.slice(0, 10)}`);
    }
  }
} catch (e) {
  console.log(`playlist mirror not exported: ${String(e.message).slice(0, 120)}`);
}

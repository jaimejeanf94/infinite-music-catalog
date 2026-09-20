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
const COLUMNS = ["artist", "title", "year", "score", "in_pool", "genres", "mbid", "cover_url", "cover_locked", "notes", "source"];

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

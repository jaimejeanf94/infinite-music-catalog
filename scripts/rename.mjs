// rename.mjs — correct an album's artist or title.
//
// A title is an identity here: data/enrichment.json is keyed by
// "artist::title", and so are the app's local edits. Renaming a row in
// albums.csv on its own would orphan that album's cover and genres and send
// the next enrichment run off to re-fetch them. This moves both halves
// together, or neither.
//
//   node scripts/rename.mjs --file renames.json [--dry-run]
//   node scripts/rename.mjs --from "Gorilaz::The Mountain" \
//                           --to   "Gorillaz::The Mountain" [--dry-run]
//
// The file is a JSON array of { from, to }, each "artist::title". When you own
// both spellings of the same album, add "merge": true: the `to` row survives,
// takes whichever score and year actually exist, and the `from` row is dropped.
// Without it, a rename onto an existing album is refused -- silently collapsing
// two rows is how a rating goes missing.
//
// --refresh drops each renamed album's enrichment record instead of carrying
// it over, so the next `node scripts/enrich.mjs` re-matches on the corrected
// name. Worth it when the old name only ever got a fuzzy fallback: a correct
// title finds a MusicBrainz release-group, which brings genres the fallback
// never had. The album shows a placeholder until that run.
//
// Nothing is written unless every entry in the batch is valid.

import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { execSync } from "node:child_process";

const DATA = new URL("../data/", import.meta.url);
const ALBUMS = new URL("albums.csv", DATA);
const ENRICH = new URL("enrichment.json", DATA);

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};
const DRY = argv.includes("--dry-run");
const REFRESH = argv.includes("--refresh");
// Without --db this script touches only local files and needs no account, as
// the rest of the offline tooling does. With it, the same rename is applied to
// Postgres -- which matters because import.mjs matches rows on artist+title,
// so a CSV-only rename would look like a brand new album and be inserted
// alongside the one it was meant to correct.
const DB = argv.includes("--db");

// enrich.mjs reads albums.csv once at startup and rewrites enrichment.json
// wholesale every few albums. Renaming underneath it would be silently undone
// and would leave the job writing under the old names.
if (!DRY) {
  let running = "";
  try { running = execSync("pgrep -f 'node .*enrich\\.mjs' || true", { encoding: "utf8" }).trim(); }
  catch { /* pgrep missing: fall through, the user gets no guard */ }
  if (running) {
    console.error(
      `enrich.mjs is running (pid ${running.split("\n").join(", ")}).\n` +
      `It holds the whole enrichment store in memory and will overwrite these\n` +
      `changes on its next save. Wait for it to finish, then re-run.`
    );
    process.exit(1);
  }
}

// ── the batch ───────────────────────────────────────────────────────────────
let batch;
if (flag("--file")) {
  batch = JSON.parse(readFileSync(flag("--file"), "utf8"));
} else if (flag("--from") && flag("--to")) {
  batch = [{ from: flag("--from"), to: flag("--to") }];
} else {
  console.error("need --file <json>, or --from and --to");
  process.exit(1);
}

const split = (key, label) => {
  const at = key.indexOf("::");
  if (at === -1) throw new Error(`${label} is not "artist::title": ${key}`);
  return [key.slice(0, at), key.slice(at + 2)];
};

// ── csv, edited line by line so untouched rows stay byte-identical ──────────
function parseLine(line) {
  const out = [];
  let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}
const quote = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

const csv = readFileSync(ALBUMS, "utf8");
const eol = csv.includes("\r\n") ? "\r\n" : "\n";
const lines = csv.split(/\r?\n/);
const header = parseLine(lines[0]);
const iArtist = header.indexOf("artist");
const iTitle = header.indexOf("title");
if (iArtist === -1 || iTitle === -1) throw new Error("albums.csv has no artist/title column");

const store = existsSync(ENRICH) ? JSON.parse(readFileSync(ENRICH, "utf8")) : {};

// Index the CSV once: key -> line number.
const lineOf = new Map();
for (let n = 1; n < lines.length; n++) {
  if (!lines[n].trim()) continue;
  const f = parseLine(lines[n]);
  const k = `${f[iArtist]}::${f[iTitle]}`;
  if (!lineOf.has(k)) lineOf.set(k, n);
}

// ── validate the whole batch before touching anything ───────────────────────
const problems = [];
const planned = [];
const willExist = new Set(lineOf.keys());

for (const { from, to, merge } of batch) {
  const [fa, ft] = split(from, "from");
  const [ta, tt] = split(to, "to");
  if (from === to) { problems.push(`no-op: ${from}`); continue; }
  if (!lineOf.has(from)) { problems.push(`not in albums.csv: ${from}`); continue; }
  const targetExists = willExist.has(to);
  if (targetExists && !merge) {
    problems.push(`target already exists, add "merge": true if that is intended: ${to}`);
    continue;
  }
  if (merge && !targetExists) {
    problems.push(`marked as a merge but nothing to merge into: ${to}`);
    continue;
  }
  willExist.delete(from);
  willExist.add(to);
  planned.push({
    from, to, fa, ft, ta, tt, merge: !!merge,
    line: lineOf.get(from),
    intoLine: targetExists ? lineOf.get(to) : null,
  });
}

if (problems.length) {
  console.error("nothing written — fix these first:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

// ── apply ───────────────────────────────────────────────────────────────────
const iYear = header.indexOf("year");
const iScore = header.indexOf("score");
const drop = new Set();
let movedEnrichment = 0, merged = 0, dropped = 0;

for (const p of planned) {
  const f = parseLine(lines[p.line]);

  if (p.merge) {
    // The surviving row is the correctly-spelled one; the duplicate only ever
    // contributes what the survivor is missing. A score present on both is
    // kept at the higher value rather than picked arbitrarily.
    const t = parseLine(lines[p.intoLine]);
    const notes = [];
    const mine = iScore > -1 ? f[iScore].trim() : "";
    const theirs = iScore > -1 ? t[iScore].trim() : "";
    if (mine && !theirs) { t[iScore] = f[iScore]; notes.push(`took score ${mine}`); }
    else if (mine && theirs && Number(mine) !== Number(theirs)) {
      const keep = String(Math.max(Number(mine), Number(theirs)));
      t[iScore] = keep;
      notes.push(`scores differed (${theirs} / ${mine}), kept ${keep}`);
    }
    if (iYear > -1 && !t[iYear].trim() && f[iYear].trim()) {
      t[iYear] = f[iYear]; notes.push(`took year ${f[iYear]}`);
    }
    lines[p.intoLine] = t.map(quote).join(",");
    drop.add(p.line);

    // Enrichment: the survivor's own record wins; the duplicate's is only
    // promoted if the survivor never got one.
    if (!store[p.to] && store[p.from]) { store[p.to] = store[p.from]; notes.push("took cover + genres"); }
    if (store[p.from]) delete store[p.from];

    merged++;
    console.log(
      `merge  ${p.fa} — ${p.ft}\n    into ${p.ta} — ${p.tt}` +
      (notes.length ? `   [${notes.join("; ")}]` : "   [nothing to carry over]")
    );
    continue;
  }

  f[iArtist] = p.ta;
  f[iTitle] = p.tt;
  lines[p.line] = f.map(quote).join(",");

  let note = "no enrichment yet";
  if (store[p.from]) {
    if (REFRESH) {
      delete store[p.from];
      dropped++;
      note = "dropped, will re-match on the new name";
    } else {
      store[p.to] = store[p.from];
      delete store[p.from];
      movedEnrichment++;
      note = `kept cover${store[p.to].genres?.length ? " + genres" : ", still no genres"}`;
    }
  }
  console.log(`rename ${p.fa} — ${p.ft}\n    -> ${p.ta} — ${p.tt}   [${note}]`);
}

// Deleting by index would shift every later line, so removal happens once, here.
if (drop.size) {
  const kept = lines.filter((_, n) => !drop.has(n));
  lines.length = 0;
  lines.push(...kept);
}

const renamed = planned.length - merged;
console.log(
  `\n${renamed} renamed, ${merged} merged away` +
  (dropped ? `, ${dropped} enrichment records dropped for re-matching` : "") +
  (movedEnrichment ? `, ${movedEnrichment} carried their enrichment` : "") +
  (DRY ? "   — --dry-run, nothing written" : "")
);
if (dropped && !DRY) console.log(`\nnow run:  node scripts/enrich.mjs   # fills the ${dropped} gaps`);

if (DRY) process.exit(0);

// ── carry the renames into Postgres, when asked ─────────────────────────────
if (DB) {
  if (planned.some((p) => p.merge)) {
    console.error(
      "--db does not do merges: collapsing two database rows means deciding\n" +
      "what happens to their rolls and plays. Do those by hand."
    );
    process.exit(1);
  }
  const { requireEnv, signIn, rest } = await import("./supabase-rest.mjs");
  requireEnv();
  const api = rest(await signIn());

  // Fetch the ids once and match in memory, rather than building a PostgREST
  // filter per album -- album titles contain commas, quotes and parentheses,
  // all of which mean something in a filter.
  const rows = await api.selectAll("albums?select=id,artist,title&order=id.asc");
  const idOf = new Map(rows.map((r) => [`${r.artist}::${r.title}`, r.id]));

  let patched = 0, absent = 0;
  for (const p of planned) {
    const id = idOf.get(p.from);
    if (!id) { absent++; continue; }        // not in the database yet; the CSV is enough
    await api.update("albums", `id=eq.${id}`, { artist: p.ta, title: p.tt });
    patched++;
  }
  console.log(`database: ${patched} rows renamed` + (absent ? `, ${absent} not found there` : ""));
}

// Write to a sibling then rename, so an interrupted run cannot leave a
// half-written catalog behind.
const tmpCsv = new URL("albums.csv.tmp", DATA);
const tmpEnr = new URL("enrichment.json.tmp", DATA);
writeFileSync(tmpCsv, lines.join(eol));
writeFileSync(tmpEnr, JSON.stringify(store, null, 1));
renameSync(tmpCsv, ALBUMS);
renameSync(tmpEnr, ENRICH);
console.log("written");

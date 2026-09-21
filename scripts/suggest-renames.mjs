// suggest-renames.mjs — work out what a misspelt album is actually called.
//
// Only looks at albums enrichment could not match at all (no MusicBrainz id),
// since an album that matched already has the right name by definition.
//
//   node scripts/suggest-renames.mjs [--limit=N] [--out=renames.json]
//
// Writes a batch for scripts/rename.mjs. Nothing is applied here.
//
// Why not just fuzzy-search the whole database: because "Zen" is one edit from
// "Xen" and also one edit from a thousand other things, and an open search
// happily returns Arcane. Edit distance is only trustworthy against a small
// set of known-correct strings, so both passes below close the set first.
//
//   Pass A  find the ARTIST, pull their discography, match the title inside it.
//           Arca has ~8 release-groups; "Zen" can only land on "Xen".
//   Pass B  if the artist cannot be found (their name is the typo), search the
//           TITLE, then match the artist among whoever released it.
//
// Distance alone still cannot tell a typo from a different record -- "pt. 2"
// is one edit from "Pt. 1" -- so any suggestion that changes a DIGIT is held
// back for review. Numbers in album titles are load-bearing: Vol. 2, Pt. 1,
// 1991, 99.9%.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

const UA = "InfiniteMusicCatalog/1.0 (https://github.com/jaimejean/infinite-music-catalog)";
const MB = "https://musicbrainz.org/ws/2";
const DATA = new URL("../data/", import.meta.url);
const ALBUMS = new URL("albums.csv", DATA);
const ENRICH = new URL("enrichment.json", DATA);

const args = process.argv.slice(2);
const LIMIT = Number(args.find((a) => a.startsWith("--limit="))?.split("=")[1] || Infinity);
const OUT = args.find((a) => a.startsWith("--out="))?.split("=")[1] || "renames.json";
const REVIEW = OUT.replace(/\.json$/, "-review.json");
// Without a cooldown the nightly run cycles through the same unmatched albums
// every few nights, repeating lookups that already came back with nothing.
// Each album examined is stamped, and skipped until the stamp is this old. A
// newly added album has no stamp, so it is always looked at on the next run.
const AFTER_DAYS = Number(args.find((a) => a.startsWith("--after="))?.split("=")[1] || 30);

const MB_GAP = 1100;                       // MusicBrainz allows one call a second
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Letters and digits in any script -- see the note in lib/match.mjs.
const norm = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]/gu, "");
// A sequence marker is the one thing distance is blind to: "Part II" is a
// hair away from "Part One" and "Vol. 2" from "Vol. 3", but they are different
// records. Digits alone are not enough -- Roman numerals and number words say
// the same thing -- so all three are collected and compared as a set.
const NUM_WORDS = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10",
  first: "1", second: "2", third: "3", fourth: "4", fifth: "5",
  i: "1", ii: "2", iii: "3", iv: "4", v: "5", vi: "6",
  vii: "7", viii: "8", ix: "9", x: "10",
};
function sequenceTokens(s) {
  const out = new Set();
  for (const m of String(s).toLowerCase().matchAll(/[a-z]+|\d+/g)) {
    const t = m[0];
    if (/^\d+$/.test(t)) out.add(String(Number(t)));
    else if (NUM_WORDS[t]) out.add(NUM_WORDS[t]);
  }
  return out;
}
const sameSequence = (a, b) => {
  const x = sequenceTokens(a), y = sequenceTokens(b);
  if (x.size !== y.size) return false;
  for (const t of x) if (!y.has(t)) return false;
  return true;
};

// Titles that share heavy boilerplate ("Original Motion Picture Soundtrack",
// "Live at ...") score well on ratio while differing in the only part that
// identifies the record. Compare what is left once the shared words are gone.
const BOILERPLATE = /\b(original|motion|picture|soundtrack|score|music|from|the|a|an|of|and|deluxe|edition|remaster(ed)?|expanded|anniversary|version|ost|vol|volume|part|pt|live|at)\b/gi;
function distinctivePart(s) {
  return String(s).toLowerCase().replace(BOILERPLATE, " ").replace(/[^a-z0-9]+/g, " ").trim();
}

// Deliberately without enrich.mjs's `if (Math.abs(m - n) > 3) return 99` bail.
// That guard is a speed optimisation there, but it means a title missing a
// whole word can never match -- which is exactly the case this script exists
// for ("Three Cheers for Revenge" is 5 characters short of "...Sweet Revenge").
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// A fixed edit budget punishes long titles and lets short ones through on
// nonsense, so score as a fraction of the longer string instead.
const ratio = (a, b) => {
  const x = norm(a), y = norm(b);
  if (!x || !y) return 1;
  if (x === y) return 0;
  // Containment usually means a subtitle ("Homecoming" inside "Homecoming: The
  // Live Album"), but only when the shorter string is substantial. "Legend" is
  // inside "Reggae Legends", and a title normalising to a single letter -- as
  // Cyrillic does, since everything but the Latin M is stripped -- is inside
  // almost anything. Both scored a perfect 0.05 before this floor.
  if (x.includes(y) || y.includes(x)) {
    const short = Math.min(x.length, y.length);
    const long = Math.max(x.length, y.length);
    if (short >= 6 && short / long >= 0.5) return 0.05;
    // otherwise fall through and measure it properly
  }
  return editDistance(x, y) / Math.max(x.length, y.length);
};

// Two bands. MAX is how far the search will look at all; TIGHT is how close a
// suggestion has to be to go through without being read first. Between them is
// the review pile, which is where most real corrections turn out to sit.
const TITLE_MAX = 0.28;     // "threecheersforrevenge" -> "...sweetrevenge" is 0.19
const ARTIST_MAX = 0.22;
const TITLE_TIGHT = 0.16;
const ARTIST_TIGHT = 0.16;

async function mbFetch(path, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${MB}${path}`, { headers: { "User-Agent": UA } });
    if (res.ok) return res.json();
    if (res.status === 503 && i < tries - 1) { await sleep(3000 * (i + 1)); continue; }
    throw new Error(`MusicBrainz ${res.status}`);
  }
}

// A live album or a compilation with a near-identical name is a worse answer
// than the studio record, even when it scores a hair closer.
const typePenalty = (rg) => {
  const secondary = (rg["secondary-types"] || []).map((t) => t.toLowerCase());
  if (secondary.includes("live")) return 0.12;
  if (secondary.includes("compilation")) return 0.08;
  if (secondary.includes("remix") || secondary.includes("demo")) return 0.10;
  if ((rg["primary-type"] || "").toLowerCase() === "single") return 0.10;
  return 0;
};

// ── pass A: find the artist, then search only their own records ─────────────
async function viaArtist(artist, title) {
  let found;
  try { found = await mbFetch(`/artist/?query=${encodeURIComponent(artist)}&fmt=json&limit=5`); }
  catch { return null; }

  for (const a of (found.artists || []).slice(0, 3)) {
    const aRatio = ratio(artist, a.name);
    if (aRatio > ARTIST_MAX) continue;
    await sleep(MB_GAP);

    let rgs;
    try { rgs = await mbFetch(`/release-group?artist=${a.id}&fmt=json&limit=100`); }
    catch { continue; }

    let best = null, bestScore = 9;
    for (const rg of rgs["release-groups"] || []) {
      const s = ratio(title, rg.title) + typePenalty(rg);
      if (s < bestScore) { bestScore = s; best = rg; }
    }
    if (best && bestScore <= TITLE_MAX) {
      return {
        artist: a.name, title: best.title, mbid: best.id,
        pass: "artist", titleRatio: Number(bestScore.toFixed(3)),
        artistRatio: Number(aRatio.toFixed(3)),
        pool: (rgs["release-groups"] || []).length,
      };
    }
  }
  return null;
}

// ── pass B: the artist's name is the typo, so anchor on the title ───────────
async function viaTitle(artist, title) {
  let found;
  try {
    found = await mbFetch(
      `/release-group/?query=${encodeURIComponent(`"${title}"`)}&fmt=json&limit=25`);
  } catch { return null; }

  let best = null, bestScore = 9;
  for (const rg of found["release-groups"] || []) {
    const credited = rg["artist-credit"]?.[0]?.name || "";
    const aR = ratio(artist, credited);
    const tR = ratio(title, rg.title);
    if (aR > ARTIST_MAX || tR > TITLE_MAX) continue;
    const s = aR + tR + typePenalty(rg);
    if (s < bestScore) {
      bestScore = s;
      best = { artist: credited, title: rg.title, mbid: rg.id, pass: "title",
               artistRatio: Number(aR.toFixed(3)), titleRatio: Number(tR.toFixed(3)) };
    }
  }
  return best;
}

// ── main ────────────────────────────────────────────────────────────────────
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

const [, ...rows] = parseCsv(readFileSync(ALBUMS, "utf8"));
const store = existsSync(ENRICH) ? JSON.parse(readFileSync(ENRICH, "utf8")) : {};

// Only albums nothing could be found for. One that matched already has a name
// MusicBrainz agreed with.
const today = new Date().toISOString().slice(0, 10);
const staleEnough = (rec) => {
  if (!rec?.rename_checked) return true;
  const age = (Date.parse(today) - Date.parse(rec.rename_checked)) / 86400000;
  return age >= AFTER_DAYS;
};

const unmatched = rows
  .filter((r) => r[0])
  .map((r) => ({ artist: r[0], title: r[1] }))
  .filter((a) => !store[`${a.artist}::${a.title}`]?.mbid);
const due = unmatched.filter((a) => staleEnough(store[`${a.artist}::${a.title}`]));
const targets = due.slice(0, LIMIT);
const cooling = unmatched.length - due.length;   // checked recently
const deferred = due.length - targets.length;    // due, but over tonight's limit

console.log(
  `${unmatched.length} albums with no MusicBrainz match` +
  `\n  ${targets.length} to look at tonight` +
  (cooling ? `\n  ${cooling} looked at within the last ${AFTER_DAYS} days` : "") +
  (deferred ? `\n  ${deferred} due but over tonight's limit — next run` : "") + "\n");
// The review pile is a standing list, not tonight's findings. It used to be
// overwritten every run -- with this batch, or with [] on a night with nothing
// due -- while every album examined was stamped and left alone for 30 days.
// So a held-back suggestion was on the Fix screen for one day and then
// vanished for a month, and the pile emptied itself while most of what it had
// held was still unresolved on the shelf. Now tonight's verdicts
// replace only the entries for albums examined tonight, and everything else
// stays until you rename it or reject it on the Fix screen.
const liveNames = new Set(rows.filter((r) => r[0]).map((r) => `${r[0]}::${r[1]}`));
function keepReviewing(tonight) {
  const examined = new Set(targets.map((a) => `${a.artist}::${a.title}`));
  const before = existsSync(REVIEW) ? JSON.parse(readFileSync(REVIEW, "utf8")) : [];
  const kept = before.filter((e) => !examined.has(e.from) && liveNames.has(e.from));
  const merged = [...kept, ...tonight];
  writeFileSync(REVIEW, JSON.stringify(merged, null, 1));
  return { merged, carried: kept.length, pruned: before.length - kept.length };
}

if (!targets.length) {
  writeFileSync(OUT, "[]");
  const { merged } = keepReviewing([]);
  console.log(`nothing due for another look — ${merged.length} still waiting for your review`);
  process.exit(0);
}

const safe = [], review = [], nothing = [];
let cosmetic = 0;

for (const [i, a] of targets.entries()) {
  let hit = await viaArtist(a.artist, a.title);
  await sleep(MB_GAP);
  if (!hit) { hit = await viaTitle(a.artist, a.title); await sleep(MB_GAP); }

  // Stamp the moment the lookups are done, before any branch below can skip
  // past it, and save periodically. Stamping only at the end means an
  // interrupted run -- a CI timeout, a lost network -- repeats every lookup
  // next time, which is what the cooldown exists to prevent.
  const k = `${a.artist}::${a.title}`;
  if (store[k]) store[k].rename_checked = today;
  if ((i + 1) % 20 === 0) writeFileSync(ENRICH, JSON.stringify(store, null, 1));

  if (!hit) { nothing.push(a); }
  else if (norm(hit.artist) === norm(a.artist) && norm(hit.title) === norm(a.title)) {
    nothing.push(a);          // same name, just untagged -- not a rename
  } else {
    const entry = {
      from: `${a.artist}::${a.title}`,
      to: `${hit.artist}::${hit.title}`,
      _pass: hit.pass, _titleRatio: hit.titleRatio, _artistRatio: hit.artistRatio,
      _mbid: hit.mbid,
    };
    // MusicBrainz credits a release-group to its primary artist, so a record
    // the sheet lists as a collaboration comes back under one name. That is a
    // house rule, not a correction, and applying it would delete a name the
    // collection deliberately recorded.
    const names = (s) => s.split(/\s*(?:&|\band\b|,|\bwith\b|\bfeat\.?\b)\s*/i)
                          .map(norm).filter(Boolean);
    const mine = names(a.artist), theirs = names(hit.artist);
    const lostSomeone = mine.length > theirs.length &&
                        mine.some((n) => !theirs.some((t) => t.includes(n) || n.includes(t)));

    // "X and Y" vs "X & Y", or a straight quote against a curly one, is not a
    // correction at all. Renaming for it costs an enrichment refetch and gains
    // nothing, so these are dropped rather than queued for review.
    const house = (s) => norm(s.replace(/\band\b/gi, "&"));
    if (house(a.artist) === house(hit.artist) && house(a.title) === house(hit.title)) {
      cosmetic++;
      continue;
    }

    // A typo changes letters inside words. Gaining or losing a whole word
    // changes which release it is: "Unplugged" -> "Dirt / MTV Unplugged",
    // "Greatest Hits" -> "Greatest Hits & More". Boilerplate is ignored, so
    // picking up "Live at" or a remaster tag does not count.
    const words = (s) => distinctivePart(s).split(/\s+/).filter((w) => w.length >= 4);
    const unmatched = (from, to) =>
      from.filter((w) => !to.some((v) => ratio(w, v) <= 0.34));
    const wA = words(a.title), wB = words(hit.title);
    const gained = unmatched(wB, wA), lost = unmatched(wA, wB);

    // Three ways a low ratio still means the wrong record.
    const reasons = [];
    if (gained.length || lost.length) {
      const bits = [];
      if (gained.length) bits.push(`gains "${gained.join(" ")}"`);
      if (lost.length) bits.push(`loses "${lost.join(" ")}"`);
      reasons.push(`the title ${bits.join(" and ")} — likely a different release`);
    }
    if (lostSomeone) reasons.push(`drops a credited artist (${mine.length} names -> ${theirs.length})`);
    if (!sameSequence(a.title, hit.title))
      reasons.push("sequence number changed (Pt. 2 / Vol. 3 / Part One)");
    // The distinctive words -- what is left after the boilerplate -- have to
    // survive too, or "Interstellar: Original Motion Picture Soundtrack"
    // matches "Tears of the Sun: Original Motion Picture Soundtrack".
    const dA = distinctivePart(a.title), dB = distinctivePart(hit.title);
    if (dA && dB && ratio(dA, dB) > 0.34)
      reasons.push("the distinctive words differ, only the boilerplate matches");
    if (hit.titleRatio > TITLE_TIGHT || hit.artistRatio > ARTIST_TIGHT)
      reasons.push("looser than the confident band");

    if (reasons.length) { entry._why = reasons.join("; "); review.push(entry); }
    else safe.push(entry);
  }

  if ((i + 1) % 10 === 0 || i === targets.length - 1)
    console.log(`  ${i + 1}/${targets.length}  —  ${safe.length} confident, ${review.length} to review, ${nothing.length} no answer`);
}

writeFileSync(ENRICH, JSON.stringify(store, null, 1));

writeFileSync(OUT, JSON.stringify(safe, null, 1));
const pile = keepReviewing(review);

console.log(`\n=== confident (${safe.length}) -> ${OUT} ===`);
for (const e of safe) console.log(`  ${e.from.replace("::", " — ")}\n    -> ${e.to.replace("::", " — ")}   [${e._pass} pass]`);
console.log(`\n=== needs your eyes (${review.length} new, ${pile.merged.length} waiting in all) -> ${REVIEW} ===`);
for (const e of review) console.log(`  ${e.from.replace("::", " — ")}\n    -> ${e.to.replace("::", " — ")}   [${e._why}]`);
console.log(`\n${nothing.length} genuinely not in MusicBrainz`);
console.log(`${cosmetic} skipped as house style ("and" vs "&", quote characters)\n`);
console.log(`review the file, then:  node scripts/rename.mjs --file ${OUT} --refresh --dry-run`);

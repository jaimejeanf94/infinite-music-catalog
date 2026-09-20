// match.mjs — deciding which MusicBrainz release-group an album actually is.
//
// Shared by enrich.mjs, which matches albums it has never seen, and
// recheck-matches.mjs, which re-examines ones that were matched badly. Keeping
// one copy matters: the two would drift, and then a recheck would "fix" albums
// into a state the next nightly run undoes.

export const norm = (s) => (s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

export function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i-1] === b[j-1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// "Freddie Gibs" should match "Freddie Gibbs"; "Gorilaz" should match
// "Gorillaz". Tolerance scales with length so short names stay strict.
export function sameArtist(mine, theirs) {
  const a = norm(mine), b = norm(theirs);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const allowed = Math.min(2, Math.max(1, Math.floor(Math.min(a.length, b.length) / 8)));
  return editDistance(a, b) <= allowed;
}

export const artistAgrees = sameArtist;

// Rank in tiers; never add the tiers up. Summing is what let "The Alternate
// A Hard Day's Night" beat "A Hard Day's Night": the alternate scored 70 for
// containing the title plus 10 for being a plain Album, while the real one
// scored 100 for an exact match and was then docked 45 for being a
// Soundtrack. An exact title match must never lose to a longer title that
// merely contains it.
//
// 0 exact, 1 one contains the other, 2 close enough to be a typo.
export function titleTier(rg, wantTitle) {
  const a = norm(wantTitle), b = norm(rg.title || "");
  if (!a || !b) return null;
  if (a === b) return { tier: 0, slack: 0 };
  if (b.includes(a) || a.includes(b)) return { tier: 1, slack: Math.abs(a.length - b.length) };
  const d = editDistance(a, b);
  if (d > Math.max(3, a.length / 6)) return null;      // a different album
  return { tier: 2, slack: d };
}

// The shelf genuinely holds live albums, compilations and remix records, so
// these are never excluded -- only ordered. If every candidate is a
// compilation then the album IS a compilation and the best one still wins.
// The ranking only bites when a plain studio release is sitting right next to
// a repackaging of it.
export const ASKS_FOR_REPACKAGING =
  /\b(live|remix|demo|compilation|best of|greatest hits|anthology|unplugged|collection|singles|sessions|rarities|b-sides|deluxe|soundtrack|original score|ost)\b/i;

export function typeRank(rg, wantTitle) {
  const sec = (rg["secondary-types"] || []).map((x) => x.toLowerCase());
  if (!sec.length) return 0;
  if (ASKS_FOR_REPACKAGING.test(wantTitle)) return 0;   // you asked for it
  if (sec.length === 1 && sec[0] === "soundtrack") return 1;  // what the record is,
                                                             // not a repackaging of it
  return 2;
}

// Among candidates that are otherwise equal, several plain albums can share a
// title -- American Football released three. Only the shelf's own year says
// which one is meant, so it is used to identify the record, never as the year
// itself: the year still comes from whichever release-group wins.
export function pickByDate(candidates, sheetYear) {
  const dated = candidates.filter((c) => c.rg["first-release-date"]);
  if (dated.length < 2) return candidates[0];
  const yearOf = (c) => Number(c.rg["first-release-date"].slice(0, 4));
  if (sheetYear) {
    const want = Number(sheetYear);
    return dated.reduce((a, b) =>
      Math.abs(yearOf(a) - want) <= Math.abs(yearOf(b) - want) ? a : b);
  }
  return dated.reduce((a, b) => (yearOf(a) <= yearOf(b) ? a : b));   // the original
}

export function bestOf(groups, title, artist, sheetYear) {
  const scored = [];
  for (const rg of groups || []) {
    const credited = rg["artist-credit"]?.map((c) => c.name).join(" ") || "";
    if (!sameArtist(artist, credited)) continue;
    const t = titleTier(rg, title);
    if (!t) continue;
    scored.push({ rg, tier: t.tier, slack: t.slack, type: typeRank(rg, title) });
  }
  if (!scored.length) return null;

  scored.sort((a, b) =>
    a.tier - b.tier || a.type - b.type || a.slack - b.slack ||
    (b.rg.score || 0) - (a.rg.score || 0));

  // Everything indistinguishable from the winner competes on date.
  const top = scored[0];
  const tied = scored.filter((c) =>
    c.tier === top.tier && c.type === top.type && c.slack === top.slack);
  return pickByDate(tied, sheetYear).rg;
}

// Inside a quoted Lucene phrase only a backslash and a quote need escaping,
// but the old code stripped quotes outright, which silently changed the title
// it was searching for.
export const lucene = (s) => String(s).replace(/([\\"])/g, "\\$1");


// genres.js — splitting an album's tags into a genre you can filter by and
// styles that describe it.
//
// MusicBrainz tags are one flat list of ~2,200 names with no hierarchy, and
// Discogs, which does have genre/style as separate fields, files every kind of
// metal, shoegaze and post-punk under "Rock" — too coarse to browse by. So the
// split is computed from this collection instead of imported from anywhere.
//
// Three rules, in order:
//
//   1. A tag is a GENRE if enough albums here carry it. The bar is relative to
//      the collection, so it tracks whatever your taste actually contains:
//      post-rock, idm and krautrock stay genres rather than collapsing.
//   2. A handful of tags are on so many albums that they say nothing when
//      anything better is present. "rock" sits on Nails' grindcore record. Those
//      are dropped whenever the album has a more specific genre -- and kept when
//      it does not, which is why Pavement is still rock and indie rock.
//   3. An album left with nothing after (2) gets a family term inferred from its
//      tags. MusicBrainz has no plain "metal" tag, so grindcore and powerviolence
//      would otherwise have no genre at all.
//
// Everything else becomes a STYLE: shown with the album, not offered as a filter,
// because half of them sit on two albums or fewer.

const GENRE_MIN_SHARE = 0.012;   // ~1.2% of the collection
const MEGA_SHARE = 0.15;         // a tag this common carries no information

// Families MusicBrainz never tags with the broad term.
const FAMILIES = [
  ["metal", /metal|grindcore|powerviolence|sludge|doom|mathcore|screamo/i],
  ["punk", /\bpunk\b|hardcore/i],
  ["classical", /classical|baroque|orchestral|chamber music|opera/i],
];

function buildIndex(albums) {
  const freq = new Map();
  let withGenres = 0;
  for (const a of albums) {
    if (!a.genres?.length) continue;
    withGenres++;
    for (const g of a.genres) freq.set(g, (freq.get(g) || 0) + 1);
  }
  const n = Math.max(withGenres, 1);
  const min = Math.max(6, Math.round(n * GENRE_MIN_SHARE));
  const qualifies = new Set();
  const mega = new Set();
  for (const [g, c] of freq) {
    if (c >= min) qualifies.add(g);
    if (c / n > MEGA_SHARE) mega.add(g);
  }
  return { freq, qualifies, mega };
}

function splitGenres(tags, index) {
  if (!tags?.length) return { genre: [], style: [] };
  const { qualifies, mega } = index;

  const common = tags.filter((g) => qualifies.has(g));
  const specific = common.filter((g) => !mega.has(g));

  let genre;
  if (specific.length) {
    genre = specific;
  } else {
    const family = FAMILIES.find(([, re]) => tags.some((t) => re.test(t)));
    genre = family ? [family[0]] : common;
  }

  const chosen = new Set(genre);
  // A mega tag is never a style either -- it is noise in both places.
  const style = tags.filter((g) => !chosen.has(g) && !mega.has(g));
  return { genre, style };
}

// The filter list: genres only, commonest first, and never the rescued family
// terms, which are inferred rather than tagged.
function genreOptions(albums, index) {
  const counts = new Map();
  for (const a of albums) {
    const { genre } = splitGenres(a.genres, index);
    for (const g of genre) counts.set(g, (counts.get(g) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

const Genres = { buildIndex, splitGenres, genreOptions };
if (typeof module !== "undefined" && module.exports) module.exports = Genres;
else window.Genres = Genres;

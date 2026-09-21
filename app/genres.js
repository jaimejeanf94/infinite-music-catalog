// genres.js — splitting an album's tags into a genre you can filter by and
// styles that describe it.
//
// MusicBrainz tags are one flat list of ~2,200 names with no hierarchy, and
// Discogs, which does have genre/style as separate fields, files every kind of
// metal, shoegaze and post-punk under "Rock" — too coarse to browse by. So the
// split is computed from this collection instead of imported from anywhere.
//
// How an album's genres are decided, in order:
//
//   1. Every ROOT it is tagged with (the fixed list below), plus the root any
//      of its tags is an ALIAS of -- soul is r&b, afrobeat is African.
//   2. "metal" if it carries a metal subgenre, whatever else it carries.
//   3. Nothing yet: the roots its styles attach to. A shoegaze record tagged
//      only "shoegaze, dream pop" is a rock record, and findable as one.
//   4. Still nothing: a family pattern -- hardcore is punk, baroque is
//      classical.
//
// Everything else becomes a STYLE: shown with the album, not offered as a filter,
// because half of them sit on two albums or fewer.

// A fixed, short list of roots. These are the only names offered as genres.
// Everything else is a style of one of them.
//
// Deriving the roots from frequency alone does not work: "rock" sits on 59% of
// this shelf, so a purely statistical rule swallows punk, heavy metal and
// post-punk as styles of it, while indietronica and neo-psychedelia survive as
// "genres" purely because they overlap nothing large. So the roots are a
// short fixed list -- twenty-six, each a change made on purpose and explained
// beside it below -- and only the ATTACHMENT is computed, from what actually
// co-occurs here.
//
// That is what collapses the tagging noise. "electro", "electronica",
// "electropop" and "synth-pop" are not four genres; they are four ways of
// tagging records that are also tagged "electronic", and they belong under it.
const ROOTS = [
  // rock, split. "rock" alone sat on 59% of the shelf, which made it useless
  // as a filter -- clicking it narrowed nothing. These are the scenes big
  // enough to stand on their own here, and between them they claim two thirds
  // of what used to be one undifferentiated pile.
  "rock", "indie rock", "alternative rock", "folk rock", "post-rock",
  "post-punk", "punk", "metal", "psychedelic rock", "progressive rock",
  "new wave",
  // everything else
  "electronic", "ambient", "pop", "hip hop", "jazz", "folk", "blues",
  "r&b", "funk", "disco", "latin", "country", "classical", "reggae",
  // African music had no root, so soukous, mbalax, jujú, mbaqanga, benga and
  // griot were each a style of nothing and fell out of every filter -- which
  // is how Franco, Tabu Ley Rochereau, Youssou N'Dour and Sunny Ade became
  // unbrowsable. Note that no album is TAGGED "african": this root exists
  // entirely through the aliases below, which is why the liveness rule in
  // buildIndex has to count aliased-to roots as real.
  "african",
];

// Merges the collection's own tagging does not support, but which are right.
// soul and r&b share only 42 albums of 125, so nothing computed would join
// them -- this is a judgement about the music, so it is written down as one
// rather than buried in a threshold.
const ALIASES = {
  "soul": "r&b",
  "neo soul": "r&b",
  "contemporary r&b": "r&b",
  "alternative r&b": "r&b",
  "motown": "r&b",

  // The African roots. Every one of these sits on five albums or fewer, which
  // is under MIN_TO_ATTACH, so nothing computed would ever have placed them --
  // and they co-occur with no root anyway. "afrobeat" is the exception: it has
  // twelve albums and WAS attaching to jazz on overlap alone. Fela is not a
  // jazz musician with a sideline, so it is moved here deliberately.
  "afrobeat": "african",
  "afrobeats": "african",
  "soukous": "african",
  "congolese rumba": "african",
  "mbalax": "african",
  "mbaqanga": "african",
  "benga": "african",
  "griot": "african",
  "jùjú": "african",
  "highlife": "african",
  "african blues": "african",
  "ethio-jazz": "african",

  // Brazilian regional styles, each on a single album.
  "mangue beat": "latin",
  "tecnobrega": "latin",
  "brega calypso": "latin",

  // Plunderphonic internet microgenres. Nine albums of dariacore and nothing
  // to attach it to, because it co-occurs with nothing at all.
  "dariacore": "electronic",
  "nightcore": "electronic",
};

// Deliberately NOT a root. "experimental" sits on 478 albums: 65% of them are
// also electronic and 57% are also rock, and exactly 4 carry it alone. It is
// a modifier that spans every genre, not a genre, so it is a style.

// A tag attaches to the root it shares the most albums with, provided it
// shares at least this many of its own. Below that it is nobody's style and
// stands alone.
const ATTACH_SHARE = 0.4;
const MIN_TO_ATTACH = 6;        // ignore tags too rare to say anything

// Families MusicBrainz tags by their subgenres rather than the broad word.
//
// Metal is applied to EVERY album, the way an alias is, because a metal
// subgenre is a statement about the music and not a guess. It used to be a
// last resort for albums with no root at all -- but most metal records here
// also carry "rock", so the rescue never ran for them, and black metal,
// progressive metal and doom metal attach to rock on overlap alone. 306 of
// the 525 records carrying a metal subgenre were missing from the metal
// filter: Gorguts' "Obscura" was rock, and so was Drudkh. Screamo and
// doomcore are left out on purpose: one is emo, the other hardcore techno.
//
// Punk and classical stay rescues. "hardcore" is also a style of hip hop and
// of techno, so applied to every album it would file Mobb Deep under punk.
const FAMILIES = [
  { root: "metal", re: /metal|grindcore|powerviolence|sludge|\bdoom\b|mathcore/i, always: true },
  { root: "punk", re: /\bpunk\b|hardcore|screamo/i },
  { root: "classical", re: /classical|baroque|orchestral|chamber music|opera/i },
];

function buildIndex(albums) {
  const freq = new Map();
  const pairs = new Map();          // "a\u0000b" -> albums carrying both
  for (const a of albums) {
    if (!a.genres?.length) continue;
    const tags = [...new Set(a.genres.map((g) => g.toLowerCase()))].sort();
    for (const g of tags) freq.set(g, (freq.get(g) || 0) + 1);
    for (let i = 0; i < tags.length; i++)
      for (let j = i + 1; j < tags.length; j++) {
        const k = `${tags[i]}\u0000${tags[j]}`;
        pairs.set(k, (pairs.get(k) || 0) + 1);
      }
  }
  const together = (a, b) =>
    pairs.get(a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`) || 0;

  // A root is live if the collection tags it, OR if something aliases to it.
  // Without the second half a root that exists only through ALIASES -- as
  // "african" does, since no record here is tagged with the bare word -- is
  // filtered out here, and every alias pointing at it is then silently
  // dropped by the `roots.includes(r)` check just below.
  const aliasedTo = new Set(
    Object.entries(ALIASES).filter(([g]) => freq.has(g)).map(([, r]) => r));
  const roots = ROOTS.filter((r) => freq.has(r) || aliasedTo.has(r));
  const parent = new Map();
  for (const [g, r] of Object.entries(ALIASES)) {
    if (freq.has(g) && roots.includes(r)) parent.set(g, r);
  }
  for (const [g, c] of freq) {
    if (roots.includes(g) || parent.has(g) || c < MIN_TO_ATTACH) continue;
    // Among the roots that qualify, take the NARROWEST -- not the one it
    // overlaps most. "heavy metal" shares 97% of its albums with rock and 49%
    // with metal, so picking the biggest overlap sends every metal record to
    // rock and leaves metal a root that collects nothing. The narrowest root
    // that still covers the tag is the one that actually describes it.
    const fits = roots.filter((r) => r !== g && together(g, r) >= c * ATTACH_SHARE);
    if (fits.length) {
      parent.set(g, fits.reduce((a, b) => (freq.get(a) <= freq.get(b) ? a : b)));
    }
  }
  return { freq, roots: new Set(roots), parent };
}

function splitGenres(tags, index) {
  if (!tags?.length) return { genre: [], style: [] };
  const { roots, parent } = index;
  const lower = [...new Set(tags.map((g) => g.toLowerCase()))];

  // The genres are whichever roots the album actually carries.
  let genre = lower.filter((g) => roots.has(g) && !ALIASES[g]);

  // An ALIAS is a statement about the music -- "soul IS r&b", "afrobeat IS
  // African" -- so it applies whatever else the album carries. It used to run
  // only in the rescue branch below, which meant it fired solely for albums
  // that had no root at all: 69 of the 125 records tagged "soul" never reached
  // r&b, because they also carried funk, jazz or blues. Al Green's "Call Me"
  // came out as funk and Fela stayed under jazz.
  //
  // The computed `parent` map stays a rescue, and must: it holds every style,
  // so applying it here would give every shoegaze record "rock" and undo the
  // whole point of splitting rock up.
  const merged = lower.map((g) => ALIASES[g]).filter((r) => r && roots.has(r));
  const family = FAMILIES
    .filter((f) => f.always && roots.has(f.root) && lower.some((t) => f.re.test(t)))
    .map((f) => f.root);
  genre = [...new Set([...genre, ...merged, ...family])]
    .sort((a, b) => (index.freq.get(a) || 0) - (index.freq.get(b) || 0));

  // An album tagged only with styles still belongs somewhere: take the roots
  // its styles point at. A shoegaze record tagged nothing but "shoegaze,
  // dream pop" is a rock record, and should be findable as one.
  if (!genre.length) {
    genre = [...new Set(lower.map((g) => parent.get(g)).filter(Boolean))];
  }
  // Still nothing: fall back to the family patterns.
  if (!genre.length) {
    const rescue = FAMILIES.find((f) => lower.some((t) => f.re.test(t)));
    if (rescue) genre = [rescue.root];
  }

  const chosen = new Set(genre);
  const style = lower.filter((g) => !chosen.has(g));
  return { genre, style };
}

// The filter list: genres only, commonest first. An album rescued by a family
// pattern counts under that family, which is always one of the roots anyway.
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

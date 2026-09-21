// roller.js — the randomizer, kept free of React so it can be tested on its own
// (see scripts/test-roller.mjs).
//
// The sheet weighted by BUCKET, not by album: each score tier owns a fixed
// slice of the odds and splits it evenly among its members. BUCKET_SHARE is
// how the RATED side is divided -- a 95 tier holds 15% of it, so 11.25% of all
// rolls at the default 25% unrated share -- and it is split among however few
// albums sit in that tier. That behaviour is preserved exactly.
//
// What changed: the sheet's "100" tier also held every unscored album, so a
// genuine 100 was diluted to the same odds as something never listened to.
// Here, unscored albums are their own bucket with their own share (default 25%,
// which reproduces the sheet's overall unscored-vs-scored balance).

const BUCKET_SHARE = { 70: 9.5, 75: 9.5, 80: 13, 85: 13, 90: 15, 95: 15, 100: 25 };

// ── what a score means for the roll ─────────────────────────────────────────
// 70 to 100 are the rotation: the scores the randomiser weights, and what the
// Roll screen and the front page's five draw from, alongside the unrated.
// Below 70 an album is rated and kept -- the score records what you thought --
// but it is out of every roll.
//
// "Not recommended" is stored as 45, one step under 50, and shown as <50.
// Stored as 0 it would read as "no score" to any `score || ...` in the app,
// and "NR" would read as "not rated" in an app that is mostly unrated.
const SCORES = [70, 75, 80, 85, 90, 95, 100];
const LOW_SCORES = [45, 50, 55, 60, 65];
const NOT_RECOMMENDED = 45;
const ROTATION_FLOOR = 70;
const inRotation = (album) => album.score == null || album.score >= ROTATION_FLOOR;
const scoreLabel = (score) => (score === NOT_RECOMMENDED ? "<50" : String(score));

// ── where the randomness comes from ─────────────────────────────────────────
// Math.random() is a pseudo-random generator: a fixed algorithm walking from a
// hidden starting number. Fine in practice, but it makes no promises about
// being unpredictable, and browsers have shipped weak versions of it before.
//
// crypto.getRandomValues() instead draws from the operating system's entropy
// pool -- the same source used for encryption keys. Values are pulled 256 at a
// time because one call per roll would be wasteful.
//
// Each draw is a 32-bit integer divided by 2^32, giving a float in [0, 1) with
// 4.29 billion equally likely values. Scaling that onto a list of a few
// thousand albums leaves a bias far too small to ever observe.
const RAND_POOL = new Uint32Array(256);
let randCursor = RAND_POOL.length;

function secureRandom() {
  const c = globalThis.crypto;
  if (!c || !c.getRandomValues) return Math.random(); // very old browsers only
  if (randCursor >= RAND_POOL.length) {
    c.getRandomValues(RAND_POOL);
    randCursor = 0;
  }
  return RAND_POOL[randCursor++] / 4294967296;
}

const pickOne = (xs, rnd) => xs[Math.floor(rnd() * xs.length)];

function pickWeighted(pool, unscoredShare, rnd) {
  const scored = pool.filter((a) => a.score != null);
  const unscored = pool.filter((a) => a.score == null);

  if (!scored.length) return unscored.length ? pickOne(unscored, rnd) : null;
  if (!unscored.length) unscoredShare = 0;

  // First decide which side of the fence, then which album on that side.
  if (rnd() * 100 < unscoredShare) return pickOne(unscored, rnd);

  const tiers = Object.keys(BUCKET_SHARE)
    .map(Number)
    .map((score) => ({ score, members: scored.filter((a) => a.score === score) }))
    .filter((t) => t.members.length);

  const total = tiers.reduce((sum, t) => sum + BUCKET_SHARE[t.score], 0);
  let r = rnd() * total;
  for (const t of tiers) {
    r -= BUCKET_SHARE[t.score];
    if (r <= 0) return pickOne(t.members, rnd);
  }
  return pickOne(tiers[tiers.length - 1].members, rnd); // float dust
}

// mode: 'weighted' | 'unscored' | 'uniform'
function roll(albums, opts = {}) {
  const { mode = "weighted", unscoredShare = 25, avoidIds = [], rnd = secureRandom } = opts;

  // Every album in rotation is eligible: unrated, or scored 70 or more. There
  // used to be an in_pool flag, inherited from the spreadsheet's RSP column,
  // which kept albums out of every roll for reasons nobody could see; the
  // score is the reason now, and it is on the album for anyone to read.
  let pool = albums.filter(inRotation);
  if (mode === "unscored") pool = pool.filter((a) => a.score == null);
  if (!pool.length) return null;

  const avoid = new Set(avoidIds);
  const draw = () =>
    mode === "weighted" ? pickWeighted(pool, unscoredShare, rnd) : pickOne(pool, rnd);

  // Don't serve the same album twice in a row. Give up after a few tries so a
  // small pool (say, four unscored albums left) still returns something.
  for (let i = 0; i < 25; i++) {
    const pick = draw();
    if (!pick || !avoid.has(pick.id)) return pick;
  }
  return draw();
}

const Roller = {
  roll, pickWeighted, secureRandom, BUCKET_SHARE,
  SCORES, LOW_SCORES, NOT_RECOMMENDED, ROTATION_FLOOR, inRotation, scoreLabel,
};
if (typeof module !== "undefined" && module.exports) module.exports = Roller;
else window.Roller = Roller;

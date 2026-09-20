// local-source.js — runs the app with no Supabase account at all.
//
// Loaded after supabase-client.js: if config.js still has its placeholders,
// this takes over as `window.db` and the app never knows the difference. The
// collection is read straight from data/albums.csv and every edit is kept in
// this browser's localStorage.
//
// Edits are keyed by WHAT THE ALBUM IS (artist::title), never by its position
// in the CSV. Row numbers are not identities: merging or re-sorting albums.csv
// shifts every row below the change, and edits keyed that way silently
// re-attach themselves to whatever album slid into the slot. That is exactly
// what merge-discs.py did -- 96 rows collapsed into 42 -- which put cached
// covers on unrelated albums. Ids are still row numbers, because the UI needs
// something cheap to pass around, but nothing is ever *stored* against them.

const LS_EDITS = "imc:local:edits:v2";     // v1 was keyed by row number; ignored
const LS_ROLLS = "imc:local:rolls";
const LS_PLAYS = "imc:local:plays";
const LS_ADDED = "imc:local:added";
const LS_GONE  = "imc:local:deleted:v2";   // v1 likewise
const LS_SEQ   = "imc:local:seq";

// The last full parse, so deleted albums can be listed without re-reading the
// CSV. Populated by albums().
let LAST_FULL = [];

// id -> storage key, rebuilt on every albums() call. The UI hands back ids;
// this is how a write finds the stable key to store under.
let KEY_BY_ID = new Map();

// Albums added in the app get ids from well above the CSV's row numbers, so
// the two can never collide as the spreadsheet grows.
const ADDED_ID_BASE = 1000000;

// An album added in the app has no CSV row to be identified by, so it keeps its
// id -- which comes from a counter that never reuses a value.
const editKey = (a) => (a.source === "app" ? `#${a.id}` : `${a.artist}::${a.title}`);

const load = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
};
const save = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.warn("local save failed", e); }
};

// Minimal RFC4180 parser — album titles contain commas and quotes.
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

// One-time notice: anything rated under the old row-number scheme cannot be
// remapped (the rows it pointed at are gone), so it is left in place, unread,
// rather than guessed at.
function warnAboutLegacyEdits() {
  const old = load("imc:local:edits", null);
  if (!old) return;
  const scored = Object.entries(old).filter(([, e]) => e && e.score != null);
  console.warn(
    `Infinite Music Catalog: ignoring ${Object.keys(old).length} edits saved under the ` +
    `old row-number scheme (they no longer point at the albums they were made on). ` +
    (scored.length
      ? `${scored.length} carried a score: ${scored.map(([id, e]) => `row ${id} = ${e.score}`).join(", ")}. ` +
        `Re-rate those albums if you still want them. `
      : "") +
    `Nothing was deleted -- the old data is still under localStorage["imc:local:edits"].`
  );
}

const LocalDB = {
  configured: true,
  mode: "local",

  // No accounts locally — it is your machine, so you can always edit.
  async currentUser() { return { id: "local", email: "local" }; },
  onAuthChange() { return () => {}; },
  async signIn() { return { error: { message: "Local mode — no sign-in needed." } }; },
  async signOut() {},

  async albums() {
    const res = await fetch("../data/albums.csv");
    if (!res.ok) throw new Error(
      `Could not read data/albums.csv (${res.status}). Start the server from the ` +
      `project root, not from inside app/.`
    );
    // Genres and artwork live in their own file (see scripts/enrich.mjs) so
    // that re-running clean.py cannot wipe them. Missing is fine -- the app
    // just shows no genres until the enrichment pass has run.
    const enrichment = await fetch("../data/enrichment.json")
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
    const [header, ...rows] = parseCsv(await res.text());
    const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
    const edits = load(LS_EDITS, {});
    const gone = new Set(load(LS_GONE, []));
    const added = load(LS_ADDED, []);

    KEY_BY_ID = new Map();

    const fromSheet = rows
      .filter((r) => r[col.artist])
      .map((r, i) => {
        const id = i + 1;
        const artist = r[col.artist];
        const title = r[col.title];
        const key = `${artist}::${title}`;
        const extra = enrichment[key] || {};
        const edit = edits[key] || {};
        KEY_BY_ID.set(id, key);

        const album = {
          id,
          artist,
          title,
          year: r[col.year] ? Number(r[col.year]) : null,
          score: r[col.score] ? Number(r[col.score]) : null,
          in_pool: r[col.in_pool] !== "false",
          notes: null,
          genres: extra.genres || [],
          source: "sheet",
          ...edit,
        };
        // An edit must not rewrite the fields its own key is built from.
        album.artist = artist;
        album.title = title;
        // Enrichment matched this album by MusicBrainz id; a cached cover came
        // from a text search in the browser. The verified one wins.
        album.cover_url = extra.cover_url || edit.cover_url || null;
        return album;
      })
      .filter((a) => !gone.has(KEY_BY_ID.get(a.id)));

    const fromApp = added.map((a) => {
      const key = editKey(a);
      KEY_BY_ID.set(a.id, key);
      return { ...a, ...(edits[key] || {}) };
    });

    LAST_FULL = [...fromSheet, ...fromApp];
    return LAST_FULL.filter((a) => !gone.has(editKey(a)));
  },

  async deletedAlbums() {
    const gone = load(LS_GONE, []);
    if (!LAST_FULL.length) await this.albums();
    // Newest deletion first, matching the database ordering.
    const order = new Map(gone.map((key, i) => [key, i]));
    return LAST_FULL.filter((a) => order.has(editKey(a)))
                    .sort((x, y) => order.get(editKey(y)) - order.get(editKey(x)));
  },

  async restoreAlbum(id) {
    const key = KEY_BY_ID.get(id);
    if (!key) return;
    save(LS_GONE, load(LS_GONE, []).filter((x) => x !== key));
  },

  async addAlbum({ artist, title, year, score }) {
    const added = load(LS_ADDED, []);
    // A counter that only ever goes up. Deriving the next id from the current
    // list would reuse an id after the last addition was deleted, and the new
    // album would be filtered straight back out by that id's tombstone.
    const seq = load(LS_SEQ, 0);
    save(LS_SEQ, seq + 1);
    const id = ADDED_ID_BASE + seq;
    const album = {
      id,
      artist, title,
      year: year || null,
      score: score || null,
      in_pool: true,
      notes: null,
      genres: [],
      cover_url: null,
      source: "app",
    };
    added.push(album);
    save(LS_ADDED, added);
    KEY_BY_ID.set(id, editKey(album));
    return album;
  },

  // Always a tombstone, whether the album came from the CSV or was added here.
  // Hard-removing an added album would make a mistaken delete unrecoverable,
  // and keys never repeat, so keeping the row is safe.
  async deleteAlbum(id) {
    const key = KEY_BY_ID.get(id);
    if (!key) return;
    const gone = load(LS_GONE, []);
    if (!gone.includes(key)) { gone.push(key); save(LS_GONE, gone); }
  },

  async updateAlbum(id, patch) {
    const key = KEY_BY_ID.get(id);
    if (!key) { console.warn(`updateAlbum: no album loaded with id ${id}`); return; }
    const edits = load(LS_EDITS, {});
    edits[key] = { ...(edits[key] || {}), ...patch };
    save(LS_EDITS, edits);
  },

  async logRoll(album_id, mode) {
    const rolls = load(LS_ROLLS, []);
    const id = Date.now();
    rolls.unshift({ id, album_id, mode, rolled_at: new Date().toISOString() });
    save(LS_ROLLS, rolls.slice(0, 500));
    return id;
  },
  async setRollOutcome(id, outcome) {
    const rolls = load(LS_ROLLS, []);
    const hit = rolls.find((r) => r.id === id);
    if (hit) { hit.outcome = outcome; save(LS_ROLLS, rolls); }
  },
  async logPlay(album_id, source = "manual") {
    const plays = load(LS_PLAYS, []);
    plays.unshift({ id: Date.now(), album_id, source, played_at: new Date().toISOString() });
    save(LS_PLAYS, plays.slice(0, 1000));
  },
  async recentRolls(limit = 40) { return load(LS_ROLLS, []).slice(0, limit); },
  async recentPlays(limit = 40) { return load(LS_PLAYS, []).slice(0, limit); },

  // ── moving to Supabase later ────────────────────────────────────────────
  // Everything rated locally, as SQL you can paste into the Supabase editor
  // after importing albums.csv. Call db.exportEdits() from the browser console.
  //
  // Matched on artist and title, not on id: the database assigns its own ids,
  // and this browser's row numbers mean nothing there.
  exportEdits() {
    const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
    const edits = load(LS_EDITS, {});
    const lines = Object.entries(edits)
      .filter(([key, e]) => !key.startsWith("#") &&
                            (e.score != null || e.notes || e.in_pool === false))
      .map(([key, e]) => {
        const [artist, title] = key.split("::");
        const sets = [];
        if ("score" in e) sets.push(`score = ${e.score == null ? "null" : e.score}`);
        if ("in_pool" in e) sets.push(`in_pool = ${e.in_pool}`);
        if (e.notes) sets.push(`notes = ${q(e.notes)}`);
        return `update albums set ${sets.join(", ")} ` +
               `where artist = ${q(artist)} and title = ${q(title)};`;
      });
    const sql = lines.join("\n");
    console.log(sql || "-- nothing rated locally yet");
    return sql;
  },
};

if (!window.db || !window.db.configured) {
  window.db = LocalDB;
  warnAboutLegacyEdits();
  console.info("Infinite Music Catalog: local mode (config.js has no Supabase keys yet)");
}

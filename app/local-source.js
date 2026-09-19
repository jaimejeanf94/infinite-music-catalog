// local-source.js — runs the app with no Supabase account at all.
//
// Loaded after supabase-client.js: if config.js still has its placeholders,
// this takes over as `window.db` and the app never knows the difference. The
// collection is read straight from data/albums.csv and every edit is kept in
// this browser's localStorage.
//
// Album ids are row numbers in albums.csv, so saved ratings stay attached as
// long as that file is not reordered. Re-running data/clean.py is safe; adding
// or removing rows by hand is not.

const LS_EDITS = "imc:local:edits";
const LS_ROLLS = "imc:local:rolls";
const LS_PLAYS = "imc:local:plays";

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
    return rows
      .filter((r) => r[col.artist])
      .map((r, i) => {
        const id = i + 1;
        const extra = enrichment[`${r[col.artist]}::${r[col.title]}`] || {};
        return {
          id,
          artist: r[col.artist],
          title: r[col.title],
          year: r[col.year] ? Number(r[col.year]) : null,
          score: r[col.score] ? Number(r[col.score]) : null,
          in_pool: r[col.in_pool] !== "false",
          notes: null,
          genres: extra.genres || [],
          cover_url: extra.cover_url || null,
          ...(edits[id] || {}),
        };
      });
  },

  async updateAlbum(id, patch) {
    const edits = load(LS_EDITS, {});
    edits[id] = { ...(edits[id] || {}), ...patch };
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
  exportEdits() {
    const edits = load(LS_EDITS, {});
    const lines = Object.entries(edits)
      .filter(([, e]) => e.score != null || e.notes || e.in_pool === false)
      .map(([id, e]) => {
        const sets = [];
        if ("score" in e) sets.push(`score = ${e.score == null ? "null" : e.score}`);
        if ("in_pool" in e) sets.push(`in_pool = ${e.in_pool}`);
        if (e.notes) sets.push(`notes = '${String(e.notes).replace(/'/g, "''")}'`);
        return `update albums set ${sets.join(", ")} where id = ${id};`;
      });
    const sql = lines.join("\n");
    console.log(sql || "-- nothing rated locally yet");
    return sql;
  },
};

if (!window.db || !window.db.configured) {
  window.db = LocalDB;
  console.info("Infinite Music Catalog: local mode (config.js has no Supabase keys yet)");
}

// supabase-client.js — the only file that talks to Supabase directly.
// Everything else calls db.* from here.

const CFG = window.IH_CONFIG || {};
const CONFIGURED =
  CFG.SUPABASE_URL &&
  CFG.SUPABASE_KEY &&
  !CFG.SUPABASE_URL.startsWith("PASTE_");

const sb = CONFIGURED
  ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY)
  : null;

// Supabase caps any single select at 1000 rows, and the collection is ~4.5k.
// Everything else in the app assumes it has the whole list in memory (search,
// filtering and the roller all run client-side), so page through it here once.
const PAGE = 1000;

async function fetchAllAlbums() {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("albums")
      .select("id, artist, title, year, score, in_pool, notes, cover_url")
      .order("artist", { ascending: true })
      .order("title", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < PAGE) return out;
  }
}

const supabaseDb = {
  configured: CONFIGURED,

  // ── auth ────────────────────────────────────────────────────────────────
  // One account, sign-ups disabled: being signed in IS being the owner.
  async currentUser() {
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data.session?.user || null;
  },
  onAuthChange(fn) {
    if (!sb) return () => {};
    const { data } = sb.auth.onAuthStateChange((_e, s) => fn(s?.user || null));
    return () => data.subscription.unsubscribe();
  },
  signIn: (email, password) => sb.auth.signInWithPassword({ email, password }),
  signOut: () => sb.auth.signOut(),

  // ── reads ───────────────────────────────────────────────────────────────
  albums: fetchAllAlbums,

  async recentRolls(limit = 40) {
    const { data, error } = await sb
      .from("rolls")
      .select("id, album_id, mode, outcome, rolled_at")
      .order("rolled_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  },

  async recentPlays(limit = 40) {
    const { data, error } = await sb
      .from("plays")
      .select("id, album_id, played_at, source")
      .order("played_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data;
  },

  // ── writes (owner only — RLS rejects these when signed out) ─────────────
  // One updater for every album edit. The whitelist keeps a stray key in a
  // patch from reaching the database and erroring the whole write.
  async updateAlbum(id, patch) {
    const ALLOWED = ["score", "in_pool", "notes", "cover_url"];
    const clean = {};
    for (const k of ALLOWED) if (k in patch) clean[k] = patch[k];
    if (!Object.keys(clean).length) return;
    const { error } = await sb.from("albums").update(clean).eq("id", id);
    if (error) throw error;
  },

  async logRoll(album_id, mode) {
    const { data, error } = await sb
      .from("rolls").insert({ album_id, mode }).select("id").single();
    if (error) throw error;
    return data.id;
  },
  async setRollOutcome(id, outcome) {
    const { error } = await sb.from("rolls").update({ outcome }).eq("id", id);
    if (error) throw error;
  },
  async logPlay(album_id, source = "roll") {
    const { error } = await sb.from("plays").insert({ album_id, source });
    if (error) throw error;
  },
};

window.db = supabaseDb;

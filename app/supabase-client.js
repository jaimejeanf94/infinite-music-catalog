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
      .select("id, artist, title, year, score, notes, cover_url, genres, mbid, source, cover_locked")
      .is("deleted_at", null)
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
  mode: "cloud",

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

  // ── writes (owner only — RLS rejects these when signed out) ─────────────
  // Albums you add yourself. `source` marks them as added here rather than
  // carried over from the original spreadsheet.
  async addAlbum({ artist, title, year, score }) {
    const { data, error } = await sb.from("albums")
      .insert({ artist, title, year: year || null, score: score || null, source: "app" })
      .select("id, artist, title, year, score, notes, cover_url, genres, mbid, source, cover_locked")
      .single();
    if (error) throw error;
    return data;
  },

  // Everything hidden by a delete, newest first, for the Deleted filter.
  async deletedAlbums() {
    const { data, error } = await sb
      .from("albums")
      .select("id, artist, title, year, score, notes, cover_url, genres, mbid, source, deleted_at")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false });
    if (error) throw error;
    return data;
  },

  async restoreAlbum(id) {
    const { error } = await sb.from("albums").update({ deleted_at: null }).eq("id", id);
    if (error) throw error;
  },

  // A tombstone rather than a delete -- see db/schema.sql for why.
  async deleteAlbum(id) {
    const { error } = await sb.from("albums")
      .update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
  },

  // Some covers no source will ever have -- a small label, a Bandcamp-only
  // release, a Japanese pressing. And many sites that do have the image serve
  // it behind Cloudflare, which answers a hotlink with a 403 challenge rather
  // than a picture, so pasting their URL can never work. Uploading puts the
  // file in our own public bucket instead: one fast host, no referer checks,
  // and it cannot rot when someone else reorganises their site.
  async uploadCover(id, file) {
    const ext = ((file.name || "").split(".").pop() || "jpg")
      .toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 4) || "jpg";
    const path = `manual/${id}.${ext}`;
    const { error } = await sb.storage.from("covers")
      .upload(path, file, { upsert: true, contentType: file.type || "image/jpeg" });
    if (error) throw error;
    const { data } = sb.storage.from("covers").getPublicUrl(path);
    // Replacing a cover reuses the path, so without this the browser shows
    // the old picture from cache.
    return `${data.publicUrl}?v=${Date.now()}`;
  },

  // One updater for every album edit. The whitelist keeps a stray key in a
  // patch from reaching the database and erroring the whole write.
  async updateAlbum(id, patch) {
    // artist and title are editable here but not in local mode: in Postgres
    // the album's id is the identity and genres/mbid/cover_url are columns on
    // the row, so a rename is an ordinary update with nothing to keep in
    // step. Locally those live in enrichment.json keyed by artist::title, and
    // a rename has to move both halves -- that is what scripts/rename.mjs is
    // for.
    //
    // `genres` is writable because the maintenance screen needs a manual
    // lever: the nightly enrichment is the only other thing that sets it, and
    // when MusicBrainz has nothing there was previously no way to type one in.
    const ALLOWED = ["artist", "title", "year", "genres",
                     "score", "notes", "cover_url", "cover_locked"];
    const clean = {};
    for (const k of ALLOWED) if (k in patch) clean[k] = patch[k];
    if (!Object.keys(clean).length) return;
    const { error } = await sb.from("albums").update(clean).eq("id", id);
    if (error) throw error;
  },

  // Every roll is logged, and nothing in the app reads the log back. Kept as
  // data rather than a feature: it is the one record of what the randomiser
  // actually served, and a screen for it is a later decision. The reader and
  // the "played/skipped" outcome setter that went with it were never called,
  // so they are gone.
  async logRoll(album_id, mode) {
    const { error } = await sb.from("rolls").insert({ album_id, mode });
    if (error) throw error;
  },

  // ── review flags ────────────────────────────────────────────────────────
  // What you decided about a maintenance item. See db/migrations/2026-09-20-review-flags.sql for
  // why these are a table of their own rather than a column on albums.
  async reviewFlags() {
    if (!sb) return [];
    const { data, error } = await sb
      .from("review_flags").select("kind, subject, album_id, state, note");
    if (error) throw error;
    return data;
  },

  // Upsert on (kind, subject), so changing your mind rewrites the verdict
  // instead of stacking a second one next to it.
  async setReviewFlag({ kind, subject, album_id = null, state, note = null }) {
    const { error } = await sb
      .from("review_flags")
      .upsert({ kind, subject, album_id, state, note },
              { onConflict: "kind,subject" });
    if (error) throw error;
  },

  async clearReviewFlag(kind, subject) {
    const { error } = await sb
      .from("review_flags").delete().eq("kind", kind).eq("subject", subject);
    if (error) throw error;
  },
};

window.db = supabaseDb;

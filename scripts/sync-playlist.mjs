// sync-playlist.mjs — mirror one Apple Music playlist into Postgres.
//
//   node scripts/sync-playlist.mjs --playlist-id=394006C178D52AD2 [--dry-run]
//
// Mac only: it asks the Music app, which is the one place the whole playlist
// can be read for free. Apple's public page for a playlist carries only its
// first stretch of songs, and the API that pages through the rest wants a
// paid developer key.
//
// You do not normally run this. scripts/playlist-backup.sh calls it as its
// last step every night, after it has saved its snapshot and after its own
// check that the playlist has not suddenly lost or gained a fifth of its
// songs -- so a library sync gone wrong is caught there and never reaches the
// database. Run by hand, the only guard is the one below: an empty playlist
// is refused.
//
// The id is the playlist's persistent ID, not its name, so renaming the
// playlist changes nothing. To find one:
//   osascript -e 'tell application "Music" to get persistent ID of user playlist "NAME"'
//
// --dry-run reads the playlist, prints what it found and writes nothing. It
// needs no credentials.

import { execFileSync } from "node:child_process";
import { requireEnv, signIn, rest } from "./supabase-rest.mjs";

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const ID = args.find((a) => a.startsWith("--playlist-id="))?.split("=")[1] || "";

// It goes into a URL filter below, so it is checked rather than escaped.
if (!/^[0-9A-F]{16}$/i.test(ID)) {
  console.error("Usage: node scripts/sync-playlist.mjs --playlist-id=<16 hex digits> [--dry-run]");
  process.exit(1);
}

// Each property is fetched for every track in one call. Asking track by track
// is one round trip to the Music app per song per property; this is five in
// total, and reads fifteen hundred songs in a fifth of a second.
const READ = `
function run(argv) {
  const list = Application("Music").userPlaylists.whose({ persistentID: argv[0] })[0];
  const t = list.tracks;
  return JSON.stringify({
    name: list.name(),
    titles: t.name(), artists: t.artist(), albums: t.album(),
    durations: t.duration(), ids: t.persistentID(),
  });
}`;

let read;
try {
  read = JSON.parse(execFileSync("osascript", ["-l", "JavaScript", "-e", READ, ID],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
} catch (e) {
  console.error(`Could not read playlist ${ID} from the Music app.`);
  console.error(String(e.stderr || e.message).trim().split("\n").pop());
  process.exit(1);
}

const tracks = read.titles.map((title, i) => ({
  playlist_id: ID,
  position: i + 1,
  track_id: read.ids[i],
  title: title || "",
  artist: read.artists[i] || "",
  album: read.albums[i] || "",
  duration_s: Number.isFinite(read.durations[i]) ? Math.round(read.durations[i]) : null,
}));

// The Music app answers with an empty playlist while the cloud library is
// still loading, and for a playlist whose songs a bad sync has just removed.
// Neither is something to copy over a good mirror.
if (!tracks.length) {
  console.error(`"${read.name}" came back empty — nothing written.`);
  process.exit(1);
}

const line = (t) => `  ${String(t.position).padStart(5)}  ${t.artist} — ${t.title}`;

if (DRY) {
  console.log(`"${read.name}" — ${tracks.length} songs, ` +
    `${new Set(tracks.map((t) => t.track_id)).size} distinct. Dry run: nothing written.\n`);
  for (const t of tracks.slice(0, 3)) console.log(line(t));
  console.log("      …");
  for (const t of tracks.slice(-3)) console.log(line(t));
  process.exit(0);
}

requireEnv();
const api = rest(await signIn());

const [before] = await api.select(`playlists?select=track_count&id=eq.${ID}`);

// The playlist row has to exist before its tracks can point at it. Only the
// name is sent, so the share link set by hand is left alone.
await api.upsert("playlists", [{ id: ID, name: read.name }], "id");

// Overwrite every position, then cut off what is left past the new end. In
// that order the table is never empty part-way through: a reader mid-sync
// sees a mix of last night and tonight, never nothing.
const CHUNK = 500;
for (let i = 0; i < tracks.length; i += CHUNK) {
  await api.upsert("playlist_tracks", tracks.slice(i, i + CHUNK), "playlist_id,position");
}
await api.remove("playlist_tracks", `playlist_id=eq.${ID}&position=gt.${tracks.length}`);

// Last, so synced_at only ever names a sync that finished.
await api.update("playlists", `id=eq.${ID}`,
  { track_count: tracks.length, synced_at: new Date().toISOString() });

// The first and last song go in the log beside the count: the count says the
// sync ran, these say WHAT it read, which is how a stale library shows itself.
const name = (t) => `${t.artist} — ${t.title}`;
console.log(`synced "${read.name}" — ${tracks.length} songs` +
  (before ? ` (was ${before.track_count})` : " (first sync)"));
console.log(`  first: ${name(tracks[0])}`);
console.log(`  last:  ${name(tracks.at(-1))}`);

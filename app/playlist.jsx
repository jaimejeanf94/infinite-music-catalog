// playlist.jsx — the Playlist screen. One song drawn from the mirrored
// playlist, and the songs that follow it.
//
// The point is the draw. A music app's shuffle is built to feel varied, which
// is not the same thing as fair; this one is the Roll screen's generator,
// with every position in the playlist an equal shot. The habit it serves is
// "start somewhere random, then let it play in order", so the screen shows
// the song, where it sits, and what comes after -- and sends you to the
// playlist with the title on the clipboard, because Apple documents no link
// that opens a playlist AT a song.
//
// Nothing here writes. The playlist lives in the Music app and is copied into
// Postgres each night (scripts/sync-playlist.mjs), so a visitor sees exactly
// what the owner does.

// Fetched once per page load and kept, so a trip to the shelf and back does
// not read fifteen hundred rows again. Names in this file carry a prefix:
// every script on the page shares one global scope, and `norm`, `loose` and
// `query` are already taken.
let playlistMirror = null;

// A mirror older than this has missed a night. The sync runs at 21:00, so a
// day and a half covers one run arriving late and no more.
const PLAYLIST_STALE_MS = 36 * 3600 * 1000;
const PLAYLIST_NEXT = 10;

const plainName = (s) =>
  (s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

// The Music app names the edition it happens to hold -- "Speaking In Tongues
// (Bonus Track Version)", "Blue Lines (2012 Mix/Master)", "Song - Single" --
// where the shelf names the record. Only a bracket that is recognisably about
// the edition is dropped. Dropping every bracket would file Weezer's Green
// Album under the Blue one.
const EDITION_SUFFIX =
  /\s*(?:[(\[][^)\]]*\b(?:remaster(?:ed)?|deluxe|edition|version|bonus|expanded|anniversary|reissue|mix|master|mono|stereo)\b[^)\]]*[)\]]|-\s*(?:single|ep))\s*$/i;

function bareAlbumName(name) {
  let out = name || "";
  while (EDITION_SUFFIX.test(out)) out = out.replace(EDITION_SUFFIX, "");
  return out.trim() || name || "";
}

const trackLength = (s) =>
  s == null ? null : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// Copy, finished before this function returns. The async clipboard API is the
// modern way and the wrong one here: on a phone the tap that copies is the
// same tap that hands over to the Music app, the page loses focus a moment
// later, and a write still in flight is rejected for exactly that. The old
// synchronous command has no such window. False when the browser refuses it.
function copyPlaylistText(text) {
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");   // selectable, but no keyboard sliding up
  box.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.appendChild(box);
  box.select();
  box.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { /* falls through */ }
  box.remove();
  return ok;
}

const trackLine = (t) => `${t.artist} — ${t.title}`;

function PlaylistView({ albums, params, setParams }) {
  const [list, setList] = React.useState(undefined);   // undefined = loading, null = none mirrored
  const [error, setError] = React.useState("");
  const [flash, setFlash] = React.useState(null);

  React.useEffect(() => {
    let alive = true;
    playlistMirror = playlistMirror || db.playlist();
    playlistMirror.then(
      (found) => { if (alive) setList(found); },
      (e) => {
        playlistMirror = null;   // so coming back to the screen tries again
        if (alive) setError(e.message || String(e));
      });
    return () => { alive = false; };
  }, []);

  const tracks = list?.tracks || [];
  const total = tracks.length;

  // The song on screen is its position, and the position lives in the URL --
  // the album link below leaves this screen, and Back has to return to the
  // song you left rather than to a fresh draw.
  const at = Number(params.get("song"));
  const drawn = Number.isInteger(at) && at >= 1 && at <= total;
  const track = drawn ? tracks[at - 1] : null;

  const draw = React.useCallback(() => {
    if (!total) return;
    // Uniform over every position. The one thing ruled out is the song
    // already on screen: a draw that changes nothing reads as a dead button.
    let next;
    do next = 1 + Math.floor(Roller.secureRandom() * total);
    while (total > 1 && next === at);
    const to = new URLSearchParams(params);
    to.set("song", String(next));
    // Replaced, not pushed: Back should leave the screen, not walk back
    // through every song it dealt.
    setParams(to, { push: false });
  }, [total, at, params, setParams]);

  // First draw once the playlist has arrived -- and again if the address
  // names a position the playlist no longer reaches.
  React.useEffect(() => {
    if (total && !drawn) draw();
  }, [total, drawn]);

  // Covers come from the shelf when the song's album is on it. Built once per
  // collection: this screen re-renders on every draw.
  const shelf = React.useMemo(() => {
    const exact = new Map(), bare = new Map();
    for (const a of albums) {
      const artist = plainName(a.artist);
      exact.set(`${artist}::${plainName(a.title)}`, a);
      // Two shelf albums that reduce to the same bare name cannot be told
      // apart by it, so that name matches neither.
      const k = `${artist}::${plainName(bareAlbumName(a.title))}`;
      bare.set(k, bare.has(k) ? null : a);
    }
    return { exact, bare };
  }, [albums]);

  React.useEffect(() => {
    const onKey = (e) => {
      if (e.target.matches("input, textarea, select")) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // A focused button or link does its own thing with these keys.
      if (e.target.closest("a, button")) return;
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); draw(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  React.useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2600);
    return () => clearTimeout(t);
  }, [flash]);

  if (error) return (
    <div className="empty">
      <p className="err">{error}</p>
      <p>The playlist could not be read. If this is new, check that
      <code>db/migrations/2026-11-15-playlists.sql</code> has run.</p>
    </div>
  );
  if (list === undefined) return <div className="empty">Reading the playlist…</div>;
  if (!list || !total) return (
    <div className="empty">
      No playlist has been mirrored yet. The nightly backup on the Mac fills
      this in — <code>scripts/playlist-backup.sh</code>.
    </div>
  );
  if (!track) return <div className="empty">Drawing a song…</div>;

  const artist = plainName(track.artist);
  const onShelf = track.album
    ? shelf.exact.get(`${artist}::${plainName(track.album)}`)
      || shelf.bare.get(`${artist}::${plainName(bareAlbumName(track.album))}`)
      || null
    : null;
  // Off the shelf, CoverArt looks the sleeve up by name the way it does for
  // an album added since the last nightly run. The id only has to be stable
  // for the album, so two songs from one record share the lookup.
  const sleeve = onShelf || {
    id: `playlist:${artist}::${plainName(track.album || track.title)}`,
    artist: track.artist,
    title: bareAlbumName(track.album) || track.title,
    cover_url: null,
  };

  const link = Listen.playlist(list.url);
  const copied = link ? "Title copied — search the playlist for it" : "Title copied";
  const copyTitle = () => {
    if (copyPlaylistText(track.title)) return setFlash(copied);
    // Only where the synchronous copy is refused.
    const done = navigator.clipboard?.writeText(track.title);
    if (!done) return setFlash("Could not copy — the title is on screen");
    done.then(() => setFlash(copied),
              () => setFlash("Could not copy — the title is on screen"));
  };

  const next = tracks.slice(at, at + PLAYLIST_NEXT);
  const age = list.synced_at ? Date.now() - Date.parse(list.synced_at) : null;
  const stale = age != null && age > PLAYLIST_STALE_MS;
  const days = age != null ? Math.floor(age / 86400000) : 0;

  return (
    <div className="roll">
      {/* Keyed on the position, so each draw deals the card in again. */}
      <div className="card card--song" key={at}>
        <div className="card__art">
          <CoverArt album={sleeve} size={320} canPersist={false} />
        </div>

        <div className="card__body">
          <div className="card__artist">{track.artist || "Unknown artist"}</div>
          <h2 className="card__title">{track.title}</h2>
          <div className="card__meta">
            {track.album && (onShelf
              ? <a className="link" href={shelfHref({ artist: onShelf.artist, album: onShelf.id })}
                   title="Open the album on the shelf">{track.album}</a>
              : <span>{track.album}</span>)}
            {track.duration_s != null && <span>{trackLength(track.duration_s)}</span>}
          </div>
          <div className="card__meta">
            <span className="badge">#{at.toLocaleString()}</span>
            <span>of {total.toLocaleString()} in {list.name}</span>
          </div>

          <div className="row">
            <button className="btn btn--primary" onClick={draw}>
              Another song<span className="key-hint"> ␣</span>
            </button>
            {link
              ? <a className="btn" href={link.href} onClick={copyTitle}
                   target={link.newTab ? "_blank" : undefined} rel="noreferrer"
                   title="Copies the song's title, then opens the playlist">
                  Open playlist
                </a>
              : <button className="btn" onClick={copyTitle}>Copy title</button>}
          </div>
        </div>
      </div>

      {flash && <div className="flash" role="status" aria-live="polite">{flash}</div>}

      <section className="queue">
        <h3>Then, in order</h3>
        {next.length
          ? <ol className="queue__list">
              {next.map((t) => (
                <li key={t.position} className="queue__item">
                  <span className="queue__pos">#{t.position.toLocaleString()}</span>
                  <span className="queue__txt">
                    <b>{t.title}</b>
                    <em>{t.artist}</em>
                  </span>
                  <span className="queue__len">{trackLength(t.duration_s)}</span>
                </li>
              ))}
            </ol>
          : <p className="muted">Nothing — this is the last song in the playlist.</p>}
      </section>

      {/* How current the mirror is, and proof of what it holds. The date says
          the sync ran; the first and last song say what it READ, which is the
          part you can check against the playlist itself. */}
      <dl className={"mirror" + (stale ? " mirror--stale" : "")}>
        <div>
          <dt>Synced</dt>
          <dd>
            {list.synced_at
              ? new Date(list.synced_at).toLocaleString(undefined,
                  { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
              : "unknown"}
            {" · "}{total.toLocaleString()} songs
            {stale && <b> · {days} day{days === 1 ? "" : "s"} old — the nightly sync has not run</b>}
          </dd>
        </div>
        <div><dt>First</dt><dd>{trackLine(tracks[0])}</dd></div>
        <div><dt>Last</dt><dd>{trackLine(tracks[total - 1])}</dd></div>
      </dl>
    </div>
  );
}

window.PlaylistView = PlaylistView;

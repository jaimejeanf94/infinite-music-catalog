// browse.jsx — the shelf: search, filter, and score in bulk.

const BROWSE_SCORES = [70, 75, 80, 85, 90, 95, 100];
const CHUNK = 60;   // tiles rendered per "page" — 4.4k at once would crawl

function Stat({ label, value }) {
  return <div className="stat"><b>{value}</b><span>{label}</span></div>;
}

function Detail({ album, owner, onPatch, onPlay, onClose }) {
  const [notes, setNotes] = React.useState(album.notes || "");
  React.useEffect(() => setNotes(album.notes || ""), [album.id]);

  React.useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__inner" onClick={(e) => e.stopPropagation()}>
        <button className="sheet__x" onClick={onClose}>×</button>
        <div className="sheet__art">
          <CoverArt album={album} size={260} canPersist={owner}
                    onResolved={(id, url) => onPatch(id, { cover_url: url }, true)} />
        </div>
        <div className="sheet__body">
          <div className="card__artist">{album.artist}</div>
          <h2 className="card__title">{album.title}</h2>
          <div className="card__meta">{album.year || "—"}</div>

          <div className="scores">
            {BROWSE_SCORES.map((s) => (
              <button
                key={s}
                className={"score" + (album.score === s ? " score--on" : "")}
                disabled={!owner}
                onClick={() => onPatch(album.id, { score: album.score === s ? null : s })}
              >
                {s}
              </button>
            ))}
          </div>

          <label className="field">
            <span>Notes</span>
            <textarea
              rows="3" value={notes} disabled={!owner}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes !== (album.notes || "") && onPatch(album.id, { notes })}
              placeholder="What did you think?"
            />
          </label>

          <div className="row">
            <button className="btn" disabled={!owner} onClick={() => onPlay(album.id)}>
              Log a play
            </button>
            <button className="btn btn--quiet" disabled={!owner}
                    onClick={() => onPatch(album.id, { in_pool: !album.in_pool })}>
              {album.in_pool ? "Remove from pool" : "Back in the pool"}
            </button>
          </div>

          <div className="row row--links">
            <a className="link" target="_blank" rel="noreferrer"
               href={`https://open.spotify.com/search/${encodeURIComponent(album.artist + " " + album.title)}`}>
              Spotify
            </a>
            <a className="link" target="_blank" rel="noreferrer"
               href={`https://music.apple.com/search?term=${encodeURIComponent(album.artist + " " + album.title)}`}>
              Apple Music
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function BrowseView({ albums, owner, onPatch, onPlay }) {
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState("all");
  const [sort, setSort] = React.useState("artist");
  const [shown, setShown] = React.useState(CHUNK);
  const [open, setOpen] = React.useState(null);

  const stats = React.useMemo(() => ({
    total: albums.length,
    scored: albums.filter((a) => a.score != null).length,
    pool: albums.filter((a) => a.in_pool).length,
  }), [albums]);

  const list = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = albums;
    if (needle) {
      out = out.filter((a) =>
        a.artist.toLowerCase().includes(needle) ||
        a.title.toLowerCase().includes(needle) ||
        String(a.year || "").includes(needle));
    }
    if (filter === "unscored") out = out.filter((a) => a.score == null);
    if (filter === "scored")   out = out.filter((a) => a.score != null);
    if (filter === "out")      out = out.filter((a) => !a.in_pool);

    const by = {
      artist: (a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title),
      title:  (a, b) => a.title.localeCompare(b.title),
      year:   (a, b) => (b.year || 0) - (a.year || 0),
      score:  (a, b) => (b.score ?? -1) - (a.score ?? -1) || a.artist.localeCompare(b.artist),
    }[sort];
    return [...out].sort(by);
  }, [albums, q, filter, sort]);

  React.useEffect(() => setShown(CHUNK), [q, filter, sort]);

  // Grow the list as it is scrolled rather than rendering thousands of tiles.
  React.useEffect(() => {
    const onScroll = () => {
      if (window.innerHeight + window.scrollY > document.body.offsetHeight - 700) {
        setShown((n) => (n < list.length ? n + CHUNK : n));
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [list.length]);

  const live = open ? albums.find((a) => a.id === open.id) || open : null;

  return (
    <div className="browse">
      <div className="stats">
        <Stat label="albums" value={stats.total.toLocaleString()} />
        <Stat label="rated" value={`${stats.scored} · ${Math.round(stats.scored / stats.total * 100)}%`} />
        <Stat label="in the pool" value={stats.pool.toLocaleString()} />
      </div>

      <div className="toolbar">
        <input
          className="search" value={q} placeholder="Search artist, album or year…"
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="chips">
          {[["all", "All"], ["unscored", "Unrated"], ["scored", "Rated"], ["out", "Out of pool"]]
            .map(([id, label]) => (
              <button key={id} className={"chip" + (filter === id ? " chip--on" : "")}
                      onClick={() => setFilter(id)}>{label}</button>
            ))}
        </div>
        <select className="sort" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="artist">Artist A–Z</option>
          <option value="title">Album A–Z</option>
          <option value="year">Newest first</option>
          <option value="score">Highest rated</option>
        </select>
      </div>

      <div className="count">{list.length.toLocaleString()} shown</div>

      <div className="grid">
        {list.slice(0, shown).map((a) => (
          <button key={a.id} className="tile" onClick={() => setOpen(a)}>
            <div className="tile__art">
              <CoverArt album={a} size={150} canPersist={owner}
                        onResolved={(id, url) => onPatch(id, { cover_url: url }, true)} />
              {a.score != null && <span className="tile__score">{a.score}</span>}
              {!a.in_pool && <span className="tile__out" title="Out of the pool" />}
            </div>
            <div className="tile__title">{a.title}</div>
            <div className="tile__artist">{a.artist}</div>
          </button>
        ))}
      </div>

      {shown < list.length && (
        <button className="btn btn--more" onClick={() => setShown((n) => n + CHUNK)}>
          Show more ({(list.length - shown).toLocaleString()} left)
        </button>
      )}

      {live && (
        <Detail album={live} owner={owner} onPatch={onPatch} onPlay={onPlay}
                onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

window.BrowseView = BrowseView;

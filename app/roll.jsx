// roll.jsx — the randomizer screen. Built for speed: one album at a time, one
// keystroke to score it, one to move on.

const SCORES = [70, 75, 80, 85, 90, 95, 100];

const MODES = [
  { id: "weighted", label: "Weighted",  hint: "Favours what you rated highly" },
  { id: "unscored", label: "Unrated",   hint: "Only albums you have never scored" },
  { id: "uniform",  label: "Uniform",   hint: "Every album an equal shot" },
];

function RollView({ albums, owner, onPatch, onPlay, onRoll }) {
  const [mode, setMode] = React.useState(
    () => localStorage.getItem("ih:mode") || "weighted"
  );
  const [share, setShare] = React.useState(
    () => Number(localStorage.getItem("ih:share") ?? 25)
  );
  const [current, setCurrent] = React.useState(null);
  const [history, setHistory] = React.useState([]);   // most recent first
  const [flash, setFlash] = React.useState(null);

  React.useEffect(() => localStorage.setItem("ih:mode", mode), [mode]);
  React.useEffect(() => localStorage.setItem("ih:share", share), [share]);

  // The album in `current` is a snapshot; re-read it from the live list so a
  // score set here shows up immediately on the card.
  const album = current ? albums.find((a) => a.id === current.id) || current : null;

  const spin = React.useCallback(() => {
    const pick = Roller.roll(albums, {
      mode,
      unscoredShare: share,
      avoidIds: history.slice(0, 15).map((a) => a.id),
    });
    if (!pick) return setFlash("Nothing left in this pool");
    setCurrent(pick);
    setHistory((h) => [pick, ...h].slice(0, 30));
    onRoll?.(pick, mode);
  }, [albums, mode, share, history, onRoll]);

  // First roll once the collection has loaded.
  React.useEffect(() => {
    if (!current && albums.length) spin();
  }, [albums.length]);

  // Changing mode should hand you an album from the new mode straight away,
  // rather than leaving the last one sitting there -- switching to Unrated and
  // still staring at something you rated 100 is confusing.
  const firstRun = React.useRef(true);
  React.useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (albums.length) spin();
  }, [mode]);

  const score = (value) => {
    if (!album || !owner) return;
    onPatch(album.id, { score: album.score === value ? null : value });
    setFlash(album.score === value ? "Score cleared" : `Scored ${value}`);
  };

  // ── keyboard ──────────────────────────────────────────────────────────────
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.target.matches("input, textarea, select")) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 7) { e.preventDefault(); return score(SCORES[n - 1]); }
      if (e.key === "0") { e.preventDefault(); return score(album?.score); }
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); return spin(); }
      if (e.key.toLowerCase() === "p") { e.preventDefault(); return played(); }
      if (e.key.toLowerCase() === "x") { e.preventDefault(); return drop(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  React.useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  const played = () => {
    if (!album || !owner) return;
    onPlay(album.id);
    setFlash("Logged as played");
  };

  const drop = () => {
    if (!album || !owner) return;
    onPatch(album.id, { in_pool: false });
    setFlash("Removed from the pool");
    spin();
  };

  if (!album) return <div className="empty">Shuffling…</div>;

  const searchUrl = (svc) => {
    const q = encodeURIComponent(`${album.artist} ${album.title}`);
    return svc === "spotify"
      ? `https://open.spotify.com/search/${q}`
      : `https://music.apple.com/search?term=${q}`;
  };

  return (
    <div className="roll">
      <div className="roll__controls">
        <div className="modes">
          {MODES.map((m) => (
            <button
              key={m.id}
              className={"mode" + (mode === m.id ? " mode--on" : "")}
              onClick={() => setMode(m.id)}
              title={m.hint}
            >
              {m.label}
            </button>
          ))}
        </div>
        {mode === "weighted" && (
          <label className="slider">
            <span>Unrated albums: <b>{share}%</b> of rolls</span>
            <input
              type="range" min="0" max="100" step="5"
              value={share}
              onChange={(e) => setShare(Number(e.target.value))}
            />
          </label>
        )}
      </div>

      <div className="card">
        <div className="card__art">
          <CoverArt album={album} size={320} canPersist={owner}
                    onResolved={(id, url) => onPatch(id, { cover_url: url }, true)} />
        </div>

        <div className="card__body">
          <div className="card__artist">{album.artist}</div>
          <h2 className="card__title">{album.title}</h2>
          <div className="card__meta">
            {album.year || "—"}
            {album.score != null && <span className="badge">{album.score}</span>}
            {album.score == null && <span className="badge badge--dim">unrated</span>}
          </div>

          {album.genres?.length > 0 && (() => {
            const { genre, style } = Genres.splitGenres(album.genres, Genres.buildIndex(albums));
            return (
              <div className="genres">
                {genre.map((g) => <span key={g} className="genre">{g}</span>)}
                {style.map((g) => <span key={g} className="genre genre--style">{g}</span>)}
              </div>
            );
          })()}

          <div className="scores">
            {SCORES.map((s, i) => (
              <button
                key={s}
                className={"score" + (album.score === s ? " score--on" : "")}
                onClick={() => score(s)}
                disabled={!owner}
                title={`Key ${i + 1}`}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="row">
            <button className="btn btn--primary" onClick={spin}>Roll again ␣</button>
            <button className="btn" onClick={played} disabled={!owner}>Played it (p)</button>
            <button className="btn btn--quiet" onClick={drop} disabled={!owner}>
              Not for the pool (x)
            </button>
          </div>

          <div className="row row--links">
            <a className="link" href={searchUrl("spotify")} target="_blank" rel="noreferrer">
              Find on Spotify
            </a>
            <a className="link" href={searchUrl("apple")} target="_blank" rel="noreferrer">
              Apple Music
            </a>
          </div>
        </div>
      </div>

      {flash && <div className="flash" role="status" aria-live="polite">{flash}</div>}

      {history.length > 1 && (
        <div className="recent">
          <h3>Just rolled</h3>
          <div className="recent__list">
            {history.slice(1, 13).map((h, i) => {
              const live = albums.find((a) => a.id === h.id) || h;
              return (
                <button key={`${h.id}-${i}`} className="recent__item"
                        onClick={() => setCurrent(live)}>
                  <CoverArt album={live} size={56} canPersist={false} />
                  <span className="recent__txt">
                    <b>{live.title}</b>
                    <em>{live.artist}</em>
                  </span>
                  {live.score != null && <span className="badge badge--sm">{live.score}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

window.RollView = RollView;

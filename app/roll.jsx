// roll.jsx — the randomizer screen. Built for speed: one album at a time, one
// keystroke to score it, one to move on.

const MODES = [
  // Uniform leads and is the default. With 9% of the collection rated, a
  // weighted roll spends most of its odds on one enormous "unrated" tier, so
  // it behaves almost like uniform anyway while looking like it knows
  // something. The other two are deliberate choices, set apart below.
  { id: "uniform",  label: "Uniform",   hint: "Every album an equal shot" },
  { id: "weighted", label: "Weighted",  hint: "Favours what you rated highly" },
  { id: "unscored", label: "Unrated",   hint: "Only albums you have never scored" },
];

function RollView({ albums, owner, onPatch, onRoll, params, setParams }) {
  // The mode lives in the URL, the way the shelf's filters do. It used to sit
  // in localStorage, which meant a browser that had ever picked a mode kept it
  // forever -- so changing the default changed nothing for anyone who had
  // already used the app, and the address bar said nothing about what you were
  // looking at. A bare #/roll is now always Uniform, and a link carries its
  // mode to whoever opens it.
  const setParam = (key, value, { push = true } = {}) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { push });
  };

  const mode = MODES.some((m) => m.id === params.get("mode"))
    ? params.get("mode")
    : "uniform";
  const setMode = (id) => setParam("mode", id === "uniform" ? "" : id);

  const share = Number.isFinite(Number(params.get("share")))
                && params.get("share") !== null
    ? Math.min(100, Math.max(0, Number(params.get("share"))))
    : 25;
  const setShare = (n) => setParam("share", String(n), { push: false });
  const [current, setCurrent] = React.useState(null);
  const [history, setHistory] = React.useState([]);   // most recent first
  const [flash, setFlash] = React.useState(null);

  // The album in `current` is a snapshot; re-read it from the live list so a
  // score set here shows up immediately on the card.
  const album = current ? albums.find((a) => a.id === current.id) || current : null;

  // Built once per collection, not on every render. This screen re-renders on
  // every keystroke and every flash message, and rebuilding the genre index
  // walks all four thousand albums and every pair of their tags each time.
  const genreIndex = React.useMemo(() => Genres.buildIndex(albums), [albums]);

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
  // The slider counts too: moving it changes the odds, so the album on screen
  // was drawn under rules that no longer apply. It fires continuously while
  // dragging, hence the wait -- re-rolling on every step of the drag would be
  // unreadable.
  const firstRun = React.useRef(true);
  React.useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (!albums.length) return;
    const t = setTimeout(spin, 250);
    return () => clearTimeout(t);
  }, [mode, share]);

  const score = (value) => {
    if (!album || !owner) return;
    // 0 on an unrated album arrives here as score(null): nothing to clear, so
    // no write and no "Score cleared" for a score that never existed.
    if (value == null && album.score == null) return;
    onPatch(album.id, { score: album.score === value ? null : value });
    setFlash(album.score === value ? "Score cleared"
      : Roller.inRotation({ score: value }) ? `Scored ${value}` : "Not Recommended — out of rotation");
  };

  // ── keyboard ──────────────────────────────────────────────────────────────
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.target.matches("input, textarea, select")) return;
      // Cmd/Ctrl+1-9 is the browser's own "go to tab". Without this the
      // keystroke scored the album on screen AND was swallowed, so switching
      // tabs from the Roll screen quietly rated whatever happened to be up.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 7) { e.preventDefault(); return score(Roller.SCORES[n - 1]); }
      if (e.key === "0") { e.preventDefault(); return score(album?.score); }
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); return spin(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  React.useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  // "Played it" and "Not for the pool" used to sit beside Roll again. Rating
  // an album already says you heard it, and the pool itself is gone: every
  // album is eligible, and one you never want to see again is deleted from
  // its sheet, which can be undone.
  if (!album) return <div className="empty">Shuffling…</div>;

  const apple = Listen.apple(album);
  const spotify = Listen.spotify(album);

  return (
    <div className="roll">
      <div className="roll__controls">
        <div className="modes">
          {MODES.map((m, i) => (
            <button
              key={m.id}
              className={"mode" + (mode === m.id ? " mode--on" : "") +
                         (i === 1 ? " mode--first-optional" : "")}
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
            {album.score != null && <span className="badge">{Roller.scoreLabel(album.score)}</span>}
            {album.score == null && <span className="badge badge--dim">unrated</span>}
          </div>

          {album.genres?.length > 0 && (
            <GenreLines
              album={album}
              index={genreIndex}
              onGenre={(g) => { location.hash = `#/browse?genre=${encodeURIComponent(g)}`; }}
            />
          )}

          {owner && <ScoreKeys value={album.score} onPick={score} keyHints />}

          <div className="row">
            <button className="btn btn--primary" onClick={spin}>Roll again ␣</button>
          </div>

          <div className="row row--links">
            <a className="link" href={apple.href} target={apple.newTab ? "_blank" : undefined} rel="noreferrer">
              {apple.exact ? "Apple Music" : "Search Apple Music"}
            </a>
            <a className="link" href={spotify.href} target="_blank" rel="noreferrer">
              Search Spotify
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
                  {live.score != null && <span className="badge badge--sm">{Roller.scoreLabel(live.score)}</span>}
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

// browse.jsx — the shelf: search, filter, and score in bulk.

const BROWSE_SCORES = [70, 75, 80, 85, 90, 95, 100];
const CHUNK = 60;   // tiles rendered per "page" — 4.4k at once would crawl

// Tiles sit at slightly different heights, like records pushed unevenly into a
// shelf. The offset is derived from the album id rather than chosen at random,
// so a given album always sits at the same height and the wall does not
// reshuffle itself on every re-render.
//
// The id is passed through a multiplicative hash first: ids run in sequence, so
// using them directly would line the offsets up into vertical stripes once the
// grid settled on a column count.
const LIFTS = [0, 13, 6, 20, 3, 16, 9];
function lift(id) {
  return LIFTS[(Math.imul(id, 2654435761) >>> 0) % LIFTS.length];
}

function Stat({ label, value }) {
  return <div className="stat"><b>{value}</b><span>{label}</span></div>;
}

// Genre is what you browse by; style is what the record actually is. Clicking a
// genre filters; a style is not a filter -- half of them sit on one album -- so
// it runs a search instead.
function GenreLines({ album, index, onGenre }) {
  const { genre, style } = Genres.splitGenres(album.genres, index);
  if (!genre.length && !style.length) return null;
  return (
    <div className="taxo">
      {genre.length > 0 && (
        <div className="taxo__row">
          <span className="taxo__label">Genre</span>
          <div className="genres">
            {genre.map((g) => (
              <button key={g} className="genre genre--link" onClick={() => onGenre?.(g)}>{g}</button>
            ))}
          </div>
        </div>
      )}
      {style.length > 0 && (
        <div className="taxo__row">
          <span className="taxo__label">Style</span>
          <div className="genres">
            {style.map((g) => <span key={g} className="genre genre--style">{g}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ album, owner, onPatch, onPlay, onDelete, onClose, index, onGenre }) {
  // Two taps rather than a browser confirm dialog: the first arms it, the
  // second does it, and clicking anywhere else disarms.
  const [armed, setArmed] = React.useState(false);
  React.useEffect(() => setArmed(false), [album.id]);
  const [notes, setNotes] = React.useState(album.notes || "");
  React.useEffect(() => setNotes(album.notes || ""), [album.id]);

  // Renaming is a cloud-mode action. See the note on the whitelist in
  // supabase-client.js for why local mode sends you to the script instead.
  const canRename = window.db?.mode !== "local";
  const blank = () => ({ artist: album.artist, title: album.title, year: album.year || "" });
  const [editingName, setEditingName] = React.useState(false);
  const [draft, setDraft] = React.useState(blank);
  React.useEffect(() => { setEditingName(false); setDraft(blank()); }, [album.id]);

  function saveName(e) {
    e.preventDefault();
    const artist = draft.artist.trim();
    const title = draft.title.trim();
    if (!artist || !title) return;          // never leave an album unnameable
    const year = draft.year ? Number(draft.year) : null;
    const patch = {};
    if (artist !== album.artist) patch.artist = artist;
    if (title !== album.title) patch.title = title;
    if (year !== (album.year ?? null)) patch.year = year;
    if (Object.keys(patch).length) onPatch(album.id, patch);
    setEditingName(false);
  }

  React.useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="sheet" onClick={onClose}>
      <div className="sheet__inner" onClick={(e) => e.stopPropagation()}>
        <button className="sheet__x" onClick={onClose} aria-label="Close">×</button>
        <div className="sheet__art">
          <CoverArt album={album} size={260} canPersist={owner}
                    onResolved={(id, url) => onPatch(id, { cover_url: url }, true)} />
        </div>
        <div className="sheet__body">
          {editingName ? (
            <form className="rename" onSubmit={saveName}>
              <label className="field">
                <span>Artist</span>
                <input value={draft.artist} autoFocus spellCheck={false}
                       onChange={(e) => setDraft({ ...draft, artist: e.target.value })} />
              </label>
              <label className="field">
                <span>Album</span>
                <input value={draft.title} spellCheck={false}
                       onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </label>
              <label className="field rename__year">
                <span>Year</span>
                <input value={draft.year} inputMode="numeric" spellCheck={false}
                       onChange={(e) => setDraft({ ...draft, year: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
              </label>
              <div className="rename__actions">
                <button type="submit" className="btn">Save Name</button>
                <button type="button" className="btn btn--quiet"
                        onClick={() => { setDraft(blank()); setEditingName(false); }}>Cancel</button>
              </div>
              <p className="rename__note">
                Renaming re-matches this album on the next nightly run, which
                refreshes its genres and artwork.
              </p>
            </form>
          ) : (
            <>
              <div className="card__artist">{album.artist}</div>
              <h2 className="card__title">{album.title}</h2>
              <div className="card__meta">
                {album.year || "—"}
                {owner && (canRename ? (
                  <button className="linkish" onClick={() => setEditingName(true)}>Edit name</button>
                ) : (
                  <span className="hint">local mode — rename with scripts/rename.mjs</span>
                ))}
              </div>
            </>
          )}

          <GenreLines album={album} index={index} onGenre={onGenre} />

          {owner ? (
            <div className="scores">
              {BROWSE_SCORES.map((s) => (
                <button
                  key={s}
                  className={"score" + (album.score === s ? " score--on" : "")}
                  onClick={() => onPatch(album.id, { score: album.score === s ? null : s })}
                >
                  {s}
                </button>
              ))}
            </div>
          ) : album.score != null ? (
            <div className="card__meta"><span className="badge">{album.score}</span> rated</div>
          ) : null}

          {/* A visitor sees a note that exists, but not an empty box inviting
              them to write one they cannot save. */}
          {owner ? (
            <>
              <label className="field">
                <span>Cover image {album.cover_locked && <b>— yours, kept</b>}</span>
                <input
                  id={`cover-${album.id}`}
                  defaultValue={album.cover_url || ""}
                  placeholder="Paste an image URL to override"
                  onBlur={(e) => {
                    const url = e.target.value.trim();
                    if (url === (album.cover_url || "")) return;
                    onPatch(album.id, { cover_url: url || null, cover_locked: !!url });
                  }}
                />
              </label>

              <label className="field">
                <span>Notes</span>
                <textarea
                  rows="3" value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onBlur={() => notes !== (album.notes || "") && onPatch(album.id, { notes })}
                  placeholder="What did you think?"
                />
              </label>

              <div className="row">
                <button className="btn" onClick={() => onPlay(album.id)}>Log a play</button>
                <button className="btn btn--quiet"
                        onClick={() => onPatch(album.id, { in_pool: !album.in_pool })}>
                  {album.in_pool ? "Remove from pool" : "Back in the pool"}
                </button>
                <button className={"btn btn--danger" + (armed ? " btn--armed" : "")}
                        onClick={() => (armed ? onDelete(album.id) : setArmed(true))}>
                  {armed ? "Tap again to delete" : "Delete"}
                </button>
              </div>
              {armed && (
                <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                  Removes it from the shelf for good. To stop it coming up on rolls
                  without deleting it, use “Remove from pool”.
                </p>
              )}
            </>
          ) : album.notes ? (
            <div className="field"><span>Notes</span><p className="readonly-note">{album.notes}</p></div>
          ) : null}

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


// Genre filter. There are already 216 distinct genres and half of them sit on
// two albums or fewer, so a dropdown is the wrong control: the list is too long
// to scan and most of it is too specific to browse for. Instead the common ones
// are offered first, ranked by how much of YOUR collection they cover, and
// typing reaches the tail.
//
// Built as a real combobox rather than a native <select> so it can show counts
// and be searched -- which means the keyboard behaviour is ours to implement.
function GenreFilter({ options, value, onChange }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const boxRef = React.useRef(null);
  const listId = "genre-options";

  const matches = React.useMemo(() => {
    const needle = query.trim().toLowerCase();
    const hits = needle
      ? options.filter(([g]) => g.toLowerCase().includes(needle))
      : options;
    return hits.slice(0, 40);
  }, [options, query]);

  React.useEffect(() => setActive(0), [query]);

  // Clicking away closes it; the input keeps whatever was already selected.
  React.useEffect(() => {
    if (!open) return;
    const away = (e) => { if (!boxRef.current?.contains(e.target)) { setOpen(false); setQuery(""); } };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const choose = (g) => { onChange(g); setOpen(false); setQuery(""); };

  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, matches.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && open && matches[active]) { e.preventDefault(); choose(matches[active][0]); }
    else if (e.key === "Escape") { setOpen(false); setQuery(""); e.currentTarget.blur(); }
  };

  if (value) {
    return (
      <button className="chip chip--on genre-clear" onClick={() => onChange("")}
              title="Clear the genre filter">
        {value} <span aria-hidden="true">×</span>
        <span className="sr-only">, clear genre filter</span>
      </button>
    );
  }

  return (
    <div className="combo" ref={boxRef}>
      <input
        className="combo__input"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Filter by genre"
        placeholder="Genre…"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />
      {open && (
        <ul className="combo__list" id={listId} role="listbox">
          {matches.length === 0 && <li className="combo__empty">No genre matches “{query}”</li>}
          {matches.map(([g, n], i) => (
            <li key={g} role="option" aria-selected={i === active}>
              <button
                className={"combo__opt" + (i === active ? " combo__opt--active" : "")}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(g)}
              >
                <span>{g}</span>
                <em>{n}</em>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddAlbum({ albums, onAdd, onClose }) {
  const [artist, setArtist] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [year, setYear] = React.useState("");
  const [score, setScore] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");

  // The database refuses duplicates outright; catching it here explains the
  // problem instead of surfacing a constraint violation.
  const clash = albums.find(
    (a) => a.artist.trim().toLowerCase() === artist.trim().toLowerCase() &&
           a.title.trim().toLowerCase() === title.trim().toLowerCase());

  const submit = async (e) => {
    e.preventDefault();
    if (!artist.trim() || !title.trim() || clash) return;
    setBusy(true); setErr("");
    try {
      await onAdd({ artist: artist.trim(), title: title.trim(), year: year ? Number(year) : null, score });
      onClose();
    } catch (e2) {
      setErr(e2.message || String(e2));
      setBusy(false);
    }
  };

  return (
    <div className="sheet" onClick={onClose}>
      <form className="sheet__inner sheet__inner--sm" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <button type="button" className="sheet__x" onClick={onClose} aria-label="Close">×</button>
        <h2 className="card__title">Add an album</h2>
        <p className="muted">Genres and artwork are filled in by the next enrichment run.</p>

        <label className="field"><span>Artist</span>
          <input id="add-artist" value={artist} onChange={(e) => setArtist(e.target.value)}
                 autoFocus required />
        </label>
        <label className="field"><span>Album</span>
          <input id="add-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label className="field"><span>Year (optional)</span>
          <input id="add-year" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
                 inputMode="numeric" placeholder="2026" />
        </label>

        <div className="field">
          <span>Score it now? (optional)</span>
          <div className="scores">
            {BROWSE_SCORES.map((sc) => (
              <button type="button" key={sc}
                      className={"score" + (score === sc ? " score--on" : "")}
                      onClick={() => setScore(score === sc ? null : sc)}>{sc}</button>
            ))}
          </div>
        </div>

        {clash && <div className="err">Already in the collection — {clash.artist} — {clash.title}</div>}
        {err && <div className="err">{err}</div>}
        <button className="btn btn--primary" disabled={busy || !!clash}>
          {busy ? "Adding…" : "Add to the shelf"}
        </button>
      </form>
    </div>
  );
}

function BrowseView({ albums, owner, onPatch, onPlay, onAdd, onDelete, onRestore,
                     params, setParams }) {
  // The URL is the source of truth for these four, so a filtered view can be
  // bookmarked and shared, and Back undoes a filter instead of leaving the app.
  const q = params.get("q") || "";
  const filter = params.get("filter") || "all";
  const sort = params.get("sort") || "artist";
  const genre = params.get("genre") || "";

  // Typing replaces the current entry; picking a filter pushes a new one. Back
  // should step through the filters you chose, not through every keystroke.
  const setParam = (key, value, { push = true } = {}) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { push });
  };
  const [shown, setShown] = React.useState(CHUNK);
  const [open, setOpen] = React.useState(null);
  const [adding, setAdding] = React.useState(false);
  const [deleted, setDeleted] = React.useState(null);   // null until asked for

  React.useEffect(() => {
    if (filter !== "deleted" || deleted) return;
    db.deletedAlbums().then(setDeleted).catch(() => setDeleted([]));
  }, [filter, deleted]);

  const stats = React.useMemo(() => ({
    total: albums.length,
    scored: albums.filter((a) => a.score != null).length,
    pool: albums.filter((a) => a.in_pool).length,
  }), [albums]);

  // Genres are computed from the collection itself -- see app/genres.js.
  const index = React.useMemo(() => Genres.buildIndex(albums), [albums]);
  const genreOptions = React.useMemo(
    () => Genres.genreOptions(albums, index), [albums, index]);

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
    if (genre) out = out.filter((a) => Genres.splitGenres(a.genres, index).genre.includes(genre));

    const by = {
      artist: (a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title),
      title:  (a, b) => a.title.localeCompare(b.title),
      year:   (a, b) => (b.year || 0) - (a.year || 0),
      score:  (a, b) => (b.score ?? -1) - (a.score ?? -1) || a.artist.localeCompare(b.artist),
    }[sort];
    return [...out].sort(by);
  }, [albums, q, filter, sort, genre, index]);

  React.useEffect(() => setShown(CHUNK), [q, filter, sort, genre]);

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
          onChange={(e) => setParam("q", e.target.value, { push: false })}
        />
        <div className="chips">
          {[["all", "All"], ["unscored", "Unrated"], ["scored", "Rated"],
            ["out", "Out of pool"], ...(owner ? [["deleted", "Deleted"]] : [])]
            .map(([id, label]) => (
              <button key={id} className={"chip" + (filter === id ? " chip--on" : "")}
                      onClick={() => setParam("filter", id === "all" ? "" : id)}>{label}</button>
            ))}
        </div>
        {genreOptions.length > 0 && (
          <GenreFilter options={genreOptions} value={genre}
                       onChange={(g) => setParam("genre", g)} />
        )}
        {owner && (
          <button className="btn btn--primary btn--sm" onClick={() => setAdding(true)}>
            + Add album
          </button>
        )}
        <select className="sort" value={sort} onChange={(e) => setParam("sort", e.target.value === "artist" ? "" : e.target.value)}>
          <option value="artist">Artist A–Z</option>
          <option value="title">Album A–Z</option>
          <option value="year">Newest first</option>
          <option value="score">Highest rated</option>
        </select>
      </div>

      {filter === "deleted" ? (
        <div className="count">
          {deleted === null ? "Loading…" :
           deleted.length === 0 ? "Nothing deleted. Anything you remove shows up here." :
           `${deleted.length} hidden — nothing is ever erased from the database`}
        </div>
      ) : (
        <div className="count">{list.length.toLocaleString()} shown</div>
      )}

      {filter === "deleted" && deleted?.length > 0 && (
        <div className="restore-list">
          {deleted.map((a) => (
            <div key={a.id} className="restore-row">
              <div className="restore-art"><CoverArt album={a} size={48} canPersist={false} /></div>
              <div className="restore-txt">
                <b>{a.title}</b>
                <em>{a.artist}{a.year ? ` · ${a.year}` : ""}</em>
              </div>
              {a.score != null && <span className="badge badge--sm">{a.score}</span>}
              <button className="btn btn--sm" disabled={!owner}
                      onClick={() => onRestore(a.id)}>Restore</button>
            </div>
          ))}
        </div>
      )}

      <div className="grid" hidden={filter === "deleted"}>
        {list.slice(0, shown).map((a) => (
          <button key={a.id} className="tile" onClick={() => setOpen(a)}
                  style={{ "--lift": lift(a.id) + "px" }}>
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

      {shown < list.length && filter !== "deleted" && (
        <button className="btn btn--more" onClick={() => setShown((n) => n + CHUNK)}>
          Show more ({(list.length - shown).toLocaleString()} left)
        </button>
      )}

      {live && (
        <Detail album={live} owner={owner} onPatch={onPatch} onPlay={onPlay}
                index={index} onGenre={(g) => { setParam("genre", g); setOpen(null); }}
                onDelete={(id) => { onDelete(id); setDeleted(null); setOpen(null); }}
                onClose={() => setOpen(null)} />
      )}

      {adding && (
        <AddAlbum albums={albums} onAdd={onAdd} onClose={() => setAdding(false)} />
      )}
    </div>
  );
}

window.BrowseView = BrowseView;

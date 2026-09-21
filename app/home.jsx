// home.jsx — the front page.
//
// A door, not a menu. One record is printed large; the other four stand as a
// stub index carrying no artwork at all. Five equal cards was the old
// arrangement, and a menu of five is how you end up playing nothing.
//
// The lead is always one of the day's unrated records. daily-picks.mjs draws
// at random and does not rank, so a lead chosen any other way would imply a
// recommendation nothing actually made. "The one you have not heard" is a
// claim the data can support.
//
// The five come from app/daily.json, written by the nightly job. It ships with
// the app, so there is nothing to fetch from the database and nothing to wait
// for: the page is complete the moment it opens. Which is also why nothing
// here animates on load -- a door opened several times a day must not make
// anyone watch it assemble. The one transition is the lead sleeve fading in
// when the image itself arrives, which is a state change rather than
// choreography.

function LeadArt({ album }) {
  const [on, setOn] = React.useState(false);
  const ref = React.useRef(null);

  // A cached image can finish before React attaches onLoad, which would leave
  // it stuck at opacity 0 forever. Check the element directly on mount.
  React.useEffect(() => {
    if (ref.current?.complete) setOn(true);
  }, [album.cover_url]);

  return (
    <span className="lead__art">
      <img
        ref={ref}
        className={on ? "is-on" : ""}
        src={album.cover_url}
        alt=""
        width="660"
        height="660"
        loading="eager"
        fetchPriority="high"
        onLoad={() => setOn(true)}
        onError={() => setOn(true)}
      />
    </span>
  );
}

function Lead({ album, onOpen }) {
  return (
    <article className="lead">
      <button className="lead__hit" onClick={() => onOpen(album)}>
        <LeadArt album={album} />
        <span className="lead__artist">{album.artist}</span>
        <span className="lead__title">{album.title}</span>
        <span className="lead__meta">
          <span>{album.year || "—"}</span>
          {album.score != null && <b className="lead__score">{album.score}</b>}
          {!!album.genres?.length && (
            <span className="lead__genres">{album.genres.join(" · ")}</span>
          )}
        </span>
      </button>
    </article>
  );
}

// The four that are not the lead. No artwork: the point of the margin is that
// it is quiet, and four more sleeves would make five equal cards again by
// another route. The year sits where a list number would -- it is the same
// width every time and it actually tells you something.
function Stub({ album, onOpen }) {
  return (
    <li className="stub">
      <button className="stub__hit" onClick={() => onOpen(album)}>
        <span className="stub__year">{album.year || "—"}</span>
        <span className="stub__name">
          <span className="stub__artist">{album.artist}</span>
          <span className="stub__title">{album.title}</span>
        </span>
        {album.score != null && <span className="stub__score">{album.score}</span>}
      </button>
    </li>
  );
}

function HomeView({ albums, onGo }) {
  const [daily, setDaily] = React.useState(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    fetch("./daily.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setDaily)
      .catch(() => setFailed(true));
  }, []);

  const rated = albums.filter((a) => a.score != null).length;
  const unrated = albums.length - rated;

  // Written out rather than Intl-formatted with a hardcoded locale: the
  // dateline should read in the visitor's own language.
  const dateline = daily?.date
    ? new Intl.DateTimeFormat(undefined, {
        weekday: "long", day: "numeric", month: "long",
      }).format(new Date(daily.date + "T12:00:00"))
    : "";
  const stale = daily?.date && daily.date !== new Date().toISOString().slice(0, 10);

  const picks = daily?.picks || [];
  // First unrated, falling back to the first pick on a day that somehow has
  // none -- the page must still have a lead.
  const leadAt = Math.max(0, picks.findIndex((p) => p.score == null));
  const lead = picks[leadAt];
  const rest = picks.filter((_, i) => i !== leadAt);

  // The shelf's artist filter is exact, so this lands on the record rather
  // than on whatever a title search happens to match.
  const open = (a) => onGo("browse", { artist: a.artist });

  return (
    <div className="home">
      <header className="folio">
        <h1 className="folio__title">Infinite Music Catalog</h1>
        <div className="folio__side">
          <p className="folio__date">{dateline}</p>
          <p className="folio__count">
            <b>{albums.length.toLocaleString()}</b> albums &middot;{" "}
            <b>{rated.toLocaleString()}</b> rated &middot;{" "}
            <b>{unrated.toLocaleString()}</b> to go
          </p>
        </div>
      </header>

      {stale && (
        <p className="home__stale" role="status">Picked {dateline}.</p>
      )}

      {failed && (
        <p className="home__empty">
          No picks yet — <code>node scripts/daily-picks.mjs</code>
        </p>
      )}

      {lead && (
        <div className="spread">
          <Lead album={lead} onOpen={open} />

          {rest.length > 0 && (
            <div className="margin">
              <p className="margin__label">Also today</p>
              <ol className="margin__list">
                {rest.map((a) => (
                  <Stub key={`${a.artist}::${a.title}`} album={a} onOpen={open} />
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      <nav className="doors" aria-label="Elsewhere">
        <button className="door" onClick={() => onGo("browse")}>
          <span className="door__t">The shelf</span>
          <span className="door__d">{albums.length.toLocaleString()} albums</span>
        </button>
        <button className="door" onClick={() => onGo("roll")}>
          <span className="door__t">Roll</span>
          <span className="door__d">{unrated.toLocaleString()} still unrated</span>
        </button>
      </nav>
    </div>
  );
}

window.HomeView = HomeView;

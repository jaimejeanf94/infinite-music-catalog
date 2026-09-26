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

// A link into the shelf, shared with roll.jsx. `album` is read once by the
// shelf to open that album's sheet, then dropped from the URL.
const shelfHref = (params) => "#/browse?" + new URLSearchParams(params);

// A pick whose record could not be found in the live collection (renamed or
// deleted since the nightly run) has no id; it still gets its artist's shelf.
const albumHref = (album) => shelfHref(album.id != null
  ? { artist: album.artist, album: album.id }
  : { artist: album.artist });

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

// The same rules as the roll: the artist leads to their shelf, the record --
// its title, or its sleeve -- to that shelf with its own sheet open on top.
// The sleeve is a second way to the same place, so it is out of the tab order
// and hidden from screen readers rather than announced twice.
function Lead({ album }) {
  return (
    <article className="lead">
      <a className="lead__art-link" href={albumHref(album)} tabIndex={-1} aria-hidden="true">
        <LeadArt album={album} />
      </a>
      <span className="lead__artist">
        <a className="hoverline" href={shelfHref({ artist: album.artist })}
           title={`Show everything by ${album.artist}`}>{album.artist}</a>
      </span>
      <span className="lead__title">
        <a className="hoverline" href={albumHref(album)} title="Open it on the shelf">{album.title}</a>
      </span>
      <span className="lead__meta">
        <span>{album.year || "—"}</span>
        {album.score != null && <b className="lead__score">{Roller.scoreLabel(album.score)}</b>}
        {!!album.genres?.length && (
          <span className="lead__genres">{album.genres.join(" · ")}</span>
        )}
      </span>
    </article>
  );
}

// The four that are not the lead. No artwork: the point of the margin is that
// it is quiet, and four more sleeves would make five equal cards again by
// another route. The year sits where a list number would -- it is the same
// width every time and it actually tells you something.
//
// One link per row, to the artist's shelf. The lead has two (artist, and the
// record itself), but four small rows each split into two targets meant
// aiming for the right line of text. The link is stretched over the whole
// row (styles.css), so the row is one big target on a phone -- and it is the
// row that lights up, not the name, since underlining one line invites a
// click on the other.
function Stub({ album }) {
  return (
    <li className="stub">
      <span className="stub__year">{album.year || "—"}</span>
      <span className="stub__name">
        <span className="stub__artist">
          <a className="stub__link" href={shelfHref({ artist: album.artist })}
             title={`Show everything by ${album.artist}`}>{album.artist}</a>
        </span>
        <span className="stub__title">{album.title}</span>
      </span>
      {album.score != null && <span className="stub__score">{Roller.scoreLabel(album.score)}</span>}
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
  // Stale means older than the viewer's own today. The picks are dated in
  // UTC by the nightly run, and this used to compare against the UTC date
  // too -- so from 6pm in Mexico City, when UTC has already rolled over, the
  // front page announced that perfectly current picks were yesterday's, every
  // evening. Dated AHEAD of the viewer (a run after UTC midnight) is not stale.
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-` +
                String(d.getDate()).padStart(2, "0");
  const stale = !!daily?.date && daily.date < today;

  // The five are a snapshot taken at night, so the page lays them over the
  // live collection: rate the lead and come back, and it shows your score
  // rather than the "unrated" it had at 1am. Which record LEADS is still
  // decided by the snapshot, so rating it does not swap it for another.
  const live = React.useMemo(() => {
    const m = new Map();
    for (const a of albums) m.set(`${a.artist}::${a.title}`, a);
    return m;
  }, [albums]);
  // A pick you rate below 70 today leaves the five today, not tomorrow: it is
  // out of every roll, and the five are a roll.
  const pickKey = (p) => `${p.artist}::${p.title}`;
  const picks = (daily?.picks || []).map((p) => {
    const now = live.get(pickKey(p));
    return now ? { ...p, id: now.id, score: now.score, year: now.year, cover_url: now.cover_url || p.cover_url } : p;
  }).filter(Roller.inRotation);
  // First pick that was unrated when it was drawn, falling back to the first
  // pick on a day that somehow has none -- the page must still have a lead.
  const drawnUnrated = new Set((daily?.picks || []).filter((p) => p.score == null).map(pickKey));
  const leadAt = Math.max(0, picks.findIndex((p) => drawnUnrated.has(pickKey(p))));
  const lead = picks[leadAt];
  const rest = picks.filter((_, i) => i !== leadAt);

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
          <Lead album={lead} />

          {rest.length > 0 && (
            <div className="margin">
              <p className="margin__label">Also today</p>
              <ol className="margin__list">
                {rest.map((a) => (
                  <Stub key={`${a.artist}::${a.title}`} album={a} />
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

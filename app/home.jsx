// home.jsx — the front page.
//
// A broadsheet, not a dashboard. The app already reads like a set print
// object: heavy display type, mono labels, one red accent on bone and ink.
// The homepage takes that the whole way -- a dateline, a lead story, and four
// columns under it -- because a shelf of 4,400 records deserves a front page
// rather than another grid.
//
// The five come from app/daily.json, written by the nightly job. It ships with
// the app, so there is nothing to fetch from the database and nothing to wait
// for: the page is complete the moment it opens.

function DailyCard({ album, index, onOpen }) {
  const lead = index === 0;
  return (
    <article
      className={"daily" + (lead ? " daily--lead" : "")}
      style={{ animationDelay: `${120 + index * 70}ms` }}
    >
      <button className="daily__hit" onClick={() => onOpen(album)}>
        <span className="daily__no">{String(index + 1).padStart(2, "0")}</span>
        <span className="daily__art">
          <img
            src={album.cover_url}
            alt=""
            width={lead ? 420 : 200}
            height={lead ? 420 : 200}
            loading={lead ? "eager" : "lazy"}
            fetchPriority={lead ? "high" : "auto"}
          />
        </span>
        <span className="daily__text">
          <span className="daily__artist">{album.artist}</span>
          <span className="daily__title">{album.title}</span>
          <span className="daily__meta">
            {album.year || "—"}
            {album.score != null && <b className="daily__score">{album.score}</b>}
          </span>
          {!!album.genres?.length && (
            <span className="daily__genres">{album.genres.join(" · ")}</span>
          )}
        </span>
      </button>
    </article>
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
  const pct = albums.length ? Math.round((rated / albums.length) * 100) : 0;

  // Written out rather than Intl-formatted with a hardcoded locale: the
  // dateline should read in the visitor's own language.
  const dateline = daily?.date
    ? new Intl.DateTimeFormat(undefined, {
        weekday: "long", day: "numeric", month: "long",
      }).format(new Date(daily.date + "T12:00:00"))
    : "";
  const stale = daily?.date && daily.date !== new Date().toISOString().slice(0, 10);

  return (
    <div className="home">
      <header className="masthead">
        <h1 className="masthead__title">
          Today&rsquo;s<br />Five
        </h1>
        <div className="masthead__side">
          <p className="masthead__date">{dateline}</p>
          <p className="masthead__blurb">
            Five records off the shelf, chosen fresh each night. Three you have
            never rated, two you already know.
          </p>
          <p className="masthead__count">
            <b>{albums.length.toLocaleString()}</b> albums ·{" "}
            <b>{rated.toLocaleString()}</b> rated · {pct}%
          </p>
        </div>
      </header>

      {stale && (
        <p className="home__stale" role="status">
          Last refreshed {dateline} — tonight&rsquo;s run will pick five more.
        </p>
      )}

      {failed && (
        <p className="home__empty">
          No picks yet. Run <code>node scripts/daily-picks.mjs</code>, or wait
          for tonight&rsquo;s job.
        </p>
      )}

      {daily?.picks?.length > 0 && (
        <section className="dailies">
          {daily.picks.map((p, i) => (
            <DailyCard key={`${p.artist}::${p.title}`} album={p} index={i}
                       onOpen={(a) => onGo("browse", { q: a.title })} />
          ))}
        </section>
      )}

      <nav className="doors" aria-label="Elsewhere">
        <button className="door" onClick={() => onGo("browse")}>
          <span className="door__k">01</span>
          <span className="door__t">The shelf</span>
          <span className="door__d">
            Every record, searchable, sortable, filterable by genre.
          </span>
        </button>
        <button className="door" onClick={() => onGo("roll")}>
          <span className="door__k">02</span>
          <span className="door__t">Roll</span>
          <span className="door__d">
            One album at a time, drawn at random. Rate it and roll again.
          </span>
        </button>
      </nav>
    </div>
  );
}

window.HomeView = HomeView;

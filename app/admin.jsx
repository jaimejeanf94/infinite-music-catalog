// admin.jsx — the maintenance screen. Owner only.
//
// Everything the pipeline could not decide on its own, in one list. The
// nightly job already applies what can be applied; what reaches this page is
// the residue that needs a person -- a name only you can confirm, a cover two
// albums share that might be correct, a style grown big enough to deserve its
// own filter.
//
// It reads app/health.json, written by the nightly run and shipped with the
// app, so the page needs no query at load. Nothing here edits anything: every
// row links to the album, and the fixing happens on the album's own sheet.

function Section({ section, open, onToggle, onOpenAlbum }) {
  const empty = section.count === 0;
  return (
    <section className={"hs" + (empty ? " hs--clear" : "")}>
      <h2>
        <button
          className="hs__bar"
          onClick={() => !empty && onToggle(section.id)}
          aria-expanded={!empty && open}
          disabled={empty}
        >
          <span className="hs__n">{section.count}</span>
          <span className="hs__t">{section.title}</span>
          <span className="hs__why">{section.why}</span>
          {!empty && <span className="hs__chev" aria-hidden="true">{open ? "−" : "+"}</span>}
        </button>
      </h2>

      {open && !empty && (
        <ul className="hs__list">
          {section.items.map((it, i) => (
            <li key={`${it.artist}::${it.title}::${i}`}>
              {it.title ? (
                <button className="hs__item" onClick={() => onOpenAlbum(it)}>
                  <span className="hs__artist">{it.artist}</span>
                  <span className="hs__title">{it.title}</span>
                  {it.note && <span className="hs__note">{it.note}</span>}
                </button>
              ) : (
                // A row with no title is not an album -- it is a genre.
                <span className="hs__item hs__item--flat">
                  <span className="hs__title">{it.artist}</span>
                  {it.note && <span className="hs__note">{it.note}</span>}
                </span>
              )}
            </li>
          ))}
          {section.count > section.items.length && (
            <li className="hs__more">
              {(section.count - section.items.length).toLocaleString()} more not
              listed — fix these first and the rest will be in tomorrow&rsquo;s run.
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function AdminView({ onGo }) {
  const [health, setHealth] = React.useState(null);
  const [failed, setFailed] = React.useState(false);
  const [open, setOpen] = React.useState(null);

  React.useEffect(() => {
    fetch("./health.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setHealth)
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return (
      <div className="admin">
        <p className="home__empty">
          No report yet — <code>node scripts/health-report.mjs</code>
        </p>
      </div>
    );
  }
  if (!health) return <div className="empty">Reading the report…</div>;

  const t = health.totals;
  const outstanding = health.sections.reduce((n, s) => n + s.count, 0);
  const when = new Intl.DateTimeFormat(undefined, {
    day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  }).format(new Date(health.generated));

  return (
    <div className="admin">
      <header className="admin__head">
        <h1>Maintenance</h1>
        <p className="admin__meta">
          {outstanding.toLocaleString()} open &middot; checked {when}
        </p>
      </header>

      <dl className="admin__totals">
        <div><dt>albums</dt><dd>{t.albums.toLocaleString()}</dd></div>
        <div><dt>rated</dt><dd>{t.rated.toLocaleString()}</dd></div>
        <div><dt>cover</dt><dd>{t.withCover.toLocaleString()}</dd></div>
        <div><dt>genres</dt><dd>{t.withGenres.toLocaleString()}</dd></div>
        <div><dt>matched</dt><dd>{t.matched.toLocaleString()}</dd></div>
      </dl>

      {health.sections.map((s) => (
        <Section
          key={s.id}
          section={s}
          open={open === s.id}
          onToggle={(id) => setOpen(open === id ? null : id)}
          onOpenAlbum={(it) => onGo("browse", { q: it.title || it.artist })}
        />
      ))}
    </div>
  );
}

window.AdminView = AdminView;

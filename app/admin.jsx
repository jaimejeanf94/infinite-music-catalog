// admin.jsx — the maintenance screen. Owner only.
//
// Everything the pipeline could not decide on its own, in one list. The
// nightly job already applies what can be applied; what reaches this page is
// the residue that needs a person -- a name only you can confirm, a cover two
// albums share that might be correct, a year that could be yours or could be
// MusicBrainz matching a reissue.
//
// The list is app/health.json, written by the nightly run and shipped with the
// app, so the page needs no query at load. What it does query is your verdicts
// (db/review_flags.sql): a row you have settled stays settled, which is the
// difference between a list that empties and one that shows you the same
// thirty-one shared sleeves every morning for the rest of your life.
//
// Two verdicts, because "not a problem" and "a problem I cannot fix right now"
// want opposite treatment:
//
//   dismissed — checked, nothing wrong. Hidden, and uncounted.
//   flagged   — something IS wrong. Pinned to the top, and still counted.

const norm = (s) => (s || "").trim().toLowerCase();
const flagKey = (kind, subject) => `${kind}\u0000${subject}`;

// The stable identity of a maintenance item. Most rows are about one album, so
// the album's id is the right key -- renaming it is frequently the fix, and a
// verdict keyed on the artist and title would evaporate the moment you applied
// one. Rows that are NOT about a single album carry their own subject from
// health-report.mjs: a shared sleeve belongs to the image, a held-back rename
// belongs to the suggestion.
const subjectFor = (it, live) =>
  it.subject || (live ? `album:${live.id}` : `name:${norm(it.artist)}::${norm(it.title)}`);

function Row({ item, live, flag, kind, onOpen, onSet, onClear, onApply }) {
  const settled = flag?.state === "dismissed";
  const flagged = flag?.state === "revisit";
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };

  return (
    <li className={"hs__row" + (settled ? " hs__row--settled" : "") +
                              (flagged ? " hs__row--flagged" : "")}>
      {item.title ? (
        <button className="hs__item" onClick={() => onOpen(item, live)}>
          <span className="hs__artist">{item.artist}</span>
          <span className="hs__title">{item.title}</span>
          {item.note && <span className="hs__note">{item.note}</span>}
        </button>
      ) : (
        <span className="hs__item hs__item--flat">
          <span className="hs__title">{item.artist}</span>
          {item.note && <span className="hs__note">{item.note}</span>}
        </span>
      )}

      <span className="hs__acts">
        {flag ? (
          <>
            <span className="hs__state">{settled ? "settled" : "flagged"}</span>
            <button className="hs__act" onClick={stop(onClear)}>Undo</button>
          </>
        ) : (
          <>
            {/* Applying a held-back rename is the ordinary rename, run for
                you -- the same update the album's own sheet performs. */}
            {kind === "rename-review" && item.suggest && live && (
              <button className="hs__act hs__act--go" onClick={stop(onApply)}>
                Apply
              </button>
            )}
            <button className="hs__act" onClick={stop(() => onSet("dismissed"))}
                    title="Checked — nothing wrong here">
              {kind === "rename-review" ? "Reject" : "Fine"}
            </button>
            <button className="hs__act" onClick={stop(() => onSet("revisit"))}
                    title="Something is wrong — keep it in front of me">
              Flag
            </button>
          </>
        )}
      </span>
    </li>
  );
}

function Section({ section, rows, open, onToggle, ...rest }) {
  // A section's count is what is still OPEN. Flagged rows count -- they are
  // unfinished work you chose to keep -- dismissed ones do not.
  const openRows = rows.filter((r) => r.flag?.state !== "dismissed");
  const settledCount = rows.length - openRows.length;
  const empty = openRows.length === 0 && settledCount === 0;
  const clear = openRows.length === 0;

  const shown = [...rows].sort((a, b) => {
    const rank = (r) => (r.flag?.state === "revisit" ? 0 : r.flag ? 2 : 1);
    return rank(a) - rank(b);
  });

  return (
    <section className={"hs" + (clear ? " hs--clear" : "")}>
      <h2>
        <button className="hs__bar" onClick={() => !empty && onToggle(section.id)}
                aria-expanded={!empty && open} disabled={empty}>
          <span className="hs__n">{openRows.length}</span>
          <span className="hs__t">{section.title}</span>
          <span className="hs__why">{section.why}</span>
          {/* One grid cell, not two: .hs__bar is a four-column grid, and a
              fifth child wraps the chevron onto a line of its own. */}
          <span className="hs__end">
            {settledCount > 0 && (
              <span className="hs__settled">{settledCount} settled</span>
            )}
            {!empty && <span className="hs__chev" aria-hidden="true">{open ? "−" : "+"}</span>}
          </span>
        </button>
      </h2>

      {open && !empty && (
        <ul className="hs__list">
          {shown.map((r) => (
            <Row
              key={r.subject}
              {...r}
              kind={section.id}
              onOpen={rest.onOpen}
              onSet={rest.onSet(r)}
              onClear={rest.onClear(r)}
              onApply={rest.onApply(r)}
            />
          ))}
          {section.count > section.items.length && (
            <li className="hs__more">
              {(section.count - section.items.length).toLocaleString()} more not
              listed — settle these and the rest arrive in tomorrow&rsquo;s run.
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function AdminView({ albums, onPatch, onGo }) {
  const [health, setHealth] = React.useState(null);
  const [failed, setFailed] = React.useState(false);
  const [open, setOpen] = React.useState(null);
  const [flags, setFlags] = React.useState(null);   // null until loaded
  const [flagErr, setFlagErr] = React.useState("");

  React.useEffect(() => {
    fetch("./health.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setHealth)
      .catch(() => setFailed(true));
  }, []);

  // A missing review_flags table must not take the page down with it -- the
  // list is still worth reading without your verdicts on it.
  React.useEffect(() => {
    if (!window.db?.reviewFlags) return setFlags(new Map());
    window.db.reviewFlags()
      .then((rows) => setFlags(new Map(rows.map((f) => [flagKey(f.kind, f.subject), f]))))
      .catch((e) => {
        setFlags(new Map());
        setFlagErr(/review_flags/i.test(e?.message || "")
          ? "Verdicts are not saving — run db/review_flags.sql in Supabase."
          : e?.message || "Could not read your verdicts.");
      });
  }, []);

  // artist+title -> the live album, so a row can reach the real id.
  const byName = React.useMemo(() => {
    const m = new Map();
    for (const a of albums || []) m.set(`${norm(a.artist)}::${norm(a.title)}`, a);
    return m;
  }, [albums]);

  if (failed) {
    return (
      <div className="admin">
        <p className="home__empty">
          No report yet — <code>node scripts/health-report.mjs</code>
        </p>
      </div>
    );
  }
  if (!health || !flags) return <div className="empty">Reading the report…</div>;

  const rowsFor = (section) => section.items.map((it) => {
    const live = byName.get(`${norm(it.artist)}::${norm(it.title)}`) || null;
    const subject = subjectFor(it, live);
    return { item: it, live, subject, flag: flags.get(flagKey(section.id, subject)) };
  });

  const write = async (kind, subject, album_id, state) => {
    const key = flagKey(kind, subject);
    const prev = flags.get(key);
    const next = new Map(flags);
    if (state) next.set(key, { kind, subject, album_id, state });
    else next.delete(key);
    setFlags(next);                       // optimistic: the click should land
    try {
      if (state) await window.db.setReviewFlag({ kind, subject, album_id, state });
      else await window.db.clearReviewFlag(kind, subject);
      setFlagErr("");
    } catch (e) {
      const back = new Map(flags);        // put it back exactly as it was
      if (prev) back.set(key, prev); else back.delete(key);
      setFlags(back);
      setFlagErr(e?.message || "That did not save.");
    }
  };

  // Applying a held-back suggestion is just the rename the album's own sheet
  // would do -- same onPatch, same update -- followed by settling the
  // suggestion so tonight's run does not offer it again. The flag is keyed on
  // the suggestion rather than the album precisely so it survives this.
  const applyRename = async (kind, row) => {
    const { live, item, subject } = row;
    if (!live || !item.suggest) return;
    try {
      await onPatch(live.id, { artist: item.suggest.artist, title: item.suggest.title });
      await write(kind, subject, live.id, "dismissed");
    } catch (e) {
      setFlagErr(e?.message || "The rename did not save.");
    }
  };

  const sections = health.sections.map((s) => ({ section: s, rows: rowsFor(s) }));
  const outstanding = sections.reduce(
    (n, { rows }) => n + rows.filter((r) => r.flag?.state !== "dismissed").length, 0);
  const flagged = sections.reduce(
    (n, { rows }) => n + rows.filter((r) => r.flag?.state === "revisit").length, 0);

  const t = health.totals;
  const when = new Intl.DateTimeFormat(undefined, {
    day: "numeric", month: "long", hour: "2-digit", minute: "2-digit",
  }).format(new Date(health.generated));

  return (
    <div className="admin">
      <header className="admin__head">
        <h1>Maintenance</h1>
        <p className="admin__meta">
          {outstanding.toLocaleString()} open
          {flagged > 0 && <> &middot; {flagged} flagged</>}
          {" "}&middot; checked {when}
        </p>
      </header>

      {flagErr && <p className="admin__warn" role="alert">{flagErr}</p>}

      <dl className="admin__totals">
        <div><dt>albums</dt><dd>{t.albums.toLocaleString()}</dd></div>
        <div><dt>rated</dt><dd>{t.rated.toLocaleString()}</dd></div>
        <div><dt>cover</dt><dd>{t.withCover.toLocaleString()}</dd></div>
        <div><dt>genres</dt><dd>{t.withGenres.toLocaleString()}</dd></div>
        <div><dt>matched</dt><dd>{t.matched.toLocaleString()}</dd></div>
      </dl>

      {sections.map(({ section, rows }) => (
        <Section
          key={section.id}
          section={section}
          rows={rows}
          open={open === section.id}
          onToggle={(id) => setOpen(open === id ? null : id)}
          onOpen={(it) => onGo("browse", { q: it.title || it.artist })}
          onSet={(row) => (state) =>
            write(section.id, row.subject, row.live?.id ?? null, state)}
          onClear={(row) => () =>
            write(section.id, row.subject, row.live?.id ?? null, null)}
          onApply={(row) => () => applyRename(section.id, row)}
        />
      ))}
    </div>
  );
}

window.AdminView = AdminView;

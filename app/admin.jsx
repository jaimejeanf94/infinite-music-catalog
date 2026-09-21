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
// (db/migrations/2026-09-20-review-flags.sql): a row you have settled stays settled, which is the
// difference between a list that empties and one that keeps handing you the
// same judgement every morning for the rest of your life.
//
// Two verdicts, because "not a problem" and "a problem I cannot fix right now"
// want opposite treatment:
//
//   dismissed — checked, nothing wrong. Leaves the list, and uncounted.
//   flagged   — something IS wrong. Pinned to the top, still counted, and it
//               keeps every fix the row was offering.
//
// A settled row leaves the list rather than greying out at the bottom of it.
// The verdict is the end of that item, and a page that keeps every ended item
// forever only grows -- burying the open work, which is the one thing this
// page exists to show. The count stays on the section bar and a line at the
// foot of the list brings them back, so Undo is never more than a click away.

const norm = (s) => (s || "").trim().toLowerCase();
const flagKey = (kind, subject) => `${kind}\u0000${subject}`;

// A suggestion spelled out, for the hover on the button that will write it.
const describe = (suggest) =>
  Object.entries(suggest || {}).map(([k, v]) => `${k} → ${v}`).join(", ");

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

  // A row can carry its own fix: health-report.mjs attaches `suggest` (the
  // patch) and `apply` (what the button says it will do). The button names the
  // value rather than the verb -- "Use 2001", not "Apply" -- because the whole
  // point of settling one of these from the list is not having to open the
  // record to find out what you just agreed to.
  const canApply = !!(item.suggest && item.apply && live);

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
        {flag && <span className="hs__state">{settled ? "settled" : "flagged"}</span>}

        {/* The fix outlives the flag. "Keep it in front of me" and "take away
            the button that would end it" are opposite instructions, and the
            row used to do both: flagging collapsed it to a bare Undo, so the
            only route to the fix was undoing your own verdict first. A
            flagged row now keeps its fix; only a settled one puts it away. */}
        {!settled && canApply && (
          <button className="hs__act hs__act--go" onClick={stop(onApply)}
                  title={`Write it: ${describe(item.suggest)}`}>
            {item.apply}
          </button>
        )}

        {flag ? (
          <button className="hs__act" onClick={stop(onClear)}>Undo</button>
        ) : (
          <>
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

function Section({ section, rows, open, onToggle, touched, ...rest }) {
  // A section's count is what is still OPEN. Flagged rows count -- they are
  // unfinished work you chose to keep -- dismissed ones do not.
  const openRows = rows.filter((r) => r.flag?.state !== "dismissed");
  const settledCount = rows.length - openRows.length;
  const empty = openRows.length === 0 && settledCount === 0;
  const clear = openRows.length === 0;

  // Settled rows are out of the list unless you ask for them back. Per section
  // and not persisted: wanting to see what you dismissed is a moment, not a
  // preference, and it should not survive a reload of a page whose job is to
  // show what is open.
  const [showSettled, setShowSettled] = React.useState(false);
  React.useEffect(() => { if (!open) setShowSettled(false); }, [open]);

  // "Not eternally" is about verdicts you reached on some other morning, not
  // the one you just reached. A row settled in THIS session stays where it is,
  // greyed, so the click has a visible result and Undo is where your hand
  // already is. Reload and it is gone with the rest of them.
  const here = (r) => touched.has(flagKey(section.id, r.subject));
  const visible = rows.filter((r) => r.flag?.state !== "dismissed" || here(r));
  const hidden = rows.length - visible.length;

  const shown = [...(showSettled ? rows : visible)].sort((a, b) => {
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
          {(hidden > 0 || showSettled) && (
            <li className="hs__reveal">
              <button className="hs__act" aria-expanded={showSettled}
                      onClick={() => setShowSettled(!showSettled)}>
                {showSettled
                  ? `Hide ${settledCount.toLocaleString()} settled`
                  : `Show ${hidden.toLocaleString()} settled earlier`}
              </button>
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

  // Every item you have given a verdict to since the page loaded. Used only to
  // keep those rows on screen; it is never read back from anywhere, so a
  // reload correctly forgets it.
  const [touched, setTouched] = React.useState(() => new Set());

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
          ? "Verdicts are not saving — run db/migrations/2026-09-20-review-flags.sql in Supabase."
          : e?.message || "Could not read your verdicts.");
      });
  }, []);

  // artist+title -> the live album, so a row can reach the real id. And id ->
  // album, for a row whose album has been renamed away from the name the row
  // was raised against: its flag still remembers which album it was.
  const byName = React.useMemo(() => {
    const m = new Map();
    for (const a of albums || []) m.set(`${norm(a.artist)}::${norm(a.title)}`, a);
    return m;
  }, [albums]);
  const byId = React.useMemo(() => new Map((albums || []).map((a) => [a.id, a])), [albums]);

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

  // Every change to the verdicts is a functional update touching one key. It
  // used to copy the `flags` this render had seen and write the copy back --
  // which, from anything that awaited first (an apply, an undo), replaced the
  // whole map with a stale snapshot, so a verdict clicked while the network
  // was busy vanished from the screen until the next reload.
  const write = async (kind, subject, album_id, state) => {
    const key = flagKey(kind, subject);
    let prev;
    const put = (value) => setFlags((cur) => {
      const next = new Map(cur);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    });
    setFlags((cur) => { prev = cur.get(key); return cur; });
    put(state ? { kind, subject, album_id, state } : null);   // optimistic: the click should land
    setTouched((t) => new Set(t).add(key));
    try {
      if (state) await window.db.setReviewFlag({ kind, subject, album_id, state });
      else await window.db.clearReviewFlag(kind, subject);
      setFlagErr("");
    } catch (e) {
      put(prev || null);                  // put this one back exactly as it was
      setFlagErr(e?.message || "That did not save.");
    }
  };

  // Applying a suggestion is just the edit the album's own sheet would do --
  // same onPatch, same update -- followed by settling the item so tonight's
  // run does not offer it again. The row supplies the patch, so one handler
  // serves every section that carries one: a held-back rename writes artist
  // and title, a year gap writes the year.
  //
  // Settling only on a confirmed write. onPatch moves the local row first and
  // reports whether the database agreed; marking the item done on an optimism
  // that then failed would file the work as finished and lose it.
  const applyFix = async (kind, row) => {
    const { live, item, subject } = row;
    if (!live || !item.suggest) return;
    if (await onPatch(live.id, item.suggest)) {
      await write(kind, subject, live.id, "dismissed");
    }
  };

  // Undo on a row whose fix you applied rewinds the album, not just the
  // verdict: roughly three year gaps in four are MusicBrainz matching a
  // reissue, so the suggestion is often the wrong answer, and once it is
  // written the gap closes and the row is never reported again.
  //
  // Nothing here is remembered by the page. The row carries what the fix
  // overwrote (`was`, from health-report.mjs) and the flag carries which
  // album it was, so Undo works after a reload too -- it used to live in a
  // map a reload threw away, leaving Undo to reopen the item while the new
  // value stayed put. Whether the fix was applied is read off the album
  // itself: if it still holds exactly the suggested value, the fix put it
  // there. A row settled with Fine never touched the album, so its Undo
  // only reopens the item.
  const undo = async (kind, row) => {
    const { item, flag } = row;
    const album = row.live || byId.get(flag?.album_id) || null;
    const holdsFix = !!(album && item.suggest && item.was) &&
      Object.entries(item.suggest).every(([k, v]) => String(album[k] ?? "") === String(v));
    if (holdsFix && !(await onPatch(album.id, item.was))) return;
    await write(kind, row.subject, album?.id ?? null, null);
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
          touched={touched}
          onToggle={(id) => setOpen(open === id ? null : id)}
          onOpen={(it) => onGo("browse", { q: it.title || it.artist })}
          onSet={(row) => (state) =>
            write(section.id, row.subject, row.live?.id ?? null, state)}
          onClear={(row) => () => undo(section.id, row)}
          onApply={(row) => () => applyFix(section.id, row)}
        />
      ))}
    </div>
  );
}

window.AdminView = AdminView;

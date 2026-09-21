-- queries.sql — the questions that do not deserve a screen.
--
-- These used to be sections on the maintenance page. They came off it because
-- every row was either unactionable or a decision that belongs in a commit,
-- not because the question stopped being interesting. Paste one into the
-- Supabase SQL Editor when you actually want the answer.

-- ── albums MusicBrainz has never matched ───────────────────────────────────
-- Was a 146-row section on the Fix page. Nothing here is visibly broken --
-- covers and genres are both complete -- but these rows never refresh, because
-- the nightly enrichment looks them up by mbid. Mostly mixtapes, bootlegs and
-- self-released records that genuinely are not in MusicBrainz.
select artist, title, year
from public.albums
where mbid is null and deleted_at is null
order by artist, title;

-- How many, as one number. This is the figure the maintenance screen shows as
-- `matched` in its totals row.
select count(*) filter (where mbid is not null) as matched,
       count(*) filter (where mbid is null)     as unmatched,
       count(*)                                 as total
from public.albums
where deleted_at is null;

-- ── albums carrying five or more genres ────────────────────────────────────
-- Was the largest section on the page at 283 rows, and every one of them was
-- accurate: Check Your Head really is funk, psych, punk, hip hop and
-- alternative rock. Kept here in case the number ever runs away.
select artist, title, cardinality(genres) as n, genres
from public.albums
where cardinality(genres) >= 5 and deleted_at is null
order by n desc, artist;

-- ── the tags nothing is filed under ────────────────────────────────────────
-- Which raw tags appear most often. Promoting one to a genre is an edit to
-- ROOTS in app/genres.js -- `node scripts/genre-report.mjs` prints the same
-- thing with the roots already resolved, which is more useful.
select tag, count(*) as albums
from public.albums, unnest(genres) as tag
where deleted_at is null
group by tag
order by albums desc
limit 60;

-- ── what you have settled on the maintenance screen ────────────────────────
select f.kind, f.state, count(*)
from public.review_flags f
group by f.kind, f.state
order by f.kind, f.state;

-- Everything you flagged as "something is wrong, but not now".
select f.kind, a.artist, a.title, f.note, f.updated_at
from public.review_flags f
left join public.albums a on a.id = f.album_id
where f.state = 'revisit'
order by f.updated_at desc;

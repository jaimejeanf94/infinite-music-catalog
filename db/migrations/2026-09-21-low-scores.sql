-- 2026-09-21-low-scores.sql — scores below 70, and "Not recommended".
--
-- Paste into the Supabase SQL Editor and Run. Safe to run more than once.
--
-- The scale gains 50, 55, 60 and 65, and "Not recommended" for anything
-- below 50 -- stored as 45, one step under 50, because 0 would read as "no
-- score" to code that tests a score for truth. Anything under 70 is rated
-- and kept but out of every roll: app/roller.js holds that rule, and the
-- Roll screen, the front page's five and daily-picks.mjs all use it.
--
-- The old rule was written inline in schema.sql, so Postgres named it; this
-- finds every check on albums that mentions score rather than trusting the
-- name, then adds the new one under a name of its own.

do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.albums'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%score%'
  loop
    execute format('alter table public.albums drop constraint %I', c);
  end loop;
end $$;

alter table public.albums add constraint albums_score_check
  check (score in (45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100));

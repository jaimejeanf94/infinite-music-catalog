-- 2026-09-20-drop-plays.sql — remove the plays table.
--
-- Nothing ever read it. "Log a play" wrote a row, no screen displayed one,
-- and it held 0 rows when it was removed. A score already records that you
-- heard an album, and scored_at says when, so the table only ever earned its
-- place for re-listens of things already rated -- which is not what this
-- collection is for yet.
--
-- If that changes, bring it back from git history: it was four columns and
-- two indexes.

drop table if exists public.plays;

-- Expect albums and rolls only.
select tablename from pg_tables
where schemaname = 'public'
order by tablename;

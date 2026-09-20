-- drop_pool.sql — remove the in_pool column.
--
-- It came from the spreadsheet's RSP column and meant "the randomiser never
-- serves this album". 99 albums were excluded by it, including rated ones,
-- for reasons that were no longer visible anywhere in the app: the filter
-- chip and the roll-screen button had both been removed, leaving a silent
-- effect on every roll and one button on the detail sheet.
--
-- The roller now draws from the whole collection. To stop seeing an album,
-- delete it -- which is a tombstone, and undoable from the Deleted filter.

alter table public.albums drop column if exists in_pool;

-- Expect the column to be gone.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'albums'
order by ordinal_position;

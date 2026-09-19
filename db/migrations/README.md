# Migrations

`db/schema.sql` created the database. It is not the place to change it.

It uses `create table if not exists`, so once the tables exist, re-running it
does nothing — edit a column into that file and Postgres will skip the entire
block. You would see "Success" and no new column.

So: **schema.sql is history. Changes live here.**

## Adding something

One file per change, named by date, run once in the SQL editor:

```sql
-- db/migrations/2026-10-04-listened-count.sql
alter table public.albums
  add column if not exists listened_count int not null default 0;
```

`if not exists` makes it safe to run twice, which matters because nothing here
tracks what has already run — you do, by reading the folder.

## The order that keeps the site working

1. Run the migration. The app has not changed, and its queries name columns
   explicitly, so it neither sees nor cares about the new one.
2. Add the column to the `select` in `app/supabase-client.js`.
3. Use it in the interface.
4. Add it to `COLUMNS` in `scripts/export.mjs` so it reaches the CSV backup.

Never the reverse. Code that reads a column the database does not have fails
for everyone; a column nothing reads yet is invisible.

## Changing or removing

Adding is free. These are not:

- **Renaming** breaks every query naming the old column, instantly and for
  everyone. Add the new one, move the data, change the app, drop the old one
  later.
- **Dropping** destroys the data. Take a backup first: `node scripts/export.mjs`
  writes the CSV and git keeps it.
- **Adding `not null` without a default** fails outright if any row exists.
  Give it a default, or add it nullable and fill it in.

## Keeping the schema file honest

`schema.sql` should still describe a database you could build from scratch, so
when you add a migration, add the column to `schema.sql` too. It stops being a
thing you run and becomes the documentation of what exists.

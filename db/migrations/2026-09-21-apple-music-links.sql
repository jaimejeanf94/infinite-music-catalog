-- 2026-09-21-apple-music-links.sql — an exact Apple Music link per album.
--
-- Paste into the Supabase SQL Editor and Run. Safe to run more than once.
--
-- The listen buttons used to open a search, and a search page is not something
-- the Apple Music app promises to open -- so on a phone a tap landed in the web
-- player. An album page is: music.apple.com is a verified app link on Android.
-- So each album gets the link to itself, found nightly by
-- scripts/apple-music-links.mjs, and the button falls back to a search only
-- where no link is known.
--
-- apple_music_locked works like cover_locked: set when you paste or clear a
-- link by hand, and the nightly run never touches a locked row. Clearing locks
-- too -- the likeliest reason to clear a link is that the run matched the
-- wrong record, and it would only match it again.

alter table public.albums add column if not exists apple_music_url text;
alter table public.albums add column if not exists apple_music_locked boolean not null default false;

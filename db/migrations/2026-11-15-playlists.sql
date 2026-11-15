-- playlists, playlist_tracks — a mirror of one Apple Music playlist, so the
-- Playlist screen can draw a song from it.
--
-- Paste into the Supabase SQL Editor and Run. Safe to run more than once.
-- Then run db/public_hardening.sql again (node scripts/fill-sql.mjs writes it
-- out with your user id): this file gives the new tables the original
-- schema's open rules, and that one narrows the writes to you.
--
-- Unlike albums, Postgres is NOT the source of truth here. The playlist lives
-- in the Music app; scripts/sync-playlist.mjs rewrites these rows from it
-- every night, as the last step of scripts/playlist-backup.sh. Nothing in the
-- app writes to either table, and an edit made here is gone by morning.

-- One row per mirrored playlist. A table rather than a constant in the app,
-- because the three things the screen needs beside the songs -- what the
-- playlist is called, when it was last read, and the link that opens it --
-- all belong to the playlist and change without a deploy.
create table if not exists public.playlists (
  -- The Music app's persistent ID for the playlist, e.g. 394006C178D52AD2.
  -- Not the name: renaming a playlist must not orphan its rows, which is the
  -- same reason playlist-backup.sh finds it by this id.
  id          text primary key,
  name        text not null,
  -- The share link (music.apple.com/.../playlist/.../pl.u-...). Set by hand,
  -- once; the Music app does not expose it, so the sync never touches it.
  url         text,
  track_count int  not null default 0,
  synced_at   timestamptz not null default now()
);

create table if not exists public.playlist_tracks (
  playlist_id text not null references public.playlists(id) on delete cascade,
  -- 1-based, in the playlist's own order. Part of the key because nothing
  -- else is unique: the same song can be in a playlist twice, and is.
  position    int  not null check (position > 0),
  -- The track's persistent ID in the Music library. Kept so two syncs can be
  -- compared song by song; repeats wherever the playlist does.
  track_id    text not null,
  title       text not null,
  artist      text not null default '',
  album       text not null default '',
  duration_s  int,
  -- Leading with playlist_id, so this also serves the foreign key and the one
  -- query the app makes: every track of a playlist, in order.
  primary key (playlist_id, position)
);

-- Same starting rules as the rest of the schema: anyone may read, a signed-in
-- account may write. public_hardening.sql then names the one account.
alter table public.playlists       enable row level security;
alter table public.playlist_tracks enable row level security;

drop policy if exists playlists_read        on public.playlists;
drop policy if exists playlists_write       on public.playlists;
drop policy if exists playlist_tracks_read  on public.playlist_tracks;
drop policy if exists playlist_tracks_write on public.playlist_tracks;

create policy playlists_read on public.playlists
  for select to anon, authenticated using (true);
create policy playlists_write on public.playlists
  for all to authenticated using (true) with check (true);

create policy playlist_tracks_read on public.playlist_tracks
  for select to anon, authenticated using (true);
create policy playlist_tracks_write on public.playlist_tracks
  for all to authenticated using (true) with check (true);

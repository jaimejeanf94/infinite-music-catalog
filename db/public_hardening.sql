-- public_hardening.sql
-- Run this AFTER schema.sql, and before making the GitHub repo public.
-- Safe to run more than once.
--
-- ── Why this file exists ────────────────────────────────────────────────────
-- A public repo publishes app/config.js, which holds your project URL and
-- publishable key. That is fine in itself: those two values are designed to
-- sit in browser code, and anyone who opens the deployed site already has
-- them. What it does change is who might bother to look. A stranger can send
-- requests straight at your database instead of going through the app, so the
-- rules below are the only thing standing in the way.
--
-- schema.sql allows any SIGNED-IN user to write, which is safe only because
-- sign-ups are switched off in the dashboard. That is one checkbox between
-- your collection and anyone who wants to edit it. This file removes that
-- dependency by naming exactly one user id that may write.

-- ── Step 1 — paste your user id ─────────────────────────────────────────────
-- Supabase dashboard -> Authentication -> Users -> the UID column.
-- It looks like: 8c8e5aeb-af65-4fef-ae01-84ef12592237
do $$
declare
  owner_text text := 'PASTE_YOUR_USER_UID_HERE';
  owner_id   uuid;
  t          text;
begin
  if owner_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception
      'Replace PASTE_YOUR_USER_UID_HERE with your user id from Authentication -> Users, then run this again.';
  end if;
  owner_id := owner_text::uuid;

  -- Writes: one specific person, not "anyone holding an account".
  foreach t in array array['albums', 'rolls', 'plays'] loop
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format(
      -- (select auth.uid()) rather than auth.uid(): wrapped in a subquery
      -- Postgres evaluates it once and caches it, instead of calling it for
      -- every row the policy examines. Supabase documents 100x on large
      -- tables, and every read of albums passes through a policy.
      'create policy %I on public.%I for all to authenticated '
      || 'using ((select auth.uid()) = %L) with check ((select auth.uid()) = %L)',
      t || '_write', t, owner_id, owner_id);
  end loop;

  -- Reads: the catalogue stays public, but a deleted album is not part of it.
  -- The app hides them, but hiding is not a rule -- anyone could ask the API
  -- directly. Signed in, you still see them, which is what makes Restore work.
  execute format('drop policy if exists %I on public.albums', 'albums_read');
  execute format(
    'create policy %I on public.albums for select to anon, authenticated '
    || 'using (deleted_at is null or (select auth.uid()) = %L)',
    'albums_read', owner_id);

  -- Listening history is the one genuinely personal thing in the database.
  foreach t in array array['rolls', 'plays'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select auth.uid()) = %L)',
      t || '_read', t, owner_id);
  end loop;
end $$;

-- ── Step 2 — confirm it took ────────────────────────────────────────────────
-- Run these two and read the output; do not assume.

-- Every table must say `true`. A false here means the rules are decorative:
-- policies on a table without RLS enabled do nothing at all.
select relname as table_name, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace
  and relname in ('albums', 'rolls', 'plays')
order by relname;

-- Expect exactly five policies. `albums_read` should be the only one open to
-- the `anon` role, and every write policy's condition should name your uid.
select tablename, policyname, cmd, roles, qual::text as condition
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

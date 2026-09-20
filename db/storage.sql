-- storage.sql — lock the cover bucket down the same way the tables are locked.
--
-- Run this AFTER creating the bucket in the dashboard:
--   Storage -> New bucket -> name "covers", Public ON
--
-- Public ON makes reads free and keyless, which is what you want for album
-- art: it is served from the CDN with no round trip through the API. It does
-- NOT make writes public -- that is what the policies below are for.
--
-- Replace PASTE_YOUR_UID_HERE with your user's id, from
--   select id, email from auth.users;
-- Left as-is this script fails rather than quietly granting nothing.

-- Anyone may look at a cover.
drop policy if exists "covers are readable by anyone" on storage.objects;
create policy "covers are readable by anyone"
  on storage.objects for select
  to public
  using (bucket_id = 'covers');

-- Only you may add, replace or remove one. auth.uid() is wrapped in a
-- subselect so Postgres evaluates it once per query instead of once per row.
drop policy if exists "only the owner writes covers" on storage.objects;
create policy "only the owner writes covers"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'covers'
    and (select auth.uid()) = 'PASTE_YOUR_UID_HERE'::uuid
  );

drop policy if exists "only the owner replaces covers" on storage.objects;
create policy "only the owner replaces covers"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'covers'
    and (select auth.uid()) = 'PASTE_YOUR_UID_HERE'::uuid
  );

drop policy if exists "only the owner deletes covers" on storage.objects;
create policy "only the owner deletes covers"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'covers'
    and (select auth.uid()) = 'PASTE_YOUR_UID_HERE'::uuid
  );

-- Check it took. Expect exactly the four policies above.
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;

-- ================================================================
-- Easy Floor Plan — Migrate the designs table from Supabase Auth
-- to Clerk (third-party auth). Run ONCE in Supabase SQL Editor.
-- ================================================================
-- Background: Clerk user ids are text like "user_2abc..." (not UUIDs),
-- and Supabase reads the Clerk id from the JWT via auth.jwt()->>'sub'.
-- This converts user_id to text and rewrites the RLS policies.
--
-- IMPORTANT: do your data migration AFTER this runs (see notes at bottom).

-- 1. Drop the old RLS policies (they used auth.uid())
drop policy if exists "Users can view own designs"   on public.designs;
drop policy if exists "Users can insert own designs" on public.designs;
drop policy if exists "Users can update own designs" on public.designs;
drop policy if exists "Users can delete own designs" on public.designs;

-- 2. Drop the foreign key to auth.users (Clerk users don't live there)
alter table public.designs drop constraint if exists designs_user_id_fkey;

-- 3. Convert user_id from uuid to text and default it to the Clerk id
alter table public.designs alter column user_id drop default;
alter table public.designs alter column user_id type text using user_id::text;
alter table public.designs alter column user_id set default (auth.jwt()->>'sub');

-- 4. New RLS policies keyed to the Clerk id (the JWT 'sub' claim)
create policy "Users can view own designs"
  on public.designs for select to authenticated
  using ((select auth.jwt()->>'sub') = user_id);

create policy "Users can insert own designs"
  on public.designs for insert to authenticated
  with check ((select auth.jwt()->>'sub') = user_id);

create policy "Users can update own designs"
  on public.designs for update to authenticated
  using ((select auth.jwt()->>'sub') = user_id);

create policy "Users can delete own designs"
  on public.designs for delete to authenticated
  using ((select auth.jwt()->>'sub') = user_id);

-- ================================================================
-- DATA MIGRATION (your existing designs)
-- ----------------------------------------------------------------
-- Existing rows still have your OLD Supabase Auth UUID in user_id,
-- so they won't show up under your new Clerk id until you remap them.
--
-- Option A (recommended, no SQL): before switching, use the app's
--   Export (⬇️) on each design to download .json files. After switching
--   to Clerk and signing in, use Import (⬆️) + Save to re-create them
--   under your Clerk id.
--
-- Option B (bulk remap): sign into the Clerk-powered app once, find your
--   Clerk user id (Clerk Dashboard → Users, looks like user_2abc...),
--   then run — replacing both values:
--
--   update public.designs
--   set user_id = 'user_2YOURCLERKID'
--   where user_id = 'your-old-supabase-uuid';
--
-- To list the old ids still present:
--   select distinct user_id from public.designs;
-- ================================================================

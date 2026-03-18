-- ================================================
-- Easy Floor Plan — Supabase Database Setup
-- ================================================
-- Run this in your Supabase SQL Editor:
--   Dashboard → SQL Editor → New Query → paste → Run

-- 1. Create the designs table
create table if not exists public.designs (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null default 'Untitled Layout',
  grid_w numeric not null default 19,
  grid_h numeric not null default 60,
  shape_count integer not null default 0,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- 2. Index for fast lookups by user
create index if not exists designs_user_id_idx on public.designs(user_id);
create index if not exists designs_updated_at_idx on public.designs(updated_at desc);

-- 3. Enable Row Level Security
alter table public.designs enable row level security;

-- 4. RLS policies — users can only access their own designs
create policy "Users can view own designs"
  on public.designs for select
  using (auth.uid() = user_id);

create policy "Users can insert own designs"
  on public.designs for insert
  with check (auth.uid() = user_id);

create policy "Users can update own designs"
  on public.designs for update
  using (auth.uid() = user_id);

create policy "Users can delete own designs"
  on public.designs for delete
  using (auth.uid() = user_id);

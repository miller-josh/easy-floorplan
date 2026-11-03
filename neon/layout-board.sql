-- ================================================================
-- Layout Board schema for Neon (plain Postgres).
-- Run once in the Neon SQL Editor, or: npm run board:migrate
-- ----------------------------------------------------------------
-- Differences from the handoff schema (layout-board-handoff/db/schema.sql):
--   * Users are Clerk ids (text like "user_2abc..."), not uuids.
--   * No auth.uid() and no row level security. Neon has no PostgREST layer;
--     every request goes through api/board.js, which verifies the
--     Clerk token and enforces roles. The browser never talks to the DB.
--   * Functions take the user id as a parameter.
--   * Display names are stored so History can say "saved by Shannon".
--   * Invite tokens are hex (url safe).
-- ================================================================

create extension if not exists pgcrypto;

create table if not exists lb_floor_plans (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  base         jsonb not null,            -- plan-base.json (static + items), inches
  created_by   text not null,             -- Clerk user id
  created_at   timestamptz not null default now()
);

create table if not exists lb_plan_members (
  plan_id       uuid not null references lb_floor_plans(id) on delete cascade,
  user_id       text not null,
  role          text not null check (role in ('owner','editor','viewer')),
  display_name  text,
  added_at      timestamptz not null default now(),
  primary key (plan_id, user_id)
);
create index if not exists lb_plan_members_user_idx on lb_plan_members(user_id);

create table if not exists lb_plan_invites (
  token       text primary key default encode(gen_random_bytes(18),'hex'),
  plan_id     uuid not null references lb_floor_plans(id) on delete cascade,
  role        text not null check (role in ('editor','viewer')),
  created_by  text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  used_by     text,
  used_at     timestamptz
);

-- The shared layout everyone sees. rev is the optimistic-concurrency counter.
create table if not exists lb_layouts (
  plan_id          uuid primary key references lb_floor_plans(id) on delete cascade,
  rev              integer not null default 1,
  state            jsonb not null default '{"t":{},"dups":[]}',
  updated_by       text,
  updated_by_name  text,
  updated_at       timestamptz not null default now()
);

create table if not exists lb_layout_revisions (
  id             bigint generated always as identity primary key,
  plan_id        uuid not null references lb_floor_plans(id) on delete cascade,
  rev            integer not null,
  state          jsonb not null,
  note           text,
  saved_by       text not null,
  saved_by_name  text,
  saved_at       timestamptz not null default now(),
  unique (plan_id, rev)
);

-- Save with a conflict check. Returns the new rev, or raises 'conflict' if someone saved first.
create or replace function lb_save_layout(p_user text, p_name text, p_plan uuid, p_expected_rev int, p_state jsonb, p_note text default null)
returns integer language plpgsql as $$
declare new_rev int;
begin
  if not exists (select 1 from lb_plan_members where plan_id = p_plan and user_id = p_user and role in ('owner','editor')) then
    raise exception 'not_writer';
  end if;
  update lb_layouts set rev = rev + 1, state = p_state, updated_by = p_user, updated_by_name = p_name, updated_at = now()
   where plan_id = p_plan and rev = p_expected_rev
   returning rev into new_rev;
  if new_rev is null then raise exception 'conflict'; end if;
  insert into lb_layout_revisions(plan_id, rev, state, note, saved_by, saved_by_name)
    values (p_plan, new_rev, p_state, p_note, p_user, p_name);
  return new_rev;
end $$;

-- Accept an invite. Single use; never downgrades an owner.
create or replace function lb_accept_invite(p_user text, p_name text, p_token text)
returns uuid language plpgsql as $$
declare inv lb_plan_invites;
begin
  select * into inv from lb_plan_invites where token = p_token and used_at is null and expires_at > now() for update;
  if inv.token is null then raise exception 'invalid_invite'; end if;
  insert into lb_plan_members(plan_id, user_id, role, display_name) values (inv.plan_id, p_user, inv.role, p_name)
    on conflict (plan_id, user_id) do update
      set role = case when lb_plan_members.role = 'owner' then 'owner' else excluded.role end,
          display_name = coalesce(excluded.display_name, lb_plan_members.display_name);
  update lb_plan_invites set used_by = p_user, used_at = now() where token = p_token;
  return inv.plan_id;
end $$;

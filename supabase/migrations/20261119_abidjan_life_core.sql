-- Abidjan Life: tables required by server/server.js
-- Apply once in the Supabase SQL Editor. Never expose service_role keys in the client.
create extension if not exists pgcrypto;

create table if not exists public.game_accounts (
  phone text primary key,
  email text not null,
  password_hash text not null,
  security jsonb not null default '{}'::jsonb,
  profile jsonb not null default '{}'::jsonb,
  position jsonb not null default '{"x":0,"z":0,"yaw":0}'::jsonb,
  needs jsonb,
  save jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- E-mail is a reusable recovery contact; phone is the unique account identifier.
create index if not exists game_accounts_email_lower_idx on public.game_accounts (lower(email));

create table if not exists public.creator_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  player_name text,
  player_phone text,
  kind text,
  message text,
  version text,
  district text,
  status text not null default 'nouveau'
);

create table if not exists public.afgamer_inbox (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  player_name text,
  player_phone text,
  category text,
  subject text,
  message text,
  status text not null default 'nouveau',
  reply_text text,
  replied_at timestamptz
);

alter table public.game_accounts enable row level security;
alter table public.creator_reports enable row level security;
alter table public.afgamer_inbox enable row level security;
-- No anon/authenticated policies are intentionally created. Server uses service_role only.

create or replace function public.delete_game_account_data(p_phone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.creator_reports where player_phone = p_phone;
  delete from public.afgamer_inbox where player_phone = p_phone;
  delete from public.game_accounts where phone = p_phone;
end;
$$;
revoke all on function public.delete_game_account_data(text) from public, anon, authenticated;
grant execute on function public.delete_game_account_data(text) to service_role;

grant select, insert, update, delete on public.game_accounts to service_role;
grant select, insert, update, delete on public.creator_reports to service_role;
grant select, insert, update, delete on public.afgamer_inbox to service_role;

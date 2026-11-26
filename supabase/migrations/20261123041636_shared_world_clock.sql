-- Persist the shared simulation clock and weather between server restarts.
create table if not exists public.shared_world_state (
  id smallint primary key default 1 check (id = 1),
  payload jsonb not null default '{"hour":8,"minute":0,"weather":"ensoleille","temperature":31}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.shared_world_state enable row level security;
revoke all on table public.shared_world_state from anon, authenticated;
grant select, insert, update, delete on table public.shared_world_state to service_role;
insert into public.shared_world_state (id)
values (1)
on conflict (id) do nothing;

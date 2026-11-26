-- Shared world properties and player-built structures.
-- Server-only writes use the Supabase service_role key; no client policies are exposed.
create table if not exists public.shared_world_assets (
  owner_phone text not null,
  asset_id text not null,
  asset_type text not null check (asset_type in ('plot','house','company')),
  commune text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_phone, asset_id)
);
create index if not exists shared_world_assets_type_idx
  on public.shared_world_assets (asset_type);
alter table public.shared_world_assets enable row level security;
revoke all on table public.shared_world_assets from anon, authenticated;
grant select, insert, update, delete on table public.shared_world_assets to service_role;

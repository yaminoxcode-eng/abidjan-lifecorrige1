-- Shared rental offers for completed player-owned houses.
create table if not exists public.shared_rental_offers (
  id text primary key,
  owner_phone text not null,
  asset_id text not null,
  property_name text not null,
  rent_weekly integer not null check (rent_weekly >= 1000 and rent_weekly <= 50000000),
  deposit integer not null default 0 check (deposit >= 0 and deposit <= 200000000),
  commune text not null default '',
  active boolean not null default true,
  applicant_phones jsonb not null default '[]'::jsonb,
  tenant_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shared_rental_offers_active_created_idx
  on public.shared_rental_offers (active, created_at desc);
create index if not exists shared_rental_offers_owner_idx
  on public.shared_rental_offers (owner_phone);
alter table public.shared_rental_offers enable row level security;
revoke all on table public.shared_rental_offers from anon, authenticated;
grant select, insert, update, delete on table public.shared_rental_offers to service_role;

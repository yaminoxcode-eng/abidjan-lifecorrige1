-- Persistent player-to-player job and rental offers.
-- All writes are performed by the game server with the Supabase service_role key.
create table if not exists public.shared_job_offers (
  id text primary key,
  owner_phone text not null,
  company_id text not null,
  company_name text not null default '',
  role text not null,
  salary bigint not null check (salary between 1000 and 50000000),
  qualification text not null default 'aucun',
  commune text not null default '',
  active boolean not null default true,
  applicant_phones text[] not null default '{}'::text[],
  hired_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shared_job_offers_active_created_idx
  on public.shared_job_offers (active, created_at desc);
create index if not exists shared_job_offers_owner_idx
  on public.shared_job_offers (owner_phone);

create table if not exists public.shared_rental_offers (
  id text primary key,
  owner_phone text not null,
  asset_id text not null,
  property_name text not null default '',
  rent_weekly bigint not null check (rent_weekly between 1000 and 50000000),
  deposit bigint not null default 0 check (deposit between 0 and 200000000),
  commune text not null default '',
  active boolean not null default true,
  applicant_phones text[] not null default '{}'::text[],
  tenant_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shared_rental_offers_active_created_idx
  on public.shared_rental_offers (active, created_at desc);
create index if not exists shared_rental_offers_owner_idx
  on public.shared_rental_offers (owner_phone);

alter table public.shared_job_offers enable row level security;
alter table public.shared_rental_offers enable row level security;
revoke all on table public.shared_job_offers from anon, authenticated;
revoke all on table public.shared_rental_offers from anon, authenticated;
grant select, insert, update, delete on table public.shared_job_offers to service_role;
grant select, insert, update, delete on table public.shared_rental_offers to service_role;

-- Shared job offers between player-owned companies.
create table if not exists public.shared_job_offers (
  id text primary key,
  owner_phone text not null,
  company_id text not null,
  company_name text not null,
  role text not null,
  salary integer not null check (salary >= 1000 and salary <= 50000000),
  qualification text not null default 'aucun',
  commune text not null default '',
  active boolean not null default true,
  applicant_phones jsonb not null default '[]'::jsonb,
  hired_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shared_job_offers_active_created_idx
  on public.shared_job_offers (active, created_at desc);
create index if not exists shared_job_offers_owner_idx
  on public.shared_job_offers (owner_phone);
alter table public.shared_job_offers enable row level security;
revoke all on table public.shared_job_offers from anon, authenticated;
grant select, insert, update, delete on table public.shared_job_offers to service_role;

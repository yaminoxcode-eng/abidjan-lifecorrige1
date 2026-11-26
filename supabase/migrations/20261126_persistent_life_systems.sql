-- Abidjan Life: durable event ledger, game bills, services and device ownership.
-- All writes are performed by the authenticated game backend using its server-only service role.
-- No public/anon/authenticated policies are granted.

create table if not exists public.player_action_events (
  id uuid primary key default gen_random_uuid(),
  player_phone text not null references public.game_accounts(phone) on delete cascade,
  event_key text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (player_phone, event_key)
);
create index if not exists player_action_events_player_created_idx
  on public.player_action_events (player_phone, created_at desc);

create table if not exists public.player_services (
  player_phone text not null references public.game_accounts(phone) on delete cascade,
  service_key text not null,
  status text not null default 'inactive' check (status in ('active','inactive','suspended')),
  activated_game_day integer,
  expires_game_day integer,
  last_code_game_month integer,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (player_phone, service_key)
);

create table if not exists public.player_invoices (
  id uuid primary key default gen_random_uuid(),
  player_phone text not null references public.game_accounts(phone) on delete cascade,
  provider text not null,
  invoice_type text not null,
  amount_fcfa integer not null check (amount_fcfa >= 0),
  billing_game_day integer not null,
  due_game_day integer not null,
  status text not null default 'pending' check (status in ('pending','paid','overdue','cancelled')),
  paid_at timestamptz,
  payment_method text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (player_phone, provider, invoice_type, billing_game_day)
);
create index if not exists player_invoices_player_status_idx
  on public.player_invoices (player_phone, status, due_game_day);

create table if not exists public.player_devices (
  player_phone text not null references public.game_accounts(phone) on delete cascade,
  device_id text not null,
  device_type text not null,
  owned boolean not null default true,
  equipped boolean not null default false,
  appearance jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (player_phone, device_id)
);

alter table public.player_action_events enable row level security;
alter table public.player_services enable row level security;
alter table public.player_invoices enable row level security;
alter table public.player_devices enable row level security;

grant select, insert, update, delete on public.player_action_events to service_role;
grant select, insert, update, delete on public.player_services to service_role;
grant select, insert, update, delete on public.player_invoices to service_role;
grant select, insert, update, delete on public.player_devices to service_role;

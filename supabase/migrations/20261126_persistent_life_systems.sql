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

-- Atomic in-game Wave settlement: locks both rows so an invoice cannot be charged twice.
create or replace function public.pay_player_invoice(p_player_phone text, p_invoice_id uuid)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_save jsonb;
  v_invoice public.player_invoices%rowtype;
  v_balance numeric;
  v_amount integer;
  v_now timestamptz := now();
  v_tx jsonb;
  v_msg jsonb;
  v_contacts jsonb;
  v_messages jsonb;
begin
  select save into v_save from public.game_accounts where phone = p_player_phone for update;
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  select * into v_invoice from public.player_invoices
    where id = p_invoice_id and player_phone = p_player_phone for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if v_invoice.status = 'paid' then raise exception 'INVOICE_ALREADY_PAID'; end if;
  v_save := coalesce(v_save, '{}'::jsonb);
  v_balance := greatest(0, coalesce((v_save->>'waveBalance')::numeric, 0));
  v_amount := greatest(0, v_invoice.amount_fcfa);
  if v_balance < v_amount then raise exception 'INSUFFICIENT_WAVE_BALANCE'; end if;
  v_tx := jsonb_build_object('type','facture','provider',v_invoice.provider,'label',v_invoice.invoice_type,
    'amount',-v_amount,'method','Wave','at',v_now);
  v_msg := jsonb_build_object('id','bill-'||v_invoice.id::text,'contactId','wave','from','contact',
    'text','Ta facture '||v_invoice.invoice_type||' a été réglée depuis Wave ('||v_amount||' FCFA).',
    'time',to_char(v_now at time zone 'UTC','HH24:MI'));
  v_contacts := case when jsonb_typeof(v_save->'contacts')='array' then v_save->'contacts' else '[]'::jsonb end;
  if not exists (select 1 from jsonb_array_elements(v_contacts) c where c->>'id'='wave') then
    v_contacts := v_contacts || jsonb_build_array(jsonb_build_object('id','wave','name','Wave ABJ','phone',''));
  end if;
  v_messages := case when jsonb_typeof(v_save->'messages')='array' then v_save->'messages' else '[]'::jsonb end;
  v_save := jsonb_set(v_save, '{waveBalance}', to_jsonb(v_balance-v_amount), true);
  v_save := jsonb_set(v_save, '{bankTransactions}',
    (case when jsonb_typeof(v_save->'bankTransactions')='array' then v_save->'bankTransactions' else '[]'::jsonb end) || v_tx, true);
  v_save := jsonb_set(v_save, '{contacts}', v_contacts, true);
  v_save := jsonb_set(v_save, '{messages}', v_messages || v_msg, true);
  update public.game_accounts set save=v_save, updated_at=v_now where phone=p_player_phone;
  update public.player_invoices set status='paid', paid_at=v_now, payment_method='wave' where id=p_invoice_id;
  return jsonb_build_object('ok',true,'save',v_save,'waveBalance',v_balance-v_amount,'paidAt',v_now);
end;
$$;
revoke all on function public.pay_player_invoice(text,uuid) from public, anon, authenticated;
grant execute on function public.pay_player_invoice(text,uuid) to service_role;

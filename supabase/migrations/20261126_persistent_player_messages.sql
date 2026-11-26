-- Durable private messages. Access is restricted to the game backend service role.
create table if not exists public.player_messages (
  id uuid primary key default gen_random_uuid(),
  sender_phone text not null references public.game_accounts(phone) on delete cascade,
  recipient_phone text not null references public.game_accounts(phone) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  check (sender_phone <> recipient_phone)
);
create index if not exists player_messages_sender_created_idx
  on public.player_messages (sender_phone, created_at desc);
create index if not exists player_messages_recipient_created_idx
  on public.player_messages (recipient_phone, created_at desc);
alter table public.player_messages enable row level security;
revoke all on table public.player_messages from public, anon, authenticated;
grant select, insert, update, delete on table public.player_messages to service_role;

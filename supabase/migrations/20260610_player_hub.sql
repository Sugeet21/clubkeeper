-- ============================================================
-- Player Hub Phase 1: clubs registry + topup intents
-- ============================================================

-- 1. Clubs table — one row per owner (mirrors a subset of ClubSettings to cloud)
create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  slug text not null unique,
  club_name text not null,
  upi_id text,
  accepts_topups boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index clubs_owner_id_idx on public.clubs(owner_id);
create index clubs_slug_idx on public.clubs(slug);

-- Slug format constraint: lowercase, alphanumeric + hyphens, 3-40 chars, no leading/trailing hyphen
alter table public.clubs add constraint clubs_slug_format
  check (slug ~ '^[a-z0-9]([a-z0-9-]{1,38}[a-z0-9])?$');

-- 2. Topup intents table — public form submissions awaiting owner confirmation
create table public.topup_intents (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  player_name text,                   -- nullable, can be anonymous
  player_mobile text not null,        -- 10 digits Indian, no country code
  amount integer not null,            -- whole rupees, 100-10000
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'rejected', 'expired')),
  reject_reason text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id)
);

create index topup_intents_club_status_idx on public.topup_intents(club_id, status, created_at desc);

-- Amount and mobile constraints
alter table public.topup_intents add constraint topup_intents_amount_range
  check (amount >= 100 and amount <= 10000);
alter table public.topup_intents add constraint topup_intents_mobile_format
  check (player_mobile ~ '^[6-9][0-9]{9}$');

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.clubs enable row level security;
alter table public.topup_intents enable row level security;

-- Owner sees only own club row
create policy clubs_owner_select on public.clubs
  for select using (auth.uid() = owner_id);
create policy clubs_owner_insert on public.clubs
  for insert with check (auth.uid() = owner_id);
create policy clubs_owner_update on public.clubs
  for update using (auth.uid() = owner_id);

-- Owner sees only own club's intents; insert/update from anon goes through RPC only
create policy topup_intents_owner_select on public.topup_intents
  for select using (
    exists (select 1 from public.clubs c where c.id = club_id and c.owner_id = auth.uid())
  );
create policy topup_intents_owner_update on public.topup_intents
  for update using (
    exists (select 1 from public.clubs c where c.id = club_id and c.owner_id = auth.uid())
  );

-- ============================================================
-- RPC functions (SECURITY DEFINER so anon can call them safely)
-- ============================================================

-- Public read: only the safe columns needed by the scan page
create or replace function public.get_club_public_info(p_slug text)
returns table (club_name text, upi_id text, accepts_topups boolean)
language sql
security definer
set search_path = public
as $$
  select club_name, upi_id, accepts_topups
  from public.clubs
  where slug = p_slug;
$$;

grant execute on function public.get_club_public_info(text) to anon, authenticated;

-- Public insert: submit a topup intent, returns the new id
create or replace function public.submit_topup_intent(
  p_slug text,
  p_player_name text,
  p_player_mobile text,
  p_amount integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
  v_intent_id uuid;
  v_accepts boolean;
begin
  -- Look up club
  select id, accepts_topups into v_club_id, v_accepts
  from public.clubs where slug = p_slug;

  if v_club_id is null then
    raise exception 'club_not_found';
  end if;
  if not v_accepts then
    raise exception 'topups_disabled';
  end if;

  -- Rate limit: max 3 pending intents per mobile per club in last 10 minutes
  if (
    select count(*) from public.topup_intents
    where club_id = v_club_id
      and player_mobile = p_player_mobile
      and status = 'pending'
      and created_at > now() - interval '10 minutes'
  ) >= 3 then
    raise exception 'rate_limited';
  end if;

  insert into public.topup_intents (club_id, player_name, player_mobile, amount)
  values (v_club_id, nullif(trim(p_player_name), ''), p_player_mobile, p_amount)
  returning id into v_intent_id;

  return v_intent_id;
end;
$$;

grant execute on function public.submit_topup_intent(text, text, text, integer) to anon, authenticated;

-- Public status check: lets player poll their own intent (only their row, by id)
create or replace function public.get_topup_intent_status(p_intent_id uuid)
returns table (status text, reject_reason text)
language sql
security definer
set search_path = public
as $$
  select status, reject_reason
  from public.topup_intents
  where id = p_intent_id;
$$;

grant execute on function public.get_topup_intent_status(uuid) to anon, authenticated;

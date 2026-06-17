-- ⚠ RUN MANUALLY in Supabase SQL editor. Not auto-applied.
-- Phase 1 (issue #84): Player advance booking.
--
-- Architecture: Hybrid. booking_intents is a transient Supabase "postbox"
-- (<=24h). Player INSERTs via security-definer RPC, owner SELECTs + UPDATEs
-- via RLS. Confirmed-or-later rows are mirrored into owner's Dexie bookings
-- store (v17) and then become irrelevant in Supabase — LAZY CLEANUP deletes
-- expired non-pending rows on every submit. No cron, no Pro plan needed.
--
-- Paste into Supabase Dashboard → SQL Editor → New query → Run.

-- ============================================================
-- 1. Extend clubs row with booking opt-in + advance config
-- ============================================================

alter table public.clubs
  add column if not exists accepts_bookings boolean default false,
  add column if not exists booking_advance_amount int default 100;

alter table public.clubs
  drop constraint if exists clubs_booking_advance_range;
alter table public.clubs
  add constraint clubs_booking_advance_range
  check (booking_advance_amount >= 0 and booking_advance_amount <= 10000);

-- ============================================================
-- 2. booking_intents table — short-lived (<=24h) postbox
-- ============================================================

create table if not exists public.booking_intents (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  table_id int not null,                   -- mirrors owner Dexie GameTable.id
  table_name text not null,
  game_type text not null,
  player_name text,
  player_phone text not null,              -- 10-digit Indian
  slot_start timestamptz not null,
  duration_min int not null,
  slot_end timestamptz not null,
  tier_price int not null,
  advance_amount int not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'rejected', 'expired')),
  notes text,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create index if not exists booking_intents_club_status_idx
  on public.booking_intents(club_id, status, created_at desc);
create index if not exists booking_intents_slot_idx
  on public.booking_intents(club_id, slot_start);

alter table public.booking_intents
  drop constraint if exists booking_intents_phone_format;
alter table public.booking_intents
  add constraint booking_intents_phone_format
  check (player_phone ~ '^[6-9][0-9]{9}$');

alter table public.booking_intents
  drop constraint if exists booking_intents_duration_range;
alter table public.booking_intents
  add constraint booking_intents_duration_range
  check (duration_min >= 15 and duration_min <= 720);

alter table public.booking_intents
  drop constraint if exists booking_intents_amounts_range;
alter table public.booking_intents
  add constraint booking_intents_amounts_range
  check (tier_price >= 0 and tier_price <= 99999
     and advance_amount >= 0 and advance_amount <= 99999);

-- ============================================================
-- 3. Row Level Security — mirror topup_intents exactly
-- ============================================================

alter table public.booking_intents enable row level security;

drop policy if exists booking_intents_owner_select on public.booking_intents;
create policy booking_intents_owner_select on public.booking_intents
  for select using (
    exists (select 1 from public.clubs c where c.id = club_id and c.owner_id = auth.uid())
  );

drop policy if exists booking_intents_owner_update on public.booking_intents;
create policy booking_intents_owner_update on public.booking_intents
  for update using (
    exists (select 1 from public.clubs c where c.id = club_id and c.owner_id = auth.uid())
  );

-- ============================================================
-- 4. Extend get_club_public_info to expose booking opt-in + advance
--    (drop+recreate — CREATE OR REPLACE cannot change OUT params)
-- ============================================================

drop function if exists public.get_club_public_info(text);

create or replace function public.get_club_public_info(p_slug text)
returns table (
  club_name text,
  upi_id text,
  accepts_topups boolean,
  coins_enabled boolean,
  coin_tiers_json jsonb,
  tables_json jsonb,
  accepts_pricing_display boolean,
  accepts_bookings boolean,
  booking_advance_amount int
)
language sql
security definer
set search_path = public
as $$
  select
    club_name,
    upi_id,
    accepts_topups,
    coins_enabled,
    coin_tiers_json,
    tables_json,
    accepts_pricing_display,
    accepts_bookings,
    booking_advance_amount
  from public.clubs
  where slug = p_slug;
$$;

grant execute on function public.get_club_public_info(text) to anon, authenticated;

-- ============================================================
-- 5. submit_booking_intent — anon submits via security definer
--    Includes LAZY CLEANUP of expired non-pending rows.
-- ============================================================

create or replace function public.submit_booking_intent(
  p_slug text,
  p_table_id int,
  p_table_name text,
  p_game_type text,
  p_player_name text,
  p_player_phone text,
  p_slot_start timestamptz,
  p_duration_min int,
  p_tier_price int,
  p_advance_amount int,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
  v_accepts_bookings boolean;
  v_intent_id uuid;
  v_slot_end timestamptz;
begin
  -- Lazy cleanup: trim non-pending rows older than 24h before any new insert.
  -- Keeps table tiny on free tier; no cron required.
  delete from public.booking_intents
   where created_at < now() - interval '24 hours'
     and status <> 'pending';

  -- Resolve club + opt-in
  select id, accepts_bookings into v_club_id, v_accepts_bookings
    from public.clubs where slug = p_slug;

  if v_club_id is null then
    raise exception 'club_not_found';
  end if;
  if not v_accepts_bookings then
    raise exception 'bookings_disabled';
  end if;

  -- Slot must be in the future
  if p_slot_start <= now() then
    raise exception 'slot_in_past';
  end if;

  v_slot_end := p_slot_start + make_interval(mins => p_duration_min);

  -- Conflict check: any confirmed-or-pending intent overlapping [start, end)
  -- on the same table blocks the new submission. Player sees 'slot_taken'.
  if exists (
    select 1 from public.booking_intents
     where club_id = v_club_id
       and table_id = p_table_id
       and status in ('pending', 'confirmed')
       and slot_start < v_slot_end
       and slot_end   > p_slot_start
  ) then
    raise exception 'slot_taken';
  end if;

  -- Rate limit: max 3 pending intents per phone per club in last 10 min
  if (
    select count(*) from public.booking_intents
     where club_id = v_club_id
       and player_phone = p_player_phone
       and status = 'pending'
       and created_at > now() - interval '10 minutes'
  ) >= 3 then
    raise exception 'rate_limited';
  end if;

  insert into public.booking_intents (
    club_id, table_id, table_name, game_type,
    player_name, player_phone,
    slot_start, duration_min, slot_end,
    tier_price, advance_amount, notes
  ) values (
    v_club_id, p_table_id, p_table_name, p_game_type,
    nullif(trim(p_player_name), ''), p_player_phone,
    p_slot_start, p_duration_min, v_slot_end,
    p_tier_price, p_advance_amount, nullif(trim(p_notes), '')
  ) returning id into v_intent_id;

  return v_intent_id;
end;
$$;

grant execute on function public.submit_booking_intent(
  text, int, text, text, text, text, timestamptz, int, int, int, text
) to anon, authenticated;

-- ============================================================
-- 6. get_booking_intent_status — player polls their own row by id
-- ============================================================

create or replace function public.get_booking_intent_status(p_intent_id uuid)
returns table (status text, confirmed_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select status, confirmed_at
  from public.booking_intents
  where id = p_intent_id;
$$;

grant execute on function public.get_booking_intent_status(uuid) to anon, authenticated;

-- ============================================================
-- 7. Realtime publication + REPLICA IDENTITY FULL (Pattern S6)
--    Needed so the owner-side BookingRealtimeBridge can receive
--    INSERT/UPDATE events and read payload.old.status on UPDATE.
-- ============================================================

alter publication supabase_realtime add table public.booking_intents;
alter table public.booking_intents replica identity full;

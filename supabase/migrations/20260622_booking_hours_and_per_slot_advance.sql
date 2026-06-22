-- ⚠ RUN MANUALLY in Supabase SQL editor. Not auto-applied.
-- Issue #106: per-club operating hours + per-30-min-slot advance.
--
-- Two linked changes:
--   A. New columns booking_open_minutes / booking_close_minutes on clubs.
--      Until both are set, the player BookingScreen renders a "not configured"
--      state. Accept-bookings toggle in the owner UI is also gated on these.
--   B. booking_advance_amount stays (legacy per-booking flat ₹). New column
--      booking_advance_per_slot replaces its semantic — final advance =
--      ceil(duration / 30) * booking_advance_per_slot. submit_booking_intent
--      RECOMPUTES this server-side and rejects mismatch ('advance_mismatch')
--      so a stale/forged client value cannot underpay.
--
-- Server-side outside_hours check is NON-OVERNIGHT ONLY for v1
-- (booking_close_minutes <= 1440). Overnight (close > 1440) is allowed in
-- config + client UI, but the server skips the bounds check for those clubs
-- — the client filters time options. See ripple_effects.md "Advance Booking".

-- ============================================================
-- 1. Extend clubs row
-- ============================================================

alter table public.clubs
  add column if not exists booking_open_minutes  int,
  add column if not exists booking_close_minutes int,
  add column if not exists booking_advance_per_slot int default 50;

alter table public.clubs
  drop constraint if exists clubs_booking_advance_per_slot_range;
alter table public.clubs
  add constraint clubs_booking_advance_per_slot_range
  check (booking_advance_per_slot >= 0 and booking_advance_per_slot <= 2000);

alter table public.clubs
  drop constraint if exists booking_hours_valid;
alter table public.clubs
  add constraint booking_hours_valid
  check (
    (booking_open_minutes is null and booking_close_minutes is null)
    or (
      booking_open_minutes  between 0 and 1439
      and booking_close_minutes between 1 and 2880
      and booking_close_minutes > booking_open_minutes
    )
  );

-- ============================================================
-- 2. get_club_public_info — drop+recreate with the 3 new OUT params
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
  booking_advance_amount int,
  booking_open_minutes int,
  booking_close_minutes int,
  booking_advance_per_slot int
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
    booking_advance_amount,
    booking_open_minutes,
    booking_close_minutes,
    booking_advance_per_slot
  from public.clubs
  where slug = p_slug;
$$;

grant execute on function public.get_club_public_info(text) to anon, authenticated;

-- ============================================================
-- 3. submit_booking_intent — drop+recreate with server-side per-slot
--    recompute + non-overnight outside_hours check.
--    Parameter list is unchanged (same 11 params as 20260617) so callers
--    keep working; the semantic of p_advance_amount is now "must match
--    server-computed slot_count * booking_advance_per_slot".
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
  v_open_min int;
  v_close_min int;
  v_per_slot int;
  v_slot_count int;
  v_computed_advance int;
  v_slot_local_min int;
  v_intent_id uuid;
  v_slot_end timestamptz;
begin
  -- Lazy cleanup (unchanged)
  delete from public.booking_intents
   where created_at < now() - interval '24 hours'
     and status <> 'pending';

  select id, accepts_bookings, booking_open_minutes, booking_close_minutes,
         coalesce(booking_advance_per_slot, 50)
    into v_club_id, v_accepts_bookings, v_open_min, v_close_min, v_per_slot
    from public.clubs where slug = p_slug;

  if v_club_id is null then
    raise exception 'club_not_found';
  end if;
  if not v_accepts_bookings then
    raise exception 'bookings_disabled';
  end if;

  -- Hours must be configured before any booking can land
  if v_open_min is null or v_close_min is null then
    raise exception 'hours_not_set';
  end if;

  if p_slot_start <= now() then
    raise exception 'slot_in_past';
  end if;

  v_slot_end := p_slot_start + make_interval(mins => p_duration_min);

  -- Per-slot advance recompute. Client must match exactly.
  v_slot_count := ceil(p_duration_min::numeric / 30);
  v_computed_advance := v_slot_count * v_per_slot;
  if p_advance_amount <> v_computed_advance then
    raise exception 'advance_mismatch';
  end if;

  -- Non-overnight outside_hours check.
  -- Overnight (close > 1440) is allowed in config but server-side bounds
  -- check is skipped — client filters time options. Server-side conflict
  -- + slot_in_past + per-slot recompute remain the safety nets.
  if v_close_min <= 1440 then
    v_slot_local_min :=
      extract(hour   from p_slot_start at time zone 'Asia/Kolkata')::int * 60
    + extract(minute from p_slot_start at time zone 'Asia/Kolkata')::int;
    if v_slot_local_min < v_open_min or v_slot_local_min > (v_close_min - 30) then
      raise exception 'outside_hours';
    end if;
  end if;

  -- Conflict check (unchanged)
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

  -- Rate limit (unchanged)
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
    p_tier_price, v_computed_advance, nullif(trim(p_notes), '')
  ) returning id into v_intent_id;

  return v_intent_id;
end;
$$;

grant execute on function public.submit_booking_intent(
  text, int, text, text, text, text, timestamptz, int, int, int, text
) to anon, authenticated;

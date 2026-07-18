-- ⚠ RUN MANUALLY in Supabase SQL editor. Not auto-applied.
-- ⚠ ORDERING: run 20260708_booking_table_id_uuid.sql FIRST (this file
--   recreates submit_booking_intent / get_booked_slots with the text-typed
--   p_table_id signatures from #127; running it against the old int
--   signatures would create ambiguous overloads). A guard below aborts if
--   the #127 migration hasn't been applied.
--
-- Issue #147 (D-Booking-2): pending booking intent = soft hold with 10-min
-- flat expiry + confirm-time re-validation.
--   1. Guard: require #127 applied.
--   2. submit_booking_intent: lazy-expire stale pendings (>10 min) for the
--      club, ignore them in the conflict check, and FIX the lazy-cleanup
--      predicate — confirmed rows with FUTURE slots must keep blocking
--      (the old predicate deleted them 24h after creation, opening a
--      double-book window for bookings made >24h ahead).
--   3. get_booked_slots: expose per-slot status ('pending'|'confirmed') so
--      the player picker can render "request pending — pick another slot";
--      stale pendings (>10 min) no longer block. Timing+status only — the
--      #90 privacy posture holds (no phone/name/amount).
--   4. get_booking_intent_status: lazily flip the polled row to 'expired'
--      when it is a stale pending, so the player's existing expired screen
--      fires server-side, not only on the client timer.
--   5. NEW confirm_booking_intent(p_intent_id): server-side guarded confirm.
--      Re-validates status + 10-min hold + slot overlap at confirm time.
--      Typed failures: not_found / intent_expired / slot_taken. Idempotent
--      on an already-confirmed row (returns the original confirmed_at).
--      SECURITY INVOKER — auth rides the existing booking_intents RLS.
--
-- Paste into Supabase Dashboard → SQL Editor → New query → Run.

-- ============================================================
-- 1. Guard — abort unless #127's text-typed functions are live
-- ============================================================

do $$
begin
  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'submit_booking_intent'
       and pg_get_function_identity_arguments(p.oid) like '%p_table_id integer%'
  ) then
    raise exception 'Run 20260708_booking_table_id_uuid.sql first (#127) — submit_booking_intent still has the int-typed p_table_id.';
  end if;
end
$$;

-- ============================================================
-- 2. submit_booking_intent — 10-min pending expiry + cleanup fix
--    (same signature as 20260708 → CREATE OR REPLACE, no drop)
-- ============================================================

create or replace function public.submit_booking_intent(
  p_slug text,
  p_table_id text,
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
  -- Lazy cleanup (FIXED for #147): the old predicate deleted any non-pending
  -- row 24h after CREATION, so a confirmed booking made >24h before its slot
  -- stopped blocking get_booked_slots + the conflict check — a silent
  -- double-book window. Rows now survive until their slot has passed too.
  delete from public.booking_intents
   where status <> 'pending'
     and created_at < now() - interval '24 hours'
     and slot_end < now();

  -- Resolve club + opt-in
  select id, accepts_bookings into v_club_id, v_accepts_bookings
    from public.clubs where slug = p_slug;

  if v_club_id is null then
    raise exception 'club_not_found';
  end if;
  if not v_accepts_bookings then
    raise exception 'bookings_disabled';
  end if;

  -- D-Booking-2: lazily expire this club's stale pending holds (>10 min
  -- unpaid/unreviewed) so they free their slots for the conflict check below.
  update public.booking_intents
     set status = 'expired'
   where club_id = v_club_id
     and status = 'pending'
     and created_at < now() - interval '10 minutes';

  -- Slot must be in the future
  if p_slot_start <= now() then
    raise exception 'slot_in_past';
  end if;

  v_slot_end := p_slot_start + make_interval(mins => p_duration_min);

  -- Conflict check: confirmed rows and LIVE pending holds (<10 min) block.
  -- Stale pendings were just expired above; the age filter is defence in
  -- depth for rows in other transaction windows.
  if exists (
    select 1 from public.booking_intents
     where club_id = v_club_id
       and table_id = p_table_id
       and (status = 'confirmed'
            or (status = 'pending' and created_at > now() - interval '10 minutes'))
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
  text, text, text, text, text, text, timestamptz, int, int, int, text
) to anon, authenticated;

-- ============================================================
-- 3. get_booked_slots — expose per-slot status; live holds only
--    (return type changes → drop + recreate)
-- ============================================================

drop function if exists public.get_booked_slots(text, text, timestamptz, timestamptz);

create or replace function public.get_booked_slots(
  p_slug text,
  p_table_id text,
  p_day_start timestamptz,
  p_day_end timestamptz
)
returns table (
  slot_start timestamptz,
  slot_end timestamptz,
  status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
begin
  -- Resolve club by slug. Silent-empty on unknown slug (do not leak existence).
  select id into v_club_id from public.clubs where slug = p_slug;
  if v_club_id is null then
    return;
  end if;

  -- Day-window guard: cap the range to 8 days to prevent abuse.
  if p_day_end - p_day_start > interval '8 days' then
    raise exception 'window_too_large';
  end if;

  -- #90 privacy posture: timing + status ONLY. Read-only — no lazy expiry
  -- UPDATE here (this RPC fires on every picker load; the expiry flip
  -- happens in submit / status-poll / confirm instead). Stale pendings are
  -- filtered out by age so they stop blocking even before any flip runs.
  return query
  select bi.slot_start, bi.slot_end, bi.status
  from public.booking_intents bi
  where bi.club_id = v_club_id
    and bi.table_id = p_table_id
    and (bi.status = 'confirmed'
         or (bi.status = 'pending' and bi.created_at > now() - interval '10 minutes'))
    and bi.slot_start < p_day_end
    and bi.slot_end > p_day_start;
end;
$$;

grant execute on function public.get_booked_slots(text, text, timestamptz, timestamptz) to anon;
grant execute on function public.get_booked_slots(text, text, timestamptz, timestamptz) to authenticated;

-- ============================================================
-- 4. get_booking_intent_status — lazy-expire the polled row
--    (same signature + return type → CREATE OR REPLACE)
-- ============================================================

create or replace function public.get_booking_intent_status(p_intent_id uuid)
returns table (status text, confirmed_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- D-Booking-2: a stale pending flips to expired the moment its own player
  -- polls it — the player's existing 'Booking request expired' screen fires
  -- from server truth, not only the client-side 10-min timer.
  update public.booking_intents bi
     set status = 'expired'
   where bi.id = p_intent_id
     and bi.status = 'pending'
     and bi.created_at < now() - interval '10 minutes';

  return query
  select bi.status, bi.confirmed_at
  from public.booking_intents bi
  where bi.id = p_intent_id;
end;
$$;

grant execute on function public.get_booking_intent_status(uuid) to anon, authenticated;

-- ============================================================
-- 5. confirm_booking_intent — server-side guarded confirm (#147)
-- ============================================================

create or replace function public.confirm_booking_intent(p_intent_id uuid)
returns timestamptz
language plpgsql
-- SECURITY INVOKER (default, deliberate): authorization rides the existing
-- booking_intents RLS policies (owner select/update, 20260617) exactly like
-- the legacy client-side UPDATE did. Non-owners simply see zero rows →
-- not_found. Do NOT flip to security definer.
set search_path = public
as $$
declare
  v_row public.booking_intents%rowtype;
  v_confirmed_at timestamptz := now();
begin
  select * into v_row
    from public.booking_intents
   where id = p_intent_id
   for update;

  if not found then
    raise exception 'not_found';
  end if;

  -- Idempotent re-tap (mirrors the client's old ConstraintError swallow):
  -- already confirmed → return the original server timestamp.
  if v_row.status = 'confirmed' then
    return v_row.confirmed_at;
  end if;

  -- D-Booking-2: the 10-min hold lapsed before review — flip and fail typed.
  if v_row.status = 'pending'
     and v_row.created_at <= now() - interval '10 minutes' then
    update public.booking_intents
       set status = 'expired'
     where id = p_intent_id;
    raise exception 'intent_expired';
  end if;

  -- rejected / expired / cancelled: cannot be confirmed.
  if v_row.status <> 'pending' then
    raise exception 'intent_expired';
  end if;

  -- Re-validate the slot at confirm time: another confirmed row or live
  -- pending hold overlapping this window means the slot was rebooked while
  -- this intent sat unpaid/unreviewed. NEVER double-book (owner mandate).
  -- Assumption: confirms are serial (one owner modal). Only the target row
  -- is FOR-UPDATE-locked; two truly concurrent confirms of two DIFFERENT
  -- overlapping intents could interleave past this check. submit prevents
  -- overlapping live pendings, so that pair can't normally exist — if
  -- multi-staff concurrent confirm ever ships, add a slot-level lock here.
  if exists (
    select 1 from public.booking_intents bi
     where bi.club_id = v_row.club_id
       and bi.table_id = v_row.table_id
       and bi.id <> v_row.id
       and (bi.status = 'confirmed'
            or (bi.status = 'pending' and bi.created_at > now() - interval '10 minutes'))
       and bi.slot_start < v_row.slot_end
       and bi.slot_end > v_row.slot_start
  ) then
    raise exception 'slot_taken';
  end if;

  update public.booking_intents
     set status = 'confirmed', confirmed_at = v_confirmed_at
   where id = p_intent_id;

  return v_confirmed_at;
end;
$$;

-- Owner/staff action — authenticated only, never anon.
grant execute on function public.confirm_booking_intent(uuid) to authenticated;

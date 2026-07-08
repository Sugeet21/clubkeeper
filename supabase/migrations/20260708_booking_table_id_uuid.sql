-- ⚠ RUN MANUALLY in Supabase SQL editor. Not auto-applied.
-- Issue #127 (P1): Player booking flow broken post-v20.
--
-- Post-v20 (24 Jun, ee40cda) all owner Dexie ids — including GameTable.id that
-- gets mirrored into clubs.tables_json — are UUID **strings**, not integers.
-- The booking RPCs still declared p_table_id as `int`, so probing get_booked_slots
-- with a real UUID raised `22P02 invalid input syntax for type integer`, and
-- booking_intents.table_id (int) could not store a UUID at all.
--
-- This migration retypes the table-id everywhere on the Supabase side to `text`:
--   1. booking_intents.table_id  int -> text   (existing rows cast losslessly)
--   2. submit_booking_intent.p_table_id  int -> text
--   3. get_booked_slots.p_table_id  int -> text
--
-- The TS side already treats the id as an opaque string (#127 code fix); this
-- makes the server agree. No behaviour change for clubs whose tables_json still
-- carries legacy numeric ids — those cast to numeric-strings and still match.
--
-- Paste into Supabase Dashboard → SQL Editor → New query → Run.

-- ============================================================
-- 1. Retype the column. `using ::text` converts any legacy
--    numeric rows to their string form losslessly.
-- ============================================================

alter table public.booking_intents
  alter column table_id type text using table_id::text;

-- ============================================================
-- 2. submit_booking_intent — p_table_id int -> text.
--    CREATE OR REPLACE cannot change an argument type, so drop
--    the old-signature function first, then recreate. Body is
--    unchanged except the param type; table_id comparisons are
--    plain equality so text-vs-text works identically.
-- ============================================================

drop function if exists public.submit_booking_intent(
  text, int, text, text, text, text, timestamptz, int, int, int, text
);

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
  -- Lazy cleanup: trim non-pending rows older than 24h before any new insert.
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
  text, text, text, text, text, text, timestamptz, int, int, int, text
) to anon, authenticated;

-- ============================================================
-- 3. get_booked_slots — p_table_id int -> text. Same drop+recreate.
-- ============================================================

drop function if exists public.get_booked_slots(text, int, timestamptz, timestamptz);

create or replace function public.get_booked_slots(
  p_slug text,
  p_table_id text,
  p_day_start timestamptz,
  p_day_end timestamptz
)
returns table (
  slot_start timestamptz,
  slot_end timestamptz
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

  return query
  select bi.slot_start, bi.slot_end
  from public.booking_intents bi
  where bi.club_id = v_club_id
    and bi.table_id = p_table_id
    and bi.status in ('pending', 'confirmed')
    and bi.slot_start < p_day_end
    and bi.slot_end > p_day_start;
end;
$$;

grant execute on function public.get_booked_slots(text, text, timestamptz, timestamptz) to anon;
grant execute on function public.get_booked_slots(text, text, timestamptz, timestamptz) to authenticated;

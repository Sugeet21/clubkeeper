-- ⚠ RUN MANUALLY in Supabase SQL editor. Not auto-applied.
-- Issue #90: Player booking time picker shows already-booked slots as clickable.
--
-- Adds get_booked_slots() — anon-readable, returns the time windows already
-- taken on a given (club, table, day) so /c/<slug>/book can grey them out
-- BEFORE the player taps and gets bounced by slot_taken.
--
-- Only returns pending + confirmed intents. Rejected / expired rows are not
-- blocking. Consumed bookings live in owner-side Dexie (not in booking_intents
-- anymore — owner's lazy cleanup may have deleted them), so we also include
-- any confirmed-or-later row that hasn't been cleaned yet. The owner-side
-- Dexie row IS the long-term truth, but for FUTURE slots the Supabase row
-- still exists (cleanup deletes only rows older than 24h from now()).
--
-- Paste into Supabase Dashboard → SQL Editor → New query → Run.

create or replace function public.get_booked_slots(
  p_slug text,
  p_table_id int,
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

  -- Day-window guard: cap the range to 7 days to prevent abuse.
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

grant execute on function public.get_booked_slots(text, int, timestamptz, timestamptz) to anon;
grant execute on function public.get_booked_slots(text, int, timestamptz, timestamptz) to authenticated;

-- ⚠ RUN MANUALLY in Supabase SQL editor. Not auto-applied.
-- Phase 1 P1e-2 (issue #84): Player cancellation of a confirmed booking.
--
-- Hybrid model: this RPC ONLY flips the Supabase row to status='cancelled'.
-- The owner-side reconciliation (Dexie row update + advance refund as wallet
-- credit) happens client-side in BookingRealtimeBridge's UPDATE handler. No
-- Vercel function needed (mirrors confirm/reject).
--
-- Auth: anon-callable. Authorization is by phone-match — caller must supply
-- the same player_phone that was used at booking submission. No JWT involved
-- (player has no Supabase auth).
--
-- Policy guard (matches Pattern P2 cancellation window from skill):
--   - status must currently be 'confirmed' (rejected/expired/cancelled noop)
--   - now() < slot_start - interval '2 hours' (else 'too_late')
--
-- Paste into Supabase Dashboard → SQL Editor → New query → Run.
--
-- CHECK constraint update: 20260617 only allowed pending/confirmed/rejected/
-- expired. Without this, the UPDATE below would raise check_violation at
-- runtime. Applied to prod 18 Jun 2026.

alter table public.booking_intents
  drop constraint if exists booking_intents_status_check;

alter table public.booking_intents
  add constraint booking_intents_status_check
  check (status in ('pending', 'confirmed', 'rejected', 'expired', 'cancelled'));

create or replace function public.cancel_booking_intent(
  p_intent_id uuid,
  p_player_phone text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_phone text;
  v_slot_start timestamptz;
begin
  select status, player_phone, slot_start
    into v_status, v_phone, v_slot_start
    from public.booking_intents
   where id = p_intent_id;

  if v_status is null then
    raise exception 'not_found';
  end if;
  if v_phone <> p_player_phone then
    -- Phone mismatch — likely someone guessed an intent id. Don't leak which
    -- failed; surface as not_found.
    raise exception 'not_found';
  end if;
  if v_status <> 'confirmed' then
    -- Pending bookings can be rejected by the owner — players don't cancel
    -- those. Already-cancelled/expired noop.
    raise exception 'invalid_status';
  end if;
  if now() >= v_slot_start - interval '2 hours' then
    raise exception 'too_late';
  end if;

  update public.booking_intents
     set status = 'cancelled'
   where id = p_intent_id;
end;
$$;

grant execute on function public.cancel_booking_intent(uuid, text) to anon, authenticated;

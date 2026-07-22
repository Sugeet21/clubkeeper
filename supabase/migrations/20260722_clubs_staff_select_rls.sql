-- Staff read of the club row (#170) — fixes "UPI QR never shows on staff device".
--
-- The payment QR (SessionDetail post-stop, QuickSale, WalletTopup) needs
-- settings.upiId. On a fresh/staff device that value is hydrated by
-- getOwnerClub() (useSyncClubFromSupabase → useLiveData.ts) reading clubs.upi_id.
-- But the only SELECT policy on clubs was owner-only:
--     clubs_owner_select: USING (auth.uid() = owner_id)
-- A staff auth.uid() != owner_id, so getOwnerClub().maybeSingle() returned NULL,
-- upiId never hydrated, and the QR fell back to the "Add your UPI ID" placeholder.
--
-- Fix: add a staff-readable SELECT policy scoped by the JWT club claim, the same
-- idiom as every other staff read policy (canteen_items_select_own_club etc.):
--     id::text = auth.jwt() ->> 'user_club_id'
-- The owner keeps clubs_owner_select. No user ever sees >1 club row (the owner's
-- owner_id row IS their user_club_id club), so getOwnerClub()'s .maybeSingle()
-- stays safe — it never trips the "multiple rows" error.
--
-- Read-only for staff: this is SELECT only. clubs INSERT/UPDATE stay owner-only
-- (clubs_owner_insert / clubs_owner_update untouched), so a staff user can read
-- the UPI id / booking config but cannot mutate the club row.

drop policy if exists clubs_staff_select on public.clubs;
create policy clubs_staff_select on public.clubs
  for select
  using (id::text = auth.jwt() ->> 'user_club_id');

-- ════════════════════════════════════════════════════════════════════════════
-- Post-run verification (fresh staff JWT only — Rule M):
--   1. Probe pg_policies: clubs has clubs_staff_select SELECT on user_club_id.
--   2. Staff sign-in on a fresh device → open a session, stop with a UPI portion
--      → the UPI QR renders (no "Add your UPI ID" fallback).
--   3. Owner regression: owner still reads exactly one club row; QR unaffected.
-- ════════════════════════════════════════════════════════════════════════════

-- Revert staff restock (#169) — restore stock_purchases INSERT/UPDATE to
-- OWNER-ONLY. Reverses 20260720_staff_restock_rls.
--
-- Context: staff was silently adjusting canteen stock (owner report, Ball
-- Bended / Naresh). All three 20 Jul staff-commerce grants on the canteen
-- (edit / delete / restock) are being pulled back. Edit + Delete are UI-gated
-- in Canteen.tsx (#169) — their canteen_items UPDATE RLS MUST stay open to
-- staff because the in-session stock-decrement path (#131) depends on it, so
-- those are UI-only gates. Restock is the ONE that has a dedicated staff RLS
-- branch, so it gets a real DB block here: staff INSERT/UPDATE on
-- stock_purchases → 42501.
--
-- Pattern S26: constrain on the wire contract, club-scoped. This simply drops
-- the ('owner','staff') branch back to ('owner'). Owner restock unaffected.
-- Bulk-peak pricing was never staff-allowed and is untouched.

drop policy if exists stock_purchases_insert_own_club on public.stock_purchases;
create policy stock_purchases_insert_own_club on public.stock_purchases
  for insert
  with check (
    club_id::text = auth.jwt() ->> 'user_club_id'
    and (auth.jwt() ->> 'user_role') = 'owner'
  );

drop policy if exists stock_purchases_update_own_club on public.stock_purchases;
create policy stock_purchases_update_own_club on public.stock_purchases
  for update
  using (club_id::text = auth.jwt() ->> 'user_club_id')
  with check (
    club_id::text = auth.jwt() ->> 'user_club_id'
    and (auth.jwt() ->> 'user_role') = 'owner'
  );

-- ════════════════════════════════════════════════════════════════════════════
-- Post-run verification (fresh staff JWT only — Rule M):
--   1. Probe pg_policies: both stock_purchases INSERT + UPDATE with_check now
--      reference user_role = 'owner' only (no 'staff').
--   2. Staff sign-in → Restock button is GONE from every canteen card (UI gate).
--   3. Owner regression: owner restock still works, drains outbox to 0.
--   4. Edit/Delete buttons also gone for staff (Canteen.tsx UI gate, #169).
-- ════════════════════════════════════════════════════════════════════════════

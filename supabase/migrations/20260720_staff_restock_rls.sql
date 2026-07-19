-- Staff restock (owner-approved 20 Jul) — open stock_purchases INSERT to staff.
--
-- Restock writes two synced tables via recordStockPurchase →
-- syncedBatch(['stock_purchases','canteen_items']):
--   1. stock_purchases INSERT  — was OWNER-ONLY → staff 42501 → outbox
--      dead-letters. This migration adds the staff branch.
--   2. canteen_items UPDATE (currentStock += qty, deleted_at NULL) — ALREADY
--      allowed for staff (D6 #131 canteen_items_update_own_club). Untouched.
-- The 'piggy' source is just a text field on the stock_purchases row — no
-- wallet_transactions write, so no other policy is in play.
--
-- Pattern S26: constrain on the WIRE contract (syncPayloadMapper stock_purchases
-- mapper sends club_id + the row as-is; no owner-only discriminator column
-- exists on this table), club-scoped, and PROVE with a real staff restock
-- draining the outbox to 0 — a SQL-editor insert proves nothing.
--
-- The sync push is an upsert(onConflict:'id'), so INSERT WITH CHECK is
-- evaluated on the conflict-UPDATE path too (S26 rule 2). stock_purchases rows
-- are append-only in practice (recordStockPurchase only ever inserts), but we
-- ALSO give staff the UPDATE branch so a re-pushed row (retry / idempotent
-- re-drain) can't 42501 on the update path. Bulk-peak pricing is a
-- canteen_items write and stays UI-gated owner-only — not affected here.

drop policy if exists stock_purchases_insert_own_club on public.stock_purchases;
create policy stock_purchases_insert_own_club on public.stock_purchases
  for insert
  with check (
    club_id::text = auth.jwt() ->> 'user_club_id'
    and (auth.jwt() ->> 'user_role') in ('owner', 'staff')
  );

drop policy if exists stock_purchases_update_own_club on public.stock_purchases;
create policy stock_purchases_update_own_club on public.stock_purchases
  for update
  using (club_id::text = auth.jwt() ->> 'user_club_id')
  with check (
    club_id::text = auth.jwt() ->> 'user_club_id'
    and (auth.jwt() ->> 'user_role') in ('owner', 'staff')
  );

-- ════════════════════════════════════════════════════════════════════════════
-- Post-run verification (fresh staff JWT only — Rule M):
--   1. Staff sign-in → Restock an item → outbox drains to 0; the
--      stock_purchases row (created_by = staff id) + the canteen_items
--      currentStock bump are visible from the owner device within ~2s.
--   2. Owner regression: owner restock still works.
--   3. Confirm bulk-peak-pricing is still owner-only (UI gate, unaffected).
-- ════════════════════════════════════════════════════════════════════════════

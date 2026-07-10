-- ════════════════════════════════════════════════════════════════════════════
-- Phase D (D6) — staff commerce write-path RLS fixes
-- Fixes #130 (staff wallet top-up 403) + #131 (staff stock decrement 403).
-- Owner-run in Supabase Dashboard → SQL Editor, same as 20260710_phase_d_staff_login.
--
-- WHY (found by the D6 runtime gate — first real staff commerce writes):
--
-- #130 — wallet_transactions: the D1 staff whitelist `kind in ('topup',
--   'debit','coin_redeem')` was written against the advisory DDL enum, but
--   the wire mapper (src/db/syncPayloadMapper.ts) sends the Dexie `type`
--   VERBATIM: 'credit' | 'debit' | 'adjustment'. A staff top-up arrives as
--   kind='credit' → 42501 → the outbox row dead-letters and the top-up
--   never reaches the owner device. The owner-only distinction (manual
--   adjustment / future refund / reversal) lives in reference_type on the
--   wire, not in kind — a modern manual adjustment is type 'credit'|'debit'
--   + referenceType 'adjustment' (the v6 Dexie upgrade retired the legacy
--   type:'adjustment').
--
-- #131 — canteen_items: the sync push is `upsert(..., { onConflict: 'id' })`
--   for BOTH insert and update ops (syncRunner §6.5 idempotency). Postgres
--   evaluates INSERT policies' WITH CHECK on every upsert row — even when
--   the conflict-update path is taken — so "INSERT owner-only + UPDATE both"
--   can never let a staff stock decrement through. Staff get the INSERT
--   branch too (club-scoped, not pre-deleted); item create/edit/restock
--   remain UI-gated (Pattern A12 — the client gate is the primary defense,
--   and D6 removed every staff trigger).
-- ════════════════════════════════════════════════════════════════════════════


-- 1. wallet_transactions — staff branch matches the wire contract (#130).
--    Owner branch unchanged. Staff kind='adjustment' (legacy shape) AND
--    staff reference_type IN ('adjustment','refund','reversal') both still
--    403 — the D9 forbidden-write proof stays meaningful.

drop policy if exists wallet_transactions_insert_own_club on public.wallet_transactions;
create policy wallet_transactions_insert_own_club on public.wallet_transactions
  for insert
  with check (
    club_id::text = auth.jwt() ->> 'user_club_id'
    and (
      (auth.jwt() ->> 'user_role') = 'owner'
      or (
        (auth.jwt() ->> 'user_role') = 'staff'
        and kind in ('credit', 'debit')
        and coalesce(reference_type, '') not in ('adjustment', 'refund', 'reversal')
      )
    )
  );


-- 2. canteen_items — staff INSERT allowed so the upsert push passes (#131).
--    Staff cannot push a row that arrives pre-deleted (soft-delete stays
--    owner-only); the UPDATE policy from D1 is unchanged.

drop policy if exists canteen_items_insert_own_club on public.canteen_items;
create policy canteen_items_insert_own_club on public.canteen_items
  for insert
  with check (
    club_id::text = auth.jwt() ->> 'user_club_id'
    and (
      (auth.jwt() ->> 'user_role') = 'owner'
      or (
        (auth.jwt() ->> 'user_role') = 'staff'
        and deleted_at is null
      )
    )
  );


-- ════════════════════════════════════════════════════════════════════════════
-- Post-run verification (fresh JWTs only — the SQL editor proves nothing):
--   1. Staff sign-in → wallet top-up → outbox drains to 0; the
--      wallet_transactions row (kind='credit', created_by = staff id) is
--      visible from the owner device within ~2s.
--   2. Staff QuickSale on a stocked item → canteen_items.stock_qty
--      decrements server-side; canteen_sales row lands.
--   3. Owner regression: top-up + item edit + restock still sync (owner
--      branch untouched).
-- ════════════════════════════════════════════════════════════════════════════

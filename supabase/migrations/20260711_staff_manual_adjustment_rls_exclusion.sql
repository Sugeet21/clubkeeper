-- ════════════════════════════════════════════════════════════════════════════
-- Phase D (D6 tail) — staff wallet exclusion list: add 'manual' (#132)
--
-- WHY (found by the post-migration gap probe, 11 Jul):
--   20260710_phase_d6_staff_write_rls_fix excluded staff reference_type IN
--   ('adjustment','refund','reversal') — but the app's REAL manual-adjustment
--   shape is kind='credit'|'debit' + reference_type='manual'
--   (src/store/customerStore.ts:235; the v6 Dexie upgrade retired the legacy
--   type:'adjustment', and 'reversal' has never existed in the app). A staff
--   JWT inserting the real shape PASSED RLS, leaving the Pattern-A12 UI gate
--   as the only barrier against staff-forged ledger adjustments.
--
--   Pattern S26 rule 1 (extended): exclusion lists are wire-contract too —
--   blocked values come from src/types/walletTransaction.ts + the mapper,
--   not from the shapes the policy author imagined.
--
-- SAFE: legit staff pushes carry reference_type 'topup' / 'session' /
--   'canteen_sale' / 'coin_redemption' / 'coin_expiry' / 'welcome_bonus' /
--   'streak_bonus' / 'engagement_log' / 'booking_advance' — never 'manual'.
--   The database.ts v6 upgrade that writes referenceType:'manual' is a local
--   Dexie rewrite with no outbox op, and SyncReader direct-applies pulled
--   owner rows without re-pushing them. Owner branch unchanged.
--   'adjustment'/'reversal' stay excluded as belt-and-braces.
-- ════════════════════════════════════════════════════════════════════════════

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
        and coalesce(reference_type, '') not in ('manual', 'adjustment', 'refund', 'reversal')
      )
    )
  );


-- ════════════════════════════════════════════════════════════════════════════
-- Post-run verification (fresh staff JWT, real wire shapes):
--   1. Staff top-up (kind='credit', reference_type='topup') still passes.
--   2. Staff kind='debit' + reference_type='manual' → 42501 (the #132 probe
--      flips from ALLOWED to blocked).
--   3. Owner manual adjustment (owner branch) still passes.
-- ════════════════════════════════════════════════════════════════════════════

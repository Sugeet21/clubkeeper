-- ⚠ RUN MANUALLY in Supabase SQL editor. Not auto-applied.
-- Phase C Chunk 5.2b — client-field columns for the 4 tables whose Dexie
-- shape does not fit the 20260625 DDL. Issue #112.
--
-- WHY THIS EXISTS
-- The Chunk 5.2b bidirectional mappers (syncPayloadMapper / syncReadMapper)
-- refuse to silently drop Dexie-local load-bearing fields on a cross-device
-- pull. Four tables need a server-side home for them:
--
--   1. sessions.config jsonb — 14 Dexie-local fields (billingMode,
--      rateSnapshot, playerName, playerCount, framesPlayed,
--      roundedDurationMs, notifyAtMs, notifyAcknowledgedAt, tableMoves,
--      rateCardSnapshot, toleranceMinutesSnapshot, rateCardBillingSnapshot,
--      isBackEntry, paymentInProgress). Without these a fresh-device pull
--      cannot bill or display a session. The read mapper THROWS on a
--      config-less sessions row (fail-loud).
--   2. bookings.config jsonb — gameType, tierPrice, durationMin,
--      consumedSessionId. Load-bearing for the Bookings page. Read mapper
--      throws on a config-less row.
--   3. canteen_items.stock_enabled boolean — stock_qty alone cannot
--      represent Dexie's `currentStock: null` (stock tracking disabled).
--      Read mapper throws when the column is missing.
--   4. wallet_transactions — ClubCoins ledger fields (balance_type,
--      coin_delta, rupee_equivalent) have no home in the 20260625 DDL, and
--      reference_id widens uuid → text (Dexie referenceId is a free-form
--      soft ref: "sessionId / itemId / null" — never joined server-side).
--
-- All ADD COLUMN statements are IF NOT EXISTS; the ALTER TYPE is guarded by
-- an information_schema check — safe to re-run.
--
-- RLS / realtime: no changes needed. Policies are row-scoped (club_id), not
-- column-scoped, and the tables are already in the supabase_realtime
-- publication with REPLICA IDENTITY FULL (20260625 §6).

-- 1. sessions.config ---------------------------------------------------------
alter table public.sessions
  add column if not exists config jsonb;

-- 2. bookings.config ---------------------------------------------------------
alter table public.bookings
  add column if not exists config jsonb;

-- 3. canteen_items.stock_enabled ---------------------------------------------
-- Default false matches the Dexie default for new items; existing server
-- rows (there are none pre-Chunk-7 cutover) would read as tracking-off.
alter table public.canteen_items
  add column if not exists stock_enabled boolean not null default false;

-- 4. wallet_transactions -----------------------------------------------------
alter table public.wallet_transactions
  add column if not exists balance_type text;

alter table public.wallet_transactions
  add column if not exists coin_delta numeric(10, 2);

alter table public.wallet_transactions
  add column if not exists rupee_equivalent numeric(10, 2);

-- reference_id uuid → text. Guarded: only alters if the column is still uuid.
do $$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'wallet_transactions'
       and column_name  = 'reference_id'
       and data_type    = 'uuid'
  ) then
    alter table public.wallet_transactions
      alter column reference_id type text using reference_id::text;
  end if;
end $$;

-- ============================================================
-- Verification — run AFTER the migration. Should return 6 rows:
--   sessions            config            jsonb
--   bookings            config            jsonb
--   canteen_items       stock_enabled     boolean
--   wallet_transactions balance_type      text
--   wallet_transactions coin_delta        numeric
--   wallet_transactions rupee_equivalent  numeric
-- and reference_id must show data_type = 'text'.
-- ============================================================
-- select table_name, column_name, data_type
--   from information_schema.columns
--  where table_schema = 'public'
--    and (
--      (table_name = 'sessions'            and column_name = 'config') or
--      (table_name = 'bookings'            and column_name = 'config') or
--      (table_name = 'canteen_items'       and column_name = 'stock_enabled') or
--      (table_name = 'wallet_transactions' and column_name in ('balance_type', 'coin_delta', 'rupee_equivalent'))
--    )
--  order by table_name, column_name;
--
-- select data_type from information_schema.columns
--  where table_schema = 'public' and table_name = 'wallet_transactions'
--    and column_name = 'reference_id';  -- expect: text

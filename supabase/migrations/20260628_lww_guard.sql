-- ⚠ RUN MANUALLY in Supabase SQL editor. Not auto-applied.
-- Phase C Chunk 5.1 — server-side last-write-wins (LWW) guard. Issue #112.
--
-- WHY THIS EXISTS
-- The Chunk 4 SyncRunner drains _outbox rows with an UNCONDITIONAL
-- upsert(onConflict: 'id'). That is correct for fresh writes but is a SILENT
-- LOST-UPDATE BUG when an offline device reconnects: device A's stale edit
-- (made offline) drains AFTER device B's newer edit landed on the server, and
-- the server has no way to know A's edit is stale — it overwrites B.
-- Offline-then-reconnect is a PRIMARY use case for this app (Indian club staff
-- on flaky data) so this guard is required, not an edge case.
--
-- The client-side LWW handler (Chunk 5.3) protects only the READ direction
-- (incoming realtime/pull won't clobber a local pending edit). The WRITE
-- direction is unprotected at the source of truth — that's what this trigger
-- enforces.
--
-- HOW IT WORKS
-- BEFORE UPDATE trigger on each of 8 synced tables. If NEW.updated_at is
-- STRICTLY LESS THAN OLD.updated_at, the trigger returns OLD (= skip the
-- write, keep the existing row). Otherwise NEW wins.
--
-- EDGE CASES
-- - INSERT is not triggered (no OLD row). Insert-as-upsert paths unaffected.
-- - Equal timestamps: NEW.updated_at < OLD.updated_at is FALSE → NEW wins.
--   Deterministic tie-break happens at the client read layer using the
--   server-authoritative rule (Chunk 5.3 / Pattern S17).
-- - NULL updated_at on legacy rows: the comparison `< OLD.updated_at`
--   evaluates to NULL, which is not TRUE → NEW wins. Acceptable — we WANT
--   fresh writes to override legacy nulls.
-- - Soft-delete writes already include updated_at (SyncRunner.pushOne invariant
--   from Chunk 4.3 / ripple_effects.md), so the trigger treats them identically
--   under the same LWW rule.
--
-- TABLE COVERAGE (8 of 9 synced tables)
-- wallet_transactions is APPEND-ONLY by design (§4.6 of sync_architecture_v2 +
-- header of the Phase C schema migration: "No updated_at / deleted_at.
-- Corrections happen by inserting a 'reversal' row."). It has no updated_at
-- column to compare and no UPDATE path through the app — so no LWW guard is
-- needed or possible. The other 8 synced tables each get a per-table function
-- + trigger pair so the schema name carries the table name (easier debugging
-- when a trigger ever fires unexpectedly).

-- ============================================================
-- game_tables
-- ============================================================
create or replace function public.enforce_lww_game_tables()
returns trigger language plpgsql as $$
begin
  if new.updated_at < old.updated_at then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists lww_game_tables on public.game_tables;
create trigger lww_game_tables
  before update on public.game_tables
  for each row execute function public.enforce_lww_game_tables();

-- ============================================================
-- sessions
-- ============================================================
create or replace function public.enforce_lww_sessions()
returns trigger language plpgsql as $$
begin
  if new.updated_at < old.updated_at then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists lww_sessions on public.sessions;
create trigger lww_sessions
  before update on public.sessions
  for each row execute function public.enforce_lww_sessions();

-- ============================================================
-- session_items
-- ============================================================
create or replace function public.enforce_lww_session_items()
returns trigger language plpgsql as $$
begin
  if new.updated_at < old.updated_at then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists lww_session_items on public.session_items;
create trigger lww_session_items
  before update on public.session_items
  for each row execute function public.enforce_lww_session_items();

-- ============================================================
-- customers
-- ============================================================
create or replace function public.enforce_lww_customers()
returns trigger language plpgsql as $$
begin
  if new.updated_at < old.updated_at then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists lww_customers on public.customers;
create trigger lww_customers
  before update on public.customers
  for each row execute function public.enforce_lww_customers();

-- ============================================================
-- canteen_items
-- ============================================================
create or replace function public.enforce_lww_canteen_items()
returns trigger language plpgsql as $$
begin
  if new.updated_at < old.updated_at then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists lww_canteen_items on public.canteen_items;
create trigger lww_canteen_items
  before update on public.canteen_items
  for each row execute function public.enforce_lww_canteen_items();

-- ============================================================
-- canteen_sales
-- ============================================================
create or replace function public.enforce_lww_canteen_sales()
returns trigger language plpgsql as $$
begin
  if new.updated_at < old.updated_at then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists lww_canteen_sales on public.canteen_sales;
create trigger lww_canteen_sales
  before update on public.canteen_sales
  for each row execute function public.enforce_lww_canteen_sales();

-- ============================================================
-- stock_purchases
-- ============================================================
create or replace function public.enforce_lww_stock_purchases()
returns trigger language plpgsql as $$
begin
  if new.updated_at < old.updated_at then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists lww_stock_purchases on public.stock_purchases;
create trigger lww_stock_purchases
  before update on public.stock_purchases
  for each row execute function public.enforce_lww_stock_purchases();

-- ============================================================
-- bookings
-- ============================================================
create or replace function public.enforce_lww_bookings()
returns trigger language plpgsql as $$
begin
  if new.updated_at < old.updated_at then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists lww_bookings on public.bookings;
create trigger lww_bookings
  before update on public.bookings
  for each row execute function public.enforce_lww_bookings();

-- ============================================================
-- Verification helper — run this AFTER the migration applies to confirm
-- all 8 triggers exist. Should return 8 rows.
-- ============================================================
-- select event_object_table, trigger_name
--   from information_schema.triggers
--  where trigger_schema = 'public'
--    and trigger_name like 'lww_%'
--  order by event_object_table;

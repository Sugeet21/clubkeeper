-- ════════════════════════════════════════════════════════════════════════════
-- Phase D (D6 tail) — server-side actor stamping: created_by / updated_by (#133)
--
-- WHY: created_by was NULL on every row of every synced table — no column
--   default, no trigger, and syncPayloadMapper deliberately never sends it.
--   Phase D's point is owner visibility into staff actions; without server
--   attribution the ledger can't say WHO wrote a row.
--
-- DESIGN — BEFORE triggers, not column defaults:
--   * `coalesce(auth.uid(), new.<col>)` means a JWT client (owner or staff)
--     is ALWAYS stamped with its own uid — a malicious staff payload that
--     sends created_by = <owner uuid> is overwritten (unforgeable). A plain
--     DEFAULT only fires when the column is absent, so it would be forgeable.
--   * Service-role writes (api/ endpoints, admin cleanup) have auth.uid() =
--     NULL → whatever they provide (usually nothing) is preserved; cleanup
--     scripts don't claim authorship of rows they touch.
--   * INSERT stamps created_by + updated_by; UPDATE stamps updated_by only
--     (created_by is never in the sync payload, and PostgREST upserts only
--     SET columns present in the payload, so it survives the update path).
--   * Trigger names are zz_-prefixed so they sort AFTER the lww_* triggers:
--     an LWW-vetoed update never reaches the stamp.
--   * wallet_transactions is append-only with created_by only (no
--     updated_at/updated_by by design) → separate insert-only function.
--
-- RIPPLE (client, verified before authoring):
--   * syncReadMapper drops created_by/updated_by on every table — no Dexie
--     shape change, no client code change.
--   * syncReader.applyEvent tie-break (§7.3, syncReader.ts:550) reads
--     newRow.updated_by: with the column now stamped, a SELF-echo at equal
--     ms is skipped (updated_by === my uid) instead of doing an idempotent
--     re-put, and a PEER write at equal ms is still accepted. This is the
--     exact activation the Chunk 5.3 comment anticipated ("if push ever
--     starts populating updated_by ... re-verify then").
--
-- Backfill: impossible — authorship of pre-existing rows is unknown; they
--   stay NULL and read as "before attribution existed".
-- ════════════════════════════════════════════════════════════════════════════


-- 1. Stamp function for the 8 mutable synced tables (created_by + updated_by)

create or replace function public.stamp_actor()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;


-- 2. Insert-only variant for the append-only ledger (no updated_by column)

create or replace function public.stamp_created_by()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end;
$$;


-- 3. Triggers — zz_ prefix sorts after lww_* (BEFORE-trigger name order)

drop trigger if exists zz_stamp_actor on public.bookings;
create trigger zz_stamp_actor before insert or update on public.bookings
  for each row execute function public.stamp_actor();

drop trigger if exists zz_stamp_actor on public.canteen_items;
create trigger zz_stamp_actor before insert or update on public.canteen_items
  for each row execute function public.stamp_actor();

drop trigger if exists zz_stamp_actor on public.canteen_sales;
create trigger zz_stamp_actor before insert or update on public.canteen_sales
  for each row execute function public.stamp_actor();

drop trigger if exists zz_stamp_actor on public.customers;
create trigger zz_stamp_actor before insert or update on public.customers
  for each row execute function public.stamp_actor();

drop trigger if exists zz_stamp_actor on public.game_tables;
create trigger zz_stamp_actor before insert or update on public.game_tables
  for each row execute function public.stamp_actor();

drop trigger if exists zz_stamp_actor on public.session_items;
create trigger zz_stamp_actor before insert or update on public.session_items
  for each row execute function public.stamp_actor();

drop trigger if exists zz_stamp_actor on public.sessions;
create trigger zz_stamp_actor before insert or update on public.sessions
  for each row execute function public.stamp_actor();

drop trigger if exists zz_stamp_actor on public.stock_purchases;
create trigger zz_stamp_actor before insert or update on public.stock_purchases
  for each row execute function public.stamp_actor();

drop trigger if exists zz_stamp_created_by on public.wallet_transactions;
create trigger zz_stamp_created_by before insert on public.wallet_transactions
  for each row execute function public.stamp_created_by();


-- ════════════════════════════════════════════════════════════════════════════
-- Post-run verification (fresh JWTs, real wire shapes):
--   1. Staff top-up → wallet_transactions.created_by = staff uid.
--   2. Staff payload that SENDS created_by = <owner uuid> → row lands with
--      created_by = staff uid (forge overwritten).
--   3. Staff stock-decrement upsert on an owner-created item →
--      canteen_items.updated_by = staff uid, created_by stays owner uid.
--   4. Owner writes stamp the owner uid. Service-role cleanup unaffected.
-- ════════════════════════════════════════════════════════════════════════════

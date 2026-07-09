-- Phase D — staff login: users_meta owner-read policy + staff RLS on the 9
-- sync tables + trial-trigger staff exclusion + club-subscription RPC.
--
-- Server side of Phase D (staff login + roles). Client chunks D2–D8 assume
-- this DDL is deployed. Plan: .claude/skills/clubkeeper/references/phase_d_plan.md
-- Architecture: references/history/sync_architecture_v2.md §2 (permission
-- matrix — LOCKED), §3 (identity model), §4.5 (JWT claims), Appendix B (RLS).
--
-- ⚠ DEPLOY MANUALLY: copy into Supabase Dashboard → SQL Editor and Run.
--   (Same protocol as 20260625 — Sugeet wants the diff visible before it lands.)
--
-- ⚠ VERIFICATION LAW (project memory + Pattern A9): the SQL editor runs as
--   `postgres` and BYPASSES RLS and the access-token hook. NOTHING in this
--   file is proven by editor queries alone. The only true proof is a FRESH
--   sign-in (freshly-minted JWT) from the app — see the verification block
--   at the bottom.
--
-- What this migration does NOT need to do (verified against prod schema
-- 10 Jul 2026, D0 grounding):
--   • users_meta already exists (20260625) — no table change.
--   • add_user_meta_to_jwt already reads users_meta for BOTH roles and
--     already blocks active=false at mint time — the hook needs NO change
--     for staff. The Dashboard hook config is already set. Do not touch it.
--
-- Idempotency: every statement is DROP IF EXISTS + CREATE / CREATE OR REPLACE.


-- ════════════════════════════════════════════════════════════════════════════
-- 1. users_meta — owner can read all rows in their own club (staff management
--    screen list). Additive PERMISSIVE policy; the existing self-read and
--    auth-admin policies (20260625) stay untouched. INSERT/UPDATE/DELETE stay
--    absent = service-role only (api/create-staff.ts + api/manage-staff.ts).
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists users_meta_owner_read_club on public.users_meta;
create policy users_meta_owner_read_club on public.users_meta
  as permissive
  for select
  using (
    club_id::text = auth.jwt() ->> 'user_club_id'
    and (auth.jwt() ->> 'user_role') = 'owner'
  );

-- updated_at hygiene — service-role updates (revoke, reset) get a fresh stamp
-- without every endpoint remembering to send one.
create or replace function public.set_users_meta_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_users_meta_updated_at on public.users_meta;
create trigger trg_users_meta_updated_at
  before update on public.users_meta
  for each row execute function public.set_users_meta_updated_at();


-- ════════════════════════════════════════════════════════════════════════════
-- 2. handle_new_user — staff accounts must NOT get their own 7-day trial.
--    The on_auth_user_created trigger fires on EVERY auth.users insert,
--    including admin-API staff creation (D0 grounding finding). Staff are
--    detected by the ck_role marker api/create-staff.ts puts in
--    user_metadata, belt-and-braces by the fake-email domain (§3.3).
--    The profiles insert is KEPT for staff (display name; refreshProfile
--    expects a row). Only the subscriptions insert is skipped — staff access
--    follows the OWNER's subscription via the RPC in section 3.
--    (CREATE OR REPLACE keeps the trigger binding intact — 20260602 precedent.)
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  );

  if coalesce(new.raw_user_meta_data->>'ck_role', '') <> 'staff'
     and new.email not like '%.ck.local' then
    insert into public.subscriptions (user_id, status, plan, trial_ends_at)
    values (new.id, 'trialing', 'standard', now() + interval '7 days');
  end if;

  return new;
end;
$$;


-- ════════════════════════════════════════════════════════════════════════════
-- 3. get_club_subscription_status() — staff devices gate access on the
--    OWNER's subscription (§9 edge case: "Owner needs to renew"). Staff
--    cannot read the subscriptions table directly (RLS is user_id-scoped);
--    this SECURITY DEFINER RPC resolves the caller's club from the JWT claim
--    and returns the owner's latest subscription — status fields only, no
--    owner ids leaked. Returns zero rows if the caller has no club claim.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.get_club_subscription_status()
returns table (
  status               text,
  plan                 text,
  trial_ends_at        timestamptz,
  current_period_start timestamptz,
  current_period_end   timestamptz,
  cancel_at_period_end boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select s.status, s.plan, s.trial_ends_at,
         s.current_period_start, s.current_period_end, s.cancel_at_period_end
  from public.users_meta um
  join public.subscriptions s on s.user_id = um.user_id
  where um.club_id::text = auth.jwt() ->> 'user_club_id'
    and um.role = 'owner'
  order by s.created_at desc
  limit 1
$$;

revoke all on function public.get_club_subscription_status() from public;
revoke all on function public.get_club_subscription_status() from anon;
grant execute on function public.get_club_subscription_status() to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- 4. Staff RLS on the 9 sync tables — the Phase C policies required
--    role='owner' on every INSERT/UPDATE, so every staff write would 403 and
--    dead-letter the staff outbox. Rewrite per the §2 permission matrix.
--
--    Policy names are IDENTICAL to Phase C ({t}_insert_own_club etc.) so this
--    section fully supersedes the 20260625 loop on re-run.
--
--    Matrix → table-level grants (field-level staff restrictions — session
--    started_at / paymentBreakdown edits, customer name/phone edits, canteen
--    price edits — stay APP-LAYER per Appendix B; RLS gates rows, not fields):
--
--      owner-only writes : game_tables, stock_purchases
--      both write        : sessions, session_items, customers, canteen_sales,
--                          bookings   (staff cannot SET deleted_at — soft-
--                          delete is owner-only in the matrix)
--      canteen_items     : INSERT owner-only; UPDATE both (staff sales must
--                          decrement stock_qty — the sync push is a full-row
--                          upsert, so staff need row UPDATE; name/price edit
--                          + restock UI are owner-only app-layer)
--      wallet_transactions: INSERT only (append-only §4.6). Staff kinds
--                          limited to topup/debit/coin_redeem; adjustment,
--                          refund, reversal are owner-only AT RLS level (this
--                          is the server-side 403 the D9 proof exercises).
--                          Phase C's update policy on this table was a
--                          template artifact — DROPPED here for real
--                          append-only enforcement.
--
--    SELECT stays club-wide for both roles on all 9 tables (staff devices
--    run the same SyncReader; privacy trimming is UI-layer — §9 accepted).
--
--    NB the staff no-soft-delete WITH CHECK ('owner' OR deleted_at IS NULL)
--    means staff CAN technically un-delete (new row has deleted_at NULL).
--    Accepted: restore/undo is app-layer owner-only UI; RLS blocks the
--    destructive direction.
-- ════════════════════════════════════════════════════════════════════════════

-- 4.1 owner-only tables — recreate the Phase C shape (unchanged semantics,
--     re-stated here so this file is the single authority post-Phase-D).

do $$
declare
  t text;
begin
  foreach t in array array['game_tables', 'stock_purchases'] loop
    execute format('drop policy if exists %I_insert_own_club on public.%I', t, t);
    execute format($p$
      create policy %I_insert_own_club on public.%I
        for insert
        with check (
          club_id::text = auth.jwt() ->> 'user_club_id'
          and (auth.jwt() ->> 'user_role') = 'owner'
        )
    $p$, t, t);

    execute format('drop policy if exists %I_update_own_club on public.%I', t, t);
    execute format($p$
      create policy %I_update_own_club on public.%I
        for update
        using (club_id::text = auth.jwt() ->> 'user_club_id')
        with check (
          club_id::text = auth.jwt() ->> 'user_club_id'
          and (auth.jwt() ->> 'user_role') = 'owner'
        )
    $p$, t, t);
  end loop;
end $$;

-- 4.2 both-write tables — staff INSERT + UPDATE allowed; staff cannot set
--     deleted_at (soft-delete stays owner-only server-side).

do $$
declare
  t text;
begin
  foreach t in array array[
    'sessions', 'session_items', 'customers', 'canteen_sales', 'bookings'
  ] loop
    execute format('drop policy if exists %I_insert_own_club on public.%I', t, t);
    execute format($p$
      create policy %I_insert_own_club on public.%I
        for insert
        with check (
          club_id::text = auth.jwt() ->> 'user_club_id'
          and (auth.jwt() ->> 'user_role') in ('owner', 'staff')
        )
    $p$, t, t);

    execute format('drop policy if exists %I_update_own_club on public.%I', t, t);
    execute format($p$
      create policy %I_update_own_club on public.%I
        for update
        using (club_id::text = auth.jwt() ->> 'user_club_id')
        with check (
          club_id::text = auth.jwt() ->> 'user_club_id'
          and (
            (auth.jwt() ->> 'user_role') = 'owner'
            or ((auth.jwt() ->> 'user_role') = 'staff' and deleted_at is null)
          )
        )
    $p$, t, t);
  end loop;
end $$;

-- 4.3 canteen_items — INSERT owner-only, UPDATE both (stock decrement path).

drop policy if exists canteen_items_insert_own_club on public.canteen_items;
create policy canteen_items_insert_own_club on public.canteen_items
  for insert
  with check (
    club_id::text = auth.jwt() ->> 'user_club_id'
    and (auth.jwt() ->> 'user_role') = 'owner'
  );

drop policy if exists canteen_items_update_own_club on public.canteen_items;
create policy canteen_items_update_own_club on public.canteen_items
  for update
  using (club_id::text = auth.jwt() ->> 'user_club_id')
  with check (
    club_id::text = auth.jwt() ->> 'user_club_id'
    and (
      (auth.jwt() ->> 'user_role') = 'owner'
      or ((auth.jwt() ->> 'user_role') = 'staff' and deleted_at is null)
    )
  );

-- 4.4 wallet_transactions — INSERT only; staff limited to operational kinds.
--     The Phase C update policy is dropped and NOT recreated (append-only).

drop policy if exists wallet_transactions_update_own_club on public.wallet_transactions;

drop policy if exists wallet_transactions_insert_own_club on public.wallet_transactions;
create policy wallet_transactions_insert_own_club on public.wallet_transactions
  for insert
  with check (
    club_id::text = auth.jwt() ->> 'user_club_id'
    and (
      (auth.jwt() ->> 'user_role') = 'owner'
      or (
        (auth.jwt() ->> 'user_role') = 'staff'
        and kind in ('topup', 'debit', 'coin_redeem')
      )
    )
  );


-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION
-- ════════════════════════════════════════════════════════════════════════════
--
-- Post-deploy verification (Sugeet, by hand — fresh JWTs only, NEVER the
-- SQL editor as proof; the editor runs as postgres and bypasses RLS + hook):
--
--   1. OWNER regression: sign OUT of the app, sign back IN (fresh JWT).
--      Start/stop a session, add a canteen item to it, do a wallet top-up.
--      Outbox drains to 0 (TopBar dot green / __dev TestOutbox). This proves
--      the rewritten policies didn't break the owner write path.
--   2. Decode the fresh owner JWT at jwt.io → `user_club_id` + `user_role`
--      claims still present (hook untouched, but verify anyway — Pattern A9).
--   3. STAFF checks come with D9 (needs api/create-staff.ts first). Until
--      then there is no staff JWT to test with — do NOT fake one via the
--      editor.
--   4. Update the STATE.md migration ledger line for this file:
--      UNAPPLIED → APPLIED, same session as the run.
--   5. Reply in chat with PHASE_D_DDL_DEPLOYED.

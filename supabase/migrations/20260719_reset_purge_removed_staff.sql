-- #156 — owner decision on reset scope: 'Type RESET' additionally purges
-- REMOVED staff accounts (users_meta.active = false); ACTIVE staff are kept.
-- Removed staff are already banned + blocked at token mint (revoke, D2), so
-- this deletes only the dormant record: the auth.users row, which cascades
-- to users_meta (and profiles). Owner's stated flow for a truly clean slate:
-- remove staff first, then reset.
--
-- FK safety: the actor-stamp columns (created_by/updated_by on the 9 synced
-- tables, topup_intents.confirmed_by) reference auth.users with NO cascade.
-- That is safe HERE because every row this club's staff ever stamped carries
-- this club_id and is deleted earlier in this same function, in the same
-- transaction. If a reference ever survives anyway, the FK violation aborts
-- the WHOLE reset atomically — fail-safe, never a half-reset.

create or replace function public.reset_club_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := auth.jwt() ->> 'user_role';
  v_claim text := auth.jwt() ->> 'user_club_id';
  v_club uuid;
  v_n int;
  v_deleted jsonb := '{}'::jsonb;
begin
  if v_role is distinct from 'owner' or v_claim is null then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  v_club := v_claim::uuid;

  delete from session_items where club_id = v_club;
  get diagnostics v_n = row_count;
  v_deleted := v_deleted || jsonb_build_object('session_items', v_n);

  delete from canteen_sales where club_id = v_club;
  get diagnostics v_n = row_count;
  v_deleted := v_deleted || jsonb_build_object('canteen_sales', v_n);

  delete from stock_purchases where club_id = v_club;
  get diagnostics v_n = row_count;
  v_deleted := v_deleted || jsonb_build_object('stock_purchases', v_n);

  delete from wallet_transactions where club_id = v_club;
  get diagnostics v_n = row_count;
  v_deleted := v_deleted || jsonb_build_object('wallet_transactions', v_n);

  delete from bookings where club_id = v_club;
  get diagnostics v_n = row_count;
  v_deleted := v_deleted || jsonb_build_object('bookings', v_n);

  delete from booking_intents where club_id = v_club;
  get diagnostics v_n = row_count;
  v_deleted := v_deleted || jsonb_build_object('booking_intents', v_n);

  delete from topup_intents where club_id = v_club;
  get diagnostics v_n = row_count;
  v_deleted := v_deleted || jsonb_build_object('topup_intents', v_n);

  delete from sessions where club_id = v_club;
  get diagnostics v_n = row_count;
  v_deleted := v_deleted || jsonb_build_object('sessions', v_n);

  delete from customers where club_id = v_club;
  get diagnostics v_n = row_count;
  v_deleted := v_deleted || jsonb_build_object('customers', v_n);

  delete from canteen_items where club_id = v_club;
  get diagnostics v_n = row_count;
  v_deleted := v_deleted || jsonb_build_object('canteen_items', v_n);

  delete from game_tables where club_id = v_club;
  get diagnostics v_n = row_count;
  v_deleted := v_deleted || jsonb_build_object('game_tables', v_n);

  -- #156 — purge removed-staff accounts LAST (their actor-stamped rows are
  -- all gone by now). auth.users delete cascades to users_meta + profiles.
  delete from auth.users u
  using users_meta um
  where um.user_id = u.id
    and um.club_id = v_club
    and um.role = 'staff'
    and um.active = false;
  get diagnostics v_n = row_count;
  v_deleted := v_deleted || jsonb_build_object('removed_staff', v_n);

  return jsonb_build_object('ok', true, 'deleted', v_deleted);
end;
$$;

revoke all on function public.reset_club_data() from public;
revoke all on function public.reset_club_data() from anon;
grant execute on function public.reset_club_data() to authenticated;

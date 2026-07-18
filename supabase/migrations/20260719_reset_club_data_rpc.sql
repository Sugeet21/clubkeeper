-- #154 — 'Type RESET' wipe only cleared local Dexie; Phase C sync re-pulled
-- everything from Supabase on the next boot (clearing db.settings also wipes
-- the pull cursors, forcing a fresh from-epoch pull). This RPC makes reset
-- durable by deleting the club's rows server-side.
--
-- SECURITY DEFINER because prod deliberately has ZERO DELETE policies on any
-- table — clients never get raw DELETE. Authorization is the JWT claim pair
-- (user_role = 'owner' AND user_club_id), same contract as the RLS policies.
-- Staff JWTs get 42501.
--
-- Scope: the 9 synced data tables + both player postboxes (booking_intents,
-- topup_intents). The clubs row (slug, UPI, booking config, tables_json) and
-- subscriptions are deliberately PRESERVED — reset wipes club data, not the
-- account. Children deleted before parents. Returns per-table deleted counts
-- so the client / owner can verify the wipe.

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

  return jsonb_build_object('ok', true, 'deleted', v_deleted);
end;
$$;

revoke all on function public.reset_club_data() from public;
revoke all on function public.reset_club_data() from anon;
grant execute on function public.reset_club_data() to authenticated;

-- #155 (SWEEP-#154) — Settings "Clear session history" only ran a bare local
-- db.sessions.clear(): sessions resurrected from Supabase on the next pull, and
-- session_items were orphaned locally. This RPC is the durable, server-first
-- half — a SCOPED sibling of reset_club_data() that clears ONLY session history.
--
-- SOFT-DELETE, not hard-delete (deliberate — see #155 Phase 1): the Phase C pull
-- path is apply-only (syncReader.pullTable bulkPut's rows it receives; it never
-- removes a local row because the server dropped it) and realtime DELETE events
-- cannot propagate either. A hard delete would fix the acting device but strand
-- every OTHER device (their sessions never disappear, and pending outbox rows
-- could re-push them). Stamping deleted_at makes the clear a normal UPDATE the
-- pull applies everywhere, and every session/session_items reader already filters
-- !deletedAt (#117/#162). This mirrors how the app soft-deletes everywhere else.
--
-- updated_at is bumped to now() alongside deleted_at so the numeric-ms LWW compare
-- on other devices (Pattern S17) sees the row as newer and applies it — a soft
-- delete that DIDN'T advance updated_at could lose LWW to a stale-but-later local
-- edit and silently fail to converge. updated_by is left to the server BEFORE
-- trigger (#133 actor-stamping) exactly like every other JWT write.
--
-- Only rows still live (deleted_at IS NULL) are touched: idempotent, and re-running
-- doesn't needlessly re-bump updated_at on already-cleared rows (which would spam
-- other devices with no-op re-pulls). Children (session_items) before parent
-- (sessions), same ordering discipline as reset_club_data().
--
-- SECURITY DEFINER + JWT-claim owner gate (user_role = 'owner' AND user_club_id),
-- identical contract to reset_club_data(); staff JWTs get 42501. Scope is sessions
-- + session_items ONLY — customers, wallet, canteen, bookings, game_tables are
-- untouched (the "Tables will not be affected" promise, extended). Returns per-table
-- stamped counts so the client / owner can verify.

create or replace function public.clear_club_sessions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := auth.jwt() ->> 'user_role';
  v_claim text := auth.jwt() ->> 'user_club_id';
  v_club uuid;
  v_now timestamptz := now();
  v_n int;
  v_deleted jsonb := '{}'::jsonb;
begin
  if v_role is distinct from 'owner' or v_claim is null then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  v_club := v_claim::uuid;

  -- Children first (session_items), then the parent (sessions). Only live rows.
  update session_items
     set deleted_at = v_now,
         updated_at = v_now
   where club_id = v_club
     and deleted_at is null;
  get diagnostics v_n = row_count;
  v_deleted := v_deleted || jsonb_build_object('session_items', v_n);

  update sessions
     set deleted_at = v_now,
         updated_at = v_now
   where club_id = v_club
     and deleted_at is null;
  get diagnostics v_n = row_count;
  v_deleted := v_deleted || jsonb_build_object('sessions', v_n);

  return jsonb_build_object('ok', true, 'deleted', v_deleted);
end;
$$;

revoke all on function public.clear_club_sessions() from public;
revoke all on function public.clear_club_sessions() from anon;
grant execute on function public.clear_club_sessions() to authenticated;

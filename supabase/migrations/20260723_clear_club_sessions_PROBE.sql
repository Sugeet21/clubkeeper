-- ── #155 clear_club_sessions() — VERIFICATION PROBE ────────────────────────────
-- Run these AFTER applying 20260723_clear_club_sessions_rpc.sql, in the Supabase
-- SQL Editor. Each is READ-ONLY — nothing here changes data.
--
-- ⚠ The SQL Editor runs as `postgres` and BYPASSES RLS + has no JWT, so it CANNOT
-- prove the owner-gate rejects a staff/anon caller — do NOT call the function here
-- to "test" it (as postgres, auth.jwt() is NULL → it would just raise not_owner,
-- proving nothing about the real gate). The gate is proven on-device: sign in as
-- OWNER, clear history (works); the staff-JWT rejection is the app's job to prove.

-- 1. Function exists, is SECURITY DEFINER, returns jsonb, takes no args.
select
  p.proname,
  pg_get_function_identity_arguments(p.oid)      as args,
  p.prosecdef                                    as is_security_definer,
  pg_get_function_result(p.oid)                  as returns
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'clear_club_sessions';
-- EXPECT exactly 1 row: args = '' (empty), is_security_definer = true, returns = 'jsonb'.

-- 2. Full definition — eyeball that it UPDATEs (soft-delete) not DELETEs, stamps
--    both deleted_at AND updated_at, filters deleted_at IS NULL, and gates on
--    user_role='owner' + user_club_id.
select pg_get_functiondef(p.oid) as def
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'clear_club_sessions';
-- EXPECT: two `update ... set deleted_at = v_now, updated_at = v_now ... where
--         club_id = v_club and deleted_at is null` blocks (session_items then
--         sessions), the not_owner gate, and NO `delete from` anywhere.

-- 3. Execute privilege: authenticated only, NOT anon/public.
select r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
cross join (select unnest(array['anon','authenticated','public']) as rolname) r
where n.nspname = 'public' and p.proname = 'clear_club_sessions';
-- EXPECT: authenticated = true; anon = false; public = false.

-- 4. Sanity — confirm the target columns exist and are nullable (so the stamp is
--    valid). Read-only; proves nothing changed, just that the shape is right.
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('sessions','session_items')
  and column_name in ('deleted_at','updated_at','club_id')
order by table_name, column_name;
-- EXPECT: deleted_at (timestamptz, nullable YES) + updated_at (timestamptz, NO)
--         + club_id (uuid, NO) on BOTH tables.

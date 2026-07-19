-- #157 — the Settings staff list is name-only because the generated
-- <slug>.ck.local username lives in auth.users.email, unreachable via RLS
-- (the D8 known gap). Denormalize it onto users_meta so the existing
-- owner-read policy exposes it — supersedes the deferred D8b list-staff
-- endpoint: no new endpoint, the direct SELECT list keeps working without
-- vercel dev.
--
-- RLS exposure check (pg_policies, 19 Jul): users_meta_owner_read_club
-- (own club, owner claim) + users_meta_select_self (staff sees own row)
-- + users_meta_auth_admin_read (token hook). No player/anon read path.
--
-- Passwords are NOT touched — only the hash exists; recovery stays the
-- reset_password endpoint (show-once).

alter table public.users_meta add column if not exists username text;

-- Backfill existing staff/owner rows from auth. api/create-staff.ts writes
-- the column for all rows created after this migration.
update public.users_meta um
set username = u.email
from auth.users u
where u.id = um.user_id
  and um.username is null;

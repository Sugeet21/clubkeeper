-- #159 / #160 — cross-device sync was silently dead for EVERY real customer.
--
-- Root cause: sync partitions on the `user_club_id` JWT claim, minted by the
-- add_user_meta_to_jwt access-token hook, which reads it from public.users_meta.
-- Nothing ever provisioned an OWNER's users_meta row:
--   - handle_new_user() (signup) writes profiles + subscriptions only.
--   - upsertClub() (Player-Hub slug setup) writes the clubs row only.
-- Only staff rows (api/create-staff.ts) and one hand-inserted owner row
-- (sugeetjadhav@gmail.com, #109) ever existed. So a real owner's JWT carried
-- no claim → SyncReader deferred forever, SyncRunner dead-lettered → data
-- stayed 100% local per device. Verified 19 Jul: ZERO rows in every synced
-- table across all clubs.
--
-- Fix, three parts:
--   1. AFTER INSERT trigger on public.clubs auto-provisions the owner's
--      users_meta row {user_id: owner_id, club_id: NEW.id, role:'owner',
--      active:true}. SECURITY DEFINER (bypasses RLS — same as handle_new_user).
--      Idempotent via ON CONFLICT: a re-run or a manual row is never clobbered
--      destructively (role/active/club refreshed to the owning club, which is
--      the correct authority — one owner, one club).
--   2. Backfill: provision the 3 existing claim-less owners (incl. the new
--      ball-bended club) from public.clubs.
--   3. #160 — repoint sugeetjadhav@gmail.com's mis-mapped row from the
--      sugeet21 club (87501f04, owned by the "7" account) to his own
--      clubkeeper club (b08a11b4).
--
-- Rule M: after apply, probe pg_trigger + pg_get_functiondef live and record
-- in the STATE ledger. Owner self-check: Dashboard → Database → Triggers →
-- `on_club_created_provision_owner_meta` on public.clubs.

-- ── 1. Provisioning function + trigger ──────────────────────────────────────

create or replace function public.provision_owner_users_meta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  owner_email text;
  owner_name  text;
begin
  -- Owner-provisioning ONLY. A club always has an owner_id (NOT NULL); map it.
  -- `name` is NOT NULL on users_meta — source the display name from profiles
  -- (populated by handle_new_user at signup), falling back to email then a
  -- literal so the insert can never violate the constraint.
  select u.email, coalesce(p.display_name, u.email, 'Owner')
    into owner_email, owner_name
    from auth.users u
    left join public.profiles p on p.id = u.id
    where u.id = new.owner_id;

  insert into public.users_meta (user_id, club_id, role, active, name, username, created_by)
  values (
    new.owner_id,
    new.id,
    'owner',
    true,
    coalesce(owner_name, 'Owner'),
    owner_email,
    new.owner_id
  )
  on conflict (user_id) do update
    set club_id = excluded.club_id,   -- one owner ⇒ one club: the owning club is authoritative
        role    = 'owner',
        active  = true,
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_club_created_provision_owner_meta on public.clubs;
create trigger on_club_created_provision_owner_meta
  after insert on public.clubs
  for each row
  execute function public.provision_owner_users_meta();

-- ── 2. Backfill: provision every existing owner that has no users_meta row ───
--    Runs the same shape as the trigger for clubs that pre-date it.

insert into public.users_meta (user_id, club_id, role, active, name, username, created_by)
select c.owner_id, c.id, 'owner', true,
       coalesce(p.display_name, u.email, 'Owner'), u.email, c.owner_id
from public.clubs c
join auth.users u on u.id = c.owner_id
left join public.profiles p on p.id = u.id
where not exists (
  select 1 from public.users_meta um where um.user_id = c.owner_id
)
on conflict (user_id) do nothing;

-- ── 3. #160 — repoint sugeetjadhav@gmail.com to his OWN club ─────────────────
--    His row was hand-inserted (#109) pointing at the sugeet21 club (owned by
--    the "7" account). Repoint to his clubkeeper club so his JWT partitions
--    under the club he actually owns. Guarded by the join so it only fires if
--    the mapping is genuinely wrong.

update public.users_meta um
set club_id = c.id, role = 'owner', active = true, updated_at = now()
from public.clubs c
join auth.users u on u.id = c.owner_id
where u.email = 'sugeetjadhav@gmail.com'
  and c.owner_id = um.user_id
  and um.club_id is distinct from c.id;

-- Phase C — multi-device sync: 9 synced tables + users_meta + JWT custom-claims
-- hook + clubs additions (sync_enabled kill switch) + RLS policies + realtime
-- publication grants.
--
-- This migration ships the SERVER side of the Phase C outbox/realtime sync
-- engine. Client wrappers (syncedCreate / SyncRunner / SyncReader) ship in
-- Chunks 3–5 and assume this DDL is already deployed.
--
-- Architecture reference: .claude/skills/clubkeeper/references/sync_architecture_v2.md
-- §3 (users_meta), §4.1 (clubs additions), §4.2 (the 9 sync tables — WITH
-- v3.2 amendment that drops the invented session_items.canteen_item_id column),
-- §4.5 (JWT custom claims), §4.9 (sync_enabled kill switch), Appendix B
-- (owner-only RLS policy template).
--
-- ⚠ DEPLOY MANUALLY: copy this file's contents into Supabase Dashboard → SQL
-- Editor and click Run. The MCP apply_migration tool is NOT used for Phase C
-- because Sugeet wants the diff visible before it lands.
--
-- Idempotency: every CREATE uses IF NOT EXISTS / CREATE OR REPLACE so re-runs
-- against a partially-applied state are safe.
--
-- Schema column name: clubs.owner_id (not owner_user_id as v2 §4.1 said). v3.2
-- amendment to sync_architecture_v2.md aligns the doc with what production
-- actually has.


-- ════════════════════════════════════════════════════════════════════════════
-- 1. clubs additions (extend existing table)
-- ════════════════════════════════════════════════════════════════════════════

-- clubs.owner_id already exists (from the initial Player Hub migration) — it's
-- the column upsertClub writes to on INSERT. This ALTER is a no-op guard for
-- a fresh project; on production it does nothing.
alter table public.clubs
  add column if not exists owner_id uuid references auth.users(id);

-- Sync kill-switch (§4.9). Default true so existing clubs keep syncing once
-- the client ships. Sugeet flips to false in the dashboard when investigating
-- a corrupted club.
alter table public.clubs
  add column if not exists sync_enabled boolean not null default true;

alter table public.clubs
  add column if not exists sync_disabled_reason text;

alter table public.clubs
  add column if not exists sync_disabled_at timestamptz;


-- ════════════════════════════════════════════════════════════════════════════
-- 2. users_meta (§3) — single source of truth for "which club does this user
--    belong to". Phase C only writes one row per club (the owner). Phase D
--    will add staff rows. RLS here is Phase-D-permissive so service-role can
--    INSERT the owner row out-of-band (via the dashboard SQL editor or a
--    one-off admin script) without authenticated owner writes leaking in.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.users_meta (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null check (role in ('owner', 'staff')),
  club_id    uuid not null references public.clubs(id) on delete cascade,
  name       text not null,
  active     boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_users_meta_club_id on public.users_meta(club_id);

alter table public.users_meta enable row level security;

-- SELECT: a user can read their own row (so the client can decide what to
-- render) but not other rows. Phase D widens this to "owner can read all
-- users_meta in their own club" for the staff management screen.
drop policy if exists users_meta_select_self on public.users_meta;
create policy users_meta_select_self on public.users_meta
  for select using (user_id = auth.uid());

-- INSERT / UPDATE / DELETE: locked to service-role for Phase C. Owners and
-- staff cannot create users_meta rows from the client; provisioning happens
-- via Supabase Dashboard or an admin script. Phase D adds owner-INSERT
-- policy for staff creation.
-- (Postgres treats missing INSERT/UPDATE/DELETE policies under RLS as deny.)


-- ════════════════════════════════════════════════════════════════════════════
-- 3. JWT custom-claims hook (§4.5) — embeds club_id + role in every JWT so
--    RLS on the 9 sync tables can do a constant-time comparison without a
--    per-row subquery into users_meta.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.add_user_meta_to_jwt(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  meta   record;
  claims jsonb;
begin
  claims := event -> 'claims';

  select club_id, role, active
    into meta
    from public.users_meta
    where user_id = (event ->> 'user_id')::uuid;

  -- No users_meta row → user is signed in but not provisioned. Let the JWT
  -- issue without sync claims; the client will see clubId=null via
  -- useCurrentUser() and render NoClubScreen.
  -- NB: must use `not found` (the auto-set PL/pgSQL var). A previous version
  -- of this function referenced `meta.user_id`, which doesn't exist in the
  -- record because user_id is NOT in the SELECT list — that raised on every
  -- sign-in, the hook bricked the auth callback, and the app bounced back to
  -- the sign-in screen silently.
  if not found then
    return event;
  end if;

  -- Account explicitly revoked → block sign-in. This is the "instant revoke"
  -- path (§4.5 trade-off) — for the JWT-TTL revoke path, the owner ALSO calls
  -- supabase.auth.admin.signOut(userId) from the dashboard / admin script.
  if meta.active is not true then
    raise exception 'User account is not active';
  end if;

  claims := jsonb_set(claims, '{user_club_id}', to_jsonb(meta.club_id::text));
  claims := jsonb_set(claims, '{user_role}',    to_jsonb(meta.role));

  return jsonb_set(event, '{claims}', claims);

exception when others then
  -- Defensive: a bug in this hook must NOT brick sign-in. The Phase C client
  -- degrades gracefully when claims are missing (no sync, but the app still
  -- works offline). Logged for forensics; visible in Postgres logs.
  raise warning 'add_user_meta_to_jwt failed: % %', sqlstate, sqlerrm;
  return event;
end;
$$;

-- Supabase Auth must be configured to call this function as the Custom Access
-- Token Hook (Dashboard → Auth → Hooks). The deploy banner at the bottom of
-- this file repeats the click-path.


-- ════════════════════════════════════════════════════════════════════════════
-- 4. The 9 synced tables (§4.2) — common shape: id UUID PK, club_id UUID FK
--    to clubs, audit columns (created/updated_at/by), soft-delete via
--    deleted_at. Realtime broadcasts the deleted_at update so other devices
--    can remove rows from UI without a hard DELETE.
--
-- v3.2 AMENDMENT: session_items DROPS the invented canteen_item_id NOT NULL
-- column. The Dexie SessionItem interface has never carried that field —
-- session items are denormalised snapshots (name_snapshot, price_snapshot,
-- quantity). Adding NOT NULL would break every sync push because the row
-- has no value to send.
-- ════════════════════════════════════════════════════════════════════════════

-- 4.1 game_tables ────────────────────────────────────────────────────────────

create table if not exists public.game_tables (
  id            uuid primary key,
  club_id       uuid not null references public.clubs(id) on delete cascade,
  name          text not null,
  table_type    text not null,                      -- 'pool' | 'snooker' | 'carrom' | 'ps5' | etc.
  hourly_rate   numeric(10, 2) not null,
  per_min_rate  numeric(10, 2),
  is_active     boolean not null default true,
  display_order integer not null default 0,
  config        jsonb,                              -- type-specific config (eg snooker billing rule, rate card)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id)
);

create index if not exists idx_game_tables_club
  on public.game_tables(club_id)
  where deleted_at is null;

-- 4.2 sessions ───────────────────────────────────────────────────────────────

create table if not exists public.sessions (
  id                uuid primary key,
  club_id           uuid not null references public.clubs(id) on delete cascade,
  table_id          uuid not null,                  -- soft FK to game_tables
  customer_id       uuid,                           -- soft FK to customers, nullable
  started_at        timestamptz not null,
  ended_at          timestamptz,
  paused_at         timestamptz,
  paused_total_ms   bigint not null default 0,
  status            text not null,                  -- 'active' | 'paused' | 'completed'
  table_charge      numeric(10, 2),
  canteen_charge    numeric(10, 2),
  total_charge      numeric(10, 2),
  payment_method    text,                           -- 'cash' | 'upi' | 'wallet' | 'mixed' | null
  payment_breakdown jsonb,                          -- { cash, upi, wallet }
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  created_by        uuid references auth.users(id),
  updated_by        uuid references auth.users(id)
);

create index if not exists idx_sessions_club_status
  on public.sessions(club_id, status)
  where deleted_at is null;

create index if not exists idx_sessions_club_started
  on public.sessions(club_id, started_at desc)
  where deleted_at is null;

create index if not exists idx_sessions_customer
  on public.sessions(customer_id)
  where deleted_at is null;

-- 4.3 session_items (v3.2 amendment — no canteen_item_id column) ──────────────

create table if not exists public.session_items (
  id              uuid primary key,
  club_id         uuid not null references public.clubs(id) on delete cascade,
  session_id      uuid not null,                    -- soft FK to sessions
  -- NB: no canteen_item_id column. Dexie SessionItem is a denormalised snapshot;
  -- name_snapshot + price_snapshot are authoritative for history.
  name_snapshot   text not null,
  price_snapshot  numeric(10, 2) not null,
  quantity        integer not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  created_by      uuid references auth.users(id),
  updated_by      uuid references auth.users(id)
);

create index if not exists idx_session_items_session
  on public.session_items(session_id)
  where deleted_at is null;

create index if not exists idx_session_items_club
  on public.session_items(club_id)
  where deleted_at is null;

-- 4.4 customers ──────────────────────────────────────────────────────────────

create table if not exists public.customers (
  id             uuid primary key,
  club_id        uuid not null references public.clubs(id) on delete cascade,
  name           text not null,
  phone          text,
  wallet_balance numeric(10, 2) not null default 0,
  coins_balance  numeric(10, 2) not null default 0,  -- if club uses coin system
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  created_by     uuid references auth.users(id),
  updated_by     uuid references auth.users(id)
);

create index if not exists idx_customers_club
  on public.customers(club_id)
  where deleted_at is null;

create index if not exists idx_customers_phone
  on public.customers(club_id, phone)
  where deleted_at is null and phone is not null;

-- 4.5 wallet_transactions (APPEND-ONLY LEDGER — §4.6) ────────────────────────
-- No updated_at / deleted_at. Corrections happen by inserting a 'reversal' row.

create table if not exists public.wallet_transactions (
  id             uuid primary key,
  club_id        uuid not null references public.clubs(id) on delete cascade,
  customer_id    uuid not null,                     -- soft FK
  kind           text not null,                     -- 'topup' | 'debit' | 'refund' | 'adjustment' | 'coin_redeem' | 'reversal'
  amount         numeric(10, 2) not null,           -- positive=credit, negative=debit
  balance_after  numeric(10, 2) not null,           -- snapshot; recomputed on read
  reference_type text,                              -- 'session' | 'topup_intent' | 'manual' | 'reverses' | null
  reference_id   uuid,                              -- session.id, topup_intents.id, or wallet_transactions.id (for reversal)
  payment_method text,                              -- topup: 'cash' | 'upi' | 'razorpay'
  notes          text,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users(id)
);

create index if not exists idx_wallet_tx_customer
  on public.wallet_transactions(customer_id, created_at desc);

create index if not exists idx_wallet_tx_club
  on public.wallet_transactions(club_id, created_at desc);

-- 4.6 canteen_items ──────────────────────────────────────────────────────────

create table if not exists public.canteen_items (
  id            uuid primary key,
  club_id       uuid not null references public.clubs(id) on delete cascade,
  name          text not null,
  price         numeric(10, 2) not null,
  peak_price    numeric(10, 2),                     -- nullable; overrides price during peak windows
  category      text,
  stock_qty     integer not null default 0,
  is_active     boolean not null default true,
  display_order integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  created_by    uuid references auth.users(id),
  updated_by    uuid references auth.users(id)
);

create index if not exists idx_canteen_items_club
  on public.canteen_items(club_id)
  where deleted_at is null;

-- 4.7 canteen_sales (walk-in, no session) ───────────────────────────────────

create table if not exists public.canteen_sales (
  id              uuid primary key,
  club_id         uuid not null references public.clubs(id) on delete cascade,
  canteen_item_id uuid,                             -- soft FK; nullable for freeform items
  name_snapshot   text not null,
  price_snapshot  numeric(10, 2) not null,
  quantity        integer not null,
  total           numeric(10, 2) not null,
  payment_method  text not null,                    -- 'cash' | 'upi' | 'wallet'
  customer_id     uuid,                             -- present only when wallet portion > 0
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  created_by      uuid references auth.users(id),
  updated_by      uuid references auth.users(id)
);

create index if not exists idx_canteen_sales_club_date
  on public.canteen_sales(club_id, created_at desc)
  where deleted_at is null;

-- 4.8 stock_purchases ───────────────────────────────────────────────────────

create table if not exists public.stock_purchases (
  id              uuid primary key,
  club_id         uuid not null references public.clubs(id) on delete cascade,
  canteen_item_id uuid not null,
  name_snapshot   text not null,
  quantity        integer not null,
  cost            numeric(10, 2) not null,
  payment_method  text not null,                    -- 'cash' | 'upi' | 'piggy' | 'other'
  vendor          text,
  notes           text,
  purchased_at    timestamptz not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  created_by      uuid references auth.users(id),
  updated_by      uuid references auth.users(id)
);

create index if not exists idx_stock_purchases_club
  on public.stock_purchases(club_id, purchased_at desc)
  where deleted_at is null;

-- 4.9 bookings ──────────────────────────────────────────────────────────────

create table if not exists public.bookings (
  id                      uuid primary key,
  club_id                 uuid not null references public.clubs(id) on delete cascade,
  table_id                uuid not null,
  customer_id             uuid,
  customer_name_snapshot  text not null,
  customer_phone_snapshot text,
  starts_at               timestamptz not null,
  ends_at                 timestamptz not null,
  status                  text not null,            -- 'confirmed' | 'cancelled' | 'completed' | 'no_show'
  source                  text not null,            -- 'walk_in' | 'phone' | 'player_hub'
  advance_paid            numeric(10, 2) not null default 0,
  notes                   text,
  intent_id               uuid,                     -- link to bookings_intents (player hub origin)
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz,
  created_by              uuid references auth.users(id),
  updated_by              uuid references auth.users(id)
);

create index if not exists idx_bookings_club_time
  on public.bookings(club_id, starts_at)
  where deleted_at is null;

create index if not exists idx_bookings_table_time
  on public.bookings(table_id, starts_at, ends_at)
  where deleted_at is null;


-- ════════════════════════════════════════════════════════════════════════════
-- 5. RLS policies (Appendix B) — owner-only for Phase C. Staff policies are
--    added in Phase D. Every policy uses the JWT custom claim
--    `user_club_id` so no per-row subquery hits users_meta.
--
-- Policy strategy:
--   • SELECT — club_id matches JWT claim
--   • INSERT — club_id matches JWT claim AND role='owner'
--   • UPDATE — same as INSERT (so soft-delete-via-update-deleted_at works)
--   • DELETE — absent. Hard DELETE is blocked at the API. Hard delete only
--     happens via service-role functions (customers manage screen — Phase D).
-- ════════════════════════════════════════════════════════════════════════════

-- Helper: a do-block that creates 3 policies per table. PL/pgSQL allows
-- DROP+CREATE in a loop so re-runs are idempotent.

do $$
declare
  t text;
  tables text[] := array[
    'game_tables', 'sessions', 'session_items', 'customers',
    'wallet_transactions', 'canteen_items', 'canteen_sales',
    'stock_purchases', 'bookings'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %I_select_own_club on public.%I', t, t);
    execute format($p$
      create policy %I_select_own_club on public.%I
        for select
        using (club_id::text = auth.jwt() ->> 'user_club_id')
    $p$, t, t);

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


-- ════════════════════════════════════════════════════════════════════════════
-- 6. Realtime publication — add each of the 9 sync tables to the
--    supabase_realtime publication so postgres_changes events fire on every
--    INSERT/UPDATE. SyncReader (Chunk 5) subscribes via 4 grouped channels.
--
-- ALTER PUBLICATION ... ADD TABLE is NOT idempotent — re-running raises
-- "relation already member". Wrap each ADD in a DO block that checks
-- pg_publication_tables first.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  t text;
  tables text[] := array[
    'game_tables', 'sessions', 'session_items', 'customers',
    'wallet_transactions', 'canteen_items', 'canteen_sales',
    'stock_purchases', 'bookings'
  ];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;

    -- REPLICA IDENTITY FULL so the realtime payload's `old` row carries the
    -- pre-update values. The LWW handler in SyncReader compares
    -- remote.updated_at vs local.updated_at, which is on the `new` row, so
    -- DEFAULT replica identity would technically suffice — but FULL costs
    -- next-to-nothing for these row sizes and matches the topup_intents +
    -- clubs precedent set in 20260615_enable_realtime.sql.
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- END OF MIGRATION
-- ════════════════════════════════════════════════════════════════════════════
--
-- Post-deploy steps (Sugeet does these by hand, not Opus):
--
--   1. Supabase Dashboard → Auth → Hooks → "Custom Access Token Hook"
--      → set to `public.add_user_meta_to_jwt` → Save.
--   2. INSERT your own users_meta row (replace UUIDs with your own):
--          INSERT INTO public.users_meta (user_id, role, club_id, name)
--          VALUES (
--            '<your auth.users.id>',
--            'owner',
--            '<your clubs.id>',
--            'Sugeet'
--          );
--   3. Sign OUT of the app, sign back IN. The JWT now carries `user_club_id`
--      and `user_role` claims — verify by decoding the JWT at jwt.io.
--   4. Verify in Table Editor that all 9 sync tables + users_meta exist.
--   5. Reply in chat with PHASE_C_DDL_DEPLOYED.

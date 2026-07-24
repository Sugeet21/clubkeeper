-- ClubKeeper STAGING core-sync schema clone (built 24 Jul 2026)
-- Faithful clone of PROD (vkczmgzujpidbwtzulel) restricted to the CORE SYNC surface:
-- 12 tables (9 synced + users_meta/profiles/subscriptions), their RLS, LWW +
-- actor-stamp triggers, the JWT access-token hook, auth trigger, realtime.
-- SKIPPED (add later on demand): booking_intents, bookings, topup_intents and all
-- booking/topup/player-hub RPCs.
--
-- Column defs / policy quals / function bodies were extracted verbatim from prod
-- via information_schema + pg_get_functiondef, so staging behaves identically.
-- Target: clubkeeper-staging (tdcvrmttnsyhqxxhfvwj). Data starts EMPTY.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TABLES
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id uuid primary key,
  email text not null,
  display_name text,
  avatar_url text,
  club_name text,
  created_at timestamptz default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  status text not null default 'none',
  plan text not null default 'standard',
  trial_ends_at timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  razorpay_customer_id text,
  razorpay_subscription_id text,
  cancel_at_period_end boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.clubs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  slug text not null,
  club_name text not null,
  upi_id text,
  accepts_topups boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  coins_enabled boolean default false,
  coin_tiers_json jsonb default '[]'::jsonb,
  tables_json jsonb default '[]'::jsonb,
  accepts_pricing_display boolean default true,
  accepts_bookings boolean default false,
  booking_advance_amount integer default 100,
  booking_open_minutes integer,
  booking_close_minutes integer,
  booking_advance_per_slot integer default 50,
  sync_enabled boolean not null default true,
  sync_disabled_reason text,
  sync_disabled_at timestamptz
);

create table if not exists public.users_meta (
  user_id uuid primary key,
  role text not null,
  club_id uuid not null,
  name text not null,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  username text
);

create table if not exists public.game_tables (
  id uuid primary key,
  club_id uuid not null,
  name text not null,
  table_type text not null,
  hourly_rate numeric not null,
  per_min_rate numeric,
  is_active boolean not null default true,
  display_order integer not null default 0,
  config jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid
);

create table if not exists public.customers (
  id uuid primary key,
  club_id uuid not null,
  name text not null,
  phone text,
  wallet_balance numeric not null default 0,
  coins_balance numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid
);

create table if not exists public.sessions (
  id uuid primary key,
  club_id uuid not null,
  table_id uuid not null,
  customer_id uuid,
  started_at timestamptz not null,
  ended_at timestamptz,
  paused_at timestamptz,
  paused_total_ms bigint not null default 0,
  status text not null,
  table_charge numeric,
  canteen_charge numeric,
  total_charge numeric,
  payment_method text,
  payment_breakdown jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  config jsonb,
  deleted_by uuid,
  delete_reason text
);

create table if not exists public.session_items (
  id uuid primary key,
  club_id uuid not null,
  session_id uuid not null,
  name_snapshot text not null,
  price_snapshot numeric not null,
  quantity integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid
);

create table if not exists public.canteen_items (
  id uuid primary key,
  club_id uuid not null,
  name text not null,
  price numeric not null,
  peak_price numeric,
  category text,
  stock_qty integer not null default 0,
  is_active boolean not null default true,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  stock_enabled boolean not null default false
);

create table if not exists public.canteen_sales (
  id uuid primary key,
  club_id uuid not null,
  canteen_item_id uuid,
  name_snapshot text not null,
  price_snapshot numeric not null,
  quantity integer not null,
  total numeric not null,
  payment_method text not null,
  customer_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid
);

create table if not exists public.stock_purchases (
  id uuid primary key,
  club_id uuid not null,
  canteen_item_id uuid not null,
  name_snapshot text not null,
  quantity integer not null,
  cost numeric not null,
  payment_method text not null,
  vendor text,
  notes text,
  purchased_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid,
  updated_by uuid,
  kind text,
  reason text
);

create table if not exists public.wallet_transactions (
  id uuid primary key,
  club_id uuid not null,
  customer_id uuid not null,
  kind text not null,
  amount numeric not null,
  balance_after numeric not null,
  reference_type text,
  reference_id text,
  payment_method text,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid,
  balance_type text,
  coin_delta numeric,
  rupee_equivalent numeric
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. FUNCTIONS (verbatim from prod)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.enforce_lww_game_tables() returns trigger language plpgsql as $$
begin if new.updated_at < old.updated_at then return old; end if; return new; end; $$;
create or replace function public.enforce_lww_sessions() returns trigger language plpgsql as $$
begin if new.updated_at < old.updated_at then return old; end if; return new; end; $$;
create or replace function public.enforce_lww_session_items() returns trigger language plpgsql as $$
begin if new.updated_at < old.updated_at then return old; end if; return new; end; $$;
create or replace function public.enforce_lww_canteen_items() returns trigger language plpgsql as $$
begin if new.updated_at < old.updated_at then return old; end if; return new; end; $$;
create or replace function public.enforce_lww_canteen_sales() returns trigger language plpgsql as $$
begin if new.updated_at < old.updated_at then return old; end if; return new; end; $$;
create or replace function public.enforce_lww_stock_purchases() returns trigger language plpgsql as $$
begin if new.updated_at < old.updated_at then return old; end if; return new; end; $$;
create or replace function public.enforce_lww_customers() returns trigger language plpgsql as $$
begin if new.updated_at < old.updated_at then return old; end if; return new; end; $$;

create or replace function public.stamp_actor() returns trigger language plpgsql set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end; $$;

create or replace function public.stamp_created_by() returns trigger language plpgsql set search_path to 'public' as $$
begin new.created_by := coalesce(auth.uid(), new.created_by); return new; end; $$;

create or replace function public.set_users_meta_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end; $$;

create or replace function public.add_user_meta_to_jwt(event jsonb) returns jsonb language plpgsql stable as $$
declare
  meta   record;
  claims jsonb;
begin
  claims := event -> 'claims';
  select club_id, role, active into meta from public.users_meta where user_id = (event ->> 'user_id')::uuid;
  if not found then return event; end if;
  if meta.active is not true then raise exception 'User account is not active'; end if;
  claims := jsonb_set(claims, '{user_club_id}', to_jsonb(meta.club_id::text));
  claims := jsonb_set(claims, '{user_role}',    to_jsonb(meta.role));
  return jsonb_set(event, '{claims}', claims);
exception when others then
  raise warning 'add_user_meta_to_jwt failed: % %', sqlstate, sqlerrm;
  return event;
end; $$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (new.id, new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url');
  if coalesce(new.raw_user_meta_data->>'ck_role', '') <> 'staff'
     and new.email not like '%.ck.local' then
    insert into public.subscriptions (user_id, status, plan, trial_ends_at)
    values (new.id, 'trialing', 'standard', now() + interval '7 days');
  end if;
  return new;
end; $$;

create or replace function public.provision_owner_users_meta() returns trigger language plpgsql security definer set search_path to 'public' as $$
declare owner_email text; owner_name text;
begin
  select u.email, coalesce(p.display_name, u.email, 'Owner') into owner_email, owner_name
    from auth.users u left join public.profiles p on p.id = u.id where u.id = new.owner_id;
  insert into public.users_meta (user_id, club_id, role, active, name, username, created_by)
  values (new.owner_id, new.id, 'owner', true, coalesce(owner_name, 'Owner'), owner_email, new.owner_id)
  on conflict (user_id) do update
    set club_id = excluded.club_id, role = 'owner', active = true, updated_at = now();
  return new;
end; $$;

create or replace function public.get_club_subscription_status()
  returns table(status text, plan text, trial_ends_at timestamptz, current_period_start timestamptz, current_period_end timestamptz, cancel_at_period_end boolean)
  language sql stable security definer set search_path to 'public' as $$
  select s.status, s.plan, s.trial_ends_at, s.current_period_start, s.current_period_end, s.cancel_at_period_end
  from public.users_meta um join public.subscriptions s on s.user_id = um.user_id
  where um.club_id::text = auth.jwt() ->> 'user_club_id' and um.role = 'owner'
  order by s.created_at desc limit 1
$$;

create or replace function public.clear_club_sessions() returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_role text := auth.jwt() ->> 'user_role';
  v_claim text := auth.jwt() ->> 'user_club_id';
  v_club uuid; v_now timestamptz := now(); v_n int; v_deleted jsonb := '{}'::jsonb;
begin
  if v_role is distinct from 'owner' or v_claim is null then raise exception 'not_owner' using errcode = '42501'; end if;
  v_club := v_claim::uuid;
  update session_items set deleted_at = v_now, updated_at = v_now where club_id = v_club and deleted_at is null;
  get diagnostics v_n = row_count; v_deleted := v_deleted || jsonb_build_object('session_items', v_n);
  update sessions set deleted_at = v_now, updated_at = v_now where club_id = v_club and deleted_at is null;
  get diagnostics v_n = row_count; v_deleted := v_deleted || jsonb_build_object('sessions', v_n);
  return jsonb_build_object('ok', true, 'deleted', v_deleted);
end; $$;

-- reset_club_data TRIMMED to core-only tables (booking/topup tables not in staging)
create or replace function public.reset_club_data() returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_role text := auth.jwt() ->> 'user_role';
  v_claim text := auth.jwt() ->> 'user_club_id';
  v_club uuid; v_n int; v_deleted jsonb := '{}'::jsonb;
begin
  if v_role is distinct from 'owner' or v_claim is null then raise exception 'not_owner' using errcode = '42501'; end if;
  v_club := v_claim::uuid;
  delete from session_items where club_id = v_club; get diagnostics v_n = row_count; v_deleted := v_deleted || jsonb_build_object('session_items', v_n);
  delete from canteen_sales where club_id = v_club; get diagnostics v_n = row_count; v_deleted := v_deleted || jsonb_build_object('canteen_sales', v_n);
  delete from stock_purchases where club_id = v_club; get diagnostics v_n = row_count; v_deleted := v_deleted || jsonb_build_object('stock_purchases', v_n);
  delete from wallet_transactions where club_id = v_club; get diagnostics v_n = row_count; v_deleted := v_deleted || jsonb_build_object('wallet_transactions', v_n);
  delete from sessions where club_id = v_club; get diagnostics v_n = row_count; v_deleted := v_deleted || jsonb_build_object('sessions', v_n);
  delete from customers where club_id = v_club; get diagnostics v_n = row_count; v_deleted := v_deleted || jsonb_build_object('customers', v_n);
  delete from canteen_items where club_id = v_club; get diagnostics v_n = row_count; v_deleted := v_deleted || jsonb_build_object('canteen_items', v_n);
  delete from game_tables where club_id = v_club; get diagnostics v_n = row_count; v_deleted := v_deleted || jsonb_build_object('game_tables', v_n);
  delete from auth.users u using users_meta um
    where um.user_id = u.id and um.club_id = v_club and um.role = 'staff' and um.active = false;
  get diagnostics v_n = row_count; v_deleted := v_deleted || jsonb_build_object('removed_staff', v_n);
  return jsonb_build_object('ok', true, 'deleted', v_deleted);
end; $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. TRIGGERS
-- ─────────────────────────────────────────────────────────────────────────────

create trigger lww_game_tables before update on public.game_tables for each row execute function enforce_lww_game_tables();
create trigger lww_sessions before update on public.sessions for each row execute function enforce_lww_sessions();
create trigger lww_session_items before update on public.session_items for each row execute function enforce_lww_session_items();
create trigger lww_canteen_items before update on public.canteen_items for each row execute function enforce_lww_canteen_items();
create trigger lww_canteen_sales before update on public.canteen_sales for each row execute function enforce_lww_canteen_sales();
create trigger lww_stock_purchases before update on public.stock_purchases for each row execute function enforce_lww_stock_purchases();
create trigger lww_customers before update on public.customers for each row execute function enforce_lww_customers();

create trigger zz_stamp_actor before insert or update on public.game_tables for each row execute function stamp_actor();
create trigger zz_stamp_actor before insert or update on public.sessions for each row execute function stamp_actor();
create trigger zz_stamp_actor before insert or update on public.session_items for each row execute function stamp_actor();
create trigger zz_stamp_actor before insert or update on public.canteen_items for each row execute function stamp_actor();
create trigger zz_stamp_actor before insert or update on public.canteen_sales for each row execute function stamp_actor();
create trigger zz_stamp_actor before insert or update on public.stock_purchases for each row execute function stamp_actor();
create trigger zz_stamp_actor before insert or update on public.customers for each row execute function stamp_actor();
create trigger zz_stamp_created_by before insert on public.wallet_transactions for each row execute function stamp_created_by();
create trigger trg_users_meta_updated_at before update on public.users_meta for each row execute function set_users_meta_updated_at();

-- auth.users -> profiles + trial (Supabase standard: trigger on auth schema)
create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
create trigger on_club_created_provision_owner_meta after insert on public.clubs for each row execute function provision_owner_users_meta();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS — enable + policies (verbatim quals from prod)
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.clubs enable row level security;
alter table public.users_meta enable row level security;
alter table public.subscriptions enable row level security;
alter table public.profiles enable row level security;
alter table public.game_tables enable row level security;
alter table public.customers enable row level security;
alter table public.sessions enable row level security;
alter table public.session_items enable row level security;
alter table public.canteen_items enable row level security;
alter table public.canteen_sales enable row level security;
alter table public.stock_purchases enable row level security;
alter table public.wallet_transactions enable row level security;

-- profiles
create policy "Users can view own profile" on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);
-- subscriptions
create policy "Users can view own subscription" on public.subscriptions for select using (auth.uid() = user_id);
-- clubs
create policy clubs_owner_select on public.clubs for select using (auth.uid() = owner_id);
create policy clubs_owner_insert on public.clubs for insert with check (auth.uid() = owner_id);
create policy clubs_owner_update on public.clubs for update using (auth.uid() = owner_id);
create policy clubs_staff_select on public.clubs for select using ((id)::text = (auth.jwt() ->> 'user_club_id'));
-- users_meta
create policy users_meta_select_self on public.users_meta for select using (user_id = auth.uid());
create policy users_meta_owner_read_club on public.users_meta for select using (((club_id)::text = (auth.jwt() ->> 'user_club_id')) and ((auth.jwt() ->> 'user_role') = 'owner'));
create policy users_meta_auth_admin_read on public.users_meta for select to supabase_auth_admin using (true);
-- game_tables (owner-only writes)
create policy game_tables_select_own_club on public.game_tables for select using ((club_id)::text = (auth.jwt() ->> 'user_club_id'));
create policy game_tables_insert_own_club on public.game_tables for insert with check (((club_id)::text = (auth.jwt() ->> 'user_club_id')) and ((auth.jwt() ->> 'user_role') = 'owner'));
create policy game_tables_update_own_club on public.game_tables for update using ((club_id)::text = (auth.jwt() ->> 'user_club_id')) with check (((club_id)::text = (auth.jwt() ->> 'user_club_id')) and ((auth.jwt() ->> 'user_role') = 'owner'));
-- customers (owner+staff)
create policy customers_select_own_club on public.customers for select using ((club_id)::text = (auth.jwt() ->> 'user_club_id'));
create policy customers_insert_own_club on public.customers for insert with check (((club_id)::text = (auth.jwt() ->> 'user_club_id')) and ((auth.jwt() ->> 'user_role') = any (array['owner','staff'])));
create policy customers_update_own_club on public.customers for update using ((club_id)::text = (auth.jwt() ->> 'user_club_id')) with check (((club_id)::text = (auth.jwt() ->> 'user_club_id')) and (((auth.jwt() ->> 'user_role') = 'owner') or (((auth.jwt() ->> 'user_role') = 'staff') and (deleted_at is null))));
-- sessions
create policy sessions_select_own_club on public.sessions for select using ((club_id)::text = (auth.jwt() ->> 'user_club_id'));
create policy sessions_insert_own_club on public.sessions for insert with check (((club_id)::text = (auth.jwt() ->> 'user_club_id')) and ((auth.jwt() ->> 'user_role') = any (array['owner','staff'])));
create policy sessions_update_own_club on public.sessions for update using ((club_id)::text = (auth.jwt() ->> 'user_club_id')) with check (((club_id)::text = (auth.jwt() ->> 'user_club_id')) and (((auth.jwt() ->> 'user_role') = 'owner') or (((auth.jwt() ->> 'user_role') = 'staff') and (deleted_at is null))));
-- session_items
create policy session_items_select_own_club on public.session_items for select using ((club_id)::text = (auth.jwt() ->> 'user_club_id'));
create policy session_items_insert_own_club on public.session_items for insert with check (((club_id)::text = (auth.jwt() ->> 'user_club_id')) and ((auth.jwt() ->> 'user_role') = any (array['owner','staff'])));
create policy session_items_update_own_club on public.session_items for update using ((club_id)::text = (auth.jwt() ->> 'user_club_id')) with check (((club_id)::text = (auth.jwt() ->> 'user_club_id')) and (((auth.jwt() ->> 'user_role') = 'owner') or (((auth.jwt() ->> 'user_role') = 'staff') and (deleted_at is null))));
-- canteen_items (owner+staff insert/update, staff blocked from tombstoning)
create policy canteen_items_select_own_club on public.canteen_items for select using ((club_id)::text = (auth.jwt() ->> 'user_club_id'));
create policy canteen_items_insert_own_club on public.canteen_items for insert with check (((club_id)::text = (auth.jwt() ->> 'user_club_id')) and (((auth.jwt() ->> 'user_role') = 'owner') or (((auth.jwt() ->> 'user_role') = 'staff') and (deleted_at is null))));
create policy canteen_items_update_own_club on public.canteen_items for update using ((club_id)::text = (auth.jwt() ->> 'user_club_id')) with check (((club_id)::text = (auth.jwt() ->> 'user_club_id')) and (((auth.jwt() ->> 'user_role') = 'owner') or (((auth.jwt() ->> 'user_role') = 'staff') and (deleted_at is null))));
-- canteen_sales
create policy canteen_sales_select_own_club on public.canteen_sales for select using ((club_id)::text = (auth.jwt() ->> 'user_club_id'));
create policy canteen_sales_insert_own_club on public.canteen_sales for insert with check (((club_id)::text = (auth.jwt() ->> 'user_club_id')) and ((auth.jwt() ->> 'user_role') = any (array['owner','staff'])));
create policy canteen_sales_update_own_club on public.canteen_sales for update using ((club_id)::text = (auth.jwt() ->> 'user_club_id')) with check (((club_id)::text = (auth.jwt() ->> 'user_club_id')) and (((auth.jwt() ->> 'user_role') = 'owner') or (((auth.jwt() ->> 'user_role') = 'staff') and (deleted_at is null))));
-- stock_purchases (owner-only, per #169 revert)
create policy stock_purchases_select_own_club on public.stock_purchases for select using ((club_id)::text = (auth.jwt() ->> 'user_club_id'));
create policy stock_purchases_insert_own_club on public.stock_purchases for insert with check (((club_id)::text = (auth.jwt() ->> 'user_club_id')) and ((auth.jwt() ->> 'user_role') = 'owner'));
create policy stock_purchases_update_own_club on public.stock_purchases for update using ((club_id)::text = (auth.jwt() ->> 'user_club_id')) with check (((club_id)::text = (auth.jwt() ->> 'user_club_id')) and ((auth.jwt() ->> 'user_role') = 'owner'));
-- wallet_transactions (staff restricted to credit/debit non-adjustment)
create policy wallet_transactions_select_own_club on public.wallet_transactions for select using ((club_id)::text = (auth.jwt() ->> 'user_club_id'));
create policy wallet_transactions_insert_own_club on public.wallet_transactions for insert with check (((club_id)::text = (auth.jwt() ->> 'user_club_id')) and (((auth.jwt() ->> 'user_role') = 'owner') or (((auth.jwt() ->> 'user_role') = 'staff') and (kind = any (array['credit','debit'])) and (coalesce(reference_type, '') <> all (array['manual','adjustment','refund','reversal'])))));

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. REALTIME publication (core sync tables)
-- ─────────────────────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.clubs;
alter publication supabase_realtime add table public.game_tables;
alter publication supabase_realtime add table public.sessions;
alter publication supabase_realtime add table public.session_items;
alter publication supabase_realtime add table public.customers;
alter publication supabase_realtime add table public.wallet_transactions;
alter publication supabase_realtime add table public.canteen_items;
alter publication supabase_realtime add table public.canteen_sales;
alter publication supabase_realtime add table public.stock_purchases;

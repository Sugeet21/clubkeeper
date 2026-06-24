# Sync Architecture — ClubKeeper Multi-Device + Staff Login

**Status:** Phase A v3 — Architecture & Decision Doc (post code-review reality check)
**Owner:** Sugeet
**Driver:** Ball Bender (4 partners + staff) refusing to use offline-only app
**Target ship:** ~4 weeks from start of Phase B
**Last updated:** Phase A v3 — patched after Sonnet pre-flight investigation found 9 doc-vs-code mismatches

This document is the source of truth for the multi-device sync + staff login project. Every architectural decision lives here. If we deviate during build, we update this doc first, then code. No exceptions.

### v3.2 amendment — Phase C Chunk 0 (25 Jun 2026)

§4.2 `session_items` DDL **drops the `canteen_item_id UUID NOT NULL` column**. Reason: the Dexie `SessionItem` interface has never carried a `canteenItemId` field — session items are denormalised snapshots (`name`, `price`, `quantity`) captured at add-time, and the canteen master row is intentionally NOT referenced post-write (so renaming/repricing a canteen item leaves history unchanged). The original v2 DDL invented a column that has no source. Adding `NOT NULL` would break every sync push because the Dexie row provides no value. The snapshot fields are authoritative; the FK adds nothing.

Also added in Chunk 0: `_migrationSeq?: number` typed on `GameTable`, `Session`, `SessionItem`, `CanteenItem` interfaces (§10.4 resumable upload). New `SyncTableName` union exported from `src/types/index.ts` using **snake_case Supabase names** so `SyncRunner.pushOne` can pass the wire-format string directly to `supabase.from(table)` without a hot-path conversion. `OutboxRow.table` retyped from raw `string` → `SyncTableName`. `Booking.tableId` and `Booking.consumedSessionId` narrowed `number` → `string` (Step 2 audit miss). Defensive: `.upgrade()` callback's bookings .modify() now remaps `consumedSessionId` legacy numerics through `idMaps.sessions` (it only remapped `tableId` before).

Also: production `clubs.owner_id` (not `owner_user_id` as v2 §4.1 said) — Chunk 1 + Chunk 2 use the existing column name.

---

### v3.1 addendum — Phase B step 1.5, after BUG-B1 (#107, 24 Jun 2026 evening)

Step 1 was specified as "schema + polyfill + runtime guards, ZERO data change." That promise broke on the first dev-server run because **seed.ts pre-assigns UUIDs to gameTables rows** (correctly, per §5.2). With v20 schema in force on a fresh IndexedDB, every seeded row was UUID-keyed immediately — meaning the "no data change yet" assumption only held for upgrading users, not new/empty DBs. Two downstream ripples were missed in the v3 audit and surfaced as crashes:

1. **Route param coercion (Pattern R5).** Every page using `useParams()` did `Number(routeParam)` at the boundary. `Number("<uuid>")` → NaN → `db.X.get(NaN)` DataError. Fix: dual-accept parser with `String(n) === raw` round-trip check. Documented as Pattern R5 in `bug_patterns.md`. Affected: `StartSession.tsx`, `SessionDetail.tsx`.

2. **`db.X.add()` on plain `id` schema (Pattern D12).** v20 store strings dropped `++` from the 4 tables, so callers MUST supply `id`. Step 2 was supposed to handle this; #107 forced it forward. All 8 `.add()` sites + 1 component now pre-generate `crypto.randomUUID()`. `addTable / addCanteenItem / addSessionItem / startSession` return type narrowed to `Promise<string>`. 13 query-layer signatures widened from `number` → `number | string`.

**Lesson for Step 2:** the v3 audit hunted for `typeof !== 'number'` runtime guards but did not enumerate `.add()` sites or `Number(routeParam)` sites. Both should be checked as part of any schema-flip audit. The presence of explicit `TODO(phase-b-step-2)` comments at the `.add()` sites helped diagnosis but did not prevent the crash — the schema flip and the migration of the `.add()` call sites need to ship together.

**Remaining Step 2 work narrows to:** (a) the `.upgrade()` callback that rewrites pre-existing numeric-id rows to UUIDs, (b) collapsing all `number | string` unions to `string`, (c) removing dual-accept runtime guards in `confirmPaymentAndStop` + `recordSessionPaymentBreakdown` + the route-boundary parsers, (d) the forced pre-v20 auto-backup before upgrade runs. The `.add()` rewrites are no longer in scope (already done).

### v3 changelog (corrections from code review, 24 Jun 2026)

The v2 doc was written from memory. A read-only code investigation by Sonnet revealed the following errors. THE CODE WINS — v3 reflects what's actually shipped, not what was assumed:

1. **§5 scope corrected** — only **4 tables** need UUID migration (gameTables, sessions, sessionItems, canteenItems), not 9. The other 5 (customers, walletTransactions, canteenSales, stockPurchases, bookings) **already use string id** in production today, dating back to v5 / v13 / v17. They are already UUID-ready.
2. **§5.1 DB rename removed** — v2 proposed renaming to `clubkeeper_${userId}`. Code already uses `ClubKeeperDB_${userId}` (capital, underscore). Rename is unnecessary, adds migration risk for zero benefit. **Keep existing name.**
3. **§5.2 WALKIN sentinel scope corrected** — `WALKIN_TABLE_ID = -1` lives in `src/lib/summaryMath.ts:9`, used **only** for summary-page aggregations (synthesised TableSummary rows for walk-in canteen revenue). It is NEVER stored in Dexie. Walk-in canteen sales go through `createCanteenSale` which has no `tableId` field at all. **No Dexie migration needed for WALKIN.** Optionally convert the lib constant to a UUID string for type consistency post-v20, but it's a 1-line change with zero data impact.
4. **§4.3 / §5.2 settings keying** — `settings` table is `Table<ClubSettings, number>` with id=1 singleton. Stays as-is. NOT migrated to string keys. The v2 doc implied a settings migration; there isn't one.
5. **§5.4 polyfill urgency raised** — `crypto.randomUUID()` is already called in 4 lib files today (`coinExpiry.ts`, `nudge.ts`, `streak.ts`, `walkInCode.ts`) with NO polyfill anywhere. The app already crashes on iOS Safari < 15.4 — it just hasn't been reported yet. v20 ships the polyfill, fixing both the existing latent bug AND the new UUID-everywhere usage.
6. **§5 NEW: critical type-guard hazard at queries.ts:301** — `confirmPaymentAndStop` contains `if (typeof sessionId !== 'number' || ...)` runtime guard. After v20 (sessionId becomes UUID string), this throws on EVERY payment confirmation. Without fixing this BEFORE v20 ships, the app bricks the payment flow on upgrade. **Must remove/replace before migration code is even written.** Same for any `Number.isFinite(sessionId)` check on migrated IDs.
7. **§5 NEW: cast site at queries.ts:1060** — `const sessionId = (await db.sessions.add(proto)) as number` — the `as number` cast must become `as string` post-v20. Easy fix but easy to miss.
8. **§4.4 outbox table location** — outbox does not exist yet. Will be added IN Phase B as part of v20 schema (so Phase C has it ready). Schema-only; no Phase B logic uses it.
9. **§7.1 / §10.4 _migrationSeq field** — added during v20 upgrade per row in the 4 migrated tables, so Phase C's resumable cloud upload doesn't need another schema bump.

The original v2 §12 sign-off remains valid — these are implementation corrections, not decision changes. Owner does NOT need to re-sign §12.

### v2 changelog (kept for history — what changed from v1)

1. **§4.5 added** — JWT custom claims for `club_id` so RLS doesn't subquery `users_meta` on every read
2. **§4.6 added** — wallet append-only contract clarified (adjustments and refunds are new rows, never edits)
3. **§2 updated** — customer delete is owner-only via a hidden screen; staff cannot delete
4. **§4.7 added** — "business day" defined as 6 AM IST boundary, hardcoded for v1
5. **§10.4 added** — existing-user migration upload protocol (batches, resumable, progress)
6. **§4.8 added** — `bookings_intents` ↔ `bookings` linkage confirmed
7. **§4.9 added** — sync kill-switch (`clubs.sync_enabled`) for emergency disable

---

## 1. Goals + non-goals

### Goals

- Same owner Gmail can sign in on N devices and see real-time synchronised data
- Owner can create staff logins (email + password) from inside the app
- Staff have role-restricted access to a subset of screens
- App remains **offline-first** — Dexie stays the source of truth on device
- All data lives forever in Supabase (no auto-deletion)
- Existing offline-only users (none paying yet, but they exist) can opt-in later via a one-time push of local → Supabase

### Non-goals (deliberate cuts)

- ❌ Cross-club access (one owner ↔ one club, period)
- ❌ Partner role (handled via shared Gmail or via multiple staff accounts)
- ❌ Magic links, phone OTP, SSO beyond existing Google
- ❌ Conflict resolution UI (last-write-wins, silent)
- ❌ Audit log UI surface (data is captured, no screen)
- ❌ Archive / cold storage / data compression
- ❌ Push notifications to staff devices
- ❌ Read replicas, analytics warehouse, BigQuery export
- ❌ Multi-club for one owner
- ❌ Custom permission levels beyond `owner` and `staff`

If anyone asks for any of the above during the build, the answer is "later." That includes Sugeet.

---

## 2. Permission matrix (owner vs staff)

This is the locked permission set. **Every screen must implement this.** No screen is allowed to exist outside this table.

| Surface / Action | Owner | Staff |
|---|---|---|
| Home (tables grid) | ✅ | ✅ |
| Start session | ✅ | ✅ |
| Stop session | ✅ | ✅ |
| Pause / resume session | ✅ | ✅ |
| Edit session start time | ✅ | ❌ |
| Move session between tables | ✅ | ❌ |
| Add canteen item to active session | ✅ | ✅ |
| Edit session `paymentBreakdown` | ✅ | ❌ |
| Delete session | ✅ | ❌ |
| Back Entries page | ✅ | ❌ |
| Canteen page (view items) | ✅ | ✅ |
| Add direct canteen sale | ✅ | ✅ |
| Edit canteen item (name, price) | ✅ | ❌ |
| Manage peak pricing | ✅ | ❌ |
| Restock canteen item | ✅ | ❌ |
| Customers list | ✅ | ✅ |
| Customer detail | ✅ | ✅ |
| Edit customer (name, phone) | ✅ | ❌ |
| Delete customer (hidden screen, hard delete only) | ✅ (via /settings/customers/manage) | ❌ |
| Top up wallet | ✅ | ✅ |
| Manual wallet adjustment | ✅ | ❌ |
| Wallet refund (when shipped) | ✅ | ❌ |
| Approve player-hub topup intent | ✅ | ✅ |
| Quick Sale | ✅ | ✅ |
| Bookings list | ✅ | ✅ |
| Create booking | ✅ | ✅ |
| Cancel booking | ✅ | ✅ |
| Booking config (hours / pricing) | ✅ | ❌ |
| Summary dashboard — full | ✅ | ❌ |
| **Summary dashboard — today-only strip** | ✅ | ✅ |
| Piggy page (cash flow) | ✅ | ❌ |
| Stock Purchases page | ✅ | ❌ |
| Settings — entire page | ✅ | ❌ |
| Staff management | ✅ | ❌ |
| Subscribe / billing | ✅ | ❌ |
| Backup / restore | ✅ | ❌ |
| Export data | ✅ | ❌ |

### How "today-only Summary" works for staff

Staff opening Summary sees a **single card**: today's total revenue, sessions count, canteen sales count. No date picker, no previous days, no charts, no comparisons, no piggy breakdown. The full Summary component renders behind a `role === 'owner'` gate.

### Locked role names

- `owner` — Google OAuth user, full access
- `staff` — email/password user, restricted access

These strings appear in code, Supabase metadata, and DB rows. **Do not rename them later** — it breaks every RLS policy. If we ever need a third role, add a new string (`partner`, `manager`, etc.) — don't repurpose existing ones.

---

## 3. Identity model

### Supabase auth users

Two kinds of `auth.users` rows:

1. **Owner** — created via Google OAuth (existing flow). Provider = `google`.
2. **Staff** — created by owner via admin API. Provider = `email`. Email is owner-generated (`<name>@<clubslug>.ck.local` or similar — see §3.3).

### `users_meta` table (new)

```sql
CREATE TABLE users_meta (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'staff')),
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                    -- display name, eg "Rajesh"
  active BOOLEAN NOT NULL DEFAULT true,  -- false = revoked, can't sign in
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_meta_club_id ON users_meta(club_id);
```

- Every `auth.users` row has exactly one `users_meta` row.
- `club_id` is the **single source of truth** for "which club's data can this user see."
- Owner's `users_meta.club_id` === their `clubs.id`.
- Staff's `users_meta.club_id` === their owner's `clubs.id`.
- Multiple users can share the same `club_id` (1 owner + N staff).

### Staff email scheme

Owner adds staff "Rajesh". App generates:
- Email: `rajesh.<random-4-digit>@<clubslug>.ck.local`
- Password: random 8-char alphanumeric, shown ONCE on screen

The `.ck.local` domain is fake — Supabase doesn't send emails to it, doesn't verify it, doesn't care. The email is a unique credential string, not a real inbox. Staff never receives email; owner hands them the credentials on a slip of paper.

**Rationale:** Real emails require staff to have email addresses, then deal with verification, then password reset flows. Staff at clubs often don't have working email. This pattern (username-as-fake-email) is used by Slack, Discord, etc. for service accounts.

### Account-switch flow on shared device

A phone might be used by Rajesh in morning and Suresh in evening. The flow:

1. Tap "Sign out" in Settings (or Home avatar menu)
2. App calls `closeDexieDb()` — closes connection, does NOT delete data
3. App routes to `/login`
4. New user signs in
5. App calls `initDbForUser(newUserId)` — opens fresh per-user Dexie database
6. Background `initialPullForUser(newUserId)` populates Dexie from Supabase

**Critical:** Dexie database name is **scoped per user** — `clubkeeper_${userId}`. This means:
- Rajesh's local Dexie has Rajesh's view, Suresh's has Suresh's
- Switching users does NOT contaminate cached data
- One physical device can host multiple user accounts cleanly

This is a change from today's single global `ClubKeeperDB` database. **Schema v20 migration must rename the existing DB.**

---

## 4. Supabase schema — full DDL

### 4.1 Existing tables (extended)

`clubs` already exists. Add columns:
```sql
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id);
-- backfill: UPDATE clubs SET owner_user_id = <existing owner auth id> WHERE id = <club id>;
```

`subscriptions`, `topup_intents`, `bookings_intents` — no schema changes. RLS already correct.

### 4.2 New synced tables (the 9 from Dexie)

All tables share a common shape:
- `id` UUID primary key
- `club_id` UUID NOT NULL — RLS partition key
- `created_at`, `updated_at` TIMESTAMPTZ
- `created_by` UUID — auth.users(id), for audit
- `updated_by` UUID — auth.users(id), for last-write-wins ties
- Soft-delete: `deleted_at` TIMESTAMPTZ NULL — set instead of DELETE, so realtime can broadcast removal

```sql
-- 1. game_tables
CREATE TABLE game_tables (
  id UUID PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  table_type TEXT NOT NULL,                  -- 'pool' | 'snooker' | 'carrom' | 'ps5' | etc.
  hourly_rate NUMERIC(10,2) NOT NULL,
  per_min_rate NUMERIC(10,2),
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  config JSONB,                              -- type-specific config (eg snooker billing rule)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);
CREATE INDEX idx_game_tables_club ON game_tables(club_id) WHERE deleted_at IS NULL;

-- 2. sessions
CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  table_id UUID NOT NULL,                    -- soft FK to game_tables (or WALKIN sentinel)
  customer_id UUID,                          -- soft FK to customers, nullable
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  paused_total_ms BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL,                      -- 'active' | 'paused' | 'completed'
  table_charge NUMERIC(10,2),
  canteen_charge NUMERIC(10,2),
  total_charge NUMERIC(10,2),
  payment_method TEXT,                       -- 'cash' | 'upi' | 'wallet' | 'mixed' | null
  payment_breakdown JSONB,                   -- { cash: 100, upi: 50, wallet: 25 }
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);
CREATE INDEX idx_sessions_club_status ON sessions(club_id, status) WHERE deleted_at IS NULL;
CREATE INDEX idx_sessions_club_started ON sessions(club_id, started_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_sessions_customer ON sessions(customer_id) WHERE deleted_at IS NULL;

-- 3. session_items (canteen items billed to a session)
-- v3.2 AMENDMENT (Phase C Chunk 0): canteen_item_id column DROPPED. The Dexie
-- SessionItem interface never carried this field — items are denormalised
-- snapshots so a renamed/repriced canteen item leaves history intact. Adding
-- NOT NULL would break every sync push because the row has no value to send.
-- The name_snapshot + price_snapshot fields are authoritative.
CREATE TABLE session_items (
  id UUID PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,                  -- soft FK to sessions
  name_snapshot TEXT NOT NULL,               -- denormalised for historical accuracy
  price_snapshot NUMERIC(10,2) NOT NULL,
  quantity INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);
CREATE INDEX idx_session_items_session ON session_items(session_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_session_items_club ON session_items(club_id) WHERE deleted_at IS NULL;

-- 4. customers
CREATE TABLE customers (
  id UUID PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  wallet_balance NUMERIC(10,2) NOT NULL DEFAULT 0,
  coins_balance NUMERIC(10,2) NOT NULL DEFAULT 0,  -- if club uses coin system
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);
CREATE INDEX idx_customers_club ON customers(club_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_phone ON customers(club_id, phone) WHERE deleted_at IS NULL AND phone IS NOT NULL;

-- 5. wallet_transactions (APPEND-ONLY LEDGER — never UPDATE, never DELETE)
-- Corrections happen by inserting new reversing rows. See §4.6.
CREATE TABLE wallet_transactions (
  id UUID PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL,                 -- soft FK
  kind TEXT NOT NULL,                        -- 'topup' | 'debit' | 'refund' | 'adjustment' | 'coin_redeem' | 'reversal'
  amount NUMERIC(10,2) NOT NULL,             -- positive for credit, negative for debit
  balance_after NUMERIC(10,2) NOT NULL,      -- snapshot at write time; recomputed on read for correctness
  reference_type TEXT,                       -- 'session' | 'topup_intent' | 'manual' | 'reverses' | null
  reference_id UUID,                         -- session.id, topup_intents.id, or the wallet_transactions.id this row reverses
  payment_method TEXT,                       -- for topups: 'cash' | 'upi' | 'razorpay'
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- wallet_transactions are immutable. No updated_at, no deleted_at.
  -- Mistakes = create a reversing transaction (kind='reversal', reference_id=original.id, amount=-original.amount).
  created_by UUID REFERENCES auth.users(id)
);
CREATE INDEX idx_wallet_tx_customer ON wallet_transactions(customer_id, created_at DESC);
CREATE INDEX idx_wallet_tx_club ON wallet_transactions(club_id, created_at DESC);

-- 6. canteen_items
CREATE TABLE canteen_items (
  id UUID PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  peak_price NUMERIC(10,2),                  -- nullable, overrides price during peak windows
  category TEXT,                             -- 'drink' | 'snack' | 'meal' | etc.
  stock_qty INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);
CREATE INDEX idx_canteen_items_club ON canteen_items(club_id) WHERE deleted_at IS NULL;

-- 7. canteen_sales (direct sales, not bound to a session)
CREATE TABLE canteen_sales (
  id UUID PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  canteen_item_id UUID NOT NULL,             -- soft FK
  name_snapshot TEXT NOT NULL,
  price_snapshot NUMERIC(10,2) NOT NULL,
  quantity INTEGER NOT NULL,
  total NUMERIC(10,2) NOT NULL,
  payment_method TEXT NOT NULL,              -- 'cash' | 'upi' | 'wallet'
  customer_id UUID,                          -- if paid via wallet
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);
CREATE INDEX idx_canteen_sales_club_date ON canteen_sales(club_id, created_at DESC) WHERE deleted_at IS NULL;

-- 8. stock_purchases
CREATE TABLE stock_purchases (
  id UUID PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  canteen_item_id UUID NOT NULL,
  name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  cost NUMERIC(10,2) NOT NULL,               -- total paid
  payment_method TEXT NOT NULL,              -- 'cash' | 'upi' | 'piggy' | etc.
  vendor TEXT,
  notes TEXT,
  purchased_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);
CREATE INDEX idx_stock_purchases_club ON stock_purchases(club_id, purchased_at DESC) WHERE deleted_at IS NULL;

-- 9. bookings (advance reservations, owner-managed; player intents come in via bookings_intents)
CREATE TABLE bookings (
  id UUID PRIMARY KEY,
  club_id UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  table_id UUID NOT NULL,                    -- soft FK
  customer_id UUID,                          -- soft FK, nullable
  customer_name_snapshot TEXT NOT NULL,
  customer_phone_snapshot TEXT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,                      -- 'confirmed' | 'cancelled' | 'completed' | 'no_show'
  source TEXT NOT NULL,                      -- 'walk_in' | 'phone' | 'player_hub'
  advance_paid NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes TEXT,
  intent_id UUID,                            -- link to bookings_intents if from player hub
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  updated_by UUID REFERENCES auth.users(id)
);
CREATE INDEX idx_bookings_club_time ON bookings(club_id, starts_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_bookings_table_time ON bookings(table_id, starts_at, ends_at) WHERE deleted_at IS NULL;
```

### 4.3 `settings` — stays partly local

`settings` is a singleton per club in current Dexie. The current `clubs` Supabase table already mirrors the player-hub-relevant subset (slug, hours, accepts_topups, coin config). Decision:

- **Cloud-synced settings** (already in `clubs`): slug, name, hours, accepts_topups, coin config, peak hours config
- **Local-only settings**: UI preferences (theme, default tab), backup reminders, last-seen-tour-version, etc.

Owner-changed settings that touch synced fields write to both Dexie `settings` row and Supabase `clubs` row (existing pattern S11 — keep it).

### 4.4 `sync_outbox` — does NOT exist server-side

The outbox is **Dexie-only** (client-side). Server has no outbox concept. Server-side dead-letter handling = Supabase logs + manual investigation. This keeps the architecture simple.

---

### 4.5 JWT custom claims — RLS performance fix

**Problem:** RLS policies written as `club_id IN (SELECT club_id FROM users_meta WHERE user_id = auth.uid())` add a subquery to every row read. With 5 devices polling realtime + initial pulls of ~10k rows, this becomes a noticeable hot path.

**Fix:** Embed `club_id` and `role` directly in the JWT issued at sign-in, then RLS becomes a direct equality check (no subquery, constant time).

**How to do it in Supabase:**

```sql
-- Trigger that populates JWT claims when user signs in via auth hook
-- Configure in Supabase Dashboard → Auth → Auth Hooks → Custom Access Token Hook

CREATE OR REPLACE FUNCTION public.add_user_meta_to_jwt(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  meta RECORD;
  claims jsonb;
BEGIN
  claims := event->'claims';
  SELECT club_id, role, active INTO meta
    FROM public.users_meta
    WHERE user_id = (event->>'user_id')::uuid;

  IF meta.active IS NOT TRUE THEN
    RAISE EXCEPTION 'User account is not active';
  END IF;

  claims := jsonb_set(claims, '{user_club_id}', to_jsonb(meta.club_id::text));
  claims := jsonb_set(claims, '{user_role}', to_jsonb(meta.role));
  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;
```

Then the standard RLS policy becomes:

```sql
CREATE POLICY "<table>_select_own_club" ON <table>
  FOR SELECT
  USING (club_id::text = auth.jwt() ->> 'user_club_id');

CREATE POLICY "<table>_insert_own_club" ON <table>
  FOR INSERT
  WITH CHECK (
    club_id::text = auth.jwt() ->> 'user_club_id'
    -- role check for owner-only tables:
    -- AND (auth.jwt() ->> 'user_role') = 'owner'
  );
```

**Trade-off:** Claims are baked into the JWT at sign-in. If we revoke staff (`active = false`), they keep working until their JWT expires (default 1 hour). For the "instant revoke" case (§9 — staff fired mid-shift), we also call `supabase.auth.admin.signOut(userId)` from the owner's device when removing them. Acceptable trade-off — instant revoke is the rare case, fast reads are the constant case.

---

### 4.6 Wallet append-only contract — explicit

The `wallet_transactions` table is **strictly append-only.** No code path anywhere — staff, owner, admin — UPDATEs or DELETEs a row. The contract:

| Action user takes | What the app does |
|---|---|
| Customer tops up ₹500 | INSERT row: kind='topup', amount=+500 |
| Customer pays for session via wallet (₹150) | INSERT row: kind='debit', amount=-150, reference_id=session.id |
| Owner does Manual Adjustment +₹100 (gift) | INSERT row: kind='adjustment', amount=+100, notes='reason' |
| Owner does Manual Adjustment -₹50 (correction) | INSERT row: kind='adjustment', amount=-50, notes='reason' |
| Owner refunds a topup | INSERT row: kind='refund', amount=-500, reference_id=topup_row.id |
| Owner clicks "Undo this transaction" on row X | INSERT row: kind='reversal', amount=-(X.amount), reference_id=X.id |
| Owner tries to "edit" a wrong row | UI hides edit — only "Reverse" CTA is shown |

**Why this matters for sync:** Append-only is **commutative under sync**. Two devices appending wallet rows offline can never conflict — both rows survive, balance = sum. If we allowed edits, two-device edits would create a true conflict requiring resolution.

**Balance recomputation:**
- `balance_after` is written at INSERT time as a snapshot for display
- On read in customer detail, we recompute `SELECT SUM(amount) FROM wallet_transactions WHERE customer_id = ? AND created_at <= now()` for safety
- The two should match unless there was an out-of-order write across devices, in which case the SUM is truth
- Recomputed value silently overwrites the stale `balance_after` on Dexie via a "background heal" task daily

**The customer row `wallet_balance` field is denormalised cache.** Truth lives in transactions. Heal job recomputes the customer row every time we touch it.

---

### 4.7 Business day boundary — locked

**"Today" for revenue purposes = 6:00 AM IST today → 5:59:59 AM IST tomorrow.**

Rationale: most ClubKeeper clubs operate evening into late night (typical close 12 AM–2 AM). A session that started 11 PM and ended 1:30 AM is owner-conceptually "tonight's revenue" and shouldn't split across two calendar days.

Implementation (queries.ts utility):
```ts
export const BUSINESS_DAY_START_HOUR_IST = 6;

/** Returns the business-day-start instant for the IST day containing `t`. */
export function businessDayStart(t: Date = new Date()): Date {
  // Convert to IST, subtract 6h offset so 6AM IST is the day's "midnight"
  const ist = new Date(t.getTime() + (5.5 * 3600_000) - (BUSINESS_DAY_START_HOUR_IST * 3600_000));
  ist.setUTCHours(0, 0, 0, 0);
  // Convert back: add the 6h, subtract IST offset
  return new Date(ist.getTime() - (5.5 * 3600_000) + (BUSINESS_DAY_START_HOUR_IST * 3600_000));
}

export function businessDayRangeForToday(): { from: Date; to: Date } {
  const from = businessDayStart();
  const to = new Date(from.getTime() + 24 * 3600_000);
  return { from, to };
}
```

**All revenue calculations use these helpers.** No more `new Date().setHours(0,0,0,0)` anywhere.

- Hardcoded for v1
- Owner-configurable boundary = §14 deferred list
- 24-hour clubs (rare): they get full 24h windows, no big deal

---

### 4.8 `bookings_intents` ↔ `bookings` linkage

Existing `bookings_intents` table (no schema change) keys on `id UUID`. The new `bookings.intent_id UUID` is a soft FK to it. Flow:

1. Player creates `bookings_intents` row via player hub (existing, Supabase-direct)
2. Owner sees it in app via existing realtime subscription
3. Owner taps "Approve" → app creates a `bookings` row with `intent_id = intent.id`, `source = 'player_hub'`
4. Same transaction updates `bookings_intents.status = 'approved'`
5. Realtime broadcasts both rows to all owner+staff devices

If a player intent is approved offline on Phone A, the bookings row is queued in outbox, intent update is a separate outbox write. Order matters but isn't critical — if intent-update lands first, that's fine. If bookings lands first, briefly the intent shows "pending" while the row already exists. Self-heals in <2s.

**One verification action for Phase B:** confirm `bookings_intents.id` is currently `UUID` type (not `bigint`). If it's bigint, we either (a) leave bookings_intents as-is and store the bigint as text in `bookings.intent_id_legacy`, or (b) migrate intents to UUID too. **Assume (a) until confirmed.**

---

### 4.9 Sync kill-switch — emergency disable

Add to `clubs` table:

```sql
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS sync_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS sync_disabled_reason TEXT;
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS sync_disabled_at TIMESTAMPTZ;
```

**Flow:**
- App fetches `clubs.sync_enabled` at boot (one query, before opening Dexie sync)
- If `false`: app runs in **pure offline mode** — outbox stops, realtime channels don't subscribe, sync indicator shows "Sync disabled by support — contact Sugeet"
- Owner can keep using the app fully (it's offline-first)
- Sugeet (you) flips the flag in Supabase Dashboard manually when something goes wrong
- To re-enable: flip the flag back, owner restarts the app, sync resumes from outbox

**When you'd use it:**
- Bad RLS deployment broke writes — disable to stop error spam, fix server, re-enable
- A bad client release is corrupting data — disable for affected clubs while you ship a fix
- A customer reports "my numbers are wrong" — disable their sync, investigate Supabase state, restore, re-enable

**5-min companion script (you'll want this):** small admin page at `/admin/clubs` (gated to your Gmail only) that lists all clubs with toggle switches for sync_enabled. You can build it in Phase E or skip it and use Supabase Dashboard for v1.

---

## 5. UUID strategy — Dexie v20 spec

### 5.1 What changes (CORRECTED from code review)

**Only 4 tables need migration.** The other 5 already use string `id` from earlier versions.

| Table | Today (v19) | After (v20) | Why |
|---|---|---|---|
| `gameTables` | `++id` (number) | `id` (UUID string) | **NEEDS MIGRATION** |
| `sessions` | `++id` (number) | `id` (UUID string) | **NEEDS MIGRATION** |
| `sessionItems` | `++id` (number) | `id` (UUID string) | **NEEDS MIGRATION** |
| `canteenItems` | `++id` (number) | `id` (UUID string) | **NEEDS MIGRATION** |
| `customers` | `id` (string, since v5) | `id` (string) | already UUID-ready |
| `walletTransactions` | `id` (string, since v5) | `id` (string) | already UUID-ready |
| `canteenSales` | `id` (string, since v13) | `id` (string) | already UUID-ready |
| `stockPurchases` | `id` (string, since v13) | `id` (string) | already UUID-ready |
| `bookings` | `id` (string, since v17) | `id` (string) | already UUID-ready |
| `settings` | `id: number` (singleton, id=1) | unchanged | local-only, not synced |
| `_outbox` (new) | — | `++seq` (number) | client-side only, never synced |

**FK columns that change type number → string:**

| Column | Lives on | Points to |
|---|---|---|
| `sessions.tableId` | sessions | gameTables (or undefined for walk-in synthetic rows in summary) |
| `sessionItems.sessionId` | sessionItems | sessions |
| `sessionItems.canteenItemId` | sessionItems | canteenItems |
| `canteenSales.canteenItemId` | canteenSales | canteenItems |
| `stockPurchases.canteenItemId` | stockPurchases | canteenItems |
| `bookings.tableId` | bookings | gameTables |

That's it. **6 FK columns across 6 row-shapes, in one file (`queries.ts`).**

**DB name stays `ClubKeeperDB_${userId}`** — v2's proposed rename to `clubkeeper_${userId}` was overruled by lead on 24 Jun 2026. Existing name works fine; rename is risk for zero benefit.

**WALKIN_TABLE_ID stays out of Dexie entirely.** It is a synthetic value used only by `src/lib/summaryMath.ts` to attach walk-in canteen revenue to a row in TopTablesList. Optionally change the constant value from `-1` to a UUID string for type consistency post-v20, but no data migration involved — it's a constant in TypeScript, not a row in any table.

### 5.2 The v20 upgrade script (CORRECTED pseudocode)

```ts
const TABLES_TO_MIGRATE = ['gameTables', 'sessions', 'sessionItems', 'canteenItems'] as const

db.version(20).stores({
  // 4 tables flip from ++id to id (caller-supplied UUID string)
  gameTables:    'id, name, gameType, sortOrder, outOfService',
  sessions:      'id, tableId, status, startedAt, endedAt',
  sessionItems:  'id, sessionId, addedAt',
  canteenItems:  'id, name, isActive, sortOrder',
  // 5 tables unchanged — already string id
  customers:           'id, phone, walkInCode, lastVisitAt',
  walletTransactions:  'id, customerId, createdAt, [customerId+createdAt]',
  canteenSales:        'id, createdAt, customerId',
  stockPurchases:      'id, createdAt, canteenItemId, source',
  bookings:            'id, tableId, slotStart, status, [tableId+slotStart]',
  // settings unchanged — singleton number key
  settings:            'id',
  // NEW: outbox table for Phase C
  _outbox:             '++seq, table, op, rowId, createdAt',
}).upgrade(async tx => {
  // Phase 0: forced auto-backup BEFORE any rewrite. If this fails, throw —
  // Dexie aborts the upgrade and the user stays on v19 with data intact.
  await runPreV20Backup(tx)

  // Phase 1: build numeric-id → UUID map for the 4 migrated tables
  const idMaps = {
    gameTables: new Map<number, string>(),
    sessions: new Map<number, string>(),
    sessionItems: new Map<number, string>(),
    canteenItems: new Map<number, string>(),
  }
  for (const table of TABLES_TO_MIGRATE) {
    await tx.table(table).toCollection().each((row: any) => {
      idMaps[table].set(row.id as number, crypto.randomUUID())
    })
  }

  // Phase 2: rewrite each migrated table's rows with new id + _migrationSeq
  // Order doesn't matter for the rewrite itself (we use clear+add), but for
  // FK rewrites we go catalog → operational so the maps are ready.
  let seq = 0
  await rewriteTable(tx, 'gameTables',   idMaps.gameTables,   () => ++seq,   /* no FKs */)
  await rewriteTable(tx, 'canteenItems', idMaps.canteenItems, () => ++seq,   /* no FKs */)
  await rewriteTable(tx, 'sessions',     idMaps.sessions,     () => ++seq, {
    tableId: idMaps.gameTables,  // FK → gameTables
    // customerId stays as-is (already UUID string from v5)
  })
  await rewriteTable(tx, 'sessionItems', idMaps.sessionItems, () => ++seq, {
    sessionId: idMaps.sessions,
    canteenItemId: idMaps.canteenItems,
  })

  // Phase 3: rewrite FKs in the 5 already-UUID tables that point to migrated tables
  await rewriteFKsOnly(tx, 'canteenSales',   { canteenItemId: idMaps.canteenItems })
  await rewriteFKsOnly(tx, 'stockPurchases', { canteenItemId: idMaps.canteenItems })
  await rewriteFKsOnly(tx, 'bookings',       { tableId: idMaps.gameTables })

  // No WALKIN sentinel rewrite needed — WALKIN_TABLE_ID never lived in Dexie.
  // sessions.tableId is undefined for any row that lacked a real table FK.

  // settings: singleton, untouched.
  // walletTransactions: references already-UUID FK (customer.id), untouched.
})
```

**`rewriteTable` helper:** read all rows → `clear()` the table → for each row, replace `id` with the UUID from the map, replace any FK fields with their mapped UUIDs, attach `_migrationSeq: seq++`, then `add()`. Performed inside the `tx` so it's atomic — if anything throws, Dexie rolls back and the user stays on v19.

**`rewriteFKsOnly` helper:** for tables that don't need their own id rewritten, just iterate and `.update()` the FK fields. Cheaper than clear+add.

### 5.3 Pre-flight gate before v20 ships

Before pushing v20 to ANY user device:

- [ ] v19 → v20 upgrade tested on a Dexie DB with 1000+ sessions, 100+ customers, full table data
- [ ] Post-upgrade `npm run build` clean
- [ ] All 3-scenario test (happy / existing user / edge case) passes per Critical Rule #11
- [ ] Manual smoke: start session, stop session, edit session, canteen sale, wallet topup — all work
- [ ] Rollback rehearsal documented (export pre-v20 backup, reset DB, import)
- [ ] Production users notified via in-app banner: "Big update tomorrow, please back up"
- [ ] Auto-backup forced on v19 → v20 path before upgrade runs

### 5.4 `crypto.randomUUID()` polyfill

iOS Safari < 15.4 lacks `crypto.randomUUID()`. Polyfill at app boot:

```ts
if (!crypto.randomUUID) {
  // @ts-expect-error attach polyfill
  crypto.randomUUID = () => {
    // 8-4-4-4-12 hex pattern, version-4 nibble
    const hex = (n: number) => Math.floor(Math.random() * 16).toString(16);
    let id = '';
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) id += '-';
      else if (i === 14) id += '4';
      else if (i === 19) id += (Math.floor(Math.random() * 4) + 8).toString(16);
      else id += hex(i);
    }
    return id as `${string}-${string}-${string}-${string}-${string}`;
  };
}
```

Production-grade UUIDs require `crypto.getRandomValues` — if the target browser even lacks that, refuse to boot (very old Android, unsupportable anyway).

**Important context (24 Jun code review):** The polyfill is needed TODAY, not just for v20. `crypto.randomUUID()` is already called unguarded in `src/lib/coinExpiry.ts`, `src/lib/nudge.ts`, `src/lib/streak.ts`, and `src/lib/walkInCode.ts`. The app currently crashes on iOS Safari < 15.4 in these code paths — it just hasn't been reported because no Ball Bender device hit that browser yet. Polyfill MUST be installed at app boot (in `src/main.tsx`, before any Dexie or React render) before v20 ships, fixing both the existing latent bug AND the new UUID-everywhere usage.

---

### 5.5 Pre-migration code hazards — fix BEFORE v20 schema lands

The 24 Jun code review surfaced two specific call sites that will break the moment v20 makes `sessionId` a UUID string. These are NOT migration logic — they are existing v19 code that becomes wrong post-migration. Fix them in the same PR as the v20 schema, in the order below:

**Hazard #1 — `src/db/queries.ts:301` (in `confirmPaymentAndStop`):**

```ts
// Current code — WILL THROW ON EVERY PAYMENT POST-v20
if (typeof sessionId !== 'number' || !Number.isFinite(sessionId) || sessionId <= 0) {
  throw new Error(`confirmPaymentAndStop: invalid sessionId (got ${typeof sessionId}...)`)
}
```

After v20, sessionId is a UUID string. This throws unconditionally. **Owner clicks "Confirm payment" → entire payment flow bricks.**

**Fix:** Replace with UUID validation:
```ts
if (typeof sessionId !== 'string' || sessionId.length !== 36) {
  throw new Error(`confirmPaymentAndStop: invalid sessionId (got ${typeof sessionId} "${sessionId}")`)
}
```

**Hazard #2 — `src/db/queries.ts:1060` (in `createBackEntry`):**

```ts
// Current code — wrong cast post-v20
const sessionId = (await db.sessions.add(proto)) as number
```

After v20, `db.sessions.add()` returns the caller-supplied string id. Cast becomes wrong type. **Fix:** generate the UUID up front and pass it in:
```ts
const sessionId = crypto.randomUUID()
await db.sessions.add({ ...proto, id: sessionId })
```

This pattern (generate UUID up front, pass into add) applies to **every** call site that previously relied on `++id` return. Phase B step 1 audits all such sites in `queries.ts`.

**Hazard #3 — referenceId stringification (queries.ts:373):**

```ts
referenceId: sessionId.toString()
```

This is already string-safe but will produce a useless string post-v20 (`"a3f2c8…"` instead of `"42"`). Confirm `referenceId` consumers handle UUID strings — likely fine since `walletTransactions.referenceId` is already typed as string today.

**Acceptance gate for Phase B step 1:** before any v20 schema code is written, every `typeof X === 'number'`, `Number.isFinite(X)`, and `as number` cast involving a migrated ID must be either fixed or explicitly documented as safe. Sonnet's pre-flight investigation should be re-run mid-phase to confirm zero new hazards introduced.

---

### 5.6 Step 2 landmines — explicit inventory (24 Jun 2026)

Three hazards that are easy to miss in the `.upgrade()` callback or the type-narrowing pass. Documented here so future reviewers can verify they were handled.

**Landmine 2a — `addOrIncrementSessionItem` mixed return path**

`addOrIncrementSessionItem` has two branches:
1. "Increment existing" — calls `db.sessionItems.update(existingRow.id, { quantity: ... })`. `update()` returns `1` (count of rows updated), not the row id. Pre-Step-2 the caller didn't need the id from this branch.
2. "New row" — calls `db.sessionItems.add({ ...data, id: crypto.randomUUID() })` and returns the new UUID string.

After Step 2, the function signature narrows to `Promise<string>` on both branches. The increment branch MUST explicitly `return existingRow.id` — the `existingRow.id` is already a UUID string post-migration. Do NOT return `await db.sessionItems.update(...)` (that's a number). Do NOT cast to `any`. There is no union to paper over — just return the id you already have.

**Landmine 2b — `StockPurchase.canteenItemId` and `CanteenSale.canteenItemId` still typed `number`**

As of Step 1.5, these two FK fields in `src/types/index.ts` were left as `number` — the parent rows (`canteenItems`) flip to UUID in v20 but these FK fields were not widened during Step 1 because `canteenSales` and `stockPurchases` were already on string ids and didn't need the `number | string` transitional treatment applied to the 4 migrated tables.

Step 2 must narrow both to `string`. The `.upgrade()` callback's Phase 3 (`rewriteFKsOnly` on `canteenSales` and `stockPurchases`) handles the VALUE rewrite for existing rows. The TYPE change in `src/types/index.ts` is the paired fix.

**Landmine 2c — `Session.tableMoves[]` nested inline array**

`Session.tableMoves?: TableMove[]` is stored as a JSON array inside the `sessions` row — NOT as a separate Dexie table. Each `TableMove` entry has:
- `fromTableId: number | string` — FK → `gameTables.id`
- `toTableId: number | string` — FK → `gameTables.id`

The `.upgrade()` callback's Phase 2 rewrite of `sessions` rows iterates each row's `tableMoves` array and remaps BOTH `fromTableId` and `toTableId` through the `idMaps.gameTables` map. This is easy to miss because the FK is nested inside JSON, not a top-level column. Forgetting it leaves the Table Journey display in `SessionDetail.tsx` pointing at stale numeric ids that no longer exist in `gameTables`.

**No-backup decision (Sugeet explicit, 24 Jun 2026)**

The owner explicitly waived the pre-v20 auto-backup step described in §5.2 Phase 0 and §5.3. Rationale: zero paying customers on the destructive path; worst-case recovery is `npm run seed` + re-enter test data. `runPreV20Backup` is NOT implemented. No in-app banner. No download trigger. §5.2 Phase 0 step is SKIPPED for Step 2. This decision is final for the current solo-dev phase; revisit before onboarding the first paid multi-device customer.

---

## 6. Sync engine — write path (Dexie → Supabase)

### 6.1 The outbox

New Dexie table:
```ts
interface OutboxRow {
  seq: number;               // auto-inc, ensures FIFO ordering
  idempotencyKey: string;    // UUID, used as Supabase upsert conflict key
  table: SyncTableName;      // 'sessions' | 'customers' | etc.
  op: 'insert' | 'update' | 'soft_delete';
  rowId: string;             // the data row's UUID
  payload: object;           // for insert/update: full row body; for soft_delete: { deleted_at }
  attempts: number;
  lastError: string | null;
  lastAttemptAt: number | null;
  createdAt: number;
}
```

### 6.2 Write wrapper

Every Dexie mutation goes through one of three wrappers:

```ts
async function syncedCreate<T extends SyncedRow>(table: SyncTableName, row: T) {
  await db.transaction('rw', db[table], db._outbox, async () => {
    await db[table].add(row);
    await db._outbox.add({
      seq: undefined,  // auto
      idempotencyKey: crypto.randomUUID(),
      table,
      op: 'insert',
      rowId: row.id,
      payload: row,
      attempts: 0,
      lastError: null,
      lastAttemptAt: null,
      createdAt: Date.now()
    });
  });
  scheduleDrain();
}

async function syncedUpdate<T extends SyncedRow>(table: SyncTableName, id: string, patch: Partial<T>) {
  await db.transaction('rw', db[table], db._outbox, async () => {
    const next = { ...(await db[table].get(id)), ...patch, updated_at: new Date().toISOString() };
    await db[table].put(next);
    await db._outbox.add({ /* … op: 'update', payload: next */ });
  });
  scheduleDrain();
}

async function syncedSoftDelete(table: SyncTableName, id: string) {
  await db.transaction('rw', db[table], db._outbox, async () => {
    await db[table].update(id, { deleted_at: new Date().toISOString() });
    await db._outbox.add({ /* … op: 'soft_delete' */ });
  });
  scheduleDrain();
}
```

**Rule:** No queries.ts function may write to a synced table without going through these wrappers. Linted via search/CI check.

### 6.3 The drain runner

```ts
class SyncRunner {
  private draining = false;
  private retryDelay = 1000;

  async scheduleDrain() {
    if (this.draining || !navigator.onLine) return;
    this.draining = true;
    try {
      await this.drainOnce();
      this.retryDelay = 1000;
    } catch (e) {
      this.retryDelay = Math.min(this.retryDelay * 2, 60000);
      setTimeout(() => this.scheduleDrain(), this.retryDelay);
    } finally {
      this.draining = false;
    }
  }

  private async drainOnce() {
    const batch = await db._outbox.orderBy('seq').limit(50).toArray();
    if (!batch.length) return;
    for (const row of batch) {
      try {
        await this.pushOne(row);
        await db._outbox.delete(row.seq);
      } catch (e) {
        await db._outbox.update(row.seq, {
          attempts: row.attempts + 1,
          lastError: String(e),
          lastAttemptAt: Date.now()
        });
        if (row.attempts > 10) {
          // Surface to UI - this is a data issue, not a network issue
          syncStatus.markStuck(row);
        }
        throw e;  // breaks loop, retry whole drain later
      }
    }
  }

  private async pushOne(row: OutboxRow) {
    const supa = getSupabaseClient();
    if (row.op === 'insert' || row.op === 'update') {
      const { error } = await supa.from(row.table).upsert(row.payload, {
        onConflict: 'id',
        ignoreDuplicates: false
      });
      if (error) throw error;
    } else if (row.op === 'soft_delete') {
      const { error } = await supa.from(row.table)
        .update({ deleted_at: row.payload.deleted_at })
        .eq('id', row.rowId);
      if (error) throw error;
    }
  }
}
```

### 6.4 Online/offline triggers

```ts
window.addEventListener('online', () => syncRunner.scheduleDrain());
// periodic kick every 30s in case 'online' event missed:
setInterval(() => syncRunner.scheduleDrain(), 30_000);
// after every mutation:
// (handled inside syncedCreate / syncedUpdate)
```

### 6.5 Idempotency guarantee

Each outbox row has a fixed `idempotencyKey` set at creation. Supabase upsert with `onConflict: 'id'` means re-running the same insert is a no-op (row already exists). Re-running the same update overwrites with the same value. Re-running soft-delete sets `deleted_at` again to the same timestamp (no harm).

**Safe to retry forever.** The outbox can be replayed from scratch and the database converges to the same state.

---

## 7. Sync engine — read path (Supabase → Dexie)

### 7.1 Initial pull (on sign-in)

```ts
async function initialPullForUser(userId: string, clubId: string) {
  for (const table of SYNCED_TABLES) {
    let cursor: string | null = null;
    while (true) {
      const q = supa.from(table).select('*').eq('club_id', clubId).order('updated_at').limit(1000);
      if (cursor) q.gt('updated_at', cursor);
      const { data, error } = await q;
      if (error) throw error;
      if (!data?.length) break;
      await db[table].bulkPut(data);
      cursor = data[data.length - 1].updated_at;
      if (data.length < 1000) break;
    }
  }
}
```

Shown to user via a loading screen with progress: "Loading your data… (3 of 9)". For Ball Bender (no existing data), this completes in <1 sec.

### 7.2 Realtime subscription

Realtime channels grouped to stay under connection limits:

| Channel | Tables |
|---|---|
| `club:${clubId}:operations` | sessions, session_items |
| `club:${clubId}:catalog` | game_tables, canteen_items |
| `club:${clubId}:commerce` | customers, wallet_transactions, canteen_sales |
| `club:${clubId}:scheduling` | bookings, stock_purchases |

4 channels × N devices. Each owner-with-4-staff = 5 devices × 4 channels = 20 channels per club. At 50 clubs = 1000 channels. **Supabase Pro tier limit is 500 concurrent.** This means:

- **Free tier**: up to ~10 clubs on Pro-equivalent (we'll be on Pro by then anyway)
- **Pro tier ($25/mo)**: up to ~25 active-concurrent clubs (most won't be active simultaneously, real cap is ~100)
- **Plan to upgrade tier when concurrent active clubs > 50.**

```ts
const channel = supa.channel(`club:${clubId}:operations`)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: `club_id=eq.${clubId}` }, handleSessionChange)
  .on('postgres_changes', { event: '*', schema: 'public', table: 'session_items', filter: `club_id=eq.${clubId}` }, handleSessionItemChange);

channel.subscribe((status, err) => {
  if (status === 'SUBSCRIBED') syncStatus.markRealtimeOk();
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
    syncStatus.markRealtimeDown();
    schedulePollingFallback();   // see §7.4
  }
});
```

Apply existing 5-second SUBSCRIBED timeout pattern from `topup_intents` (architecture.md §realtime).

### 7.3 Change handler — last-write-wins

```ts
async function handleSessionChange(payload: RealtimeChangePayload) {
  const remote = payload.new;
  const local = await db.sessions.get(remote.id);

  // LWW: if remote.updated_at >= local.updated_at, accept remote.
  // Use tie-breaker: remote.updated_by !== currentUserId
  if (!local || remote.updated_at > local.updated_at) {
    await db.sessions.put(remote);
  } else if (remote.updated_at === local.updated_at && remote.updated_by !== currentUserId) {
    // Same timestamp, different writer - accept remote to avoid local stuck winning
    await db.sessions.put(remote);
  }
  // else: local is newer, ignore (drain will push it shortly)
}
```

### 7.4 Polling fallback

If realtime channel is down for >30 seconds, switch to polling:
- Every 60s: fetch `updated_at > lastSeenCursor` for each synced table
- When realtime reconnects, polling stops
- Battery friendlier than realtime when device is in background, so this isn't pure degraded mode

---

## 8. Online/offline UX

### 8.1 Sync indicator (TopBar)

A 8px dot next to existing TopBar elements. Four states:

| State | Color | Tooltip |
|---|---|---|
| All synced, realtime active | Green | "Synced" |
| Draining outbox / pulling realtime | Amber pulse | "Syncing…" |
| Offline, queued writes | Red | "Offline — N changes pending" |
| Stuck (outbox row with >10 attempts) | Red exclamation | "Sync issue — tap to view" |

Tap → opens "Sync status" bottom sheet:
- Online/offline state
- Outbox size
- Realtime channel statuses (4 dots, one per channel)
- "Last successful sync" timestamp
- "Retry now" button (forces drain)
- "Pull latest" button (forces initial pull again)
- "Export support log" button (dumps last 100 outbox attempts to JSON for debugging)

### 8.2 Offline behavior

App fully functional. Every screen behaves as today. The only visual signal is the red dot. **No modals, no warnings, no blocks.** Pattern: trust Dexie, surface state via dot only.

### 8.3 Cross-device update UX

When a remote change arrives:
- Most screens use `useLiveQuery` — they re-render automatically
- Active session in flight (timer running): timer is timestamp-based per Pattern T1, so a remote `paused_at` update just makes the timer freeze on the next tick. No glitch.
- If owner deletes a session staff is viewing: surface toast "This session was deleted on another device" and navigate to home. (Realtime onDelete handler.)

---

## 9. Edge cases — locked answers

| Scenario | Resolution |
|---|---|
| **Two staff stop same session simultaneously** | Both writes upsert by id. Last `updated_at` wins. Both UIs converge within 2s. No data corruption — `ended_at` is set, end of story. |
| **Owner deletes session while staff views it** | Realtime soft-delete event → staff's screen shows toast + auto-nav to home. |
| **Two devices add wallet topup offline for same customer** | Wallet table is append-only. Both rows persist. `balance_after` becomes inconsistent across the two rows but is recomputed on read by summing all transactions. Truth is in the sum. |
| **Owner edits paymentBreakdown on Phone A while staff edits same on Phone B** | LWW. Acceptable — only one device should be doing this. Add UI hint: don't show "edit" CTA for completed sessions to staff (already in permission matrix). |
| **Customer makes UPI topup intent while owner offline** | `topup_intents` is Supabase-only (unchanged). Owner sees pending intent on next online. Existing flow. |
| **Owner removes staff while staff mid-session** | Supabase `users_meta.active = false`. Next staff API call gets RLS 403 → app surfaces "Access revoked, signing out" → returns to login. Already-in-Dexie data persists locally (privacy concern, but data is for a club they worked at — acceptable for v1). Future: optional "wipe local data on revoke" toggle. |
| **Phone offline 3 days, comes back with 200 queued writes** | Outbox drains FIFO. ~100ms/write = 20 sec. Progress dot in UI. Idempotent — re-running doesn't dupe. |
| **5 devices on same login, all editing** | 5 × 4 channels = 20 realtime connections. Within Pro tier. UI shows realtime status. LWW resolves conflicts. |
| **Customer wallet at ₹500, two debits of ₹100 each offline simultaneously from two devices** | Append-only solves it: both `wallet_transactions` rows insert, balance = 500 - 100 - 100 = 300. The `balance_after` field on each row will be wrong (both will say 400), but **the sum of `amount` is always correct.** We recompute `balance_after` on read for the customer detail view. |
| **Two devices create customer "Rajesh +91 98765 43210" at same time offline** | Both insert. Two customer rows exist after sync. Tolerable for v1; show de-dup warning in customer list ("2 customers with same phone — merge?"). Merge UI is post-v1. |
| **Subscription expires mid-session on staff device** | `useAccessGuard` already handles this for owner. Apply same guard to staff — staff hits read-only `/subscribe` page but cannot subscribe (owner-only action). Surfaces "Owner needs to renew subscription" message. |
| **Owner cancels subscription** | Staff lock-out follows same path. Active sessions complete locally; owner must subscribe again to sync them. |
| **Player Hub topup arrives during offline period** | `topup_intents` stays Supabase-only. When owner comes online, intent appears, owner approves, wallet_transaction created (which syncs through normal outbox path). |
| **Owner signs in on a brand-new device** | Initial pull populates Dexie from Supabase. Existing flow. |
| **Owner deletes their account / loses Gmail access** | Out of scope. Tell them at signup: "Use a Gmail you control; we cannot recover accounts." |
| **`_clubSyncDone` flag race (existing bug)** | Fix as part of this work — replace one-shot flag with idempotent initial-pull that checks `clubs.updated_at` vs local last-pull cursor. |
| **Daylight savings / clock skew** | All timestamps are TIMESTAMPTZ in UTC. App formats in local time on display only. Pattern T1 (timestamp-based timers) immune to clock changes. |
| **User clock is wrong (Android phone with bad time)** | `updated_at` from Supabase uses server time. Client never trusts its own clock for sync decisions. Local timestamps for display only. |
| **Migration of existing offline-only users** | Detect on first sign-in: local rows exist AND Supabase tables empty AND v20 schema. Run `pushAllLocalToSupabase()` — idempotent because every row already has a UUID by this point. Show progress bar. After completes, normal sync resumes. |

---

## 10. Migration paths

### 10.1 Ball Bender (and future fresh customers) — happy path

1. Owner Gmail signs in
2. App detects empty Dexie + empty Supabase → onboarding wizard
3. Owner sets up tables, canteen items, peak hours via Settings (writes go through outbox → Supabase)
4. Owner opens Settings → Staff → "Add Staff" → creates 4 staff accounts
5. Owner shares slip with each staff: username + password
6. Each staff installs PWA on their phone, signs in
7. First-time sign-in on staff device: initial pull → Dexie populated → app ready
8. All 5 devices now in sync via realtime

**No migration code needed.** Day 1 of customer = day 1 on sync architecture.

### 10.2 Existing offline-only users — opt-in migration

Existing users (you have some, none paying yet) will get the v20 update. On first sign-in post-v20:

1. App offers: "Enable cloud sync? This uploads your data to Supabase so you can access from multiple devices." (Owner only, behind subscription gate.)
2. If yes: `pushAllLocalToSupabase()` runs in foreground with progress bar, see §10.4
3. Once complete, app announces "Sync ready. Add staff in Settings."
4. If no: app continues offline-only, prompt every 7 days

Migration function is **idempotent by row id** — re-running it does nothing because UUIDs already match. Safe to retry on failure.

### 10.3 What we promise users

- **Pre-v20**: in-app banner 3 days before, daily for last day. "Big update coming. Auto-backup will run."
- **At v20 install**: auto-backup runs first. If backup fails, upgrade blocks with clear error.
- **Post-v20**: app works exactly as before. Cloud sync is opt-in. No surprises.

### 10.4 Migration upload protocol — batched and resumable

For an existing club with months of local data, the one-time upload could be thousands of rows. We need it to be:

1. **Resumable** — owner closes the app mid-upload, restart resumes from cursor
2. **Visible** — progress bar showing "Uploaded 2,341 / 5,800 rows"
3. **Non-blocking for new writes** — owner can keep using the app; new mutations go through normal outbox path and interleave

**Protocol:**

```ts
interface MigrationCursor {
  table: SyncTableName;
  lastUploadedSeq: number;          // Dexie auto-inc seq we've crossed
  completedTables: SyncTableName[]; // tables fully uploaded
}
// Stored in Dexie singleton table `_migration_state`

async function migrateLocalToSupabase(onProgress: (p: Progress) => void) {
  const cursor = await loadMigrationCursor();
  const tables: SyncTableName[] = [
    'gameTables', 'canteenItems',          // catalog first (FKs depend on these)
    'customers',
    'sessions', 'sessionItems',            // operational data
    'walletTransactions', 'canteenSales',
    'stockPurchases', 'bookings'
  ];

  for (const table of tables) {
    if (cursor.completedTables.includes(table)) continue;
    await migrateOneTable(table, cursor, onProgress);
    cursor.completedTables.push(table);
    await saveMigrationCursor(cursor);
  }
}

async function migrateOneTable(table, cursor, onProgress) {
  const BATCH = 100;
  while (true) {
    const rows = await db[table]
      .where('_migrationSeq').above(cursor.lastUploadedSeq)
      .limit(BATCH).toArray();
    if (!rows.length) break;

    const { error } = await supa.from(table).upsert(rows, { onConflict: 'id' });
    if (error) throw error;       // bubbles up, user can retry

    cursor.lastUploadedSeq = rows[rows.length - 1]._migrationSeq;
    await saveMigrationCursor(cursor);
    onProgress({ table, done: cursor.lastUploadedSeq, of: await db[table].count() });

    if (rows.length < BATCH) break;
  }
}
```

**`_migrationSeq` is a one-time per-row counter** assigned during the v20 upgrade — gives stable ordering for resumption. After migration completes, the field is no longer touched.

**Order matters because of FKs:** game_tables and canteen_items must land before sessions/session_items/canteen_sales/bookings reference them.

**Resumability behavior:**
- Owner closes app at row 2,341 of 5,800 in `sessions` table
- Next app open: cursor says `sessions: seq=2341, completedTables=[gameTables, canteenItems, customers]`
- Migration restarts at `sessions` table, picks up at seq > 2341
- Progress bar shows "Resuming upload…"

**During migration, new writes:**
- Go through normal outbox path
- May race with the migration's bulk upsert — but UUID is the same, upsert is idempotent, no data lost
- Progress bar shows two streams: "Uploading old data" + "Live changes syncing"

**On failure:**
- Network drop → resume on next online
- RLS rejection → red banner with error, owner contacts Sugeet
- Cursor never rewinds, only advances

---

## 11. Failure modes + recovery

| Failure | Symptom | Recovery |
|---|---|---|
| Supabase down (entire service) | All writes queue in outbox; realtime fails | App keeps working offline. Drain resumes when service returns. Surface in sync sheet. |
| Network drops mid-write | One outbox row's upsert errors | Marked with `lastError`, retried with backoff. No corruption. |
| Local Dexie corrupted | Errors on read | Owner: sign out, sign back in. App detects empty Dexie + non-empty Supabase → initial pull repopulates. Staff: same. |
| Outbox stuck (>10 attempts on a row) | Red exclamation indicator | Sync sheet surfaces "stuck row" with "skip" and "retry" actions. "Export log" for debugging. |
| RLS policy regression (we ship bad SQL) | All writes 403 | Surface "Sync paused — server issue" banner. App still operates offline. Hotfix RLS, sync resumes. |
| Realtime channel disconnects | Amber/red on indicator | Polling fallback kicks in. Reconnect attempts continue. |
| Staff account deleted while signed in | API 401/403 on next sync | Auto sign-out with "Access revoked" screen. Local data preserved (see §9). |
| Owner Supabase project paused (free tier inactivity) | All writes 403 | Surface error. Owner needs to log into Supabase dashboard and unpause. Document in support docs. |
| Two outbox rows write same id with different payloads (race) | Should not happen with seq ordering | Defensive: dedupe outbox on `(table, rowId, op)` before drain. Last seq wins inside the dedupe. |
| App killed mid-transaction | Dexie transaction atomic → either both data row + outbox row land, or neither | No partial state. Outbox always reflects what's pending. |

---

## 12. Pre-build checklist

Owner sign-off required before Phase B starts:

- [ ] Permission matrix §2 reviewed line-by-line, exhaustive, no missing screens
- [ ] Role names locked: `owner` and `staff` (not `admin`, `user`, `partner`)
- [ ] Staff email scheme approved: `<name>.<random>@<clubslug>.ck.local`
- [ ] UUID + per-user Dexie DB strategy understood — **irreversible after v20 ships**
- [ ] LWW conflict policy approved — no per-row complexity
- [ ] All 9 Dexie tables to be synced (catalog above) — no exceptions
- [ ] Wallet append-only contract approved (§4.6) — no row edits, only reversals
- [ ] Today-only Summary for staff confirmed
- [ ] Business day boundary = 6:00 AM IST hardcoded (§4.7)
- [ ] JWT custom claims hook approved (§4.5) — must be configured in Supabase first
- [ ] Sync kill-switch (`clubs.sync_enabled`) approved (§4.9)
- [ ] Customer hard-delete only via owner-only hidden screen (§2)
- [ ] Existing-user migration uses batched-resumable protocol (§10.4)
- [ ] `bookings_intents.id` type confirmed as UUID (§4.8) — verify in Phase B
- [ ] Supabase Pro tier budget approved (~$25/mo when concurrent active clubs > 10)
- [ ] Razorpay LIVE work happens in parallel (separate track) by owner
- [ ] No-new-features rule active for 4 weeks once Phase B starts
- [ ] Owner commits to daily 30-min testing once Phase C ships
- [ ] Pre-v20 auto-backup mechanism documented and tested before v20 ships
- [ ] iOS Safari < 15.4 polyfill for `crypto.randomUUID` included
- [ ] `_clubSyncDone` Pending bug folded into this work
- [ ] Communication plan for existing users (banner before v20)

---

## 13. Phase plan (recap with detail)

| Phase | Days | Deliverable | Done when |
|---|---|---|---|
| **A — This doc** | 2-3 | sync_architecture.md committed to skill, owner signs §12 | Owner ticks every box in §12 |
| **B — UUID + per-user DB** | 3-4 | Dexie v20 schema + migration + per-user DB naming | npm run build clean, 3-scenario test green, smoke test on real device |
| **C — Outbox + realtime sync** | 5-7 | syncedCreate/Update/SoftDelete wrappers, SyncRunner, realtime channels, sync indicator UI | 2-browser test: edit on A → see on B within 2s. Offline-100-writes test passes. |
| **D — Staff login + roles** | 4-5 | Settings→Staff UI, useRole hook, guards on 15+ surfaces, sign-in for both Google and email/password | Owner creates staff, staff signs in, staff cannot reach owner-only screens. |
| **E — Ball Bender pilot** | 5-7 | Real-world use, daily fix cycles | 3 consecutive days no critical bugs reported. |

**Total: ~4 weeks.** No new features during any phase.

---

## 14. What's deferred (revisit list)

When the urge to add scope hits during build, redirect it here:

- Partner role (separate from owner/staff)
- Multi-club per owner
- Audit log UI
- Conflict resolution UI (not just LWW)
- Customer de-dup merge UI
- Wipe-local-on-revoke toggle
- Push notifications to staff phones
- Backup-to-cloud-storage (separate from sync)
- Phone OTP for staff signup
- Magic-link signin
- Analytics warehouse / BI export
- Cold storage for data >2 years old
- Multi-tenant SaaS model (different from per-club)
- Cross-club reporting for chains

---

## 15. Appendices

### Appendix A — Full Postgres DDL

(Section 4.2 above is the complete DDL. Run as Supabase migration `001_sync_tables.sql`.)

### Appendix B — RLS policies (JWT-based, see §4.5)

Pattern for every synced table. Requires JWT custom claims configured per §4.5.

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;

-- SELECT: user can read rows for their club (from JWT claim)
CREATE POLICY "<table>_select_own_club" ON <table>
  FOR SELECT
  USING (club_id::text = auth.jwt() ->> 'user_club_id');

-- INSERT: user can insert into their club; role-gated for sensitive tables
CREATE POLICY "<table>_insert_own_club" ON <table>
  FOR INSERT
  WITH CHECK (
    club_id::text = auth.jwt() ->> 'user_club_id'
    -- additional role check per table; e.g. for owner-only:
    -- AND (auth.jwt() ->> 'user_role') = 'owner'
  );

-- UPDATE: same as insert
CREATE POLICY "<table>_update_own_club" ON <table>
  FOR UPDATE
  USING (club_id::text = auth.jwt() ->> 'user_club_id')
  WITH CHECK (club_id::text = auth.jwt() ->> 'user_club_id');

-- No DELETE policy = no one can hard-delete via the API.
-- Soft-delete via UPDATE deleted_at for most tables.
-- Customers table: hard-delete is allowed via a service-role function only (owner-only hidden screen).
```

**Role-gated tables** (add role check to INSERT/UPDATE):
- `stock_purchases` — owner only
- `wallet_transactions` where kind = 'adjustment' — owner only (other kinds: both)
- `bookings` config-style fields — owner only (cancel/create: both)
- `canteen_items` — owner only for inserts/updates (sales of items: both can do)
- `game_tables` — owner only

Role check pattern:
```sql
AND (
  -- staff can do this op
  EXISTS (SELECT 1 FROM users_meta WHERE user_id = auth.uid() AND role IN ('owner','staff') AND active = true)
)
-- OR for owner-only:
AND (
  EXISTS (SELECT 1 FROM users_meta WHERE user_id = auth.uid() AND role = 'owner' AND active = true)
)
```

For `paymentBreakdown` and `started_at` edits on sessions (staff-restricted fields but row-write is allowed): enforce at app layer via the permission matrix, not RLS. RLS allows row update; the UI controls don't let staff hit the edit endpoints. (RLS field-level gating is possible but adds complexity for marginal value — staff also can't reach the edit screen.)

### Appendix C — Outbox runner pseudocode

(§6.3 above is the complete implementation.)

### Appendix D — Realtime channel groupings

(§7.2 above is the complete grouping.)

### Appendix E — Dexie v20 upgrade detailed algorithm

```ts
// Phase 1: Generate id maps for all tables to migrate
async function buildIdMaps(tx: Dexie.Transaction) {
  const maps: Record<string, Map<number, string>> = {
    gameTables: new Map(),
    sessions: new Map(),
    sessionItems: new Map(),
    customers: new Map(),
    walletTransactions: new Map(),
    canteenItems: new Map(),
    canteenSales: new Map(),
    stockPurchases: new Map(),
    bookings: new Map(),
  };
  for (const tableName of Object.keys(maps)) {
    await tx.table(tableName).toCollection().each(row => {
      maps[tableName].set(row.id as number, crypto.randomUUID());
    });
  }
  return maps;
}

// Phase 2: rewrite each table's rows
async function rewriteAllRowsWithNewIds(tx: Dexie.Transaction, maps) {
  // gameTables
  const allTables = await tx.table('gameTables').toArray();
  await tx.table('gameTables').clear();
  for (const r of allTables) {
    r.id = maps.gameTables.get(r.id);
    await tx.table('gameTables').add(r);
  }

  // sessions (FK: tableId, customerId)
  const allSessions = await tx.table('sessions').toArray();
  await tx.table('sessions').clear();
  for (const r of allSessions) {
    r.id = maps.sessions.get(r.id);
    r.tableId = r.tableId === WALKIN_OLD_SENTINEL
      ? WALKIN_UUID
      : maps.gameTables.get(r.tableId) ?? r.tableId;
    if (r.customerId != null) {
      r.customerId = maps.customers.get(r.customerId) ?? null;
    }
    await tx.table('sessions').add(r);
  }

  // sessionItems (FK: sessionId, canteenItemId)
  // customers
  // walletTransactions (FK: customerId, referenceId)
  // canteenItems
  // canteenSales (FK: canteenItemId, customerId)
  // stockPurchases (FK: canteenItemId)
  // bookings (FK: tableId, customerId)
  // … (full implementation in queries.ts during Phase B)
}
```

### Appendix F — useRole hook + guards

```ts
// src/hooks/useRole.ts
export function useRole(): { role: 'owner' | 'staff' | null; loading: boolean } {
  const { user } = useAuth();
  const meta = useLiveQuery(
    () => user ? db.usersMetaCache.get(user.id) : null,
    [user?.id]
  );
  return { role: meta?.role ?? null, loading: meta === undefined };
}

// src/components/auth/RoleGuard.tsx
export function OwnerOnly({ children, fallback = null }: Props) {
  const { role, loading } = useRole();
  if (loading) return null;
  if (role !== 'owner') return fallback;
  return <>{children}</>;
}

export function HideForStaff({ children }: { children: React.ReactNode }) {
  const { role } = useRole();
  return role === 'staff' ? null : <>{children}</>;
}
```

Route-level: wrap owner-only routes in `<OwnerOnly fallback={<Navigate to="/" />}>` at the App.tsx router level. List of owner-only routes: `/settings/*`, `/stock-purchases`, `/back-entries`, `/piggy`, `/summary` (the full version; today-strip lives at `/`).

### Appendix G — Settings → Staff UI sketch

```
┌──────────────────────────────────────┐
│  Settings → Staff                    │
├──────────────────────────────────────┤
│  Active staff (2)                    │
│                                       │
│  Rajesh                       [⋯]    │
│  rajesh.4821@ballbender.ck.local     │
│  Added 12 Jun 2026                   │
│                                       │
│  Suresh                       [⋯]    │
│  suresh.1903@ballbender.ck.local     │
│  Added 14 Jun 2026                   │
│                                       │
│  [+ Add staff]                       │
└──────────────────────────────────────┘

Tap [⋯]:
  - Reset password (generates new, shows once)
  - Remove (sets active=false, signs them out)

Tap [+ Add staff]:
  Modal:
  - Name: [_____________]
  - [Create] button
  After create:
    - Username: rajesh.4821@ballbender.ck.local
    - Password: x7Kp2mNq
    - [Copy] [Done]
```

### Appendix H — Ripple effects to track

When code changes during Phase B-D, update `references/ripple_effects.md` with the new entries:

- Pattern S20: synced write wrappers (replaces direct Dexie writes for 9 tables)
- Pattern S21: per-user Dexie DB lifecycle (open/close/switch user)
- Pattern S22: realtime channel lifecycle (subscribe on login, teardown on logout)
- Pattern S23: role-guard pattern (OwnerOnly / HideForStaff at component and route level)
- Pattern A20: subscription gate + role check composition (`useAccessGuard` extended for staff)

---

**End of doc. Sign-off line 1 of Phase B starts only after §12 is fully ticked.**

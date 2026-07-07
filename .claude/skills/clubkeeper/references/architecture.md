# Architecture

## Tech Stack (LOCKED)

| Layer | Choice | Why |
|---|---|---|
| Build tool | Vite 5.x | Fast HMR, excellent TypeScript support |
| UI framework | React 18.3.x | Sugeet's familiarity, ecosystem |
| Language | TypeScript 5.x strict mode | Catches bugs at compile time, Sugeet doesn't know JS deeply |
| Styling | Tailwind CSS **3.4.x** | NEVER upgrade to v4 — broke PostCSS in tests |
| Storage | Dexie 4.x (IndexedDB wrapper) | Offline-first requirement; SQL-like API simpler than raw IndexedDB |
| Routing | react-router-dom 6.x | Standard React routing |
| Dates | date-fns 3.x | Timezone-safe, tree-shakeable |
| State | Zustand 4.x | Tiny (~1KB), no Redux complexity |
| PWA | vite-plugin-pwa 0.20.x | Auto service worker + manifest |
| Live queries | dexie-react-hooks | Auto re-render on DB changes |

## File Structure

```
src/
  components/      # Reusable UI: Button, Card, Toggle, ConfirmModal, etc.
  pages/           # Home, Summary, History, Settings, StartSession, SessionDetail
  db/
    database.ts    # Dexie instance + schema
    queries.ts     # All CRUD functions (one source of truth)
    seed.ts        # Initial seed data on first run
  store/           # Zustand stores (toast, install prompt, etc.)
  hooks/
    useTick.ts     # Force re-render every 1s for timers
    useLiveData.ts # Wrappers around useLiveQuery
  lib/
    time.ts        # getElapsedMs, formatHMS, formatHM
    money.ts       # calculateAmount, formatINR, applyRounding
    validation.ts  # Input validators (name, note, table name)
    utils.ts       # cn() class joiner, formatTime12h
  types/
    index.ts       # All TypeScript interfaces (GameTable, Session, ClubSettings)
  App.tsx          # Router + ErrorBoundary + ToastContainer
  main.tsx         # Entry, calls seedIfEmpty before mount
  index.css        # Tailwind directives + fonts + safe-area CSS
```

## Routing Map

| Path | Page | Purpose |
|---|---|---|
| `/` | Home | Tables grid with live timers |
| `/start/:tableId` | StartSession | Form to begin new session |
| `/session/:sessionId` | SessionDetail | Big timer + pause/stop/edit |
| `/summary` | Summary | Daily revenue + sessions list |
| `/history` | History | Multi-day session history with filters |
| `/settings` | Settings | Club name, rounding, table management |
| `/canteen` | Canteen | Canteen master-list management (add/edit/delete/stock) |
| `/wallet` | Wallet | Customer wallet / prepaid credit list |
| `/wallet/new` | WalletNewCustomer | Add new customer |
| `/wallet/topup/:customerId` | WalletTopup | Top up customer wallet |
| `/customer/:customerId` | CustomerProfile | Customer transaction history |
| `/quick-sale` | QuickSale | Walk-in canteen sale (no session) |
| `/piggy` | Piggy | Cash-float balance + restock log |
| `/bookings` | Bookings | Owner booking agenda (private) |
| `/subscribe`, `/signup`, `/auth/callback`, `/` | Subscribe/Signup/AuthCallback/Landing | Public funnel routes |
| `/c/:clubSlug` (+ `/book`) | PlayerScan / BookingScreen | PUBLIC Player Hub — no auth, no Dexie |
| `/poster/:slug` | Poster | PUBLIC A4 QR poster, auto-print |
| `/__dev/test-outbox`, `/__dev/test-sync-reader` | DEV-only | Sync proof pages (tree-shaken from prod) |

## /canteen Route (Phase 1, 7 Jun 2026)

Private route — lives inside `<RequireAccess>`. Reached via TopBar cart icon on all private screens that render `TopBar`.

**Page structure:**
- Header: back arrow + "Canteen" title (always renders — never gated on data query)
- Stats row: "N items · M low stock" (M only shown when > 0; handles `undefined` gracefully)
- List area: branches on `undefined` (3 skeleton pulse cards) / `[]` (empty state + icon) / `[items]` (item cards)
- Each item card: name + price, `StockPill` badge, edit pencil (opens `CanteenItemFormModal` in EDIT mode), trash icon (opens `ConfirmModal`)
- FAB "+" always renders → opens `CanteenItemFormModal` in ADD mode

**Data flow:**
- `useLiveQuery(() => getCanteenItems(false), [])` — live item list (active only)
- `useLiveQuery(() => getCanteenItems(true), [])` — all items including inactive (passed to form for duplicate-name checking)
- `useLiveQuery(() => getLowStockThreshold(), [], 5)` — live threshold with fallback

**Writes via `queries.ts`:** `addCanteenItem`, `updateCanteenItem`, `softDeleteCanteenItem`

**`CanteenItemFormModal`:** Shared ADD/EDIT modal. Fields: name (validated), price (1–9999), track stock toggle, current stock (conditional on toggle). EDIT sends only changed fields as a patch. No `<form>` tag — button `onClick` only.

**`StockPill`:** Pure display component. Four states: "No stock tracking" (grey), "Out of stock" (red), "N left ⚠️" (amber, when stock < threshold), "N in stock" (green).

**Direct URL:** Works in production. Localhost dev mode has a known redirect quirk (StrictMode + HMR timing) — `/canteen` URL bar navigation may redirect to `/tables`. In-app navigation (cart icon tap) always works.

## Critical Patterns

### Timer Implementation Pattern
```ts
// CORRECT — derived from timestamps
function getElapsedMs(session: Session): number {
  if (session.status === 'completed') 
    return (session.endedAt - session.startedAt) - session.pausedTotalMs;
  if (session.status === 'paused')
    return (session.pausedAt - session.startedAt) - session.pausedTotalMs;
  // running
  return (Date.now() - session.startedAt) - session.pausedTotalMs;
}

// WRONG — counter that resets on refresh
const [elapsed, setElapsed] = useState(0);
useEffect(() => { setInterval(() => setElapsed(e => e + 1000), 1000); }, []);
```

### Live Query Pattern
```ts
// CORRECT — auto-updates when DB changes
function useTables() {
  return useLiveQuery(() => db.tables.orderBy('sortOrder').toArray());
}

// WRONG — manually fetching, won't update
const [tables, setTables] = useState([]);
useEffect(() => { db.tables.toArray().then(setTables); }, []);
```

### Component Pattern
- Functional components only, no class components
- Props typed via interface, never inline
- Tailwind classes via `cn()` helper for conditionals
- Inline SVG icons (no icon library), stroke="currentColor"
- Touch targets minimum 44×44px

## Settings reads — `useDexieSetting` is mandatory

Any field on `ClubSettings` is read through `useDexieSetting('field', fallback)`, never via `useState(settings?.field ?? default)` paired with a sync `useEffect`, and never via a direct Supabase read on mount (`getOwnerClub()` inside a render-tree component). Dexie is the source of truth on this device (Critical Rule 2); Supabase is the mirror, not a parallel reader. The hook (`src/hooks/useDexieSetting.ts`) wraps `useSettings()` (live `useLiveQuery(db.settings.get(1))`) and `updateSettings()`, so the value is reactive across the whole tree with no race between three sources.

The three allowed shapes — copy these exactly:

**(a) Boolean toggle**
```ts
const [acceptsBookings, setAcceptsBookings] = useDexieSetting('acceptsBookings', false)
// Toggle handler:
await syncBookingConfigBySlug(slug, val, advance)  // mirror first if Supabase-first
await setAcceptsBookings(val)
```

**(b) Enum / select**
```ts
const [mode, setMode] = useDexieSetting('coinRedemptionModes', 'both')
// onChange:
await setMode(nextVal)
```

**(c) Typing buffer (numeric / text input)**
Reference implementation: `src/pages/PlayerHubSettings.tsx` (`bookingAdvance` + `advanceDraft`).
```ts
const [bookingAdvance, setBookingAdvance] = useDexieSetting('bookingAdvanceAmount', 100)
const [draft, setDraft] = useState(String(bookingAdvance))
useEffect(() => { setDraft(String(bookingAdvance)) }, [bookingAdvance])
// onBlur: parse + validate, then call setBookingAdvance(n) OR setDraft(String(bookingAdvance)) to revert.
```
The draft is the only legitimate `useState` over a settings value — it exists because the user can clear the field mid-type and an authoritative-only read would yank the empty string back to the previous number. Dexie still owns the persisted value; the draft is UI-only.

What NOT to do:
- `const [x, setX] = useState(settings?.field ?? default)` followed by a sync `useEffect` — captures `undefined` on first render and races against the live query. This is the bug class.
- `getOwnerClub()` (or any Supabase reader) inside a `useEffect` that writes into local component state on mount. Device-init handles the one-time backfill; render-tree components must not re-implement it.
- Per-field `loaded` flags (`topupsLoaded`, `bookingsLoaded`, …) that gate UI on "Supabase read finished" — Dexie is already there.
- A second `useState` mirror "just for performance" — `useLiveQuery` is already memoised.

Failure mode and root-cause detail: see `bug_patterns.md` Pattern R4 (#97, 20 Jun 2026). Enforcement: `npm run check:settings` (runs in `prebuild`) fails the build on the anti-pattern; the `checklists/new_settings_field.md` template must be filled before adding any new field.

## Cloud Sync (SHIPPED — Phase C, Jun–Jul 2026)

Multi-device sync is live: Dexie stays the on-device source of truth; writes go through sync wrappers (`src/db/syncWrappers.ts`) into a `_outbox` queue drained by `SyncRunner` (`src/db/syncRunner.ts`) over the lock-free `supabaseSync` client; reads pull via `SyncReader` (`src/db/syncReader.ts`) with 4 grouped realtime channels + polling fallback; conflicts resolve last-write-wins on epoch-ms `updatedAt` (Pattern S17). Working contract: `ripple_effects.md` §Sync + `bug_patterns.md` S14–S24. Design history: `sync_architecture_v2.md` (code wins where they differ).

## Performance Guidelines

- `useTick` at 1-second interval is fine. Never go faster.
- Don't query inside render — only via `useLiveQuery` hooks.
- Lists with 50+ items: use simple `.map`, no virtualization needed for v1.
- Bundle size target: <300kb gzipped. Run `npm run build` and check `dist/` sizes occasionally.

## Build & Deploy

- Local dev: `npm run dev` → localhost:5173
- Production build: `npm run build` → `dist/` folder
- Deploy: Push to `main` branch on GitHub → Vercel auto-deploys
- Hosting: Vercel free tier
- Domain: `app.handbookhq.in` (primary, custom domain via Cloudflare → Vercel, live 1 Jun 2026). `clubkeeper.vercel.app` remains active as backup.

## Player Hub Flow

**Owner side:**
1. PlayerHubSettings → slug save → `upsertClub()` writes Supabase `clubs` row → slug + slugLocked written to Dexie (v14).
2. `useSyncClubFromSupabase()` (exported from `src/hooks/useLiveData.ts`) runs once per browser session: pulls slug/acceptsTopups/coinsEnabled/coinTiers from Supabase → merges into Dexie (only fills `undefined` fields — never overwrites existing local values). Module-level `_clubSyncDone` flag gates it.
3. `<TopupRealtimeBridge />` (mounted in `src/App.tsx` at the app shell, inside BrowserRouter, alongside AuthInitializer) opens Supabase realtime channel `topup_intents_{clubId}` for the **entire authenticated session** — not just while `/wallet` is mounted. Gated on `dbReady && session && subscriptionLoaded && !isPlayerHubPath(pathname)`. If not `SUBSCRIBED` in 5s → falls back to 30s `setInterval` polling. `src/store/topupInbox.ts` holds `pendingCount` (TopBar badge reads from there). On INSERT the bridge also fires a "New top-up: {name} — ₹{amount} [Review]" toast unless the owner is already on `/wallet`. Cleanup via `unsubscribeTopupIntents()` on sign-out / public-route transition (Pattern A8). Wallet.tsx does NOT subscribe — it only consumes `pendingCount` to drive its own intent-list refetch.
4. `PendingTopupsModal` confirm: `confirmTopupIntent(intentId)` (Supabase → `confirmed`) → `recordTopupWithCoins(...)` (single flat Dexie tx: wallet credit + coinBalance + firstTopupAt welcome-bonus guard).

**Player side:**
1. `/c/:clubSlug` → `getClubPublicInfo(slug)` via `get_club_public_info` RPC (security definer, anon-accessible). If `acceptsTopups=false` → shows "disabled" screen.
2. Form submit → `submitTopupIntent()` RPC → returns `intentId`.
3. UPI deep-link button (opens GPay/PhonePe/Paytm) + collapsible QR for second device. 8s delay before "I've paid" button enables (allows payment to process).
4. Player taps "I've paid" → polls `getTopupIntentStatus(intentId)` every 3s, up to 10-min expire timeout.
5. Staff confirms in modal → intent `confirmed` → player poll returns `confirmed` → success screen.

## ClubCoins Flow

- **Earn:** coins earned at topup confirm only. `coinsEarnedForTopup(amount, tiers)` in `src/lib/coins.ts` — picks highest qualifying tier. Written as `WalletTransaction` with `balanceType:'coins'`, `coinDelta:+N`, `referenceType:'topup'` in the same flat tx as wallet credit.
- **Welcome bonus:** one-shot on first topup. `firstTopupAt === undefined` guard checked inside the Dexie tx (re-checked after lock, not just before).
- **Streak bonus:** `checkAndAwardStreak(customerId)` in `src/lib/streak.ts` — called from `SessionDetail.tsx` at session payment confirm. Counts distinct calendar days with `type:'debit' + referenceType:'session'` txs in `streakWindowDays`; awards if ≥ `streakRequiredDays`; per-user cooldown via `lastStreakBonusAt`.
- **Expiry:** FIFO lot accounting in `src/lib/coinExpiry.ts`. `applyExpirySweep()` called every 4h from `ExpirySweepRunner` in `App.tsx` (gated on `dbReady + session + subscriptionLoaded`; outer debounce via `sessionStorage.lastExpirySweep`). Per-customer 1h debounce via `expiryAppliedAt`.
- **Redemption:** `CoinRedemptionPill` component (`src/components/CoinRedemptionPill.tsx`) wired into `SessionDetail.tsx:697` — amber pill + slider shown in post-stop payment flow when customer has coins.
- **Sync to Supabase:** `syncCoinConfig()` in `playerHubApi.ts` — fire-and-forget on coin config save, updates `clubs.coins_enabled + coin_tiers_json`.

## Realtime Pattern (topup_intents)

```
src/lib/realtimeTopups.ts
  subscribeToTopupIntents(clubId: string)
    → supabase.channel('topup_intents_{clubId}')
       .on('postgres_changes', INSERT on topup_intents) → increment pendingCount
       .on('postgres_changes', UPDATE on topup_intents, filter: status != pending) → decrement pendingCount
    → if not SUBSCRIBED within 5000ms → setInterval(getPendingTopups, 30_000) fallback
  unsubscribeTopupIntents()
    → supabase.removeChannel() + clearInterval(fallbackTimer)
```

Called from `<TopupRealtimeBridge />` at the app shell (mounted once in `App.tsx` — Pattern A8; NOT from TopBar/Wallet page mounts, that was the pre-#83 bug). Cleaned up on sign-out / public-route transition.

⚠ Known bug (#66, open P2): the fallback polling timer is NOT cancelled when realtime eventually connects after the 5s window — both run until teardown. `realtimeBookings.ts` (the booking clone) FIXED this leak; when #66 is picked up, mirror that fix here.

## useLiveData.ts — useSyncClubFromSupabase()

```
Module-level: let _clubSyncDone = false
Effect deps: [dbReady, session]
Guard: if (!dbReady || !session || _clubSyncDone) return
Sets _clubSyncDone = true immediately (prevents double-run)
getOwnerClub() → for each field (slug, slugLocked, acceptsTopups, coinsEnabled, coinTiers):
  only writes Dexie if local value === undefined (never overwrites)
Cleanup: _clubSyncDone = false (reset on effect cleanup)
```

✅ Resolved: the flag is per-user-keyed (`_clubSyncDoneForUser`, #53/f9e3e62) and `authStore.signOut()` calls `_resetClubSyncSentinel()` (Chunk 4.3, Pattern S15) — second user on the same tab gets a fresh sync. Rule: any NEW per-user module-level cache must be reset in the same sign-out sequence.

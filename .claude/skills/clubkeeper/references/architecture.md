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

## Future Architecture (When Adding Cloud Sync)

When Sugeet decides to add auth + cloud sync:

1. **Add Supabase** — Postgres + auth + realtime out of the box. Free tier generous.
2. **Keep Dexie** — local cache stays. Supabase becomes the source of truth, Dexie syncs on online.
3. **Sync strategy** — last-write-wins on session updates. Conflict UI not needed for solo-owner app.
4. **Migration path** — existing offline-only users: on first auth, push their local DB to Supabase as their initial state.

Do NOT implement this until Sugeet has paying customers asking for multi-device support.

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

Called from TopBar on mount when `settings?.slug` exists. Cleaned up on unmount and sign-out.

⚠ Known bug: fallback polling timer is NOT cancelled when realtime eventually connects after the 5s window. Both run simultaneously until unmount.

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

⚠ Known bug: `_clubSyncDone` is module-level. If two different users sign in sequentially in the same browser tab without a full page reload, the second user's club sync is skipped because the flag was set by the first user. Fix pending (see Pending list item 10).

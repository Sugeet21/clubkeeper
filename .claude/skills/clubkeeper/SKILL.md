---
name: clubkeeper
description: ClubKeeper is Sugeet's offline-first PWA for managing indoor games clubs in India (pool, snooker, carrom, PlayStation). Use this skill whenever Sugeet mentions ClubKeeper, club app, indoor games, pool table app, carrom app, table timer, session timer, or anything related to building, debugging, or extending his SaaS product. Also trigger when he discusses pricing strategy, subscription plans, payment integration (Razorpay/UPI), customer acquisition for the app, signup/auth flows, deployment to Vercel, or shares screenshots from localhost:5173 / app.handbookhq.in (or clubkeeper.vercel.app backup). Trigger even when he just shares an error or asks "what should I do next" inside this project context. This skill carries the project's full architecture, design system, code conventions, all bugs found and fixed, business context, and decision history — consult it BEFORE answering anything about the app so advice stays consistent with prior decisions.
---

# ClubKeeper — Project Memory

Persistent memory for Sugeet's ClubKeeper SaaS. Read the relevant reference files for what's being asked, then respond with full context of prior decisions.

## About Sugeet

- Solo founder in Pune, India
- Less coding experience — relies on AI to write code via Claude Code (Sonnet)
- Building ClubKeeper as recurring-income SaaS alongside HRMS SaaS and hrdocs
- Indian English, short and pragmatic. Communicates by sharing screenshots
- Prefers: ready-to-paste prompts > theoretical explanations

## About ClubKeeper

Replaces the paper notebook used at Indian indoor game clubs for tracking who plays which table, when, for how long. Target customer: small club owners (1-2 staff, ₹50k–₹5L monthly revenue) currently losing money to forgotten timers and notebook errors.

**Sales pitch frame:** "If your staff forgets to start/stop the timer 3 times a day, that's ₹10,800/month lost. My app prevents that for ₹599/month."

## ⚠️ RULE 1 — RIPPLE EFFECTS

**Before changing any code, consult `references/ripple_effects.md`.** Find what's changing, see what else it affects, update ALL affected files in the same change.

Sugeet's biggest fear: a fix in one file creates bugs in 3 other files because the AI didn't know they were connected. ripple_effects.md prevents this. If a requested change isn't documented there yet, STOP and trace dependencies manually, then add the new ripples to it.

## ⚠️ RULE 2 — PREVENT BUG REPEATS

**Before writing code in a known-bug area, read the relevant section of `references/bug_patterns.md`.** Patterns are grouped by domain — Timer, Forms, Dexie, Auth, Subscription, Routing, UI/A11y, Modals. Each entry is symptom-signature + root cause + the rule. Most bugs in this project repeat. Patterns kill that.

## Critical Rules (Never Violate)

1. **Tech stack is LOCKED.** Vite + React 18 + TypeScript + Tailwind v3.4 + Dexie + react-router-dom v6 + date-fns + Zustand + vite-plugin-pwa. Do NOT suggest swapping any. Tailwind stays on v3.4, never v4.
2. **Offline-first via IndexedDB (Dexie).** Never localStorage for session/timer data. localStorage is OK only for UI flags (e.g. "install banner dismissed").
3. **Timers use timestamps, never counters.** Always `Date.now() - startedAt - pausedTotalMs`, recomputed every render. Never `setInterval(() => setElapsed(e+1))`. #1 bug source.
4. **Indian context.** Currency `₹`, format with `toLocaleString('en-IN')`. Razorpay for payments (NACH auto-debit). UPI is the user payment method.
5. **Mobile-first.** Design for 360px width. Touch targets ≥44×44px.
6. **Dark theme only** for v1. Palette locked — see `design_system.md`.
7. **No HTML `<form>` with submit.** Use button onClick handlers.
8. **All Dexie operations awaited.** No fire-and-forget.
9. **Strict TypeScript.** No `any`.
10. **Verify with `npm run build` after every change.** TS catches most ripple breaks.
11. **Test 3 scenarios after any change:** happy path, existing-data path, edge case (empty/max/error).

## Routing — read these references on demand

| Topic | File |
|---|---|
| **ANY code change** | **`ripple_effects.md` (mandatory first)** |
| **About to touch a known-bug area** | **`bug_patterns.md` (mandatory for that area)** |
| Architecture, file structure, library choices | `architecture.md` |
| Colors, typography, spacing, components | `design_system.md` |
| Database schema, types, queries | `data_model.md` |
| Currently-active design decisions and why | `decisions_active.md` |
| Pricing, customer acquisition, sales pitch, business strategy | `business_context.md` |
| Deployment, GitHub, Vercel, CI/CD | `deployment.md` |
| What's verified end-to-end | `test_status.md` |
| When something specifically shipped, manual setup history | `changelog.md` |
| Full chronological bug log (forensic, rarely needed) | `bug_archive.md` |
| Rejected ideas, historical context (rarely needed) | `decisions_archive.md` |

Read MULTIPLE files when the question spans domains.

## Response Style for Sugeet

- **Ready-to-paste prompts** for code requests. Include file paths, validation, what NOT to do.
- **Tables for comparisons** — he reads them faster than prose.
- **Number multi-step instructions.**
- **Anticipate the next question.** End with "next, you'll probably want X."
- **Show the why briefly.** One line, not three paragraphs.
- **Indian numbers.** ₹1,00,000 not ₹100,000.
- **Match his informal tone.** Founder building fast, not a research paper.

## Current State Snapshot

*Last updated: 15 Jun 2026 (Reset everything now clears all 9 stores — #81 fixed; Import Everything #79 closed)*

**Built and live on app.handbookhq.in (primary) / clubkeeper.vercel.app (backup):**
- **13 private screens** (behind RequireAccess): Tables (`/tables`), StartSession (`/start/:tableId`), SessionDetail (`/session/:sessionId`), Settings (`/settings`), History (`/history`), Summary (`/summary`), Wallet (`/wallet`), WalletNewCustomer (`/wallet/new`), WalletTopup (`/wallet/topup/:customerId`), CustomerProfile (`/customer/:customerId`), Canteen (`/canteen`), QuickSale (`/quick-sale`), Piggy (`/piggy`)
- **2 public Player Hub screens**: PlayerScan (`/c/:clubSlug`) — player QR topup form; Poster (`/poster/:slug`) — printable A4 QR poster (auto-triggers `window.print()` on load)
- **4 auth/landing public routes**: Landing (`/`), Signup (`/signup`), AuthCallback (`/auth/callback`), Subscribe (`/subscribe`)
- Landing → Signup → **directly to /tables (cardless trial)** flow, all wired with route guards
- Auth: Supabase + Google OAuth (`prompt: 'select_account'` enforced)
- Payment: REAL Razorpay (TEST mode). Serverless `/api/*`: create-subscription, razorpay-webhook, cancel-subscription
- Settings: **collapsible section cards** — Club Info (default open), Tables, Subscription, Data & Backup, About, Account. Only one section open at a time. `openSection` in React state + `sessionStorage`. Subscription header shows live status badge. Tables header shows live non-disabled count. Account section shows logged-in email.
- Session Items (POS): add snacks/drinks per session with Undo, bill split, grand total
- Post-stop payment screen: **fixed-viewport no-scroll layout** — `fixed inset-0 flex-col`, QR sized `min(72vw,280px)`, Done button always pinned. UPI QR (via `qrcode` npm pkg) if `upiId` set; plain amount card if not.
- Stop Session confirm: shows rounded time preview + items + grand total before stopping
- Recent-items chips: top 8 from last 30 days appear in AddItemBottomSheet
- Summary + History: all row/day totals include items; CSV has Table Amount / Items / Total columns
- **Summary dashboard rebuild (8 Jun 2026):** `src/pages/Summary.tsx` rebuilt as end-of-day dashboard. Pure aggregation in `src/lib/summaryMath.ts`. Sub-components in `src/pages/summary/`: `RevenueDeltas.tsx` (yesterday/last week/7d avg delta chips), `RevenueSplitBar.tsx` (tables vs canteen), `HourlyHeatmap.tsx` (collapsible, default collapsed, peak hour labelled), `TopTablesList.tsx` (medal ranked), `LowStockStrip.tsx` (navigates to /canteen), `TopCanteenItems.tsx`. Header has compact 44×44 calendar icon button for date navigation. Pattern T4 compliant — DB-static in `useLiveQuery`, running sessions computed in render body. History.tsx date inputs have `cursor-pointer`. **Date picker pattern: Pattern U9** — opacity-0 full-size input overlaid over a label, NOT clip/sr-only. See bug_patterns.md §Pattern U9.
- Rounding change: warns when active sessions exist (change only affects future stops)
- **Wallet / Prepaid Credit (Phase 1 + polish + Phase 1.5):** Customers table (UUID PK, phone, walkInCode, walletBalance), WalletTransactions table (compound index `[customerId+createdAt]`). TopUp with amount/bonus chips + payment mode + UPI QR (`<UpiQrCard>`). Manual adjustment (credit/debit, mandatory notes). Walk-in codes (WALK-001…). WhatsApp receipt link. Duplicate phone blocked (inline error + "View profile →" link, no toast). Transaction history with correct ₹ sign and color for all row types. Dexie v6 backfill migration for legacy `type:'adjustment'` rows. `<UpiQrCard>` shared between WalletTopup and SessionDetail post-stop screen. TopBar has wallet icon (right side, between online dot and gear). **Phase 1.5:** `src/lib/customerDisplay.ts` centralizes display name logic — `customerDisplayName` / `phoneTail` / `customerFullLabel` / `formattedPhone`. "Walk-in" label now only for truly anonymous (no name + no phone). `EditCustomerModal.tsx` (renamed from `EditPhoneModal`) supports editing both name and phone. Entire name+phone block in CustomerProfile header is tappable. `buildWhatsAppReceiptUrl` takes `Customer` directly.
- **V1-LAUNCH plan filter:** Subscribe page and landing `/pricing` show ONLY Standard Monthly (₹599). Starter and Pro hidden via `VISIBLE_PLAN_IDS` filter in `PlanSelection.tsx` + hidden cards in `PricingSection.tsx`. All 6 Razorpay plan IDs and `PLANS` array untouched. Revert = remove filter + restore cards.
- **Canteen management (Phase 1, 7 Jun 2026):** `CanteenItem` type (`id, name, defaultPrice, stockEnabled, currentStock, isActive, createdAt, sortOrder`). Dexie v8 adds `canteenItems: '++id, name, isActive, sortOrder'`. `lowStockThreshold` setting (default 5) in `ClubSettings`. 6 query functions: `getCanteenItems(includeInactive)`, `addCanteenItem`, `updateCanteenItem`, `softDeleteCanteenItem`, `decrementCanteenItemStock`, `getLowStockThreshold`. **IMPORTANT: `getCanteenItems` uses `.filter(item => item.isActive === true)` NOT `.where('isActive').equals(1)` — Dexie boolean index quirk.** Canteen page (`/canteen`): item list with StockPill badges, add/edit via `CanteenItemFormModal`, soft-delete with confirm modal, FAB. TopBar: cart icon (between online dot and wallet) navigates to `/canteen`.
- **Canteen POS stock sync — full coverage (8 Jun 2026):** Three coordinated fixes shipped in one commit:
  1. **`src/lib/canteenMatch.ts` (NEW):** Pure utility — `normalizeName(name)` (trim+lowercase+collapse spaces), `findMatchingCanteenItem(name, price, canteenItems)`, `findCanteenItemByName(name, canteenItems)`. No Dexie imports.
  2. **AddItemBottomSheet — all add paths now sync stock:** (a) Canteen chips tap directly → `handleCanteenChipTap` adds item + decrements stock in one inline flat tx; (b) Quick Add chips filtered to canteen-matched recent items ONLY (non-canteen recent items no longer appear); (c) manual form collapsed behind `+ Add other item` button (default hidden, expands on tap, collapses on successful add); (d) manual submit matches by `(name, price)` → runs same inline tx; (e) price-mismatch inline warning if name matches canteen but price differs — "Use ₹X" button auto-confirms; (f) `addOrIncrementSessionItem` — freeform path uses this new helper that merges into existing row by `(sessionId, normalizeName(name), price)` instead of always inserting; (g) repeated chip taps increment qty on existing row (merge-on-add), not new rows.
  3. **`updateSessionItem` / `deleteSessionItem` / `restoreSessionItem` — all three now sync stock atomically:** Each opens `db.transaction('rw', db.sessionItems, db.canteenItems, ...)` with stock logic INLINED via private `findMatchingCanteenItemForRow`. `InsufficientStockError` class (exported) thrown when qty-up edit or Undo would push stock negative — tx rolls back both writes atomically. Edit modal shows inline error via `setError` (Pattern F7). Undo callback catches it and shows a toast (justified exception — no inline surface once toast dismisses). Delete always succeeds (stock goes up). `restoreSessionItem` return type changed to `Promise<void>` (was `Promise<number>`; return value was unused).
  - **Pattern D7 invariant:** ALL stock logic across all six paths (3 add + 3 mutate) is inlined inside a single flat outer tx. Zero calls to `decrementCanteenItemStock` or `addOrIncrementSessionItem` from inside any outer transaction. Both remain safe to call standalone.
  - **Known limitation (tracked):** Editing qty down via the edit modal restores canteen stock correctly now. Freeform rows (no canteen match) never touch stock in any path.
- **Table Move — Phase 1 (8 Jun 2026):** Players can move a running or paused session to a different empty table of the same game type, billing mode, and rate — keeping one continuous session with one bill.
  - **Data:** `TableMove` interface (`fromTableId, toTableId, movedAt`). `Session.tableMoves?: TableMove[]` (Dexie v9, optional, no index). `session.tableId` always points to the CURRENT table after any moves.
  - **Query:** `moveSessionToTable(sessionId, toTableId)` — single `db.transaction('rw', db.sessions, db.gameTables)`. Validates: status is running/paused; dest exists + not outOfService; gameType matches; billingMode rate matches (per_hour → ratePerHour, per_frame → ratePerFrame); dest not occupied by any active session. Throws `IncompatibleTableError` or `TableOccupiedError` — both exported for typed UI catches.
  - **SessionDetail UI:** "Add Item" button → "Move table" button → "Edit Start Time" (order: Add Item is higher, used far more often). "Move table" hidden for completed sessions. Modal: list phase shows compatible free tables with "Same rate (₹X/hr|frame)" subtitle; confirm phase shows from→to names; inline error on race conditions. Table Journey row ("Pool 1 → Pool 2 → Pool 3") above bill split when `tableMoves.length > 0`.
  - **History:** `↻ N tables` appended to time range line when moves present.
  - **Home page:** No code change — `sessionMap` is keyed by `s.tableId` which Dexie updates; live query re-fires automatically. Old table goes free, new table goes occupied.
  - **Scope exclusions:** No cross-game-type moves. No per-segment billing. No move undo. No swap of two running sessions.
- **Subscribe back-button fix (8 Jun 2026):** `handleBack` in `Subscribe.tsx` now checks `headline.kind`. `'early'` (mid-trial, tapped Manage) → navigates to `/tables` freely. `'expired'` and `'welcome'` → show nag warning toast and stay on page.
- **Split payments + Walk-in Canteen Sale + PAYMENT MODE + Piggy bank (10 Jun 2026, Dexie v13):** Five-phase money-path rebuild for Ball Bender.
  - **Schema:** `Session.paymentBreakdown?: { cash, upi, wallet }` (sum === session.amount + items total). New tables `canteenSales` (id PK, indexes `createdAt, customerId`) and `stockPurchases` (id PK, indexes `createdAt, canteenItemId, source`). `ClubSettings.piggyOpeningBalance?` + `piggyStartedAt?`. `WalletReferenceType` extended with `'canteen_sale'`. v13 `.upgrade()` backfills `paymentBreakdown = { cash: amount, upi: 0, wallet: 0 }` for completed sessions and initialises piggy settings (`Date.now()` for `piggyStartedAt`, 0 for opening) only if absent. **⚠ Backfill caveat:** historic items revenue is missing from `paymentBreakdown.cash` because `session.amount` is the time portion only. PAYMENT MODE tile understates cash for pre-v13 dates by the items value; piggy is unaffected because `piggyStartedAt` cuts the window at migration time. Corrective backfill deferred until Ball Bender asks.
  - **`PaymentSplitSheet` (`src/components/PaymentSplitSheet.tsx`) — shared across SessionDetail and QuickSale.** Three numeric steppers (cash/UPI/wallet) + quick-fill chips (Cash only / UPI only / 50-50 / Wallet only when enabled). **Single `canConfirm` boolean** drives BOTH the status line and the Confirm `disabled` prop — green ✓ / orange short / red over states are exclusive; DB-layer errors REPLACE the status line (never stack). Confirm is visually muted (no accent) when not confirmable — `disabled:` pseudo-class is NOT trusted alone. Inline customer-link picker (modal with search + recent list) enables the wallet row without adding a `customerId` field to `Session`. `total` prop = grand total — caller is responsible (`session.amount + Σ items` for sessions, `subtotal` for QuickSale).
  - **`recordSessionPaymentBreakdown(sessionId, breakdown, customerId?)`** in `queries.ts`. Single flat tx over sessions+sessionItems+customers+walletTransactions. **Computes `grandTotal = session.amount + Σ(sessionItems.price × quantity)` inside the tx** and rejects if `cash+upi+wallet !== grandTotal`. Runtime guard at top throws on non-numeric `sessionId` (defence vs route-param leakage). If `wallet > 0`: writes WalletTransaction (`type:'debit'`, `referenceType:'session'`, `referenceId:sessionId.toString()`) + decrements `customer.walletBalance` in the same tx.
  - **SessionDetail post-stop flow (preserves UPI QR screen, ADDENDUM-1):** Stop → QR overlay unchanged → "Record payment" button → PaymentSplitSheet → confirm → footer flips to "Done — back to tables". **ADDENDUM-4:** "Skip for now" REMOVED — payment capture is mandatory. Re-mounting on a completed-without-breakdown session auto-resumes the flow via a `useEffect` guarded by `autoOpenHandled` + `paymentScreenOpen` (does NOT re-trigger after the normal Stop path). **ADDENDUM-5:** when `finalGrandTotal === 0`, button label flips to "Mark as paid" and writes `{0,0,0}` directly without opening the sheet (both the manual button AND the auto-open path).
  - **Quick Sale (`/quick-sale`):** New page. Entry: "+ Quick Sale" pill on TopBar's date subtitle row (`onQuickSalePress` prop). Tappable item cards (no chips), cart with `−` / `✕` controls, sticky bottom Continue-to-Payment bar. Out-of-stock cards `opacity-60` + tap blocked + toast. Reuses PaymentSplitSheet. `createCanteenSale()` (queries.ts) — single flat tx: aggregates qty per canteenItemId for stock sufficiency; decrements `currentStock` for each `stockEnabled=true` item (throws `CanteenSaleStockError(itemName, available)` if would go negative); optional wallet debit via `WalletTransaction(referenceType:'canteen_sale', referenceId:saleId)`; inserts the CanteenSale row LAST so any earlier throw rolls everything back. No customerId persisted on CanteenSale unless `wallet > 0`.
  - **Summary PAYMENT MODE strip (`src/pages/summary/PaymentModeStrip.tsx`):** Three tiles (CASH=accent, UPI=text-dim, WALLET=paused — all existing tokens) + 6px split bar between Tables-vs-Canteen and the hourly heatmap. Aggregates `paymentBreakdown` across stopped sessions (with breakdown) + canteen sales for the viewed date. **Excludes running sessions** with "Excludes N running session(s)" caveat (Pattern T4 — headline includes them, breakdown doesn't). Largest-remainder percent rounding ensures tiles sum to exactly 100. Section hidden when total is zero.
  - **Summary CASH FLOW strip (`src/pages/summary/CashFlowStrip.tsx`):** Two tappable tiles (PIGGY + STOCK BOUGHT TODAY) between PAYMENT MODE and the heatmap. Both navigate to `/piggy`. PIGGY shows `Math.max(0, current)` with "Opening · +cash today · −spent today" subline; "Piggy negative — check restock log" hint when underlying `current` is < 0. STOCK BOUGHT TODAY sums ALL restocks (any source) on the viewed date + count.
  - **Piggy aggregation (`getPiggyBalance()` in queries.ts):** `current = opening + cashIn − restockOut` where `cashIn = Σ session.paymentBreakdown.cash for completed sessions endedAt >= piggyStartedAt + Σ canteenSale.paymentBreakdown.cash createdAt >= piggyStartedAt + Σ walletTransaction.amount where type='credit' AND paymentMode='cash' AND createdAt >= piggyStartedAt`, and `restockOut = Σ stockPurchase.cost where source='piggy' AND createdAt >= piggyStartedAt`. Wallet top-ups paid in cash ARE part of piggy (the cash is in the till). They are NOT part of the PAYMENT MODE tile (that tile is revenue only).
  - **RestockSheet (`src/components/RestockSheet.tsx`):** Bottom sheet on each canteen item card (`mt-3 bg-bg border border-border h-9 px-3 rounded-xl` button below the existing edit/delete row). Captures qty, cost, source (Piggy / Other radio chips), optional notes. **Piggy chip is disabled when `cost > piggy`**; if user had Piggy selected when cost exceeds it, `effectiveSource` snaps to Other on confirm. `stockEnabled=false` caveat: "⚠ Stock tracking is disabled — currentStock won't change." `recordStockPurchase()` — single flat tx: insert StockPurchase + increment `currentStock` (when stockEnabled). Stock can only grow via restock.
  - **`/piggy` detail page:** Current balance (clamped ≥ 0) with opening + cashIn + restockOut breakdown + started-on date. "Edit opening balance" modal → `updatePiggyOpeningBalance()` writes the settings singleton (no audit log in v1). Cash collected by week (this / last / week-before) computed across all three cash sources, intersected with `piggyStartedAt`. Restocks listed in two sections: "Paid from piggy" and "Other".
  - **Settings → Piggy (cash float) section** between Subscription and Data & Backup. Shows current piggy + opening + cashIn + restockOut + started-on date + "View piggy details" button → `/piggy`.
- **Back Entries — Log Past Session (Phase 1 + Phase 2, 9 Jun 2026):** Partners can retroactively log completed sessions from a paper notebook. Dexie v12 adds `isBackEntry?: boolean` to `Session` (no index, no `.upgrade()`). `BackEntryOverlapError` (has `.conflictingSession: Session`) and `BackEntryOverlapError` exported from `queries.ts`. `createBackEntry()` — single flat `db.transaction` covering sessions, gameTables, settings, canteenItems, sessionItems. Overlap check covers active and completed sessions for same table. Rate card snapshots captured (Pattern T7). `per_frame` tables excluded. **Phase 2 items:** `BackEntryItemInput[]` added to `BackEntryInput`. Stock aggregation map (`canteenItemId → totalQty`) aggregates across all draft items before checking sufficiency — prevents bypass via multiple small rows. `InsufficientStockError(available, itemName)` thrown on insufficient stock, tx rolls back entirely. `addedAt: input.endedAt - order * 1000` anchors items inside session window. `validateBackEntry` in `validation.ts` reuses `validatePlayerName` + `validateNote`. `BackEntryModal` (`src/components/BackEntryModal.tsx` — NEW): canteen chips with out-of-stock dimming, draft items list with +/− stepper + × remove, `mergeDraftItem` merges by `(normalizeName, price)`, collapsible manual form, price-mismatch inline warning, extended preview (Duration / Table Amt / Items / Grand Total). Both `BackEntryOverlapError` and `InsufficientStockError` caught inline — no toast (Pattern F7). History shows `Logged` badge on `session.isBackEntry` rows. `onSaved(dateISO)` snaps History date range to saved date.
- **Rate card + tolerance billing (Phase 1, 9 Jun 2026):** `RateTier { minutes, price }` type added. `GameTable` gains optional `rateCard?: RateTier[]` + `toleranceMinutes?: number` + `rateCardBilling?: 'minimum' | 'prorated'`. `Session` gains snapshots: `rateCardSnapshot`, `toleranceMinutesSnapshot`, `rateCardBillingSnapshot`. Two billing algorithms in `src/lib/money.ts`: `priceForElapsedMinimum()` (legacy minimum-charge model, used when explicitly chosen) and `priceForElapsedProrated()` (new default — pro-rates pre-tier-1, plateaus at each tier for tolerance window, linearly climbs to next tier, extrapolates beyond last tier at `lastTier.price / lastTier.minutes` per minute). `calculateAmount` dispatches: per_frame → frame count; rateCardSnapshot present → mode-based dispatch (`rateCardBillingSnapshot ?? 'prorated'`); else → legacy linear `ratePerHour × hours`. **Rounding setting is IGNORED on rate card sessions for BOTH modes** (the tier+tolerance IS the rounding). `TableFormModal` has collapsible Tiered Pricing section: tier grid (mins / price columns labeled), `+ Add Tier`, Tolerance input, "Use standard preset (30 / 60 / 90 min) →" button (3-tier default, not 6), and a 2-button segmented Billing Behavior toggle (Pro-rated default, Minimum charge alternate) with helper text describing each. Validation enforces 1–12 tiers, ascending unique minutes, prices 1–99999, tolerance 0–60. Pool 1 seed includes a 6-tier example (Ball Bender values 30/60/90/120/150/180 → 70/100/170/200/270/300, tolerance 10, mode 'prorated') as demo data only — UI labels say "standard preset", never "Ball Bender". Settings rounding control shows dim hint when any table has a rate card.
- **Mobile modal scroll fix (9 Jun 2026):** `<Modal>` sheet restructured into 3 flex regions — title `shrink-0`, content `flex-1 overflow-y-auto overscroll-contain`, footer `shrink-0` with `safe-area-inset-bottom` padding. `max-h-[92vh]` on outer sheet. Pinned action buttons (Update / Cancel / Disable Table) always visible at the bottom; form content scrolls behind. Verified at 360px viewport.
- **Auth race fix (7 Jun 2026):** `subscriptionLoaded` boolean flag in authStore. Set `true` after `refreshProfile()` resolves in both `initialize()` and `onAuthStateChange`; set `false` on sign-out. `useAccessGuard` returns `{ canAccess: false, reason: 'subscription_loading' }` while `!subscriptionLoaded`. `RequireAccess` shows spinner for this reason. Prevents `subscription===null` being misread as `no_subscription` in the window between `loading=false` and `refreshProfile()` completing. Critical for any new private route that Dexie-queries on mount.
- **Alarm / Notify-at (Phase 2):** Per-session optional alarm. Threshold persisted on `Session.notifyAtMs` (Dexie v7, absolute Unix ms). Settable from BOTH `StartSession` (duration from session start) AND `SessionDetail` edit pill (duration from now). Chip presets in `src/lib/notifyPresets.ts` — 30 min / 1 hr / 1.5 hr / 2 hr / custom 1–600 min. Detection: `useSessionAlarm` — Pattern T1 timestamp comparison, `status === 'running'` only, paused sessions deferred, completed sessions excluded via `activeSessions`. Visibility: passive bell icon on table card (`Home.tsx`) when armed + unacknowledged; pulsing on running sessions. Edit pill on `SessionDetail` shows armed time + opens Modal to change/remove. Snooze anchors to original `notifyAtMs` (Pattern T6) with `Date.now()` fallback if past. Sound via `src/lib/alarm.ts` (gain 1.0, looped, 60-sec cap, iOS unlock). Wall-clock semantics — pause does NOT shift `notifyAtMs`.
- **Cardless 7-day trial (Phase 1 + 1.5 + duplication fix + banner two-state split):** New signups land directly on `/tables` — no card required. Postgres trigger `handle_new_user()` creates `status='trialing'` + `trial_ends_at = now()+7d` on every new signup. `useAccessGuard` reason values: `trial_expired` (trialing + past date), `no_subscription` (none/cancelled/expired). `RequireAccess` passes `state: { reason: 'trial_expired' }` on redirect. `AuthCallback` routes by status: active/past_due/trialing-active → `/tables`; trialing-expired → `/subscribe` with state. **`SubscriptionStatusBanner` trialing branch is split in two:** (a) `!razorpaySubscriptionId` → "Free trial: N days left · Manage →" to `/subscribe` with `state: { reason: 'subscribe_early' }`; (b) `razorpaySubscriptionId` present → "Subscribed ✓ — ₹599 will be charged on {d MMM} · View →" sets `sessionStorage('ck_settings_section', 'subscription')` then navigates to `/settings`. **Subscribe page three-branch headline (all in Subscribe.tsx):** `expired` ("Your free trial has ended"), `early` ("Subscribe early to lock in ₹599/month" + days left + trial-end date `d MMM`), `welcome` ("Welcome, {Name} 👋 / Start your 7-day free trial"). `HeadlineState` discriminated union computed via `useMemo` — `location.state.reason` takes priority, falls back to live subscription state on refresh. All three branches live in `Subscribe.tsx`; `PlanSelection` always receives `hideWelcome={true}` and never renders its own welcome header. Migration file: `supabase/migrations/20260602_cardless_trial.sql` (run manually in SQL editor).
- PWA install support
- Playwright suite: 8 spec files × 3 viewports
- **`vercel.json` SPA rewrite (12 Jun 2026):** `vercel.json` added at project root with catch-all rewrite `/((?!api/).*)` → `/index.html`. Without this, Vercel 404'd every deep route on first load. Player QR URL (`/c/<slug>`), OAuth callback, all deep links now work. `/api/*` routes excluded so serverless functions are unaffected.
- **PWA icons (12 Jun 2026):** `pwa-192x192.png`, `pwa-512x512.png`, `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png` added to `public/`. `<link>` tags added to `index.html <head>`. Icons were referenced in `vite.config.ts` manifest but files didn't exist — caused 404 on every PWA install attempt.
- **Player Hub (10–11 Jun 2026, Dexie v14):** Supabase `clubs` + `topup_intents` tables (migrations `20260610_player_hub.sql` + `20260610_clubcoins.sql` — ⚠ confirm run). Owner: slug setup in `PlayerHubSettings`, "Accept topups" toggle (Supabase-first for atomicity after 13 Jun fix). Player side: `/c/:clubSlug` (`src/pages/player/PlayerScan.tsx`) — name/mobile/amount form → UPI deep-link + QR → 8s delay → "I've paid" → polls `getTopupIntentStatus` every 3s (10-min expire). Owner side: `src/components/PendingTopupsModal.tsx` — per-row confirm/reject state machine. Realtime: `src/lib/realtimeTopups.ts` — Supabase channel `topup_intents_{clubId}` + 5s/30s polling fallback. Pending badge count in `src/store/topupInbox.ts` (Zustand). `/poster/:slug` (`src/pages/Poster.tsx`) auto-prints A4 QR. `src/lib/slug.ts`: `generateSlug`, `validateSlug`, `isSlugAvailable`. `src/lib/playerHubApi.ts`: full API layer. `useSyncClubFromSupabase()` in `src/hooks/useLiveData.ts` syncs Supabase → Dexie once per browser session.
- **ClubCoins (10–11 Jun 2026, Dexie v15):** `src/lib/coins.ts` — `coinsEarnedForTopup`, `resolveCoinConfig`, `coinsToRupees`, `coinsToMinutes`, `maxRedeemableCoins`, `formatCoins`, `DEFAULT_COIN_CONFIG` (4 tiers, minutesPerCoin=2, rupeesPerCoin=0.5, expiryDays=60, minRedemption=10). `src/components/CoinTiersEditor.tsx` in PlayerHubSettings. `src/components/CoinRedemptionPill.tsx` (amber pill + slider) — **wired in `SessionDetail.tsx:697`**. `Customer.coinBalance?`. `WalletTransaction.balanceType?/coinDelta?/rupeeEquivalent?`. `recordTopupWithCoins` in `queries.ts` credits coins + handles welcome-bonus one-shot (`firstTopupAt` guard). Config synced to Supabase via `syncCoinConfig()` (fire-and-forget). PlayerScan shows "Earn N coins" preview.
- **Engagement system (10–11 Jun 2026, Dexie v16):** All features **off by default** (master switches in ClubSettings). `src/lib/streak.ts` — `checkAndAwardStreak()` **called in `SessionDetail.tsx:750,801`**. `src/lib/coinExpiry.ts` — FIFO lot accounting, `applyExpirySweep()` — runs every 4h via `ExpirySweepRunner` in `App.tsx` (gated on `dbReady + session + subscriptionLoaded`). `src/lib/nudge.ts` — `renderNudgeTemplate`, `buildWhatsAppLink`, `logNudgeSent`. `src/lib/dormancy.ts` — `getDormantCustomers(thresholdDays, limit)`. UI: `src/components/BringBackList.tsx`, `src/components/NudgeTemplateEditor.tsx`, `src/components/EngagementConfigCard.tsx` in PlayerHubSettings. Welcome bonus (one-shot, `firstTopupAt` guard), streak bonus, coin expiry all wired.
- **Auth fixes (13 Jun 2026, commit e7b0522):** (1) Sign-out: `authStore.signOut()` does `window.location.href = '/'` hard nav + resets `loading` + `subscriptionLoaded`. (2) S1 club name sync: `handleSaveClubName` fires `updateClubNameRemote()` (new fn, `playerHubApi.ts`) fire-and-forget after Dexie write. (3) S4 toggle atomicity: `handleToggleTopups` Supabase-first, Dexie only on success. Note: `storage` option added to `createClient` was subsequently removed by linter — session persistence relies on Supabase default.
- **Import Everything + Export fix (14 Jun 2026, #78 + #79 Phase A0+A+B):** Customer #3's phone died → lost data because we had Export but no Import. Two-issue shipping unit:
  - **#78 (closed, P0 data-loss):** `getAllDataForExport()` in `queries.ts` was returning only 3 of 9 tables (`tables`, `sessions`, `settings`). Now returns all 9 (`+sessionItems +customers +walletTransactions +canteenItems +canteenSales +stockPurchases`) plus `schemaVersion: 16` and `exportedAt: number`. New exported `ClubKeeperBackupV16` interface + `CURRENT_SCHEMA_VERSION` constant (single source of truth — must bump alongside Dexie version).
  - **#79 Phase A:** New `src/lib/importEverything.ts` — `importEverythingFromFile(file)` returns typed `ImportResult` discriminated union. Single atomic `db.transaction('rw', [all 9 stores], …)` that clears every store then `bulkAdd`s — any throw rolls back the whole tx. 7 failure reasons including `legacy_incomplete_format` (catches pre-#78 3-table backups with a useful error instead of silent re-loss). IDs preserved verbatim. Active-session pre-check (`status !== 'completed'`) refuses import on top of running timers. Subscription/auth/Supabase state untouched (Dexie-only).
  - **#79 Phase B:** Settings → Data & Backup → "Import everything" action row below "Export everything". Hidden `<input type="file" accept="application/json,.json">` triggered via ref. Pre-confirm destructive Modal "Replace all current data?" → on confirm, runs the importer → success overlay (full-viewport `fixed inset-0 z-50`) with 9-row count breakdown + wallet balance total + green check icon → Done button calls `window.location.assign('/tables')` so every `useLiveQuery` re-fetches against the restored DB. All 7 failure reasons mapped to human-readable toast copy via module-level `importErrorMessage()`. DEV-only `window.__importEverythingFromFile` exposed in `main.tsx` for console testing (stripped from prod).
  - **#79 Phase C:** New `src/lib/__devTools__/importExportRoundTrip.ts` — `runImportExportRoundTrip()` exposed on `window` in DEV only. Snapshots 11 measures (9 store counts + walletBalanceTotal + piggyCurrent), exports → wraps as File → imports → re-snapshots → `console.assert`s every measure matches. Guards against silent format drift between export and import. Production bundle unchanged (954.91 kB) — confirms dev tool is tree-shaken.
  - **#79 open** — pending owner verification of the full E2E flow (export → reset → import → verify counts match).
- GitHub: `github.com/Sugeet21/clubkeeper`
- Supabase project: `vkczmgzujpidbwtzulel.supabase.co`
- Razorpay plan IDs: single source of truth in `src/lib/razorpayPlans.ts`
- ✅ End-to-end payment verified on production (TEST mode)
- Per-user IndexedDB: DB name is `ClubKeeperDB_<userId>`. Two Gmail accounts on same browser see isolated data. `db` export is a Proxy; `authStore` manages `initDbForUser` / `closeDb` lifecycle. `dbReady` flag gates all private routes via `useAccessGuard`.

**Dexie version history:**
- v1/v2: `gameTables` + `sessions` + `settings`
- v3: adds `sessionItems: '++id, sessionId, addedAt'`
- v4: documents `upiId` field on settings (no index)
- v5: adds `customers: 'id, phone, walkInCode, lastVisitAt'` + `walletTransactions: 'id, customerId, createdAt, [customerId+createdAt]'`; `ClubSettings.walkInCounter?`
- v6: `.upgrade()` backfill of legacy `type:'adjustment'` wallet transaction rows → infers credit/debit from balanceAfter delta
- v7: adds optional `notifyAtMs?` + `notifyAcknowledgedAt?` on sessions (alarm); `alarmSoundEnabled/alarmVibrationEnabled` on ClubSettings. No index. No `.upgrade()`.
- v8: adds `canteenItems: '++id, name, isActive, sortOrder'`; `ClubSettings.lowStockThreshold?` (default 5)
- v9: adds optional `tableMoves?: TableMove[]` on sessions. No index. No `.upgrade()`.
- v10 (9 Jun 2026): adds optional `rateCard?` + `toleranceMinutes?` on `GameTable`; `rateCardSnapshot?` + `toleranceMinutesSnapshot?` on `Session`. Additive, no `.upgrade()`.
- v11 (9 Jun 2026): adds optional `rateCardBilling?` on `GameTable`; `rateCardBillingSnapshot?` on `Session`. Additive.
- v12 (9 Jun 2026): adds optional `isBackEntry?: boolean` on sessions. No index. No `.upgrade()`.
- v13 (10 Jun 2026): new tables `canteenSales: 'id, createdAt, customerId'` + `stockPurchases: 'id, createdAt, canteenItemId, source'`. `Session.paymentBreakdown?`. `ClubSettings.piggyOpeningBalance?/piggyStartedAt?`. `.upgrade()` backfills sessions + initialises piggy. ⚠ Items-revenue gap: backfill used `session.amount` (time only), not grand total.
- v14 (10–11 Jun 2026): adds `ClubSettings.slug?` + `slugLocked?` for Player Hub. Additive, no `.upgrade()`.
- v15 (10–11 Jun 2026): adds `Customer.coinBalance?`; `WalletTransaction.balanceType?/coinDelta?/rupeeEquivalent?`; `ClubSettings` coin config fields (`coinsEnabled, coinTiers, minutesPerCoin, rupeesPerCoin, coinExpiryDays, coinMinRedemption`) + `acceptsTopups?` + `coinRedemptionModes?`. Same store strings as v14. No `.upgrade()`.
- **v16 (current, 10–11 Jun 2026): adds `Customer.firstTopupAt?/lastStreakBonusAt?/expiryAppliedAt?`; `ClubSettings` engagement fields (`welcomeBonusEnabled, welcomeBonusCoins, streakEnabled, streakRequiredDays, streakWindowDays, streakBonusCoins, dormancyEnabled, dormantThresholdDays, nudgeTemplate`). `WalletReferenceType` extended with `coin_expiry, welcome_bonus, streak_bonus, engagement_log`. Same store strings as v15. No `.upgrade()`.**

**⚠️ Razorpay key rotation warning:** If `VITE_RAZORPAY_KEY_ID` or `RAZORPAY_KEY_SECRET` is ever rotated, or LIVE mode is enabled, the 6 plan IDs in `razorpayPlans.ts` MUST be re-verified against the new account. Run: `curl -u KEY_ID:KEY_SECRET https://api.razorpay.com/v1/plans/PLAN_ID` — expect 200. See Pattern S5.

**⚠️ Supabase migration pending manual run:** `supabase/migrations/20260602_cardless_trial.sql` must be pasted into the Supabase SQL editor and executed. Until this runs, new signups still get `status='none'` (old trigger behavior) and land on `/subscribe` instead of `/tables`. Existing `status='none'` users also not backfilled yet.

**Pending:**
1. **Run `supabase/migrations/20260602_cardless_trial.sql`** — cardless trial broken until done (new signups land on `/subscribe`, not `/tables`)
2. **Run `supabase/migrations/20260610_player_hub.sql`** — creates `clubs` + `topup_intents` tables + `get_club_public_info` RPC. ⚠ Confirm if already run in production.
3. **Run `supabase/migrations/20260610_clubcoins.sql`** — adds `coins_enabled` + `coin_tiers_json` to clubs + updates RPC. ⚠ Confirm if already run.
4. Vercel webhook config: Razorpay Dashboard → add `/api/razorpay-webhook` URL + `RAZORPAY_WEBHOOK_SECRET` → redeploy
5. Razorpay LIVE mode switch (needs KYC first)
6. GST invoicing + email notifications (next sprint)
7. **PWA update banner (S6):** Users on old service worker don't get new deploys without hard refresh. Needs `useRegisterSW` + banner UI.
8. **Wallet Phase 3:** Refund UI. `referenceType: 'refund'` + mandatory notes.
9. **PAYMENT MODE backfill (v13 follow-up):** `paymentBreakdown.cash` understates pre-v13 sessions by items value. Defer until Ball Bender notices.
10. **`_clubSyncDone` bug (useLiveData):** Module-level flag never resets on sign-out — second user to sign in on same tab skips club sync. Fix: reset flag in auth sign-out path.
11. **Session persistence:** `storage` option removed from `createClient` by linter — monitor if session drops recur in production.

**Known limitations:**
- **LIMIT-001 (partially fixed):** IndexedDB is now per-user per-browser (`ClubKeeperDB_<userId>`). Two Gmail accounts on the same browser see separate data. Cross-device sync is still not implemented — same account on Chrome vs Edge sees different data. Full fix requires cloud sync (Supabase). Warn Sugeet if he asks for multi-device access.
- **LIMIT-002:** `/api/*` requires `vercel dev` locally, not `npm run dev`. Handled with friendly 404 error in `handlePayNow`.
- **LIMIT-003 (multi-device sync request count: 2/3):** Two paying customers have now asked for multi-device sync (Customer #1: 12-table club, 7 Jun 2026; Customer #2: Ball Bender 4-partner club, 9 Jun 2026). Threshold per decision is 3+. Keep deferring full Supabase sync until the third ask. Interim solution for Ball Bender: "Shift Handover" JSON export/import between partner phones (not yet built; defer until they actually complain).

## Bug Tracking — GitHub Issues

**As of 14 Jun 2026, bugs are tracked at: https://github.com/Sugeet21/clubkeeper/issues**

- **67 issues created** covering all bugs from bug_archive.md + the June 2026 audit
- **Issues #1–54:** fixed bugs (all closed with commit reference)
- **Issues #55–67:** open bugs from the audit (A1–A5, P1–P2, W1–W2, S1–S2, R1–R2)
- **Q1 skipped:** was a false alarm — null-guard already existed in PlayerScan.tsx:102

`bug_archive.md` now contains one-line pointers only. Full description, root cause, and fix details live on GitHub.

**When Sugeet reports a new bug or set of bugs — MANDATORY ORDER:**

1. **STOP. Do NOT write any code yet.** First, search GitHub for prior occurrences:
     gh issue list --search "<keywords>" --state all --repo Sugeet21/clubkeeper
   If a similar issue exists, reference it. Do not create a duplicate.

2. **Create a GitHub issue for EACH distinct bug** before any code change:
     gh issue create --repo Sugeet21/clubkeeper \
       --title "BUG-XX — <short symptom>" \
       --label "bug,priority-<p0|p1|p2>,domain-<area>,status-open" \
       --body "<symptom / repro / expected / suspected root cause / files likely affected>"
   Multiple bugs in one report = multiple issues. Never bundle.

3. **Reply to Sugeet with the issue numbers and links** before writing fix code. Wait for his go-ahead.

4. **Fix the bug.** Reference the issue number in the commit message:
     git commit -m "fix(<area>): <one-line>  (closes #NN — pending owner verification)"

5. **NEVER close the issue yourself.** After the commit, post a comment on the issue with the commit SHA and a one-line of what was changed. Then explicitly ask Sugeet:
     "Issue #NN — fix committed in <SHA>. Please verify on your device. Reply 'close #NN' (or 'closed') only after you've tested it. I will not close it until you do."

6. **Only close after Sugeet confirms.** When Sugeet replies "close #NN" / "closed" / "verified" for that specific issue number:
     gh issue close NN --repo Sugeet21/clubkeeper --comment "Verified by owner. Fixed in <SHA>."
   Then update the bug_archive.md pointer to add the SHA.

**This rule overrides any urge to be efficient.** Even if a bug is trivial and the fix is one line, the issue gets created first and stays open until Sugeet says close. The only exception is a typo/wording fix Sugeet asked for in plain English with no symptom — those don't need an issue.

## Updating This Skill — MANDATORY RULES

### Rule A: Update skill AFTER EVERY PHASE, not after the module
When Opus gives multi-phase prompts, the skill MUST be updated at
the end of EACH phase before moving to the next. Compaction will
eat details otherwise.

### Rule B: Every src/ commit needs a paired skill commit
If you change anything in src/, you MUST update at least one of:
changelog.md, ripple_effects.md, bug_archive.md, decisions_active.md,
or Current State Snapshot in SKILL.md — in the same working session.
Run `git log --since="2 hours ago" --name-only` before declaring
"done" — if src/ files appear but no skill files do, the skill is
stale. Fix it before stopping.

### Rule C: Bugs go to GitHub Issues, not bug_archive.md
New bugs → `gh issue create` with the format established in
github.com/Sugeet21/clubkeeper/issues. bug_archive.md only gets a
one-line pointer. Full description, discussion, and fix details live
on GitHub.

### Rule D: Before fixing any bug in a known-bug area
1. Read the relevant section of bug_patterns.md (existing rule).
2. Search GitHub issues for prior occurrences:
     gh issue list --search "<keywords>" --state all
   If a similar issue exists (open or closed), read it before writing
   code. Reference it in your commit message.

### Rule E: At end of every session
Proactively ask Sugeet: "Skill update checklist:
- changelog.md updated?
- ripple_effects.md updated for files touched?
- Any new bug → GitHub issue created?
- Any new pattern → bug_patterns.md updated?
- Current State Snapshot still accurate?"
Do NOT skip this. Sugeet has explicitly asked for this check.

### Rule F: Bug fix flow — issue first, owner closes last
- New bug report → create GitHub issue(s) BEFORE writing any code
- One bug = one issue. Never bundle multiple bugs into one issue.
- After commit, post SHA as comment on the issue and ask Sugeet to verify
- Only Sugeet's explicit "close #NN" / "closed" / "verified" triggers `gh issue close`
- The AI never auto-closes an issue, even if the fix is trivial or "obviously works"
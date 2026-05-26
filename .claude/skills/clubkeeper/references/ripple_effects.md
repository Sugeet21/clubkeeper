# Ripple Effects — Change Impact Map

**This is the most critical reference file. Consult it BEFORE making any code change.**

When changing one thing, this file lists everything else that might break. If a change isn't listed here and you can think of a ripple effect, ADD it.

## How to use this file

1. Sugeet asks for a change (e.g., "rename a field" or "add a status").
2. BEFORE writing code, search this file for the entity being changed.
3. Read the "Affects" list for that entity.
4. Update ALL affected files in the same commit.
5. After the change, add new ripples to this file if any were discovered.

If a change isn't documented here yet, pause and trace dependencies first.

---

## Database Schema Changes

### If you change the `GameTable` interface (add/rename/remove field)

**Affects:**
- `src/types/index.ts` — interface definition (source of truth)
- `src/db/database.ts` — Dexie schema if a new INDEX is needed (not just a field)
- `src/db/queries.ts` — `addTable`, `updateTable`, all readers
- `src/db/seed.ts` — seed data must include new required fields
- `src/pages/Settings.tsx` — table list display
- `src/components/TableFormModal.tsx` — add/edit form
- `src/components/TableCard.tsx` — Home card display
- `src/pages/StartSession.tsx` — uses table data
- `src/pages/SessionDetail.tsx` — uses rateSnapshot etc.
- **Migration:** if removing a field, bump Dexie version, add upgrade function
- **Export format:** `Export All Data` JSON includes tables — verify new shape

### If you change the `Session` interface

**Affects:**
- `src/types/index.ts`
- `src/db/queries.ts` — `startSession`, `pauseSession`, `resumeSession`, `stopSession`, `editSessionStart`, all readers
- `src/lib/time.ts` — `getElapsedMs` reads startedAt/endedAt/pausedAt/pausedTotalMs/status
- `src/lib/money.ts` — `calculateAmount` reads billingMode/rateSnapshot/framesPlayed
- `src/pages/SessionDetail.tsx` — displays everything
- `src/pages/Home.tsx` — needs active session for each table
- `src/pages/Summary.tsx` — today's sessions list
- `src/pages/History.tsx` — date-range sessions list
- `src/components/TableCard.tsx` — shows player/timer/status
- **CSV export** in Summary and History — column structure
- **Migration:** bump Dexie version if changing indexes

### If you change `ClubSettings`

**Affects:**
- `src/types/index.ts`
- `src/db/queries.ts` — `getSettings`, `updateSettings`
- `src/db/seed.ts` — default values
- `src/pages/Settings.tsx` — settings UI
- **Anywhere a setting is consumed:** e.g., `rounding` is read by `stopSession` in queries.ts. Search the codebase for setting usage.

---

## Component Changes

### If you change `<FilterPills>` component

**Affects:**
- `src/pages/Home.tsx` — only consumer. Props: `pills`, `active`, `onChange`.
- Pill height / padding changes affect the overall height of the filter row, which affects the visual spacing between TopBar and the table grid.
- Touch target: all pills must keep `min-h-[44px]` (added BUG-005 fix, 24 May 2026).

**Discovered when:** Phase 2B touch-target sweep.

---

### If you change `<TopBar>` component

**Affects:**
- `src/pages/Home.tsx` — only consumer.
- The settings gear inside TopBar navigates to `/settings` — if that route changes, update here.
- The gear button must stay `w-11 h-11` (44px) minimum (added BUG-006 fix, 24 May 2026).

**Discovered when:** Phase 2B touch-target sweep.

---

### If you change `<TableCard>` props or behavior

**Affects:**
- `src/pages/Home.tsx` — only consumer currently
- Visual regression: card has 4 visual states (Free, Busy, Paused, Out of Service) — verify all 4
- Touch behavior: tap zones (whole card vs just CTA button)

### If you change `<TableFormModal>`

**Affects:**
- `src/pages/Settings.tsx` — consumer #1: Add Table button (top right of Tables section) + Edit pencil for each table row
- `src/pages/Home.tsx` — consumer #2 (added Phase 2C-1, 24 May 2026): FAB `+` button opens inline Add Table modal
- Both ADD and EDIT modes share the same component; ADD mode is triggered with no `table` prop, EDIT mode passes the existing `GameTable` object
- Validation logic in `src/lib/validation.ts` — `validateTableName` called inside
- Props interface: `{ open, onClose, table?, existingTables }` — if you add a prop, update ALL call sites (currently 3: Settings Add, Settings Edit, Home FAB)
- `existingTables` prop is used for duplicate-name checking — must always receive the full current tables array

**Discovered when:** Phase 2C-1 — BUG-004 fix moved FAB from navigate('/settings') to inline modal.

---

### If you change `<Modal>` component

**Affects:**
- Every modal in the app — `<Modal>` is used by: `SessionDetail.tsx` (stop confirm, edit start time), `Settings.tsx` (clear sessions, reset everything, cancel subscription, clean names), `TableFormModal.tsx` (wraps the whole form), `Home.tsx` (orphaned sessions)
- Scroll-lock behaviour: `useEffect` with `[open]` dep sets `document.body.style.overflow = 'hidden'` on open, restores on close/unmount
- Escape key: `useEffect` with `[open, onClose]` dep adds/removes `keydown` listener — if you change `onClose` reference stability, wrap it in `useCallback` at the call site to avoid re-registering on every render
- Layout: scrim is `fixed inset-0 z-40`, sheet is `fixed bottom-0 left-0 right-0 z-50` — both are independent fixed layers. Do NOT nest them in a shared container or the scrim will intercept clicks on the sheet (confirmed bug, 24 May 2026)
- PaymentBottomSheet (`src/components/subscribe/PaymentBottomSheet.tsx`) is NOT a `<Modal>` — it has its own translateY slide-up and is a sibling in Subscribe.tsx; changes to Modal do not affect it

**Discovered when:** Phase 2C-1 — BUG-012 fix; the original single-container layout caused `absolute inset-0` scrim to intercept pointer events on the sheet in Playwright hit-testing.

### If you change `<Toggle>` component

**Affects:**
- Anywhere it's used (search `<Toggle`)
- Settings page (rounding mode, club name save behavior)
- TableFormModal — used to be there, now removed per Prompt 7

### If you change `<ConfirmModal>` component

**Affects:**
- Settings page: Clear All Sessions, Reset Everything, Disable Table actions
- TableFormModal: Disable/Enable confirmation
- SessionDetail: Stop session confirmation

### If you change `<BottomNav>` (the tab bar)

**Affects:**
- All pages — bottom nav is rendered persistently in App.tsx
- Routes: adding a new tab requires a new Route in App.tsx
- Page padding-bottom: all pages need `pb-24+` to clear nav

---

## Logic & Library Changes

### If you change `getElapsedMs()` in time.ts

**Affects:**
- `<TableCard>` — Home timer display
- `<SessionDetail>` — big timer
- `calculateAmount` in money.ts — uses elapsed for running totals
- Summary page — sums elapsed for running sessions
- History page — duration display
- **EXTREMELY high blast radius. Touch with extreme care.**

### If you change `calculateAmount()` in money.ts

**Affects:**
- `<TableCard>` — running session amount
- `<SessionDetail>` — running total
- `stopSession()` in queries.ts — final amount calculation
- Summary page — today's revenue
- History page — per-session amount
- CSV export amount column

### If you change `applyRounding()` or rounding logic

**Affects:**
- `stopSession()` ONLY — rounding is final-amount only
- Display: rounded duration shown in history/summary if `roundedDurationMs` is set

### If you change validation rules (`validation.ts`)

**Affects:**
- `<TableFormModal>` — table name validation
- `<StartSession>` — player name + note validation
- `getRecentPlayerNames()` query — filters by validation
- **Backwards compatibility:** if rules become STRICTER, existing data may now fail validation. Provide a cleanup tool in Settings.

### If you change `queries.ts` function signatures

**Affects:** every caller. Use TypeScript to track them — `npm run build` will fail if anything is missed. RELY on the type checker, don't trust memory.

---

## Routing Changes

### If you add a new route

**Affects:**
- `src/App.tsx` — add `<Route>`
- Bottom nav — if user-accessible, add a tab; else, just deep-linked
- PWA manifest — if it should be a "shortcut", update vite.config.ts

### If you rename a route path

**Affects:**
- Every `<Link to="/old">` or `navigate('/old')` call
- Bottom nav links
- Browser history of existing users — old URLs may be bookmarked

### If you change the Subscribe page (`src/pages/Subscribe.tsx` or `src/components/subscribe/`)

**Affects:**
- `src/components/subscribe/PlanSelection.tsx` — `PLANS` array has hardcoded prices (₹299/₹599/₹999 monthly, ₹2990/₹5990/₹9990 annual). If pricing changes, update here AND in `StickyCheckout.tsx`. `selectedPlan` prop is `PlanId | null` (since BUG-016 fix).
- `src/components/subscribe/StickyCheckout.tsx` — receives `selectedPlan: PlanId | null`; renders `null` (hides entirely) when no plan is selected. Receives `currentPrice` as number. Safe to change pricing in Subscribe.tsx only.
- `src/components/subscribe/PaymentBottomSheet.tsx` — accepts: `payError: string | null`, `onMaybeLater: () => void`, `onRetry: () => void`. All three must stay in sync with `handlePayNow()`/`handleMaybeLater()`/`handleRetryPayment()` in `Subscribe.tsx`. Sheet has ESC key listener (BUG-016), 4 escape paths, "Maybe later" + "Retry" buttons.
- `src/components/subscribe/ConfirmationScreen.tsx` — rendered when `screen === 'confirmed'`. Navigate uses `replace: true` — do NOT remove or user can back into Subscribe
- `src/pages/AuthCallback.tsx` — checks `subscription.status` to decide `/subscribe` vs `/tables`
- `src/hooks/useAccessGuard.ts` — reads `subscription.status`; `'trialing'` and `'active'` allow access
- `api/create-subscription.ts` — called by `handlePayNow()` via fetch POST with 15s AbortController timeout (since BUG-017 fix). If flow changes, both must update together.
- `src/lib/razorpayPlans.ts` — plan IDs consumed by `api/create-subscription.ts`. If plan IDs change, update ONLY this file
- Annual prices: `MONTHLY_PRICES` and `ANNUAL_PRICES` in `Subscribe.tsx`. ROI calculator in `Landing.tsx` also hardcodes `₹599` — keep in sync

**PaymentBottomSheet escape paths (as of BUG-016 fix, 24 May 2026):**
- X button (`onClose`) — closes sheet, plan stays selected
- ESC key (`useEffect` in PaymentBottomSheet) — calls `onClose`
- Backdrop click (overlay div in Subscribe.tsx) — calls `setSheetOpen(false)`
- "Maybe later" button (`onMaybeLater`) — closes sheet AND sets `selectedPlan = null` (hides StickyCheckout bar)
All 4 paths are guarded by `!paying` — cannot escape mid-payment.

**handlePayNow error handling (as of BUG-017 fix, 24 May 2026):**
- 15-second AbortController timeout → user-friendly timeout message
- HTTP 404 → special message pointing to `vercel dev` for local dev
- Non-ok HTTP → try to parse error body, fall back to generic message
- JSON parse failure on success body → user-friendly message
- payError displayed prominently with "Retry" button (calls handleRetryPayment)
- "Maybe later" always visible below error as exit path

### If you change Razorpay plan IDs

**Affects:**
- `src/lib/razorpayPlans.ts` — ONLY file to edit. It's the single source of truth.
- `api/create-subscription.ts` imports `getPlanId()` from `razorpayPlans.ts` — no change needed there
- Razorpay Dashboard — the plan must exist there with the exact ID before using it in the app
- `src/components/landing/PricingSection.tsx` and `src/components/subscribe/PlanCard.tsx` — if tier names or prices change (not just plan IDs), update the display text here

### If you change the webhook handler (`api/razorpay-webhook.ts`)

**Affects:**
- `RAZORPAY_WEBHOOK_SECRET` env var must be set in Vercel (Production + Preview). If missing, all webhooks return 500.
- Supabase `subscriptions` table — webhook writes `status`, `current_period_start`, `current_period_end`, `cancel_at_period_end`, `updated_at`. Column names must match DB schema.
- `src/store/authStore.ts` `refreshProfile()` — maps DB columns to TS types. If webhook writes a new column, add it to `refreshProfile()` mapping too.
- `src/hooks/useAccessGuard.ts` — reads `status` values. If webhook writes a new status value, add it to the guard.
- Razorpay Dashboard → Settings → Webhooks — event list must include all events the handler processes. Missing an event = silent data gap.

**Webhook event → status mapping (as of Prompt 13):**
- `subscription.authenticated` → `trialing`
- `subscription.activated` → `active` + period dates
- `subscription.charged` → `active` + period dates
- `subscription.halted` → `past_due`
- `subscription.cancelled` → `cancelled`
- `subscription.completed` → `expired`

### If you change the Landing page (`src/pages/Landing.tsx` or `src/components/landing/`)

**Affects:**
- `src/components/landing/HeroSection.tsx` — live timer uses `useTick` + `useRef`; if useTick changes, timer breaks
- `src/components/landing/ROICalculator.tsx` — formula is `forgetCount × ratePerHour × 30`; ROI divisor hardcoded to `599` (Standard plan price). If pricing changes, update this
- `src/components/landing/PricingSection.tsx` — plan prices (₹299/₹599/₹999) are hardcoded; keep in sync with Razorpay plan config when payments go live
- All CTA buttons → `navigate('/signup')`; if signup route changes, update all landing CTAs
- `PUBLIC_PATHS` in `App.tsx` — `/` must stay in this array so BottomNav stays hidden
- `src/components/landing/Eyebrow.tsx` — shared by all landing sections; changing it affects all eyebrows at once

---

## Theme/Style Changes

### If you change a color in `tailwind.config.js`

**Affects:**
- Anywhere the token is used. Search the codebase for the color name (e.g., `accent`, `busy`).
- Card backgrounds use color/8% or /12% — change them too
- Status badges and dots
- Update `references/design_system.md` to match

### If you change typography (font sizes, families)

**Affects:**
- `src/index.css` — font imports
- Tailwind config — font families
- Every page using specific sizes (text-[26px] for timer etc.)
- **Mobile readability:** timers must stay big enough to read across a club

### If you change spacing (padding/margin tokens)

**Affects:**
- All pages — `px-5` is standard horizontal padding
- Cards — `p-4`
- Bottom padding — `pb-24` to clear nav

---

## Settings & Configuration Changes

### If you add a new setting to ClubSettings

**Required:**
1. Add to `ClubSettings` interface in `src/types/index.ts`
2. Add default to `seed.ts`
3. Add UI in Settings page to toggle/change it
4. **Plumb the setting into the action that uses it** — this is where bugs happen (see Prompt 7 rounding bug)
5. Add test in `test_status.md` for the new setting's effect

### If you change which features are "premium" (when adding paid tiers)

**Affects:**
- Wherever feature is gated — add subscription check
- Settings UI showing which tier user is on
- Razorpay plan IDs

---

## Per-user IndexedDB — added 27 May 2026

### If you change the auth init or sign-out flow

**Affects:**
- `src/store/authStore.ts` — must call `initDbForUser(userId)` + `seedIfEmpty()` after confirming user, then set `dbReady: true`. Must call `closeDb()` + set `dbReady: false` on sign-out.
- `src/db/database.ts` — exports `initDbForUser`, `closeDb`, `isDbReadyForUser`, `getDbName`. The `_db` holder is swapped by these helpers only. No one else should mutate it.
- `src/hooks/useAccessGuard.ts` — reads `dbReady` from authStore; returns `{ canAccess: false, reason: 'db_loading' }` while `dbReady === false` and user is authenticated.
- `src/components/RequireAccess.tsx` — treats `'db_loading'` same as `'loading'` (spinner), so no Dexie query runs against the placeholder DB.

**Rules:**
- `initDbForUser` is idempotent — safe to call on every `INITIAL_SESSION` re-fire (Pattern A1).
- `closeDb()` resets `_db` to a `ClubKeeperDB__pending` placeholder — never null.
- Never call `initDbForUser` or `closeDb` from anywhere except `authStore`. Only one actor controls the DB lifecycle.
- Public routes (Landing, Signup, AuthCallback) do NOT query Dexie — no `dbReady` check needed there.

**Discovered when:** LIMIT-001 band-aid, 27 May 2026.

---

## Authentication Changes (Prompt 9 — NOW LIVE)

### If you change the auth flow (authStore, RequireAccess, AuthCallback)

**Affects:**
- `src/store/authStore.ts` — central auth state (session, user, profile, subscription, loading, dbReady, _lastFetchedAt)
- `src/hooks/useAccessGuard.ts` — reads loading/session/subscription/dbReady, returns typed guard result
- `src/components/RequireAccess.tsx` — uses useAccessGuard, redirects to /signup or /subscribe
- `src/pages/AuthCallback.tsx` — reads loading + subscription to route after OAuth
- `src/App.tsx` — AuthInitializer calls initialize(); AppLayout hides BottomNav on public paths
- All private routes: /tables, /start/:id, /session/:id, /summary, /history, /settings

**Rules:**
- `loading: true` until `initialize()` resolves — RequireAccess shows spinner, not redirect
- `signOut()` must clear session + profile + subscription in store (currently done manually)
- PUBLIC_PATHS in App.tsx must stay in sync with actual public Route paths
- **refreshProfile dedup rule (added BUG-002 fix, 24 May 2026):** `refreshProfile()` is a no-op if called within 3000ms of the last fetch, UNLESS called with `force=true`. Always use `force=true` after a real server mutation (post-payment, post-cancel). Never add new `refreshProfile()` calls without checking whether they'll fire within 3s of initialize(). Supabase fires `INITIAL_SESSION` synchronously on `onAuthStateChange` registration — this is the source of double-fetch.
- **consumers of refreshProfile():** `authStore.ts:initialize()` (auto, no force), `authStore.ts:onAuthStateChange` (auto, no force — deduplicated), `Subscribe.tsx` post-payment handler (force=true), `Settings.tsx` post-cancel-subscription (force=true). If you add a new forced call, document it here.

### If you change the subscription schema (Supabase table or TypeScript types)

**Affects:**
- `src/types/index.ts` — SubscriptionStatus, PlanTier, Subscription interface
- `src/store/authStore.ts` — `refreshProfile()` maps DB columns → TS fields
- `src/hooks/useAccessGuard.ts` — reads status, trialEndsAt, etc. to compute canAccess
- `src/pages/Subscribe.tsx` — displays plans and triggers Razorpay (future)
- Supabase DB: `public.subscriptions` table + RLS policies
- Webhook handlers (future) — must write correct status values

**Column name map (snake_case DB → camelCase TS):**
- `trial_ends_at` → `trialEndsAt`
- `current_period_start` → `currentPeriodStart`
- `current_period_end` → `currentPeriodEnd`
- `razorpay_customer_id` → `razorpayCustomerId`
- `razorpay_subscription_id` → `razorpaySubscriptionId`
- `cancel_at_period_end` → `cancelAtPeriodEnd`

### If you add a new public route

**Affects:**
- `src/App.tsx` — add to `<Routes>` outside `<RequireAccess>`
- `PUBLIC_PATHS` array in App.tsx — add path so BottomNav stays hidden

### If you rename a route (e.g. /tables → something else)

**Affects:**
- `src/App.tsx` — Route path
- `src/components/BottomNav.tsx` — tab `to` prop
- `src/pages/SessionDetail.tsx` — all `navigate('/tables')` calls
- `src/pages/Settings.tsx` — all `navigate('/tables')` calls
- `src/pages/AuthCallback.tsx` — `navigate('/tables')` after successful auth
- `src/pages/Landing.tsx` — "Go to App" button

### When cloud sync is added

**Affects:**
- Every queries.ts function — needs sync layer
- Conflict resolution — last-write-wins or manual
- Offline → online transition — replay queued changes
- Data export — now includes server-side data

**Massive change. Plan carefully. Do not let an AI session "just add it".**

---

## Payment Changes (Future)

### When Razorpay is integrated

**Affects:**
- Signup flow — collect subscription preference
- Backend serverless function — handle webhooks securely (Razorpay key SECRET, not public)
- Feature gating — restrict features by subscription state
- Renewal handling — what happens on failed auto-debit?
- Refund handling — Razorpay dashboard or in-app?
- Invoice generation — GST compliance for Indian businesses

---

## Vercel Serverless API Files (api/*.ts)

These files run on Vercel's Node16 module resolution, which is STRICTER than the frontend Vite build. Rules that apply ONLY to `api/*.ts` files:

1. **All relative imports MUST have `.js` extension**
   - Wrong: `import { PLANS } from '../src/lib/razorpayPlans'`
   - Right:  `import { PLANS } from '../src/lib/razorpayPlans.js'`

2. **Never import from `razorpay/dist/types/...` deep paths.** Use `'razorpay'` only. If the SDK return type is missing a field, use `Awaited<ReturnType<typeof razorpay.subscriptions.create>>` to infer it directly.

3. **After ANY change to `api/*.ts` files, run `npm run build` locally before pushing.** Vercel catches TypeScript errors that the local Vite dev server misses.

**Ripple: If you change `src/lib/razorpayPlans.ts`** → update the `.js` import in every `api/*.ts` file that imports it (currently only `api/create-subscription.ts`).

**Discovered when:** Prompt 13 build on Vercel failed because `'razorpay/dist/types/subscriptions'` doesn't exist as a public module path, and Node ESM requires `.js` extensions on relative imports.

---

## Most Common Mistakes to Watch For

1. **Adding a new Session field but forgetting to update `startSession()`** → field is undefined on new rows, crashes everywhere
2. **Changing a query function and forgetting one caller** → silent failure or stale UI
3. **Updating a component without updating all 4 visual states** (Free/Busy/Paused/Disabled)
4. **Renaming a field but not migrating existing IndexedDB data** → existing users see empty values
5. **Changing validation rules without cleaning up bad data** → forms reject pre-existing data, blocking users
6. **Adding a setting that does nothing** → toggle exists but action doesn't read it
7. **Changing the timer math** → cascades to 6+ places, must verify each

## Process When Making Big Changes

For changes touching 3+ files:

1. **List affected files** explicitly before coding (use this document)
2. **Make changes in one branch**, not directly on main
3. **Run `npm run build`** — catches TypeScript errors
4. **Manually test 3 scenarios:**
   - Happy path (new behavior)
   - Old data path (existing users)
   - Edge case (empty data, max data, error state)
5. **Update this file** with any new ripples discovered
6. **Then commit + push** to deploy

---

## How to add to this file

When you discover a new ripple effect:

```
### If you change [thing]

**Affects:**
- file path 1 — why
- file path 2 — why
- consideration X

**Discovered when:** [bug/situation that revealed it]
```

The more this file grows, the safer changes become. Sugeet, especially when you don't know code well, this file is your safety net.

---

## Session Items (POS) — added 26 May 2026

### If you change the `SessionItem` interface (add/rename/remove field)

**Affects:**
- `src/types/index.ts` — interface definition
- `src/db/database.ts` — bump Dexie version if changing indexes; v3 added `sessionItems: '++id, sessionId, addedAt'`
- `src/db/queries.ts` — `addSessionItem`, `updateSessionItem`, `deleteSessionItem`, `restoreSessionItem`
- `src/hooks/useLiveData.ts` — `useSessionItems`
- `src/lib/money.ts` — `calculateItemsTotal`
- `src/components/AddItemBottomSheet.tsx` — full add/edit/delete UI
- `src/pages/SessionDetail.tsx` — bill split section, grandTotal, sheet mount
- `src/pages/Home.tsx` — Today amount (`todayTotals` live query includes items)
- `src/pages/Summary.tsx` — `itemsTotalForDate` live query; `totalRevenue = sessionsRevenue + itemsTotalForDate`
- `src/pages/History.tsx` — `itemsBySessionId` live query; day totals + CSV export columns

**Ripple notes:**
- `grandTotal` in SessionDetail = `currentSessionAmount + itemsTotal` — shown in bill split and stop-confirm modal
- History CSV now has 3 new columns: `Table Amount`, `Items`, `Total` (replacing old single `Amount` column)
- toastStore was extended to support `actionLabel`/`onAction`/`durationMs` for Undo — existing callers (string `show()`) still work unchanged
- ToastContainer was updated to render the Undo action button

**Discovered when:** Session Items (POS) feature, 26–27 May 2026

---

## UPI QR / Payment Screen — added 27 May 2026

### If you change the UPI QR or post-stop payment screen

**Affects:**
- `src/components/PaymentQR.tsx` — generates UPI deeplink QR via `qrcode` package. Props: `upiId`, `payeeName`, `amount`, `transactionNote`, `size?`. If UPI URI format changes, update here.
- `src/pages/SessionDetail.tsx` — renders `<PaymentQR>` on payment screen only when `settings?.upiId` is set. Captures `finalGrandTotal` and `finalRoundedMs` BEFORE calling `stopSession()` to avoid post-stop value drift.
- `src/pages/Settings.tsx` — `upiId` field in Club Info section. Validated with `validateUpiId()`. Saves `undefined` (not empty string) to Dexie when cleared.
- `src/lib/validation.ts` — `validateUpiId()`. If UPI format spec changes, update here AND in Settings error messages.
- `src/types/index.ts` — `ClubSettings.upiId?: string` (optional)
- `src/db/database.ts` — v4 bump documents the field (no index needed)

**Key behaviour:**
- `upiId` is OPTIONAL. If not set, payment screen shows plain amount card, no QR.
- The QR encodes: `upi://pay?pa=<vpa>&pn=<clubName>&am=<grandTotal>&tn=<tableName>&cu=INR`
- Amount in QR = grand total (table time + items). Never zero-pad or format; pass raw integer.
- "Done — back to tables" navigates to `/tables` and clears payment screen state.

**Discovered when:** Build Prompt 2, 27 May 2026

---

## Stop Session confirm modal — added 27 May 2026

### If you change the stop-session flow (rounding preview, confirm modal, final amount)

**Affects:**
- `src/pages/SessionDetail.tsx` — calls `applyRounding` + `calculateAmount` with live `rawElapsedMs` to preview rounded time and grand total BEFORE user confirms. Captures snapshot into `finalRoundedMs` + `finalGrandTotal` state at confirm time so payment screen values don't drift after Dexie writes.
- `src/db/queries.ts` → `stopSession()` — actual rounding happens here; must use same logic as preview or values will differ.
- `src/lib/money.ts` → `applyRounding()` + `calculateAmount()` — both called in preview AND in stopSession. If either changes, the preview and the stored value will diverge. Always update both callsites.

**Rule:** Never change `applyRounding` or `calculateAmount` without verifying the stop-confirm preview still matches the final stored amount.

**Discovered when:** Build Prompt 2 stop-session improvements, 27 May 2026

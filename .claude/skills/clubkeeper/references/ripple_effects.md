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

### If you change `Session.isBackEntry` or `createBackEntry` (v12)

**Affects:**
- `src/types/index.ts` — field definition
- `src/db/database.ts` — v12 version block (additive, no index)
- `src/db/queries.ts` — `BackEntryOverlapError`, `BackEntryItemInput`, `BackEntryInput`, `createBackEntry`
- `src/lib/validation.ts` — `validateBackEntry`
- `src/components/BackEntryModal.tsx` — consumer (Phase 1 + Phase 2 rewrite)
- `src/pages/History.tsx` — button + modal mount + `Logged` badge in `SessionRow`
- **`InsufficientStockError` constructor:** `(available: number, itemName: string)` — NOT `(itemName, available)`. Match this exactly.
- **`BackEntryOverlapError` constructor:** `(conflictingSession: Session)` — has `.conflictingSession` payload for inline error formatting.
- **Pattern D7 invariant:** `createBackEntry` inlines ALL stock logic. Never call `decrementCanteenItemStock`, `addSessionItem`, or `addOrIncrementSessionItem` from inside the tx.
- **`addedAt` rule:** sessionItems written as `addedAt: input.endedAt - order * 1000` to anchor inside session window — NOT `Date.now()`.
- **Rate card snapshot:** if table has `rateCard`, capture all three snapshot fields together (Pattern T7). `per_frame` not supported — hide per-frame tables in the back entry table selector.

**Discovered when:** Back Entries Phase 1 + Phase 2, 9 Jun 2026.

---

### If you change the `Session` interface

**Affects:**
- `src/types/index.ts`
- `src/db/queries.ts` — `startSession`, `pauseSession`, `resumeSession`, `stopSession`, `editSessionStart`, all readers
- `src/lib/time.ts` — `getElapsedMs` reads startedAt/endedAt/pausedAt/pausedTotalMs/status
- `src/lib/money.ts` — `calculateAmount` reads billingMode/rateSnapshot/framesPlayed
- `src/pages/SessionDetail.tsx` — displays everything
- `src/pages/Home.tsx` — needs active session for each table; mounts `<SessionAlarmModal>` when alarm fires
- `src/pages/Summary.tsx` — today's sessions list
- `src/pages/History.tsx` — date-range sessions list
- `src/components/TableCard.tsx` — shows player/timer/status
- `src/hooks/useSessionAlarm.ts` — reads `notifyAtMs`, `notifyAcknowledgedAt`, `status` fields
- `src/components/SessionAlarmModal.tsx` — receives `Session` as prop; uses `getElapsedMs`
- `src/pages/StartSession.tsx` — passes `notifyAfterMs` to `startSession()` which writes `notifyAtMs`
- **CSV export** in Summary and History — column structure
- **Migration:** bump Dexie version if changing indexes

### If you change `ClubSettings`

**Affects:**
- `src/types/index.ts`
- `src/db/queries.ts` — `getSettings`, `updateSettings`
- `src/db/seed.ts` — default values
- `src/pages/Settings.tsx` — settings UI. NOTE: Settings page now renders fields inside collapsible sections. Club Info section = clubName, currency, upiId, rounding. UPI ID save logic: saves `undefined` (not empty string) when cleared. Rounding warns on active sessions via modal.
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

### If you add a new aggregate total that includes running sessions (e.g. a dashboard widget, a revenue pill)

**Rule (Pattern T4):** Never compute `calculateAmount(getElapsedMs(s))` inside a `useLiveQuery` callback. Live queries re-fire only on DB writes — the result is cached between writes. `useTick()` re-renders won't re-execute it.
**Required pattern:**
1. `useLiveQuery` → sum only `s.amount` for completed sessions + items (DB-static).
2. Render body → sum `calculateAmount(getElapsedMs(s))` for `activeSessions` (already a live hook).
3. Combine: `total = completedFromQuery + itemsFromQuery + runningFromRender`.
**Current consumers using this pattern correctly:** `Home.tsx` (`todayTotal`), `Summary.tsx` (render-body aggregation).
**Discovered when:** BUG-022 — "Today" pill on /tables was frozen; `useTick()` was present but the live calc was trapped inside `useLiveQuery`.

---

### If you change `calculateAmount()` in money.ts

**Current signature:** `calculateAmount(session: Session, elapsedMs: number, rounding?: 'none'|'15min'|'30min'): number`

**CRITICAL — dispatch order must remain exactly:**
1. `per_frame` → `(framesPlayed ?? 0) × rateSnapshot`, return immediately
2. `rateCardSnapshot` present + non-empty → dispatch to `priceForElapsedProrated` or `priceForElapsedMinimum` based on `rateCardBillingSnapshot ?? 'prorated'`, return immediately — rounding param IGNORED
3. Legacy linear: optional rounding applied to `elapsedMs`, then `Math.round(hours × rateSnapshot)`

**Affects (13 callers — verify all after any signature change):**
- `src/components/TableCard.tsx` — running session amount chip
- `src/pages/SessionDetail.tsx` — big running total + stop-confirm preview + final amount capture
- `src/pages/Home.tsx` — `runningAmount` in render body (Pattern T4 — must stay in render body, not inside `useLiveQuery`)
- `src/pages/Summary.tsx` — revenue aggregation in render body (Pattern T4)
- `src/pages/History.tsx` — per-session amount display + CSV export
- `src/db/queries.ts` (`stopSession`) — final amount written to DB
- `src/lib/summaryMath.ts` — pure aggregation, called from Summary render body
- CSV export amount column (History + Summary)

**Pattern T8 invariant:** if `rateCardSnapshot` is present, BOTH modes return before reaching the rounding branch. Never move the rounding logic above the rate card branch.

### If you change `priceForElapsedProrated()` in money.ts (added 9 Jun 2026)

**Signature:** `priceForElapsedProrated(elapsedMs: number, tiers: RateTier[], toleranceMinutes: number): number`

**Algorithm summary:**
- `em ≤ 0` or no tiers → return 0
- `em < tier1.minutes` → linear ramp from ₹0 → tier1.price proportional to em/tier1.minutes
- `em ≤ tiers[i].minutes + toleranceMinutes` → plateau, return tiers[i].price
- between tiers (after plateau, before next tier) → linear interpolation
- past last tier + tolerance → extrapolate at `last.price / last.minutes` per minute

**Affects:** `calculateAmount()` (only entry point). Used when `rateCardBillingSnapshot === 'prorated'` or missing.

### If you change `priceForElapsedMinimum()` in money.ts (renamed from `priceForElapsed`, 9 Jun 2026)

**Signature:** `priceForElapsedMinimum(elapsedMs: number, tiers: RateTier[], toleranceMinutes: number): number`

**Algorithm summary:**
- `em ≤ 0` or no tiers → return 0 (guard added 9 Jun 2026 — previously would return tier1.price at 0ms)
- `billable = ceil(elapsedMs / 60000)` minutes
- Walk tiers ascending: first tier where `billable ≤ tier.minutes + toleranceMinutes` wins
- Overflow past last tier: `last.price + Math.ceil((billable - last.minutes - toleranceMinutes)) × perMinRate`

**Affects:** `calculateAmount()` (only entry point). Used when `rateCardBillingSnapshot === 'minimum'`.

### If you change `GameTable.rateCard`, `toleranceMinutes`, or `rateCardBilling` fields (added v10/v11, 9 Jun 2026)

**Affects:**
- `src/types/index.ts` — `GameTable` interface
- `src/db/queries.ts` — `startSession()` must snapshot all three together (Pattern T7): `rateCardSnapshot`, `toleranceMinutesSnapshot`, `rateCardBillingSnapshot`
- `src/db/seed.ts` — seed tables that have `rateCard` must include `rateCardBilling: 'prorated'`
- `src/components/TableFormModal.tsx` — Tiered Pricing collapsible: tier input rows, tolerance field, Billing Behavior toggle (Pro-rated / Minimum charge)
- `src/lib/validation.ts` — `validateRateCard(tiers, toleranceMinutes, billingMode?)` — third param validates billing mode string
- **Table Move compatibility check** in `moveSessionToTable()` — currently only checks `ratePerHour`/`ratePerFrame`. If rate card is added to the compatibility check in future, update `moveSessionToTable` too.

### If you change `Session.rateCardSnapshot`, `toleranceMinutesSnapshot`, or `rateCardBillingSnapshot` (added v10/v11, 9 Jun 2026)

**Affects:**
- `src/types/index.ts` — `Session` interface
- `src/db/queries.ts` — `startSession()` reads all three from table at session start (Pattern T7)
- `src/lib/money.ts` — `calculateAmount()` reads all three from session; see dispatch order above
- `src/pages/SessionDetail.tsx` — stop-confirm preview calls `calculateAmount` which reads these fields
- **Dexie version:** v10 added `rateCardSnapshot`+`toleranceMinutesSnapshot`; v11 added `rateCardBillingSnapshot`. Both additive — existing sessions without these fields get `undefined`, which falls back to `'prorated'` mode via `?? 'prorated'` in `calculateAmount`.

### If you change `<Modal>` layout (Pattern M4)

**CRITICAL:** `<Modal>` now uses a 3-region flex layout (`max-h-[92vh] flex flex-col`). The optional `footer?: ReactNode` prop pins content outside the scroll container.

**Consumers of `<Modal>` (all receive the scroll fix automatically; no code change needed unless they need a pinned footer):**
- `src/components/TableFormModal.tsx` — passes `footer={footerContent}` (action buttons pinned)
- `src/pages/SessionDetail.tsx` — stop confirm, edit start time, edit notify (no pinned footer needed)
- `src/pages/Settings.tsx` — clear sessions, reset, cancel subscription, clean names (no pinned footer needed)
- `src/pages/Home.tsx` — orphaned sessions modal (no pinned footer needed)
- `src/pages/Canteen.tsx` — soft-delete confirm (no pinned footer needed)

**If you add a new modal that needs pinned action buttons:** pass `footer={<YourButtons />}` to `<Modal>`. Do NOT move buttons back into `children` — they will scroll off-screen on small devices.

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

**New flow (cardless trial — 2 Jun 2026):** New signups land on `/tables` directly. Subscribe page is reached via three paths, each with a distinct headline:
1. `trial_expired` (forced) — `RequireAccess` or `AuthCallback` redirects with `location.state = { reason: 'trial_expired' }` → "Your free trial has ended"
2. `subscribe_early` (voluntary) — owner taps "Manage →" on the `SubscriptionStatusBanner` trial strip → `location.state = { reason: 'subscribe_early' }` → "Subscribe early to lock in ₹599/month" with days-left count
3. `welcome` (default) — fresh signup (legacy `status='none'`) or direct navigate without state → existing PlanSelection welcome copy

Subscribe.tsx `headline` is a `useMemo` discriminated union (`expired | early | welcome`). Auth guard only bounces active-trialing users when `locationReason` is unset — intentional arrivals via state stay on page.

**Affects:**
- `src/components/subscribe/PlanSelection.tsx` — `ALL_PLANS` array has hardcoded prices. Pricing changes: update here AND in `StickyCheckout.tsx`. `selectedPlan` prop is `PlanId | null`. **Phase 3 Commit 2:** No longer reads `VISIBLE_PLAN_IDS` from module scope — receives `visiblePlanIds: readonly PlanId[]` as a prop from `Subscribe.tsx`. All plan visibility gating (V1-LAUNCH filter + live_10 email gate) lives in `Subscribe.tsx` only. `PlanId` type = `'starter' | 'standard' | 'pro' | 'test'`.
- `src/components/subscribe/StickyCheckout.tsx` — receives `selectedPlan: PlanId | null`; renders `null` (hides entirely) when no plan is selected. Receives `currentPrice` as number. Safe to change pricing in Subscribe.tsx only.
- `src/components/subscribe/PaymentBottomSheet.tsx` — accepts: `payError: string | null`, `onMaybeLater: () => void`, `onRetry: () => void`. All three must stay in sync with `handlePayNow()`/`handleMaybeLater()`/`handleRetryPayment()` in `Subscribe.tsx`. Sheet has ESC key listener (BUG-016), 4 escape paths, "Maybe later" + "Retry" buttons.
- `src/components/subscribe/ConfirmationScreen.tsx` — rendered when `screen === 'confirmed'`. Navigate uses `replace: true` — do NOT remove or user can back into Subscribe
- `src/pages/AuthCallback.tsx` — routes: `active`/`past_due` → `/tables`; `trialing`+active trial → `/tables`; `trialing`+expired trial → `/subscribe` with state; `none`/`cancelled`/`expired` → `/subscribe`.
- `src/hooks/useAccessGuard.ts` — `'trialing'` with active trial → `canAccess: true`; expired trial → `reason: 'trial_expired'`; `active`/`past_due` → `canAccess: true`; `none`/`cancelled`/`expired` → `reason: 'no_subscription'`.
- `src/components/RequireAccess.tsx` — `trial_expired` navigated imperatively (with state) via `useEffect`; `no_subscription` uses `<Navigate to="/subscribe">` without state.
- `src/components/SubscriptionStatusBanner.tsx` — trialing branch is split in two: `!razorpaySubscriptionId` → "Free trial" strip with "Manage →" to `/subscribe` with `state: { reason: 'subscribe_early' }`; `razorpaySubscriptionId` present → "Subscribed ✓" strip with "View →" that sets `sessionStorage('ck_settings_section', 'subscription')` + navigates to `/settings`. The `past_due` "Fix Now →" and cancelling "Resume →" buttons still go to `/settings`.
- `api/create-subscription.ts` — called by `handlePayNow()` via fetch POST `{ userId, tier, cycle }` with 15s AbortController timeout. **Phase 3 Commit 2 (BUG-026 fix):** Server reads `trial_ends_at` from Supabase BEFORE calling Razorpay. Three scenarios: `new` / `mid_trial` / `expired`. `trial_ends_at` only overwritten when scenario requires it. Response now includes `startAt: number` and `scenario: string`.
- `src/lib/razorpayPlans.ts` — plan IDs consumed by `api/create-subscription.ts`. If plan IDs change, update ONLY this file. Also update `api/_shared/plans.ts` (server-side mirror). `'test'` tier = LIVE-only ₹10 plan; absent from TEST_PLANS.
- `Subscribe.tsx` **visiblePlanIds gating (Phase 3 Commit 2):** `BASE_VISIBLE_PLAN_IDS = ['standard']`. Adds `'test'` tier iff `isLiveMode === true` AND `user.email ∈ SUGEET_TEST_EMAILS`. This is the ONLY place to add/remove plan visibility. Pass `visiblePlanIds` prop to `<PlanSelection>`.
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
- `src/lib/razorpayPlans.ts` — ONLY file to edit for plan IDs. It's the single source of truth for the frontend.
- `api/_shared/plans.ts` — MUST be updated in sync with `razorpayPlans.ts`. It is the server-side mirror (uses `process.env` instead of `import.meta.env`). The `'test'` tier (`test_monthly: 'plan_Sx0LfhJGzccBHQ'`) is in LIVE_PLANS only — absent from TEST_PLANS. `PlanMap` is `Partial<Record<...>>` to allow omitting tiers per mode.
- `api/create-subscription.ts` — reads from `api/_shared/plans.ts`. `getPlanId()` now throws a descriptive error if a plan is LIVE-only but server is in TEST mode (e.g. someone accidentally sends `tier=test` in TEST mode). Adding a new tier: update `VALID_TIERS` set + both plan maps.
- Razorpay Dashboard — the plan must exist there with the exact ID before using it in the app
- `src/components/subscribe/PlanCard.tsx` — `id` union must include the new tier. Also add any special badge logic here (e.g. the 🔴 LIVE TEST badge for `id === 'test'`).
- `src/components/subscribe/PlanSelection.tsx` — `ALL_PLANS` array must include the new tier's display data (name, prices, features). Visibility controlled by `visiblePlanIds` prop from Subscribe.tsx — not here.
- `src/pages/Subscribe.tsx` — `MONTHLY_PRICES` and `ANNUAL_PRICES` maps must include the new tier. If it's a gated plan, add gate logic to `visiblePlanIds` computation.
- `src/components/landing/PricingSection.tsx` — hardcoded HTML, safe. Does NOT import plan data — `live_10` / `test` tier cannot leak here. Verify when adding a new publicly-visible plan that PricingSection also shows it (currently it's hardcoded Standard only).

### If you change the webhook handler (`api/razorpay-webhook.ts`)

**Affects:**
- `RAZORPAY_WEBHOOK_SECRET` env var must be set in Vercel (Production + Preview). If missing, all webhooks return 500.
- Supabase `subscriptions` table — webhook writes `status`, `current_period_start`, `current_period_end`, `cancel_at_period_end`, `updated_at`. Column names must match DB schema.
- `src/store/authStore.ts` `refreshProfile()` — maps DB columns to TS types. If webhook writes a new column, add it to `refreshProfile()` mapping too.
- `src/hooks/useAccessGuard.ts` — reads `status` values. If webhook writes a new status value, add it to the guard.
- Razorpay Dashboard → Settings → Webhooks — event list must include all events the handler processes. Missing an event = silent data gap.

**useAccessGuard reason values (as of cardless trial, 2 Jun 2026):**
- `loading` / `db_loading` / `not_authenticated` — infrastructure states, show spinner or redirect /signup
- `trial_expired` — trialing user whose `trialEndsAt` is in the past → RequireAccess navigates to `/subscribe` with `state: { reason: 'trial_expired' }`
- `no_subscription` — status is `none`, `cancelled`, or `expired` → `<Navigate to="/subscribe" replace>`
- `subscription_ended` — (retired reason name, now merged into `no_subscription`)

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
- **`api/cancel-subscription.ts` two-mode behavior (BUG-025):** `cancelAtCycleEnd=1` (at period end) requires an active billing cycle — fails for `authenticated` (pre-charge trial) state. `cancelAtCycleEnd=0` (immediate) works for pre-charge. Handler tries `1` first, falls back to `0` on "no billing cycle" 400. If you change cancellation logic, test BOTH paths: active subscription cancel (should keep access until period end) AND trial cancel (should revoke immediately).

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
- `src/components/PaymentQR.tsx` — generates UPI deeplink QR via `qrcode` package. Props: `upiId`, `payeeName`, `amount`, `transactionNote`, `size?`. `size` is INTERNAL render resolution (default 560, 2× of 280 cap), NOT displayed CSS size. Output element uses `width:100%; height:auto; display:block` so it scales to parent (see Pattern U7). If UPI URI format changes, update here.
- `src/pages/SessionDetail.tsx` — renders payment screen as `fixed inset-0 z-50 flex-col` layout (z-50 REQUIRED to cover bottom nav — see bug_patterns Pattern U8). QR width is `min(72vw, 280px)`. White card is `aspect-square flex items-center justify-center p-3` for equal borders (see Pattern U7). Middle `flex-1` zone. "Done" pinned in footer `shrink-0`. Overlay padding uses `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)` for notch/home-indicator safety. Captures `finalGrandTotal` and `finalRoundedMs` BEFORE calling `stopSession()` to avoid post-stop value drift.
- `src/pages/Settings.tsx` — `upiId` field inside "Club Info" collapsible section. Validated with `validateUpiId()`. Saves `undefined` (not empty string) to Dexie when cleared.
- `src/lib/validation.ts` — `validateUpiId()`. If UPI format spec changes, update here AND in Settings error messages.
- `src/types/index.ts` — `ClubSettings.upiId?: string` (optional)
- `src/db/database.ts` — v4 bump documents the field (no index needed)

**Key behaviour:**
- `upiId` is OPTIONAL. If not set, payment screen shows plain amount card, no QR.
- The QR encodes: `upi://pay?pa=<vpa>&pn=<clubName>&am=<grandTotal>&tn=<tableName>&cu=INR`
- Amount in QR = grand total (table time + items). Never zero-pad or format; pass raw integer.
- "Done — back to tables" navigates to `/tables` and clears payment screen state.
- Payment screen has NO bottom nav — it is a `fixed inset-0` overlay that covers everything.

**Discovered when:** Build Prompt 2, 27 May 2026; viewport fix Build Prompt 3, 27 May 2026

---

### If you change collapsible Settings sections

**Affects:**
- `src/pages/Settings.tsx` — `openSection: string` state. Only one section open at a time. Toggling an open section sets `openSection = ''` (closed). `SettingsSection` component (inline, not exported). Animation via `grid-rows-[1fr/0fr] opacity-100/0`.
- `sessionStorage['ck_settings_section']` — UI persistence key. Cleared on tab/browser close (not localStorage, not Dexie). Safe to read/write without concern for data integrity.
- If a section ID changes (e.g., `'club-info'`), the saved `sessionStorage` value becomes stale — harmless (falls back to no-section-open, then defaults to 'club-info' won't auto-open on that session).
- Section order: `club-info`, `tables`, `alerts`, `subscription`, `data`, `about`, `account`. Adding a new section: add an `id` here and a `<SettingsSection>` block.

**Discovered when:** Build Prompt 3, 27 May 2026

---

## Stop Session confirm modal — added 27 May 2026

### If you change the stop-session flow (rounding preview, confirm modal, final amount)

**Affects:**
- `src/pages/SessionDetail.tsx` — calls `applyRounding` + `calculateAmount` with live `rawElapsedMs` to preview rounded time and grand total BEFORE user confirms. Captures snapshot into `finalRoundedMs` + `finalGrandTotal` state at confirm time so payment screen values don't drift after Dexie writes.
- `src/db/queries.ts` → `stopSession()` — actual rounding happens here; must use same logic as preview or values will differ.
- `src/lib/money.ts` → `applyRounding()` + `calculateAmount()` — both called in preview AND in stopSession. If either changes, the preview and the stored value will diverge. Always update both callsites.

**Rule:** Never change `applyRounding` or `calculateAmount` without verifying the stop-confirm preview still matches the final stored amount.

**Discovered when:** Build Prompt 2 stop-session improvements, 27 May 2026

---

## Wallet / Prepaid Credit — added 30 May 2026

### If you bump the Dexie schema version (adding tables or indexes)

**Affects:**
- `src/db/database.ts` — add a new `this.version(N).stores({...})` block. Keep ALL prior version blocks. Never edit an existing version block.
- Must be additive only for existing users — no `.upgrade()` that mutates existing rows unless absolutely required (and then test the upgrade path from every prior version).
- If you rename a table, existing users' data in the old table is gone — soft-delete + new-name migration required instead.
- The `ClubKeeperDB` class table declarations (e.g. `customers!: Table<Customer, string>`) must stay in sync with the latest version's store strings.

**Discovered when:** Wallet Phase 1, 30 May 2026

---

### If you change the `Customer` interface

**Affects:**
- `src/types/customer.ts` — interface definition
- `src/db/database.ts` — bump Dexie version if a new INDEX is needed; field-only additions don't need a bump
- `src/store/customerStore.ts` — all create/update/query operations
- `src/lib/walkInCode.ts` — creates Customer objects; must include all required fields
- `src/components/wallet/CustomerListRow.tsx` — renders customer data
- `src/pages/Wallet.tsx`, `WalletTopup.tsx`, `CustomerProfile.tsx` — all read Customer fields
- `src/lib/whatsapp.ts` — reads `phone`, `name`
- **Phone format:** always stored as `+91XXXXXXXXXX` (12 chars). Validate exactly 10 digits after the +91 prefix. Any change to format must update all display sites that do `phone.slice(3)`.

---

### If you change the `WalletTransaction` interface

**Affects:**
- `src/types/walletTransaction.ts` — interface + union types
- `src/db/database.ts` — bump version if index changes
- `src/store/customerStore.ts` — `topUp()`, `applyManualAdjustment()`, `getTransactionHistory()`
- `src/components/wallet/TransactionRow.tsx` — renders every field
- `src/pages/CustomerProfile.tsx` — queries and lists transactions
- **Immutability rule:** there is intentionally no `updateTransaction()`. Corrections = new rows. Do NOT add an update path without a deliberate decision.
- **Phase 2 hook:** session debit = `{ type: 'debit', referenceType: 'session', referenceId: sessionId.toString() }`. If Session.id type changes (number → string or vice versa), update the referenceId conversion.

---

### If you change `walkInCode.ts` (walk-in counter logic)

**Affects:**
- `src/db/database.ts` — reads `settings.walkInCounter`; must remain in the same Dexie transaction as the `customers.add()` call
- `src/types/index.ts` — `ClubSettings.walkInCounter?: number` — treat undefined as 0 at read time
- `src/db/seed.ts` — default settings seed does NOT include `walkInCounter` (intentional — undefined → 0 is the fallback). Do not add it to seed or existing users will get counter reset on re-seed.
- Format is `WALK-NNN` zero-padded to 3 digits. If you change the format, existing walk-in codes in the DB remain in the old format — handle display gracefully (don't assume all codes match the new pattern).

---

### If you change `TopBar.tsx`

**Affects (updated 7 Jun 2026):**
- `src/pages/Home.tsx` — only consumer. Now accepts optional `onWalletPress?: () => void` prop. Home does not pass this prop — TopBar's default handler `() => navigate('/wallet')` fires.
- Right side now has 4 elements: online dot (6px), canteen button (w-9 h-9) → `/canteen`, wallet button (w-9 h-9) → `/wallet`, gear button (w-9 h-9) → `/settings`. At 360px this is full — do NOT add a fifth element without removing one or redesigning the row.
- The canteen button navigates to `/canteen`. If that route changes, update the `onClick` in `TopBar.tsx`.
- The wallet button navigates to `/wallet`. If that route changes, update the default handler in `TopBar.tsx`.
- The gear button navigates to `/settings`. Unchanged.
- Touch targets: all icon buttons are `w-9 h-9` (36px) — they meet 44px when including the implicit tap zone on mobile. Do not shrink further.

---

### If you add a new wallet route

**Affects:**
- `src/App.tsx` — add `<Route>` inside the existing `<RequireAccess>` block (wallet routes are private, same as /tables)
- `PUBLIC_PATHS` in App.tsx — do NOT add wallet paths here (would break BottomNav visibility logic on /tables)
- BottomNav — wallet is NOT a tab; it is accessed via the TopBar wallet icon. Do not add a wallet tab to BottomNav in Phase 1.
- `useAccessGuard` — already gates all `<RequireAccess>` children; no per-route change needed

---

### If you change `customerDisplay.ts` (display name helper)

**Affects (5+ render sites — change the helper, all update automatically):**
- `src/components/wallet/CustomerListRow.tsx` — uses `customerFullLabel` + `formattedPhone`
- `src/pages/CustomerProfile.tsx` — uses `customerDisplayName` + `formattedPhone`
- `src/pages/WalletTopup.tsx` — uses `customerDisplayName` (header + success screen)
- `src/lib/whatsapp.ts` — uses `customerDisplayName` for WhatsApp greeting
- `src/components/wallet/EditCustomerModal.tsx` — uses `customerDisplayName` for modal subtitle

**Rules:**
- Never add a new inline `customer.name ?? ... ?? 'Customer'` chain in any component. Always import from this helper (Pattern F8).
- The three-way distinction (named / unnamed-with-phone / anonymous) is the canonical contract. Do not collapse it back to two cases.
- `phoneTail` is a display-only helper — never use it for identity checks or sorting.

**Discovered when:** Wallet Phase 1.5 — "Walk-in" label appeared for customers who had a phone but no name.

---

### If you change `customerStore.ts` phone uniqueness check

**Rule (load-bearing):** Phone uniqueness is enforced in the store, NOT via a Dexie `&phone` unique index. Multiple `null` phone values (walk-ins) would violate a unique index in some browsers. The pre-check + `DuplicatePhoneError` pattern is the only enforcement. Do NOT "fix" this by adding `&phone` to the Dexie schema string.

**Affects if removed or weakened:**
- `createCustomerWithPhone()` — pre-check before `db.customers.add()`
- `updateCustomerPhone()` — pre-check before `db.customers.update()`
- `src/pages/WalletNewCustomer.tsx` — catches `DuplicatePhoneError`, inline error + "View profile →" link (Pattern F7)
- `src/components/wallet/EditCustomerModal.tsx` — same catch pattern (renamed from EditPhoneModal in Phase 1.5)

**Discovered when:** Wallet Phase 1 design decision, 30 May 2026

---

### If you change `UpiQrCard.tsx` or `PaymentQR.tsx`

**Affects (three consumers — change one, verify all three):**
- `src/pages/SessionDetail.tsx` — post-stop payment screen. Fixed-viewport `fixed inset-0 z-50` layout. `<UpiQrCard>` sits in a `flex-1` centered middle zone. Changing card dimensions affects the fixed-layout fit.
- `src/pages/WalletTopup.tsx` — inline topup QR. Scrollable page. `<UpiQrCard>` sits between payment-mode buttons and summary card. Changing card dimensions affects scroll length.
- `src/pages/QuickSale.tsx` — post-confirm UPI QR screen (added 14 Jun 2026, fix #69). Fixed-viewport `fixed inset-0 z-50` layout, same shape as SessionDetail. Shows only the UPI split amount, not the full subtotal.
- `src/components/PaymentQR.tsx` — the actual QR generator (unchanged). Props: `upiId`, `payeeName`, `amount`, `transactionNote`. Renders at 560px internally for retina, CSS-scaled to parent (Pattern U7).
- `UpiQrCard` props: `amount`, `upiId`, `payeeName`, `transactionNote`. No store access inside.
- QR encodes `upi://pay?pa=<vpa>&pn=<name>&am=<amount>&cu=INR`. Amount is always the **paid amount** — never the credited total (bonus is owner-side ledger, never sent over UPI).

**Discovered when:** Wallet Phase 1 polish, 30 May 2026 — extracted from inline duplication in SessionDetail and WalletTopup.

---

### If you change the Dexie version or `.upgrade()` callbacks

**Affects:**
- Every prior version block must remain unchanged in `database.ts`. Never edit an existing `this.version(N)` block — only add new ones.
- The v6 `.upgrade()` callback is a one-time backfill of legacy `type:'adjustment'` wallet transaction rows. Do NOT remove it — users on v5 still need it to run.
- `src/types/index.ts` — `ClubSettings.legacyAdjustmentsBackfilled?: boolean` is the audit flag written by the v6 migration. Read-only after migration. Do not use it to gate any user-visible feature.
- The v6 upgrade runs inside Dexie's own managed transaction — do NOT wrap it in an additional `db.transaction()` call.

**Discovered when:** Wallet Phase 1 polish correction, 30 May 2026 — needed to fix existing rows with `type:'adjustment'` that were missing sign/₹ in TransactionRow.

---

## Table Move feature — added 8 Jun 2026

### If you change `moveSessionToTable()` in queries.ts

**Affects:**
- `src/types/index.ts` — `TableMove` interface + `Session.tableMoves?: TableMove[]`
- `src/db/database.ts` — v9 schema block (field-only, no index). Keep all prior version blocks.
- `src/pages/SessionDetail.tsx` — `MoveTableModal`, `MoveTableList`, `MoveIcon`, move button, Table Journey row
- `src/pages/History.tsx` — `↻ N tables` subtitle in `SessionRow`
- `src/pages/Home.tsx` — NO change needed. `sessionMap` keys on `s.tableId`; Dexie live query re-fires automatically after a move writes the new `tableId`.

**Invariant:** `session.tableId` always points to the CURRENT (latest) table. `tableMoves` records the full journey. Existing queries that filter by `tableId` continue working unchanged — they always see the current table.

**Error classes exported from queries.ts:** `IncompatibleTableError`, `TableOccupiedError` — catch by type in UI for inline error display (Pattern F7). Never show a toast for these.

**Compatibility rule (all three must match):**
1. `srcTable.gameType === destTable.gameType`
2. Session `billingMode === 'per_hour'` → `srcTable.ratePerHour === destTable.ratePerHour`
3. Session `billingMode === 'per_frame'` → `srcTable.ratePerFrame === destTable.ratePerFrame`

**Discovered when:** Table Move Phase 1, 8 Jun 2026.

---

## Authentication ripples — subscriptionLoaded flag (7 Jun 2026)

- `authStore.subscriptionLoaded` must be set to `true` AFTER `refreshProfile()` resolves, in BOTH `initialize()` and `onAuthStateChange` handler.
- On sign-out, `subscriptionLoaded` must be reset to `false` alongside `profile` / `subscription`.
- `useAccessGuard` has a `'subscription_loading'` reason — `RequireAccess` treats it as a spinner, NOT a redirect. Do not add redirect logic for any transient loading reason.
- **If you add any new field to `authStore` that `useAccessGuard` reads, add a corresponding `*Loaded: boolean` flag immediately.** Truthiness checks (`if (!subscription)`) are NOT safe for "is this loaded?" — `undefined` (not loaded) and `null` (loaded, empty) look identical.

---

## Canteen — added 7 Jun 2026

### If you change the `CanteenItem` interface

**Affects:**
- `src/types/index.ts` — interface definition
- `src/db/database.ts` — bump Dexie version (currently v8) if adding a new INDEX; field-only additions don't need a bump. Keep all prior version blocks.
- `src/db/queries.ts` — `getCanteenItems`, `addCanteenItem`, `updateCanteenItem`, `softDeleteCanteenItem`, `decrementCanteenItemStock`
- `src/db/seed.ts` — `DEFAULT_SETTINGS.lowStockThreshold` (default 5)
- `src/pages/Canteen.tsx` — list display + StockPill + CanteenItemFormModal
- `src/components/CanteenItemFormModal.tsx` — add/edit form (name, price, stockEnabled, currentStock)
- `src/components/AddItemBottomSheet.tsx` — canteen chips, qty stepper stock-max clamping, inline stock decrement transaction

### If you change `getCanteenItems()` in queries.ts

**CRITICAL:** This function uses `.filter(item => item.isActive === true)` NOT `.where('isActive').equals(1)`. IndexedDB stores JS booleans as booleans — `.equals(1)` will never match `true`. Always use `.filter()` for boolean fields in Dexie, even if the field is in the index schema string.

### If you change the stock decrement logic in AddItemBottomSheet

**CRITICAL — nested transaction rule:**
`decrementCanteenItemStock` in `queries.ts` has its own internal `db.transaction('rw', db.canteenItems, ...)`. Calling it inside an outer `db.transaction('rw', db.canteenItems, db.sessionItems, ...)` causes the inner transaction to commit immediately before the outer can run `sessionItems.add()`. Result: stock decrements but session item is NOT added (silent partial write). The inner tx closes; the outer tx throws "Transaction has already completed or failed."

**Rule:** In `AddItemBottomSheet.handleSubmit`, the stock logic is INLINED directly inside a single flat outer transaction. Do NOT call `decrementCanteenItemStock` from within any outer transaction. `decrementCanteenItemStock` may still be called standalone (outside any transaction) — it is NOT deprecated.

**Files affected if you change this flow:**
- `src/components/AddItemBottomSheet.tsx` — the inline tx block
- `src/db/queries.ts` — `decrementCanteenItemStock` (keep as standalone utility)

**Discovered when:** Canteen Phase 1, 7 Jun 2026 — stock decremented but session item was never written.

### If you change `ClubSettings.lowStockThreshold`

**Affects:**
- `src/types/index.ts` — optional field on `ClubSettings`
- `src/db/seed.ts` — default value (5)
- `src/db/queries.ts` — `getLowStockThreshold()` reads it with `?? 5` fallback
- `src/pages/Canteen.tsx` — `StockPill` and `StatsRow` use threshold
- `src/components/AddItemBottomSheet.tsx` — low-stock crossing toast after commit

### If you change item-matching logic in AddItemBottomSheet (8 Jun 2026)

**Affects:**
- `src/lib/canteenMatch.ts` — `normalizeName`, `findMatchingCanteenItem`, `findCanteenItemByName`
- `src/components/AddItemBottomSheet.tsx` — Quick Add filter, canteen chip handler, quick-add chip handler, manual submit handler, price-mismatch warning UI, collapsible manual form

**Rule:** ALL three add paths (canteen chip, quick-add chip, manual form) must run through `findMatchingCanteenItem` and use the SAME inline atomic transaction (`runCanteenAddTransaction`) when a canteen match is found. Quick Add chips are filtered to canteen-matched recent items only — non-canteen recent items do NOT appear as chips. Manual form collapses behind "+ Add other item" button. Price mismatch on manual submit shows inline warning (Pattern F7), not toast.

**Why:** Before this change, Quick Add and manual form bypassed canteen stock decrement, causing the same logical item to behave differently depending on add path. Locked decision: no auto-save freeform to canteen (would let staff typos pollute master list).

### If you change session-item add behavior in AddItemBottomSheet (8 Jun 2026)

**Affects:**
- `src/db/queries.ts` — `addOrIncrementSessionItem` (NEW, sessionItems-only tx — do NOT call from inside an outer tx, Pattern D7)
- `src/components/AddItemBottomSheet.tsx` — all four add paths (canteen chip, quick-add chip, manual matched, manual freeform) now merge into an existing row when `(sessionId, normalizeName(name), exactPrice)` already exists

**Rule:**
- The three canteen-matched paths INLINE the merge logic inside their existing `db.transaction('rw', db.canteenItems, db.sessionItems, ...)`. They do NOT call `addOrIncrementSessionItem` (Pattern D7 — nested tx would partial-write).
- The freeform path calls `addOrIncrementSessionItem` directly (no outer tx, no canteenItems write).
- Pre-existing distinct rows in the DB are NOT auto-merged. Only NEW adds merge into existing rows.
- qty is capped at 99 on merge.

**Known limitation:** Editing qty down via the existing edit modal does NOT restore canteen stock. Tracked for a future fix.

**Why:** Multiple identical-tap rows were unreadable during settlement disputes. Merging by (sessionId, name, price) gives staff one row with a quantity count.

### If you change updateSessionItem / deleteSessionItem / restoreSessionItem (8 Jun 2026)

**Affects:**
- `src/db/queries.ts` — all three functions now open `db.transaction('rw', db.sessionItems, db.canteenItems, ...)` and INLINE canteen stock sync via `findMatchingCanteenItemForRow`. New `InsufficientStockError` class exported from queries.ts.
- `src/components/AddItemBottomSheet.tsx` — `handleSubmit` edit path catches `InsufficientStockError` and shows inline error (Pattern F7, `setError`). `handleDeleteItem` Undo callback catches it and shows a toast (justified exception — no inline surface after toast dismisses).
- `src/lib/canteenMatch.ts` — `normalizeName` reused inside `findMatchingCanteenItemForRow`.

**Rule:**
- All three operations sync canteen stock atomically when the sessionItem matches an active, `stockEnabled` canteen item. Freeform rows (no match) never touch stock.
- Stock can never go negative. qty-up edit or Undo restore that would do so throws `InsufficientStockError`, rolling back both sessionItem and canteenItem writes in the same tx.
- Pattern D7: all stock logic INLINED in the outer transaction. No calls to `decrementCanteenItemStock` or `addOrIncrementSessionItem` from inside these functions.
- `restoreSessionItem` now returns `Promise<void>` (was `Promise<number>`). Return value was unused at the call site.

**Why:** Closes the three-way stock leak — edits, deletes, and undos now keep canteen stock accurate.

### If you add a new route behind RequireAccess that runs Dexie queries on mount

**CRITICAL — subscriptionLoaded gate (7 Jun 2026):**
There is a race window between `loading=false` (auth resolved) and `refreshProfile()` completing (subscription row fetched). During this window `subscription===null` which `useAccessGuard` previously misread as `no_subscription`, redirecting to `/subscribe`, which bounced active users back to `/tables` — overwriting the intended route.

**Fix:** `authStore` has a `subscriptionLoaded: boolean` flag (false until `refreshProfile()` resolves, false again on sign-out). `useAccessGuard` returns `{ canAccess: false, reason: 'subscription_loading' }` while `!subscriptionLoaded`. `RequireAccess` shows spinner for this reason — no redirect.

**Rule:** Any new `reason` added to `useAccessGuard` must be handled explicitly in `RequireAccess` (spinner or redirect). Default to spinner for transient loading states. Never redirect on a loading reason.

**Files to update when adding a new loading gate:**
- `src/hooks/useAccessGuard.ts` — add reason to `GuardResult` union + new if-block
- `src/components/RequireAccess.tsx` — add reason to spinner condition
- `src/store/authStore.ts` — add flag + set it in `initialize()`, `onAuthStateChange`, and sign-out

---

## Alarm Audio — added 1 Jun 2026

### If you change `src/lib/alarm.ts`

**Affects:**
- `src/components/SessionAlarmModal.tsx` — imports `startAlarmLoop` + `triggerVibration`. If `startAlarmLoop` signature changes (e.g. takes options), update the modal call site.
- `src/pages/Settings.tsx` — Test alert button imports `playBeepOnce` + `triggerVibration` + `unlockAudio`. Keep Test as ONE beep (`playBeepOnce`), not the full loop.
- `src/App.tsx` — global unlock listener calls `unlockAudio()`. If unlock semantics change, update the listener.
- The 60-second auto-stop cap in `startAlarmLoop` is load-bearing for battery safety — do not remove without explicit decision.

**Discovered when:** Alarm volume + loop + iOS audio unlock fix, 1 Jun 2026 (Pattern T5).

### If you change `notifyAtMs` semantics

**Affects:**
- `src/db/queries.ts` — `snoozeNotify` (anchor-to-original logic, Pattern T6), `updateSessionNotify` (set/clear on running session from now)
- `src/hooks/useSessionAlarm.ts` — detection uses wall-clock `now >= notifyAtMs`. Do NOT compensate for `pausedTotalMs` (deliberate: wall-clock semantics match how phone alarms work)
- `src/pages/StartSession.tsx` — sets alarm at session creation; duration is FROM session start
- `src/pages/SessionDetail.tsx` — sets/edits on running session via alarm pill; duration is FROM NOW
- `src/components/TableCard.tsx` — bell icon shown when `notifyAtMs != null && !notifyAcknowledgedAt`
- `src/components/SessionAlarmModal.tsx` — fires when threshold met on `/tables`

### If you change `NOTIFY_PRESETS` in `src/lib/notifyPresets.ts`

**Affects:** `src/pages/StartSession.tsx` alarm chips AND `src/pages/SessionDetail.tsx` edit bottom sheet. Both import from this file — change once, both screens update.

**Discovered when:** Alarm Phase 2, 1 Jun 2026.

---

## Split payments + Quick Sale + Piggy (v13) — added 10 Jun 2026

### If you change `Session.paymentBreakdown` or `recordSessionPaymentBreakdown`

**Affects:**
- `src/types/index.ts` — `PaymentBreakdown` interface + optional field on `Session`
- `src/db/database.ts` — v13 `.upgrade()` writes the field for completed sessions. Never touch this upgrade block.
- `src/db/queries.ts` — `recordSessionPaymentBreakdown`, `PaymentBreakdownInvalidError`, `WalletInsufficientError`
- `src/components/PaymentSplitSheet.tsx` — sheet UI consumed by SessionDetail + QuickSale
- `src/pages/SessionDetail.tsx` — captures breakdown after `stopSession`; auto-resume effect for completed-without-breakdown
- `src/pages/summary/PaymentModeStrip.tsx` — reads `paymentBreakdown` for stopped sessions on viewed date
- `src/pages/Summary.tsx` — PAYMENT MODE aggregation in render body; piggy `cashIn` math

**CRITICAL invariants:**
- `cash + upi + wallet === session.amount + Σ(sessionItems.price × quantity)` (computed inside the tx — `session.amount` alone is the time portion ONLY, not the grand total).
- `wallet > 0` requires `customerId`; sheet enforces in UI, queries layer enforces at runtime.
- `paymentBreakdown` is set ONCE at "Record payment" confirm, NOT at stopSession. Between Stop and confirm, the field is `undefined`.
- Phase 4 PAYMENT MODE tile + Phase 5 piggy `cashIn` both filter on `paymentBreakdown !== undefined` to exclude this transient state.
- ADDENDUM-4: re-mounting a completed session with no `paymentBreakdown` auto-resumes the payment flow via a `useEffect` guarded by `autoOpenHandled` + `paymentScreenOpen`. Do NOT remove the second guard — without it the auto-open re-fires immediately after a normal Stop and robs the user of the QR view.
- ADDENDUM-5: zero-amount sessions write `{0, 0, 0}` directly without opening the sheet. Both the manual button AND the auto-open path handle this.
- `Session` has NO `customerId` field. Wallet customer is captured in sheet state only; the durable link is `WalletTransaction.referenceId = sessionId.toString()`.

**Discovered when:** Phase 2 build (8 Jun 2026 — wait, this whole feature shipped 10 Jun 2026; reference Phase 2 in the prompt sequence). The `session.amount` vs `grandTotal` mismatch shipped first as a P0 bug: the DB-layer check used `session.amount` alone, rejecting valid breakdowns whenever items were present and table time was small. Fix: compute `grandTotal` inside the tx by reading `sessionItems` for the session. See bug_patterns.md Pattern M3.

---

### If you change `CanteenSale` or `createCanteenSale`

**Affects:**
- `src/types/index.ts` — `CanteenSale` interface
- `src/db/database.ts` — v13 stores `canteenSales: 'id, createdAt, customerId'`
- `src/db/queries.ts` — `createCanteenSale`, `CanteenSaleInvalidError`, `CanteenSaleStockError`, `CanteenSaleLineInput`, `getCanteenSalesByDate`
- `src/pages/QuickSale.tsx` — only writer (v1: no edit flow)
- `src/pages/Summary.tsx` — `canteenSalesForDate` live query feeds the canteen revenue tile + PAYMENT MODE + piggy `cashIn`
- `src/types/walletTransaction.ts` — `WalletReferenceType` includes `'canteen_sale'`

**Pattern D7 invariant:** `createCanteenSale` opens ONE flat `db.transaction('rw', db.canteenSales, db.canteenItems, db.customers, db.walletTransactions)`. Inside:
1. Stock decrement per `canteenItemId` (aggregated qty across duplicate lines first), throws `CanteenSaleStockError(itemName, available)` if would go negative.
2. Wallet debit + WalletTransaction(`referenceType:'canteen_sale'`) if `wallet > 0`.
3. CanteenSale insert LAST (so any earlier throw rolls everything back).

**Out-of-scope (v1):** free-text items (every line MUST match a CanteenItem.id); discount; edit/refund/void of a sale.

---

### If you change `StockPurchase` or `recordStockPurchase`

**Affects:**
- `src/types/index.ts` — `StockPurchase` interface
- `src/db/database.ts` — v13 stores `stockPurchases: 'id, createdAt, canteenItemId, source'`
- `src/db/queries.ts` — `recordStockPurchase`, `StockPurchaseInvalidError`, `listStockPurchases`, `listStockPurchasesForItem`, `getPiggyBalance`
- `src/components/RestockSheet.tsx` — only writer
- `src/pages/Canteen.tsx` — opens RestockSheet from each item card
- `src/pages/Piggy.tsx` — lists restocks split by source; reads `getPiggyBalance`
- `src/pages/Summary.tsx` — CASH FLOW strip reads piggy + sums `stockPurchasesForDate`
- `src/pages/summary/CashFlowStrip.tsx` — tile UI

**Atomicity:** single flat `db.transaction('rw', db.stockPurchases, db.canteenItems)`. Insert StockPurchase + (when `stockEnabled=true`) `currentStock += quantityAdded`. Stock can only grow via restock.

**Piggy radio rule:** RestockSheet disables the Piggy chip when `cost > piggyBalance`. If the user had Piggy selected when cost rose past piggy, `effectiveSource` snaps to Other before write. Never write a StockPurchase with `source='piggy'` if it would put piggy under ₹0 — the UI is the only enforcement point. The piggy formula tolerates a negative `current` (UI clamps to 0 + warning) but that's a data-weirdness escape hatch, not a normal path.

---

### If you change `getPiggyBalance` or piggy settings

**Affects:**
- `src/db/queries.ts` — `getPiggyBalance`, `updatePiggyOpeningBalance`
- `src/types/index.ts` — `ClubSettings.piggyOpeningBalance?` + `piggyStartedAt?`
- `src/pages/Piggy.tsx` — current balance + cash-by-week sections
- `src/pages/Settings.tsx` — Piggy section (current balance display)
- `src/pages/summary/CashFlowStrip.tsx` — PIGGY tile
- `src/pages/Summary.tsx` — `piggy` live query

**Aggregation window invariant:** every "cash collected" sum MUST intersect with `piggyStartedAt`. Same for cash-by-week sums inside Piggy.tsx — `winStart = Math.max(weekStart, since)`. NEVER aggregate cash-in from before piggy was started; that's how historic data leaks in and breaks the owner's mental model.

**Piggy is a derived value.** There is no ledger table. Single source of truth = the four underlying tables (sessions / canteenSales / walletTransactions / stockPurchases) + the two settings fields. Do NOT add a piggy_balance column or a piggy_ledger table without an explicit decision.

---

### If you change `PaymentSplitSheet`

**Two consumers — verify both:**
- `src/pages/SessionDetail.tsx` — `total = finalGrandTotal` (table-time + items); `onConfirm` calls `recordSessionPaymentBreakdown`
- `src/pages/QuickSale.tsx` — `total = subtotal` (`Σ price*qty` from the cart); `onConfirm` calls `createCanteenSale`

**Single-source-of-truth invariant (Pattern M3):** `canConfirm = matches && !submitting && totalIsValid`. This boolean drives BOTH the status line (green ✓ vs orange short vs red over) AND the Confirm button's `disabled` prop AND its visual styling (NOT just `disabled:opacity-40` — explicit className branching). The error slot REPLACES the status line when present; the two never stack. Do NOT split this boolean into separate `enabled` / `displayMatch` / `buttonStyle` variables that can drift.

**`total` prop must be the actual amount being collected.** For sessions: `session.amount + Σ(sessionItems.price * quantity)`. For QuickSale: cart subtotal. Never pass `session.amount` alone (see Pattern M3).

**Customer linking is sheet-local.** No `Session.customerId` field exists. The wallet portion's durability comes from `WalletTransaction.referenceId`.

---

### If you change the TopBar layout

**Affects (10 Jun 2026 update):**
- Now renders TWO stacked rows inside the outer container. Row 1: "Today" heading + icon group (`flex items-start justify-between`). Row 2: date subtitle + optional `+ Quick Sale` pill (`flex items-center justify-between mt-1 py-1 gap-2`). The pill is conditional on `onQuickSalePress?: () => void` prop. Date `<p>` is `truncate min-w-0`; pill is `shrink-0` so it never compresses.
- `src/pages/Home.tsx` passes `onQuickSalePress={() => navigate('/quick-sale')}`. Other consumers (none currently — TopBar is single-use) omit the prop and the pill is absent.
- Icon group at the right (canteen / wallet / settings) is unchanged. Do not add a fifth icon at 360px width per existing rule.

---

### If you change PAYMENT MODE aggregation in Summary

**Affects:**
- `src/pages/Summary.tsx` — `paymentMode` useMemo. Deps: `[detailSessions, canteenSalesForDate]`.
- `src/pages/summary/PaymentModeStrip.tsx` — tile + bar UI

**Pattern T4 invariant:** Running sessions are EXCLUDED from this tile (no `paymentBreakdown` yet). They are still added to the HEADLINE `totalRevenue` via the render-body `runningRevenueToday` reducer. Do NOT move the PAYMENT MODE math into `useLiveQuery` — it would drift behind ticks; the source data IS db-static (`paymentBreakdown` only changes on confirm), so it's correct in the render body either way, but keep the `useMemo` to avoid the per-tick reducer cost.

**Largest-remainder percent rounding:** `PaymentModeStrip.computePercents` ensures tiles sum to exactly 100. If you change the rounding strategy, the bar widths and tile percents must stay consistent (both read from the same return value).

---

## Player Hub + ClubCoins + Engagement ripples (10–11 Jun 2026)

### src/lib/playerHubApi.ts
- **Imports:** `src/lib/supabase.ts`
- **Imported by:** `src/pages/PlayerHubSettings.tsx`, `src/pages/Settings.tsx` (updateClubNameRemote), `src/pages/Wallet.tsx` (getOwnerClub), `src/hooks/useLiveData.ts` (getOwnerClub)
- **Ripple:** If you change the Supabase `clubs` table columns → update all `select()`/`update()` calls in this file. If you change `upsertClub()` signature → update `PlayerHubSettings.tsx` caller. If you add a new function → also export from this file's index.

### src/lib/realtimeTopups.ts
- **Imports:** `src/lib/supabase.ts`, `src/store/topupInbox.ts`, `src/lib/playerHubApi.ts`
- **Imported by:** TopBar (mount/unmount), sign-out flow
- **Ripple:** If you change `clubs.id` lookup → update `subscribeToTopupIntents` channel name. If you change `topup_intents` table name/columns → update INSERT/UPDATE listeners here AND in `playerHubApi.ts`. Fallback polling calls `getPendingTopups` — any change to that function signature ripples here.

### src/store/topupInbox.ts
- **Imports:** `zustand`
- **Imported by:** `src/lib/realtimeTopups.ts` (setPendingCount, increment, decrement), TopBar (usePendingTopupCount), `src/components/PendingTopupsModal.tsx` (closeModal)
- **Ripple:** If you rename `pendingCount` → update TopBar badge and realtimeTopups. This is a side-effect store — no DB reads, just in-memory state.

### src/lib/slug.ts
- **Imports:** `src/lib/supabase.ts`
- **Imported by:** `src/pages/PlayerHubSettings.tsx`
- **Ripple:** If `clubs.slug` column is renamed → update `isSlugAvailable` query here.

### src/pages/player/PlayerScan.tsx
- **Imports:** `src/lib/playerHubApi.ts`, `src/components/UpiQrCard.tsx`, `src/lib/coins.ts`, `src/pages/player/PlayerScanLayout.tsx`, `src/types/playerHub.ts`
- **Imported by:** `src/App.tsx` (route `/c/:clubSlug`)
- **Ripple:** If you change `getClubPublicInfo` return shape → update all field accesses in this file. If `ClubPublicInfo.coinsEnabled` is removed → remove coin preview block. This is a PUBLIC page — no auth, no Dexie. Keep it that way.

### src/pages/player/PlayerScanLayout.tsx
- **Imports:** React only
- **Imported by:** `src/pages/player/PlayerScan.tsx`
- **Ripple:** Layout-only. Safe to style without logic ripples.

### src/pages/Poster.tsx
- **Imports:** `src/lib/playerHubApi.ts`, `src/components/UpiQrCard.tsx`, `src/pages/player/PlayerScanLayout.tsx`
- **Imported by:** `src/App.tsx` (route `/poster/:slug`)
- **Ripple:** Calls `getClubPublicInfo(slug)` — same as PlayerScan. If slug lookup changes → update both.

### src/components/PendingTopupsModal.tsx
- **Imports:** `src/db/queries.ts` (recordTopupWithCoins, getCoinConfig), `src/lib/playerHubApi.ts` (confirmTopupIntent, rejectTopupIntent), `src/store/topupInbox.ts`, `src/store/toastStore.ts`
- **Imported by:** TopBar
- **Ripple:** If `recordTopupWithCoins` signature changes → update call here. If `confirmTopupIntent` or `rejectTopupIntent` error types change → update error handling. Confirm path writes to Dexie AND Supabase in sequence — not atomic across both. Supabase fires first, then Dexie.

### src/lib/coins.ts
- **Imports:** `src/types/index.ts` (CoinTier, ClubSettings)
- **Imported by:** `src/db/queries.ts` (coinsEarnedForTopup, resolveCoinConfig), `src/pages/player/PlayerScan.tsx` (coinsEarnedForTopup), `src/components/CoinRedemptionPill.tsx` (maxRedeemableCoins, coinsToMinutes, coinsToRupees), `src/lib/coinExpiry.ts`, `src/lib/playerHubApi.ts` (syncCoinConfig reads config)
- **Ripple:** `DEFAULT_COIN_CONFIG` is the fallback for all unconfigured clubs — change it carefully. If `CoinTier` type changes → update `PlayerHubSettings.tsx` CoinTiersEditor + `PlayerScan.tsx` preview.

### src/lib/coinExpiry.ts
- **Imports:** `src/db/database.ts`, `src/lib/coins.ts`, `src/db/queries.ts` (getCoinConfig)
- **Imported by:** `src/App.tsx` (applyExpirySweep via ExpirySweepRunner)
- **Ripple:** Reads `WalletTransaction` rows for FIFO lot logic — if `balanceType`/`coinDelta`/`referenceType` fields change → update lot reconstruction logic. Writes new `coin_expiry` rows — if `WalletReferenceType` changes → update here.

### src/lib/streak.ts
- **Imports:** `src/db/database.ts`, `src/types/index.ts`
- **Imported by:** `src/pages/SessionDetail.tsx` (checkAndAwardStreak called at session payment confirm, lines 750 + 801)
- **Ripple:** Called in SessionDetail's payment confirm path — if session stop flow changes → verify call site is still reached. Reads `walletTransactions` for distinct session days — if session debit referenceType changes → update filter.

### src/lib/dormancy.ts
- **Imports:** `src/db/database.ts`
- **Imported by:** `src/components/BringBackList.tsx`
- **Ripple:** Filters `customers` by `lastVisitAt` — if Customer schema changes → update filter logic here.

### src/lib/nudge.ts
- **Imports:** `src/db/database.ts`
- **Imported by:** `src/components/BringBackList.tsx`, `src/components/NudgeTemplateEditor.tsx`
- **Ripple:** `logNudgeSent` writes a `WalletTransaction` with `referenceType:'engagement_log'` — if that type is removed from the union → TS error here.

### src/components/CoinTiersEditor.tsx
- **Imports:** `src/types/index.ts` (CoinTier)
- **Imported by:** `src/pages/PlayerHubSettings.tsx`
- **Ripple:** Props are `tiers/onChange` — safe to style. If `CoinTier` type changes → update here.

### src/components/CoinRedemptionPill.tsx
- **Imports:** `src/lib/coins.ts`, `src/types/customer.ts`
- **Imported by:** `src/pages/SessionDetail.tsx:697` (post-stop payment flow)
- **Ripple:** If `Customer.coinBalance` is removed → update props. If coin math functions change → update displayed values.

### src/components/BringBackList.tsx
- **Imports:** `src/lib/dormancy.ts`, `src/lib/nudge.ts`, `src/lib/customerDisplay.ts`
- **Imported by:** `src/pages/PlayerHubSettings.tsx`
- **Ripple:** Pure UI + API calls. If WhatsApp link format changes → update `buildWhatsAppLink` in nudge.ts (not here).

### src/components/EngagementConfigCard.tsx
- **Imports:** `src/db/queries.ts` (updateSettings), `src/types/index.ts`
- **Imported by:** `src/pages/PlayerHubSettings.tsx`
- **Ripple:** Writes to ClubSettings engagement fields — if field names change → update here + `streak.ts` + `coinExpiry.ts` readers.

### src/components/NudgeTemplateEditor.tsx
- **Imports:** `src/lib/nudge.ts`
- **Imported by:** `src/pages/PlayerHubSettings.tsx`
- **Ripple:** Template variables (`{name}`, `{coins}`, `{clubName}`, etc.) must stay in sync with `renderNudgeTemplate` in `nudge.ts`.

### Modified shared modules

**src/hooks/useLiveData.ts** — added `useSyncClubFromSupabase()`
- Now imports `src/lib/playerHubApi.ts` (getOwnerClub). Any change to getOwnerClub return shape ripples here.
- `_clubSyncDone` module-level flag: do NOT add other one-time-run logic using the same pattern without resetting it properly on sign-out.

**src/App.tsx** — added `ExpirySweepRunner` + 2 new routes
- `ExpirySweepRunner` calls `applyExpirySweep` from `coinExpiry.ts`. Gate is `dbReady + session + subscriptionLoaded` — must remain consistent with other gated operations.
- If you add a new public route → add its prefix to the `isPublicRoute` check in `AppLayout`.

**src/db/queries.ts** — added `recordTopupWithCoins`, `getCoinConfig`, and streak/expiry helpers
- `recordTopupWithCoins` is the ONLY correct path for crediting wallet + coins atomically. Never split this into two separate DB calls.
- If `Customer.firstTopupAt` is renamed → update the welcome-bonus guard inside this tx.

**src/pages/PlayerHubSettings.tsx** — now imports: slug.ts, playerHubApi.ts, coins.ts, realtimeTopups.ts, CoinTiersEditor, EngagementConfigCard, BringBackList, NudgeTemplateEditor
- Heaviest import graph in the app. If any of these move → update imports here first.

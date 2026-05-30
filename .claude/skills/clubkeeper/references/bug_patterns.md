# Bug Patterns

Preventive reference. Grouped by area. Read the relevant section BEFORE editing code in that area — this kills repeated bugs.

For full chronological bug history with all the prose context, see `bug_archive.md`.

---

## Timer & Time math

Files most affected: `src/pages/SessionDetail.tsx`, `src/db/sessions.ts`, `src/lib/money.ts`, anywhere with `startedAt`.

### Pattern T1 — Never use counters for elapsed time
**Symptom signature:** Elapsed time resets on refresh / drifts / loses state on tab close.
**Rule:** Always derive elapsed as `Date.now() - startedAt - pausedTotalMs`, recomputed every render via a `useTick()` hook. NEVER `setInterval(() => setElapsed(e+1))`. The timestamp survives anything because it's persisted in Dexie; a counter does not.

### Pattern T4 — Never put `calculateAmount`/`getElapsedMs` inside `useLiveQuery` (BUG-022)
**Symptom signature:** An aggregate amount (e.g. "Today ₹X,XXX") is frozen on page load and only updates on route change or a DB write — even though `useTick()` is called in the same component.
**Root cause:** `useLiveQuery` runs its async callback only when IndexedDB rows change — it is NOT re-triggered by React re-renders from `useTick()`. Any `Date.now()`-derived calculation (e.g. `getElapsedMs(s)`) placed inside the callback is computed once at DB-write time and then cached, making the displayed total stale until the next DB write.
**Rule:** Split the query into two parts:
1. **`useLiveQuery`** — compute only DB-static values: `completed` session `amount` fields + `sessionItems`. These only change on DB writes, so the cached value is always correct.
2. **Render body** — compute running/paused session amounts from `activeSessions` (already a live hook) using `calculateAmount(getElapsedMs(s))`. Because this runs on every render, `useTick()` drives it every second.
3. **Combine** in the render body: `total = completedFromQuery + itemsFromQuery + runningFromRender`

`useTick()` alone is not enough if the ticking value is computed inside a live query. The ticking value must be computed in the render body.

**Canonical example (Home.tsx, fixed 29 May 2026):**
```ts
// DB-static part — only re-fires on DB write
const todayStaticTotals = useLiveQuery(async () => {
  const completed = todaySessions.filter(s => s.status === 'completed').reduce((sum, s) => sum + s.amount, 0)
  const items = sessionItems.reduce((sum, i) => sum + i.price * i.quantity, 0)
  return { completed, items }
}, [])

// Live part — recalculates every useTick() re-render
const runningAmount = activeSessions.reduce(
  (sum, s) => sum + calculateAmount(s.billingMode, getElapsedMs(s), s.rateSnapshot, s.framesPlayed), 0
)

const todayTotal = (todayStaticTotals?.completed ?? 0) + (todayStaticTotals?.items ?? 0) + runningAmount
```

**Check this pattern anywhere:** aggregate totals on Home (`todayTotal`), any future dashboard widget showing live revenue. Summary.tsx already uses the correct pattern — its aggregates are computed in the render body, not inside a live query.

### Pattern T2 — Settings flags must be plumbed into actions
**Symptom signature:** A Settings toggle exists but does nothing.
**Root cause:** Action code never reads the setting.
**Rule:** When adding any setting, grep for the action that uses it. If `stopSession()` should round time, `stopSession()` must read settings + call `applyRounding()`. Store the rounded value in its own field (e.g. `roundedDurationMs`) so display layers don't recompute.

### Pattern T3 — Rate snapshot per session
**Rule:** Each session stores its own `rateSnapshot` at start. Editing a table's rate later does NOT change in-progress sessions. This is load-bearing — never use the live table rate for an active session.

---

## Forms & Inputs (validation, adversarial input)

Files most affected: `src/pages/StartSession.tsx`, `src/components/TableFormModal.tsx`, anywhere with `<input>`.

### Pattern F7 — Validation errors must be inline-only; toasts are the wrong channel for actionable errors (30 May 2026)
**Symptom signature:** An error appears in two places — once as a system toast at the top of the screen AND once as an inline message below the input. The toast visually overlaps fixed UI (headers, nav bars). The user sees the error but can't act on it (e.g., the "View profile" link is in the toast, which auto-dismisses in 3 seconds).
**Root cause:** Both `showToast()` AND `setPhoneError()` were called in the same catch block. The toast rendered over the header, making it look like the error was "in the header".
**Rule:** For validation errors on form inputs, use ONLY the inline error below the input. If the error has an actionable follow-up (e.g., "View profile →"), render it as a button in the same inline row — right-aligned, `min-h-[36px]`. Do NOT show a toast for the same error. Toasts are for transient success/failure confirmations (e.g., "Top-up done"), not for blocking validation that the user needs to read and act on.
**Correct pattern (WalletNewCustomer.tsx):**
```tsx
{phoneError && (
  <div className="flex items-center justify-between gap-2 mt-2">
    <p className="text-[13px] text-busy">{phoneError}</p>
    {phoneErrorCustomerId && (
      <button onClick={() => navigate(`/customer/${phoneErrorCustomerId}`)}
        className="text-[13px] text-accent font-semibold shrink-0 min-h-[36px] flex items-center">
        View profile →
      </button>
    )}
  </div>
)}
```

### Pattern F1 — Adversarial input always
**Rule:** Every text input gets explicit validation + an error message. Plan for 10,000-char paste, emoji, special chars, SQL-injection-shaped strings.

### Pattern F2 — Don't use `maxLength` for length validation (BUG-008)
**Symptom signature:** Input silently truncates without telling the user.
**Root cause:** `maxLength={50}` on `<input>` truncates BEFORE React's onChange fires, so `validatePlayerName()` never sees the >50-char string and the error message never displays.
**Rule:** Remove `maxLength` from the input. Use an explicit validator that sets an error state. Submit button gets `disabled={... || Boolean(error)}`. Error message renders under the input.

### Pattern F3 — Validate at write AND read
**Rule:** If validation rules ever change, old data may not match new rules. Filter both at storage time AND at query time (e.g. `getRecentPlayerNames()` re-validates before returning). Provide a Settings "Clean Invalid Data" button for retroactive cleanup.

### Pattern F4 — Use native HTML inputs when possible
**Rule:** `<input type="date">` over custom date pickers. Free mobile keyboards, free pickers, free accessibility. Use YYYY-MM-DD strings, not Date objects, for state. Always add `[color-scheme:dark]` Tailwind class for native dark theme.

### Pattern F5 — Don't reinvent toggles with checkboxes + CSS
**Rule:** Toggles are `<button role="switch">` with absolute-positioned knob via `translateX`. Reusable `<Toggle>` component is at `src/components/Toggle.tsx`. Hand-rolled CSS toggles always have alignment bugs.

### Pattern F6 — Truncate every text display
**Rule:** Every text rendered from user input needs `truncate min-w-0 flex-1` (or similar). Without `min-w-0`, flex children won't shrink. Without `truncate`, long strings break layout in Home cards, SessionDetail, suggestion chips, everywhere.

---

## Dexie & Offline state mutations

Files most affected: `src/db/*`, any component that mutates and re-renders.

### Pattern D1 — Close UI before mutating, OR null-guard the render
**Symptom signature:** "Cannot read properties of undefined (reading 'name')" after delete/disable.
**Root cause:** Modal stays open and re-renders with deleted-record state.
**Rule:** EITHER close the modal IMMEDIATELY (`setEditingId(null)`) before the mutation, OR add `if (!record) return null` guard at the top of the modal component. Preferably both.

### Pattern D2 — Soft delete only, never hard delete
**Rule:** "Disable Table" sets `outOfService: true`, never deletes rows. Historical sessions reference `table_id` — deleting a table breaks past data. Same applies to any entity referenced by sessions.

### Pattern D3 — Check related data integrity before destructive actions
**Rule:** Before disabling a table, check it has no active session. Before deleting anything, check what references it. Pre-check + re-check on submit (handle race conditions).

### Pattern D4 — Don't fade clickable elements
**Symptom signature:** Disabled-table edit pencil still clickable but looks ghostly.
**Rule:** Apply `opacity-50` ONLY to text/info divs, NEVER to action buttons. Either disable an element properly (`pointer-events-none` + `aria-disabled`) or keep it at full opacity.

### Pattern D6 — Never query `db` before `dbReady === true` (LIMIT-001 fix, 27 May 2026)
**Symptom signature:** Dexie writes succeed but data appears to be lost; or two accounts see each other's data.
**Root cause:** The `db` export is a Proxy over a mutable `_db` holder. Before `initDbForUser()` runs, `_db` points to a `ClubKeeperDB__pending` placeholder. Dexie ops against the placeholder are valid IndexedDB ops — they just write to the wrong database.
**Rule:** `useAccessGuard` returns `{ canAccess: false, reason: 'db_loading' }` while `dbReady === false`. Private routes render a spinner, not their content. No Dexie query runs until `dbReady` is set to `true` in authStore after `initDbForUser(userId)` + `seedIfEmpty()` complete.

### Pattern D5 — Button labels must match behavior
**Rule:** If "Delete" doesn't actually delete (it soft-deletes), call it "Disable". Context-aware labels are fine ("Enable Table" when editing a disabled one). Inherited misnomers from earlier prompts must be renamed.

---

## Auth & Session (Supabase, OAuth)

Files most affected: `src/store/authStore.ts`, `src/pages/Signup.tsx`, `src/pages/AuthCallback.tsx`, `src/hooks/useAccessGuard.ts`.

### Pattern A1 — Supabase `INITIAL_SESSION` always fires synchronously (BUG-002)
**Symptom signature:** `profiles` and `subscriptions` are each queried twice (4 total) on every page load. 8 in dev with StrictMode.
**Root cause:** `initialize()` calls `refreshProfile()` once. Then registering `supabase.auth.onAuthStateChange` triggers a synthetic `INITIAL_SESSION` event synchronously, calling `refreshProfile()` again within ms.
**Rule:** authStore has a `_lastFetchedAt` timestamp. `refreshProfile()` no-ops if called within 3000ms unless `force=true`. Use `force=true` only after a real server mutation (post-payment, post-cancel).

### Pattern A2 — Google OAuth needs `prompt: 'select_account'` (BUG-015)
**Symptom signature:** Already-signed-in Chrome profile auto-picks one Google account, no picker shown.
**Rule:** Always pass `queryParams: { prompt: 'select_account' }` in `supabase.auth.signInWithOAuth` options. Users with multiple accounts MUST get the picker. Shared-device first-time users get the wrong account otherwise.

### Pattern A3 — Auth state is async, never gate UI sections on `&& subscription` (BUG-013)
**Symptom signature:** Settings "Subscription" section invisible while auth loads.
**Rule:** Don't `{subscription && (...)}` an entire UI section. Use a three-branch render: `null` → loading placeholder, `status !== 'none'` → full detail, else (`status='none'`) → Subscribe CTA card. Layout stays stable.

### Pattern A4 — OAuth in-flight double-tap
**Rule:** Use a `isOAuthInFlight` ref in Signup to prevent double-fires. `handleRetry` uses a 50ms tick to reset state cleanly.

### Pattern A5 — Auth store initializer must use try/finally on loading flag (BUG-020)
**Symptom signature:** OAuth succeeds (token visible in URL hash), page stuck forever on "Signing you in…". Refreshing is the only escape.
**Root cause:** `initialize()` set `loading: false` in the try block only. Any throw (network error, RLS error, bad Supabase response) in `refreshProfile()` left `loading=true` permanently. Any component gating on `if (loading) return` was permanently frozen.
**Rule:** Every async store initializer that drives a loading flag MUST use `try/finally`:
```ts
initialize: async () => {
  try {
    // ... getSession, refreshProfile, etc.
  } catch (err) {
    console.error('[authStore] init error:', err)
    // optionally: set({ initError: String(err) })
  } finally {
    set({ loading: false })   // ALWAYS fires — cannot be skipped
  }
}
```
Same rule applies to any future async loading flag in this app (e.g. if a data-loading store is added). The `finally` block is non-negotiable.

---

## Subscription & Razorpay (payments, fetch errors)

Files most affected: `src/pages/Subscribe.tsx`, `src/components/subscribe/PaymentBottomSheet.tsx`, `api/create-subscription.ts`, `api/razorpay-webhook.ts`.

### Pattern S1 — Every fetch needs timeout + status check + .json() try/catch (BUG-017)
**Symptom signature:** Click pay → indefinite spinner → cryptic `SyntaxError: Unexpected end of JSON input`.
**Root cause:** No `AbortController` timeout. No HTTP status check before `.json()`. No try/catch around `.json()`. The 404 (Vite doesn't serve `/api/*`) returns empty body → `.json()` throws.
**Required pattern (use for ALL fetches in this app):**
```ts
const ctrl = new AbortController()
const t = setTimeout(() => ctrl.abort(), 15000)
try {
  const res = await fetch(url, { signal: ctrl.signal, ... })
  clearTimeout(t)
  if (res.status === 404) throw new Error("Backend unavailable. Locally, run `vercel dev`.")
  if (!res.ok) {
    let msg = "Payment failed. Try again."
    try { msg = (await res.json()).message ?? msg } catch {}
    throw new Error(msg)
  }
  let body
  try { body = await res.json() } catch { throw new Error("Bad response from server.") }
  // use body
} catch (e) {
  if (e.name === 'AbortError') throw new Error("Request timed out. Check your connection.")
  throw e
}
```

### Pattern S2 — Webhook is source of truth, frontend is optimistic
**Rule:** Razorpay webhook → Supabase status updates are authoritative. Frontend calls `refreshProfile(true)` after Razorpay's `handler()` callback with a 1500ms delay (gives webhook a head start). Never write subscription status from the frontend directly.

### Pattern S3 — Razorpay Subscription API, not Orders API
**Rule:** `razorpay.subscriptions.create()` for recurring. Orders API is one-time only. Subscription API handles NACH auto-debit, retry on failure, lifecycle webhook events.

### Pattern S4 — 7-day trial via `start_at`, not `trial_period`
**Rule:** Trial = setting `start_at = now + 7 days` on Razorpay subscription. Our `trial_ends_at` in Supabase + `useAccessGuard` date check is the truth. Don't use Razorpay's `trial_period` param.

### Pattern S5 — Plan IDs live in one place AND must match both account AND mode of the active key

**Rule:** All 6 Razorpay plan IDs (starter/standard/pro × monthly/annual) live in `src/lib/razorpayPlans.ts`. Single source of truth. Never inline plan IDs anywhere else.

**Two isolation axes — both can cause BUG-018-class errors:**
1. **Account isolation (BUG-018):** A key from account A cannot resolve plan IDs from account B. Rotating keys or switching accounts silently breaks all plan IDs.
2. **Mode isolation (BUG-021):** TEST keys can only resolve TEST mode plan IDs. LIVE keys can only resolve LIVE mode plan IDs. TEST key + LIVE plan IDs → Razorpay 400 "The ID provided is invalid or could not be found."

**Canonical permanent fix (BUG-021):**
`src/lib/razorpayPlans.ts` defines `TEST_PLANS` and `LIVE_PLANS` separately, then auto-selects:
```ts
const isTestMode = keyId?.startsWith('rzp_live_') !== true
export const PLANS = isTestMode ? TEST_PLANS : LIVE_PLANS
```
Server-side mirror is in `api/_shared/plans.ts` (reads `process.env`, same logic).
Switching Vercel env between TEST ↔ LIVE now requires **zero code changes** — just set the right keys.

**Verification command:** After ANY change to `VITE_RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` in Vercel, or any new plan creation, verify each plan ID with:
```bash
curl -u KEY_ID:KEY_SECRET https://api.razorpay.com/v1/plans/PLAN_ID
```
- **200** with plan JSON = key, account, and mode all match ✅
- **400** "does not exist" = account OR mode mismatch — check both ❌

**Trigger this check when:** (1) rotating Razorpay keys, (2) switching TEST → LIVE mode, (3) plan IDs are copied from a different dashboard session.

### Pattern S6 — API response shape contract: use `message`, not `error`
**Symptom signature:** Frontend shows generic fallback message even after server was updated to return real error details.
**Root cause:** Server returns `{ error: '...' }` but frontend reads `.message`. Field name mismatch silently swallows the real reason.
**Rule:** All `api/*.ts` error responses MUST use `{ message: string }` — matching what `handlePayNow()` and any other frontend consumer reads via `(await res.json()).message`. Never use `{ error: '...' }` on error paths.
**Document the shape:** Add a JSDoc comment at the top of each `api/*.ts` file listing the exact success and error JSON shapes:
```ts
// Success: { subscriptionId: string, shortUrl: string }
// Error:   { message: string, code?: string, razorpayStatus?: number }
```

---

## Routing & Navigation

Files most affected: `src/App.tsx`, `src/components/BottomNav.tsx`, any page with `navigate(...)`.

### Pattern R1 — After renaming a route, grep ALL `navigate('/old')` calls (BUG-009)
**Symptom signature:** Some flows still go to the old route.
**Root cause:** `/` → `/tables` migration missed a `navigate('/', ...)` buried in a try/catch.
**Rule:** After any route rename, `grep "navigate\('/'"` (or whatever the old route is) across the whole src/. Check INSIDE try blocks and async handlers.

### Pattern R2 — FABs open inline modals, never navigate away (BUG-004)
**Rule:** A `+` FAB on a list/grid page (e.g. Home `/tables`) opens an inline `<TableFormModal>` via state, never `navigate('/somewhere')`. Users expect to stay on the page. Settings can have its own "Add Table" button — two entry points are fine (Settings = management, FAB = quick add).

### Pattern R3 — Public vs private routes split
**Rule:** Public: `/, /signup, /subscribe, /auth/callback`. Private (behind `<RequireAccess>`): `/tables, /start/:id, /session/:id, /history, /summary, /settings`. BottomNav hidden on public paths. AuthInitializer mounts at App level and calls `initialize()` once.

---

## UI / Layout / Touch targets

Files most affected: ALL UI components.

### Pattern U1 — 44px touch target floor (BUG-005, BUG-006, BUG-007, BUG-010)
**Symptom signature:** Pills, chips, icon buttons, back buttons easy to miss-tap on mobile.
**Root cause:** Padding-only sizing (`py-1.5`, `p-2`, `w-9 h-9`) gives ~24-36px.
**Rule:** Anchor every interactive element with explicit `min-h-[44px]` (and `min-w-[44px]` for icon-only). Padding can decorate but never sizes the floor. Specifically:
- Pills/chips: `min-h-[44px] px-4` (not `py-1.5 px-3`)
- Icon buttons: `min-w-[44px] min-h-[44px] flex items-center justify-center` (not `p-2`)
- Header gear: `w-11 h-11` (not `w-9 h-9`)
- Back buttons: `min-h-[44px]` (not `py-1.5`)
- Suggestion chips: `min-h-[44px] flex items-center` (not `py-1`)

### Pattern U2 — Standardized page padding
**Rule:** All page-level horizontal padding is `px-5`. Pick once, apply everywhere. Inconsistent padding makes the app feel amateur.

### Pattern U6 — Settings collapse-toggle state must live in React, not URL hash
**Symptom signature:** Closing the Settings page and re-opening resets all sections to closed (or unexpected open state); or back button changes the open section.
**Root cause:** If open state were stored in URL hash (e.g. `#section=tables`), every toggle pushes a history entry — tapping back navigates through section states instead of going back to `/tables`.
**Rule:** `openSection` lives in React component state (+ `sessionStorage` for same-tab persistence). Never encode it in the URL or browser history. `sessionStorage` is the correct level: it's per-tab, clears on close, and has no user-facing consequence if stale.

### Pattern U3 — Sweep the whole file for currency formatting (BUG-011)
**Symptom signature:** Hero/aggregate amounts are formatted `1,500` but row-level renders show `1500`.
**Rule:** When adding `toLocaleString('en-IN')` to one place, search the entire file for other `{currency}{amount}` patterns. Row-level displays are usually added later than the aggregate and miss the treatment.

### Pattern U7 — Fluid card with fixed-size child
**Symptom signature:** Asymmetric whitespace inside a responsive card — thicker border on one side, thinner on the other. Often noticed with QR codes, images, or canvases inside cards sized with `min()`, `%`, or `vw`.
**Root cause:** Parent container is fluid (e.g. `width: min(72vw, 280px)`) but the child element (canvas, img, SVG) has a fixed pixel size. Browser centers the child but the parent's padding becomes uneven as the parent resizes.
**Rule:** Any child of a fluid-width card must use `style={{ width: '100%', height: 'auto', display: 'block' }}`. For raster outputs like QR canvases, render at 2× the max display size internally (e.g. 560 for a 280px cap) for retina crispness, then let CSS scale it down. Also wrap the card in `aspect-square flex items-center justify-center` when the child should be a perfect square — guarantees equal borders on all 4 sides regardless of viewport width.

### Pattern U8 — Full-screen overlay must be z-50 to cover bottom nav
**Symptom signature:** A `fixed inset-0` overlay is set up to cover the whole screen, but the bottom nav (or other fixed elements) still bleeds through at the bottom. Buttons in the overlay's footer are invisible or untappable.
**Root cause:** `fixed inset-0` positions the overlay full-screen but does not set a stacking context. The bottom nav has its own z-index (or sits later in DOM order) and renders on top of the overlay's footer.
**Rule:** Any full-screen overlay that must cover the bottom nav uses `z-50` (same tier as Modal Pattern M1's sheet). Also: the footer inside the overlay must use `paddingBottom: 'max(16px, env(safe-area-inset-bottom))'` so the action button clears the iOS/Android home indicator. Do NOT raise above z-50 (conflicts with Modal Pattern M1) and do NOT hide the bottom nav via `display:none` — the overlay covering it is the correct approach.

---

## Modals & Overlays (z-index, escape paths)

Files most affected: `src/components/Modal.tsx`, `src/components/subscribe/PaymentBottomSheet.tsx`, any bottom sheet.

### Pattern M1 — Scrim and sheet must be independent fixed layers (BUG-012)
**Symptom signature:** Modal scrim "intercepts pointer events" — backdrop blocks clicks on the sheet.
**Root cause:** `fixed inset-0 flex items-end` parent wrapping `absolute inset-0` scrim sibling + `relative z-10` sheet → scrim expands over sheet, stacking context conflict.
**Required pattern:**
- Scrim: `fixed inset-0 z-40` — independent fixed layer
- Sheet: `fixed bottom-0 left-0 right-0 z-50` — independent fixed layer
- NEVER share a parent container with the scrim as `absolute inset-0`.

### Pattern M2 — Escape key handler on every modal (BUG-012, BUG-016)
**Rule:** Every modal/sheet has a `useEffect` that registers `document.addEventListener('keydown', ...)` for Escape, with cleanup. Deps: `[open, onClose]`.
```ts
useEffect(() => {
  if (!open) return
  function handleKeyDown(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
  document.addEventListener('keydown', handleKeyDown)
  return () => document.removeEventListener('keydown', handleKeyDown)
}, [open, onClose])
```

### Pattern M3 — Payment sheet needs 4 escape paths (BUG-016)
**Rule:** Any sheet over a financial commitment needs FOUR independent ways out: X button (with visible background fill, not bare icon), ESC key, backdrop click, AND an explicit "Maybe later" text button at the bottom. All 4 disabled while `paying=true`. "Maybe later" sets `selectedPlan = null` to hide the sticky checkout bar too.

---

## Accessibility (a11y)

### Pattern X1 — `translateY` / `maxHeight` does not hide from screen readers (BUG-001, BUG-003)
**Symptom signature:** Collapsed FAQ or off-screen bottom sheet still readable by screen reader / focusable via Tab.
**Root cause:** Visual-only hide (CSS transform, max-height: 0, opacity) doesn't affect the accessibility tree.
**Rule:** Always pair visual hide with `aria-hidden={!open}` AND (for collapsibles) `inert={isOpen ? undefined : ''}`. For sheet dialogs add `tabIndex={open ? 0 : -1}`. Note: `inert` needs to be added to `React.HTMLAttributes<T>` in `vite-env.d.ts` for TS to accept it (React 18 doesn't include it natively).

### Pattern X2 — Native browser UI needs `color-scheme: dark`
**Rule:** Date pickers, scrollbars, select dropdowns, file inputs — all default to light. Add `[color-scheme:dark]` Tailwind class (or `color-scheme: dark` CSS) wherever they appear.

---

## Known Limitations (not bugs — by design)

### LIMIT-001 — IndexedDB is per-browser-origin, not per-user
Two different Google accounts on the same browser see the same tables and sessions. Acceptable for v1 (single-owner, single-device). Will be fixed when cloud sync is added: scope all Dexie reads/writes by `userId`, Dexie version bump required. Warn Sugeet if he asks for multi-staff login on one phone.

### LIMIT-002 — `/api/*` requires `vercel dev` locally
Vite alone doesn't serve serverless functions. Local dev with `npm run dev` returns empty 404 for `/api/*`. Handled with friendly error in `handlePayNow` (Pattern S1). Production (Vercel) works fine.

---

## When you find a new bug

1. **Look at the symptom signatures above first.** If it matches a pattern, apply the rule and append the bug to `bug_archive.md` referencing the pattern.
2. **If it's a new class of bug**, append a new pattern entry here (under the right area) AND a full entry in `bug_archive.md`.
3. **If it crosses multiple areas**, add to whichever section is primary, then cross-reference.
4. **Update `ripple_effects.md`** if the fix touches files that weren't previously known to be coupled.

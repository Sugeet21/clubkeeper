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

### Pattern T5 — Web Audio alarm output must be loud, looped, capped, and iOS-unlocked
**Symptom signature:** Alarm "works" — modal appears, vibration fires — but sound is silent or barely audible, especially on iPhone PWA. Or sound plays once and stops while modal stays open.
**Root cause:** Multiple compounding issues common to Web Audio on mobile: (a) default GainNode value too low, (b) tones too short to perceive, (c) no loop = single missed beep = feature failure, (d) iOS Safari suspends AudioContext until user gesture.
**Rule:** All alarm sound MUST go through `src/lib/alarm.ts`. Gain = 1.0. Tone duration ≥ 500ms with attack/decay envelope to avoid clicks. Loop every 3 sec via `setInterval` cleaned up in `useEffect` return. 60-sec auto-stop cap. iOS unlock via global `pointerdown` listener in `App.tsx` + on-tap unlock in Settings Test button. Never copy-paste alarm code — always import from the shared lib.
**Files affected:** `src/lib/alarm.ts` (single source), `src/components/SessionAlarmModal.tsx`, `src/pages/Settings.tsx`, `src/App.tsx`.

### Pattern T7 — Rate card snapshot is a triple — all three fields must be captured together at session start (9 Jun 2026)
**Symptom signature:** Pro-rated billing shows wrong amount — either ignores tolerance or uses wrong billing mode — for sessions started before a table config was edited.
**Root cause:** `rateCardSnapshot` captured without `toleranceMinutesSnapshot` or `rateCardBillingSnapshot` (or vice versa). At bill time, `calculateAmount` falls back to default tolerance (10 min) or default mode ('prorated'), which may differ from what was configured at session start.
**Rule:** In `startSession()`, ALL THREE snapshot fields must be written together atomically:
```ts
rateCardSnapshot: table.rateCard ?? undefined,
toleranceMinutesSnapshot: table.rateCard?.length ? (table.toleranceMinutes ?? 10) : undefined,
rateCardBillingSnapshot: table.rateCard?.length ? (table.rateCardBilling ?? 'prorated') : undefined,
```
Never capture one without the others. If a new rate-card-related field is added to `GameTable`, add a corresponding snapshot field to `Session` and include it in this triple.
**Files affected:** `src/db/queries.ts` (`startSession`), `src/types/index.ts` (`Session` interface).

### Pattern T8 — Don't conflate `rounding` setting with rate card tolerance — they are independent systems (9 Jun 2026)
**Symptom signature:** Rate card session gets unexpected time rounding (e.g. time jumps to nearest 15 min) even though the owner set up tier-based pricing.
**Root cause:** `calculateAmount` falls through to the `rounding` branch after the rate card branch returns. Or: `stopSession()` applies `applyRounding()` before passing elapsed to `calculateAmount`, artificially rounding the elapsed time before the rate card algorithm sees it.
**Rule:** `calculateAmount` checks `rateCardSnapshot` FIRST. If present and non-empty, BOTH `'minimum'` and `'prorated'` modes return immediately — the rounding param is NEVER read for rate-card sessions. The tier + tolerance window IS the rounding. Do NOT pass a pre-rounded elapsed to `calculateAmount` when `rateCardSnapshot` is set. The dispatch order in `calculateAmount` MUST remain:
1. `per_frame` → frames × rate, return
2. `rateCardSnapshot` present → mode-based dispatch (prorated or minimum), return
3. legacy linear + optional rounding
**Files affected:** `src/lib/money.ts` (`calculateAmount`), `src/db/queries.ts` (`stopSession` preview calc).

### Pattern T6 — Snooze must anchor to original fire time, not to user tap time
**Symptom signature:** "I set snooze for 15 min but it took 16 min." Player gets called at wrong intervals. Drift accumulates over multiple snoozes.
**Root cause:** `notifyAtMs = Date.now() + snoozeMs` adds the user's reaction time (seconds between alarm ringing and user tapping Snooze) onto every snooze cycle.
**Rule:** Snooze offsets from the ORIGINAL `notifyAtMs`, not from `Date.now()`. Fallback to `Date.now() + snoozeMs` only when the resulting time would already be in the past (user snoozed long after alarm rang).
**Files affected:** `src/db/queries.ts` (`snoozeNotify`).

---

## Forms & Inputs (validation, adversarial input)

Files most affected: `src/pages/StartSession.tsx`, `src/components/TableFormModal.tsx`, anywhere with `<input>`.

### Pattern F9 — Customer names belong in data, not in UI labels or button text (9 Jun 2026)
**Symptom signature:** A button reads "Start session for Rahul" or a label says "Ball Bender rate card". Staff are confused when a demo account has real names, or a seed-data name appears in a context that shouldn't show it.
**Root cause:** Real customer or club names embedded in UI string templates (`"Use ${customerName}'s rate"`, `"${clubName} preset"`). Seed data with real names (e.g. actual player names) causes those names to surface in UI labels during demos.
**Rule:** UI labels, button text, and preset names must be generic. Use `"Standard preset"`, `"Saved rate"`, `"Your rate card"` — never interpolate real names into action labels. Real names belong only in data display fields (profile headers, session detail, history rows). Seed data for rate cards and presets uses generic label strings (not customer-specific names) even if the seed is based on a real customer's config.
**Files affected:** `src/components/TableFormModal.tsx` (preset button label), `src/db/seed.ts` (seed table names, comments).

### Pattern F8 — Display fallback labels MUST distinguish anonymous from unnamed-but-contactable (30 May 2026)
**Symptom signature:** A customer with a saved phone number is shown as "Walk-in" in the UI. Staff are confused — the customer has contact info.
**Root cause:** Inline fallback chain `customer.name ?? customer.walkInCode ?? 'Customer'` treats "has walkInCode" as the only non-name case. A customer with `phone` set but `name === null` and `walkInCode === null` falls through to 'Customer', which is correct — but the same chain used with `walkInCode` first produces "Walk-in" label for customers who DO have a phone.
**Rule:** Use `customerDisplayName(c)` from `src/lib/customerDisplay.ts` everywhere. The three cases are:
- `c.name` set → use the name
- `c.phone` set, no name → "Customer" (contactable, unnamed)
- neither name nor phone → "Walk-in" (truly anonymous)
Never hard-code these fallback chains inline in components. Centralize in the helper so the rule only needs updating in one place.

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

### Pattern D9 — Dexie boolean index: use `.filter()`, never `.equals(1)` (7 Jun 2026)

**Symptom signature:** `db.table.where('boolField').equals(1)` returns empty even though rows exist with `boolField=true`. Or `.equals(0)` returns empty even though rows exist with `boolField=false`.

**Root cause:** IndexedDB stores JavaScript booleans as actual booleans, not as integers. `.equals(1)` does not match `true`. `.equals(0)` does not match `false`.

**Detection:** Open DevTools → Application → IndexedDB → confirm rows exist with the correct boolean value. Then check the query.

**Fix:** Use `.equals(true)` / `.equals(false)` — OR preferably use `.filter(row => row.boolField === true)` on a non-boolean index:
```ts
// WRONG
db.canteenItems.where('isActive').equals(1).toArray()

// RIGHT — option 1
db.canteenItems.where('isActive').equals(true).toArray()

// RIGHT — option 2 (preferred for small tables)
db.canteenItems.orderBy('sortOrder').filter(item => item.isActive === true).toArray()
```

**Prevention:** When defining Dexie schemas with boolean fields, note "DO NOT use 0/1 in equals()." For small datasets, avoid boolean indexes entirely and use `.filter()` — it's more readable and avoids this footgun.

### Pattern D8 — Page chrome must render from the URL, never from data queries (7 Jun 2026)

**Symptom signature:** Navigating to a page shows only "Loading…" text — no header, no back button, no FAB. The loading state persists even after data loads because the page is stuck in an early return.

**Root cause:** Component returns `<Loading />` (or equivalent) when `useLiveQuery` returns `undefined`, gating the ENTIRE render tree on the data query. `useLiveQuery` always returns `undefined` before the first Dexie result resolves.

**Detection:** Open the route directly. If the header/back-button/FAB are missing from the DOM during loading, chrome is gated on the query.

**Rule:** Always render page chrome unconditionally from the URL. Only the data-dependent section branches on loading/empty/items. Pattern:
```tsx
// CORRECT
export default function MyPage() {
  const items = useLiveQuery(...)  // undefined = loading; [] = empty; [...] = data
  return (
    <div>
      <Header />                           {/* always renders */}
      <StatsRow items={items} />           {/* handles undefined internally */}
      <ListArea items={items} />           {/* skeleton / empty / cards */}
      <FAB />                              {/* always renders */}
    </div>
  )
}

// WRONG
export default function MyPage() {
  const items = useLiveQuery(...)
  if (!items) return <Loading />           {/* blocks ALL chrome */}
  return <div>...</div>
}
```

**Prevention:** When building a new page with `useLiveQuery`, separate the query consumer (a sub-component or section) from the page wrapper. The wrapper renders unconditionally.

### Pattern D7 — Never call a function with its own internal `db.transaction()` from inside an outer transaction (7 Jun 2026)

**Symptom signature:** Stock decrements correctly but the session item is never written. Console error: "Transaction has already completed or failed." Inner write succeeds, outer write silently fails.

**Root cause:** Dexie does NOT support arbitrary nested transactions. When a function that calls `db.transaction('rw', tableA, ...)` is invoked from inside an outer `db.transaction('rw', tableA, tableB, ...)`, the inner transaction commits and closes before the outer can proceed. Any writes in the outer scope that come after the inner call run against the already-closed transaction and fail. This is a **partial write** — the inner write is durable, the outer write is lost.

**Rule:** Never call a function containing its own `db.transaction()` from inside another `db.transaction()`. Inline the inner logic directly into the outer transaction instead. The standalone function can remain for solo use — it is NOT deprecated; just never nest it.

**Correct pattern (AddItemBottomSheet, canteen stock + session item add):**
```ts
// WRONG — decrementCanteenItemStock has its own internal tx
await db.transaction('rw', db.canteenItems, db.sessionItems, async () => {
  await decrementCanteenItemStock(id, qty)  // inner tx commits here — outer is now broken
  await db.sessionItems.add(...)            // fails: "Transaction already completed"
})

// CORRECT — inline the stock logic
let crossingInfo: { oldStock: number; newStock: number } | null = null
await db.transaction('rw', db.canteenItems, db.sessionItems, async () => {
  const fresh = await db.canteenItems.get(id)
  if (!fresh) throw new Error('Item not found')
  const oldStock = fresh.currentStock ?? 0
  const newStock = oldStock - qty
  if (newStock < 0) throw new Error('Insufficient stock')
  await db.canteenItems.update(id, { currentStock: newStock })
  await db.sessionItems.add({ sessionId, name, price, quantity, addedAt: Date.now() })
  crossingInfo = { oldStock, newStock }
})
// use crossingInfo after tx
```

**Files affected:** `src/components/AddItemBottomSheet.tsx` (fixed). `src/db/queries.ts` `decrementCanteenItemStock` kept as-is for standalone use.

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

### Pattern A6 — `subscription_loading` gate prevents race between loading=false and refreshProfile() (7 Jun 2026)

**Symptom signature:** Navigating to a new private route (e.g. `/canteen`) immediately redirects to `/tables`. Happens only on fresh page load or hard refresh, not on SPA navigation. No console errors. Active subscriber affected.

**Root cause:** Race window between `loading=false` (Supabase session resolved) and `refreshProfile()` completing (subscription row fetched from Supabase). During this window `subscription===null`. `useAccessGuard` previously treated `null` subscription as `no_subscription` → redirected to `/subscribe` → `Subscribe.tsx` bounced active users back to `/tables` (which was `document.referrer` or a state-based redirect). Net result: intended route silently overwritten with `/tables`.

**Fix:** `authStore.subscriptionLoaded: boolean` flag. Set `false` on init and sign-out. Set `true` after `refreshProfile()` resolves in BOTH `initialize()` and `onAuthStateChange`. `useAccessGuard` returns `{ canAccess: false, reason: 'subscription_loading' }` while `!subscriptionLoaded`. `RequireAccess` shows spinner for this reason — no redirect.

**Rule:** Any time you add a new async loading flag to `useAccessGuard`, ALWAYS map it to a spinner in `RequireAccess`, never to a redirect. Redirects on transient loading states always cause race-condition bugs.

**Files affected:** `src/store/authStore.ts`, `src/hooks/useAccessGuard.ts`, `src/components/RequireAccess.tsx`.

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

### Pattern S7 — Subscription cancel mode depends on lifecycle state (BUG-025)
**Symptom signature:** Cancel during trial returns 400 "no billing cycle is going on" from Razorpay; user is stuck unable to cancel.
**Root cause:** Razorpay has two cancel modes: `cancelAtCycleEnd=1` (cancel at end of current billing period — requires an active billing cycle) and `cancelAtCycleEnd=0` (cancel immediately — works for pre-charge `authenticated` state). Using `1` for all states fails when no billing cycle has started yet.
**Rule:** In `api/cancel-subscription.ts`, always try `cancelAtCycleEnd=1` first. If Razorpay returns 400 `BAD_REQUEST_ERROR` with description containing `'no billing cycle'`, fall back to `cancelAtCycleEnd=0` (immediate). Update Supabase `status='cancelled', cancel_at_period_end=false` on the immediate path. Never remove the fallback — `authenticated` state is a normal part of every new subscription's lifecycle.

---

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

### Pattern U9 — Native date picker: opacity-0 overlay, NOT clip/sr-only (8 Jun 2026)
**Symptom signature:** Calendar icon button only opens the date picker when tapped on the right ~40% of the icon. Left half does nothing. OR picker opens once and never again.
**Root cause:** Chrome's `<input type="date">` renders an internal calendar icon in its right portion. Clicks on the left portion of the input don't trigger the picker. `clip: rect(0,0,0,0)` or `position:absolute; width:1px; height:1px` (sr-only pattern) tricks Chrome into treating the input as "not user-visible", which silently blocks picker activation even via `label htmlFor` forwarding.
**Rule:** Use an opacity-0 full-size overlay input, NOT a clipped/tiny hidden input:
```tsx
<div className="relative w-11 h-11">
  {/* Label behind — provides the visual icon */}
  <label
    htmlFor={inputId}
    className="absolute inset-0 flex items-center justify-center rounded-2xl bg-bg-card border border-border cursor-pointer ..."
  >
    <CalendarSVG />
  </label>
  {/* Input in front — opacity-0 but real 44×44 element, Chrome accepts it as visible */}
  <input
    id={inputId}
    type="date"
    value={isoValue}
    max={todayISO}
    onChange={handleChange}
    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer [color-scheme:dark]"
  />
</div>
```
**Why it works:** The input is on top in DOM order (later sibling), so direct clicks hit it first and open the picker immediately. The label is a visual fallback. The input has real dimensions (44×44 via `inset-0` inside a sized parent) — Chrome sees it as user-visible.
**Never use:** `showPicker()` (throws NotAllowedError on opacity-0 inputs in some browsers), `clip: rect(0,0,0,0)`, `sr-only` Tailwind class (purged if unused), `pointer-events-none`, or `width:1px; height:1px` patterns.
**Files using this pattern:** `src/pages/Summary.tsx` (SummaryHeader). History.tsx uses plain visible inputs (no overlay needed there).

---

## Modals & Overlays (z-index, escape paths)

Files most affected: `src/components/Modal.tsx`, `src/components/subscribe/PaymentBottomSheet.tsx`, any bottom sheet.

### Pattern M4 — Bottom-sheet modals need 3-region flex layout for mobile scrollability (9 Jun 2026)
**Symptom signature:** On Android Chrome (360–400px), a tall modal's content is cut off at the top — early fields like "Table Name" are unreachable even when scrolling. Scroll-lock applied by the body during modal open makes content above the fold inaccessible.
**Root cause:** `<Modal>` applied `overflow:hidden` to `document.body` (scroll-lock). Without a scroll container inside the modal itself, content that overflows the viewport is permanently hidden — there is no scroll path to reach it.
**Rule:** Bottom-sheet modals must use a 3-region flex layout:
```tsx
{/* Sheet wrapper */}
<div className="fixed bottom-0 left-0 right-0 z-50 bg-bg-elevated rounded-t-3xl border-t border-border flex flex-col max-h-[92vh]">
  {/* Region 1 — title, shrink-0 */}
  <div className="shrink-0 px-5 pt-5 pb-3">
    <div className="w-10 h-1 bg-border-bright rounded-full mx-auto mb-4" />
    <h4 className="text-[18px] font-bold tracking-tight text-text">{title}</h4>
  </div>
  {/* Region 2 — scrollable body, flex-1 */}
  <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-3"
    style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
    {children}
  </div>
  {/* Region 3 — pinned footer (optional) */}
  {footer && (
    <div className="shrink-0 px-5 pt-3 pb-5 border-t border-border"
      style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}>
      {footer}
    </div>
  )}
  {!footer && <div className="shrink-0 h-6" />}
</div>
```
The `footer?: ReactNode` prop allows consumers to pin action buttons outside the scroll container while leaving all other consumers unaffected. Consumers that don't pass `footer` get a `h-6` spacer.
**Files affected:** `src/components/Modal.tsx` (fixed 9 Jun 2026), `src/components/TableFormModal.tsx` (passes `footer={footerContent}`).

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

---

## Subscription / Billing

Files most affected: `api/create-subscription.ts`, `api/cancel-subscription.ts`, `src/lib/razorpayPlans.ts`, `api/_shared/plans.ts`, `src/pages/Subscribe.tsx`.

### Pattern S9 — Use `razorpaySubscriptionId` presence to split trialing sub-states in UI (5 Jun 2026)
**Symptom signature:** After completing UPI mandate setup (₹5 RBI charge), user returns to `/tables` and still sees the "7-day free trial" banner as if nothing happened.
**Root cause:** `subscription.authenticated` webhook writes `status='trialing'` — the same value it was before. `trial_ends_at` is never touched. Banner only checked `status === 'trialing'` with no further differentiation.
**Rule:** When rendering UI that needs to distinguish "trial, no mandate" from "trial, mandate registered (subscribed, waiting for first charge at trial end)", use `razorpaySubscriptionId` as the discriminator — it is written by `create-subscription.ts` when the Razorpay subscription is created, before the mandate is completed. Both sub-states remain `status='trialing'` in the DB until `subscription.charged` fires and sets `status='active'`.
- `status === 'trialing' && !razorpaySubscriptionId` → pure trial, no payment setup
- `status === 'trialing' && razorpaySubscriptionId` → mandate registered, first charge pending at `trial_ends_at`

Never change `status` values or webhook behavior to encode this distinction — `trialing` is the correct Razorpay lifecycle state until the first charge succeeds.

### Pattern S8 — Server reads Supabase as billing source of truth before every Razorpay call (BUG-026)
**Symptom signature:** User with expired trial gets a free fresh 7-day extension on paying; or mid-trial user loses their remaining days on early subscribe.
**Root cause:** `api/create-subscription.ts` computed `start_at` unconditionally from `Date.now()` without reading the existing `trial_ends_at` from Supabase. Every subscribe call reset the trial clock.
**Rule:** Server reads existing `subscriptions.trial_ends_at` via Supabase service role BEFORE calling `razorpay.subscriptions.create()`. Three scenarios:
- `new` — no row → `start_at = now+7d`, write `trial_ends_at = now+7d`
- `mid_trial` — existing future `trial_ends_at` with >60s remaining → `start_at = existing trial_ends_at`, DO NOT overwrite
- `expired` — existing `trial_ends_at` ≤ now+60s → `start_at = now+60s`, write `trial_ends_at = now`

Frontend sends `{ tier, cycle }` only — never timestamps, flags, or scenario intent. `trial_ends_at` is NEVER overwritten if the existing value is in the future and still valid. Scenario is logged to console + stored in Razorpay `notes` for dashboard debugging. Supabase update errors after a successful Razorpay create are logged but not thrown — webhook reconciles DB state when `subscription.authenticated` fires.

---

## Payment & Money invariants

Files most affected: `src/db/queries.ts` (recordSessionPaymentBreakdown, createCanteenSale), `src/components/PaymentSplitSheet.tsx`, `src/pages/SessionDetail.tsx`, `src/pages/QuickSale.tsx`, `src/pages/Summary.tsx`.

### Pattern P1 — `session.amount` is the TIME portion only; the bill total is `session.amount + Σ(sessionItems)` (10 Jun 2026)
**Symptom signature:** Recording a perfectly valid payment breakdown fails with "Breakdown sum ₹X does not match total ₹Y" where Y is suspiciously low (or zero) compared to what the sheet showed.
**Root cause:** A queries-layer invariant check (`cash + upi + wallet === session.amount`) compared the breakdown to `session.amount` alone. But `stopSession` only writes the time-cost portion to `session.amount`; canteen items live in a separate `sessionItems` table. When a brand-new session is stopped fast with items added, `session.amount ≈ 0` and the DB rejects the valid `paymentBreakdown` summing to the item total.
**Rule:** Any check, aggregation, or UI display that needs the BILL TOTAL for a session MUST compute `grandTotal = session.amount + Σ(sessionItems.price × quantity)`. Never use `session.amount` standalone as a bill total. For `recordSessionPaymentBreakdown` this means reading `db.sessionItems.where('sessionId').equals(sessionId)` inside the same transaction and summing. For Summary/Home aggregations the existing `useLiveQuery` already does this via `calculateItemsTotal` — preserve that pattern.
**Where it does NOT apply:** `CanteenSale.total === CanteenSale.subtotal === Σ(items)` — there is no table-time component, so the canteen-sale total is whole. PaymentSplitSheet's `total` prop is the grand total in both cases; the math at the CALL SITE differs.
**Files affected:** `src/db/queries.ts` (`recordSessionPaymentBreakdown`), `src/pages/SessionDetail.tsx` (`finalGrandTotal` computation), `src/components/PaymentSplitSheet.tsx` (the `total` prop).

### Pattern P2 — Single boolean drives status line AND button disabled state (10 Jun 2026)
**Symptom signature:** A payment sheet shows green "✓ Matches total" but the Confirm button is muted/disabled; OR it shows red "₹X over" but the Confirm button is bright accent and clickable. Two indicators contradict each other.
**Root cause:** `disabled={...}` on the button reads one expression; the status-line ternary reads a different expression. Even small drift (one includes `submitting`, the other doesn't; one excludes a guard) produces UI that lies to the user.
**Rule:** Derive ONE boolean (e.g. `canConfirm = matches && !submitting && totalIsValid`) and route BOTH the status line's green-state branch AND the button's `disabled` prop AND the button's className through it. Don't trust `disabled:opacity-40` alone — explicit className branching (`canConfirm ? 'accent...' : 'muted...'`) avoids any state where `disabled=true` but the accent background still leaks through. Add `if (!canConfirm) return` at the top of the handler as defence in depth.
**Rule for stacked error messages:** If a separate `error` state (from a thrown exception) is present, REPLACE the status line — never stack the two. Otherwise the user sees green ✓ alongside a red error and can't tell what's wrong. Clear `error` on any input change so the status line restores.
**Files affected:** `src/components/PaymentSplitSheet.tsx`.

### Pattern P3 — Route param IDs are strings — coerce at the boundary, runtime-guard at queries (10 Jun 2026)
**Symptom signature:** `db.sessions.get(routeId)` silently returns `undefined`; downstream `session?.amount ?? 0` becomes 0; user sees nonsensical errors like "₹X doesn't match total ₹0". OR: random data corruption when a numeric ID stringifies through a code path that wasn't typed.
**Root cause:** `useParams()` from react-router-dom returns route params as strings. Dexie autoincrement primary keys are NUMBERS. `db.sessions.get("2")` does not match the row stored with `id=2` — it returns undefined with no error.
**Rule:** At every component where `useParams` is called, coerce immediately: `const id = Number(rawId); if (!Number.isFinite(id) || id <= 0) renderNotFound()`. Pass the numeric `id` to all downstream calls; never let the string leak. At the queries-layer entry for any function that takes an id, add a runtime guard: `if (typeof id !== 'number' || !Number.isFinite(id) || id <= 0) throw new Error('...')`. TypeScript's `id: number` parameter type is NOT enough — JS callers (or untyped wrappers) can sneak a string past it.
**Files affected:** every page using `useParams` (`SessionDetail.tsx`, `StartSession.tsx`, `WalletTopup.tsx`, `CustomerProfile.tsx`), every queries function taking an autoincrement id (e.g. `recordSessionPaymentBreakdown` runtime-guards at top).

### Pattern P4 — `paymentBreakdown` is set at "Record payment" confirm, NOT at `stopSession` — running and "stopped-but-unrecorded" are distinct states (10 Jun 2026)
**Symptom signature:** Closing the browser tab during the payment sheet leaves the session stopped (`endedAt` set, status `completed`) but with `paymentBreakdown === undefined`. Re-opening the session shows no obvious indication that payment was missed.
**Root cause:** `stopSession` writes `amount` and flips `status`, but does NOT write `paymentBreakdown`. The breakdown is a separate write after the user confirms in the sheet. There's a window where the session is "done playing but not done collecting".
**Rule:** Treat `session.status === 'completed' && paymentBreakdown === undefined` as a valid state, NOT an edge case. SessionDetail auto-resumes the payment flow on mount when this state is detected (ADDENDUM-4). The auto-open `useEffect` must be guarded by both `autoOpenHandled` (run-once per mount) AND `paymentScreenOpen` (don't fight the normal Stop path which already opened the QR screen). Without the second guard, the auto-open fires immediately after a normal Stop, robbing the user of the QR view.
**Aggregation rule:** Any reducer over "sessions paid in cash/UPI/wallet" MUST filter on `paymentBreakdown !== undefined`. Otherwise stopped-but-unrecorded sessions silently contribute 0 to every tile and skew the breakdown.
**Files affected:** `src/pages/SessionDetail.tsx` (auto-resume effect), `src/pages/Summary.tsx` (PAYMENT MODE filter), `src/db/queries.ts` (`getPiggyBalance` filter).

### Pattern P5 — ADDENDUM-5: zero-amount sessions skip the sheet entirely (10 Jun 2026)
**Symptom signature:** Sheet opens for a free session with `total=0`. User sees three steppers at 0/0/0 which already "match" — confusing UX, and possibly a runtime error if any downstream code assumes `total > 0`.
**Rule:** If `finalGrandTotal === 0` at "Record payment" tap (or in the auto-resume path), call `recordSessionPaymentBreakdown(sid, {cash:0, upi:0, wallet:0})` directly and flip the footer to "Done — back to tables". Button label becomes "Mark as paid" when total is 0. PaymentSplitSheet itself also guards with `totalIsValid = total > 0` and renders a "No amount to record" error state if a caller still mounts it with zero total — defence in depth.
**Files affected:** `src/pages/SessionDetail.tsx` (footer + auto-resume effect), `src/components/PaymentSplitSheet.tsx` (totalIsValid guard).

### Pattern P6 — Piggy is a derived value, never a stored column (10 Jun 2026)
**Symptom signature:** Someone proposes adding a `piggy_balance` column or a `piggy_ledger` table to "make the math faster" or "fix a drift". This always introduces sync bugs because three tables already write to piggy (sessions/canteenSales/walletTransactions for cash-in, stockPurchases for cash-out).
**Rule:** `getPiggyBalance()` derives the balance live from the four underlying tables + the two `piggyOpeningBalance` / `piggyStartedAt` settings. Single source of truth = those tables. Do NOT add a stored piggy balance without an explicit decision and a migration plan for every write site.
**Aggregation window invariant:** every "cash collected" sum MUST intersect with `piggyStartedAt`. Same for cash-by-week sums in `Piggy.tsx` — `winStart = Math.max(weekStart, piggyStartedAt)`. NEVER aggregate cash-in from before piggy was started — that's how historic data leaks in and breaks the owner's mental model.
**Files affected:** `src/db/queries.ts` (`getPiggyBalance`), `src/pages/Piggy.tsx` (cash-by-week computation), `src/pages/Summary.tsx` (`cashInOnDate` computation).

---

## Player Hub / Realtime patterns (stubs — fill when real bugs hit)

### R1 — Realtime channel lifecycle
**Symptom signature:** TBD — not yet seen in production.
**Stub note:** Channel is opened in TopBar on mount, closed on unmount. If TopBar remounts (e.g. route change), channel is re-opened. Fallback polling timer may accumulate if realtime never connects. Watch for double-counting of pending intents.

### R2 — Cross-store sync (Supabase ↔ Dexie)
**Symptom signature:** TBD — S4 bug (toggle desync) is the prototype. Supabase write succeeds, Dexie fails (or vice versa) → permanent mismatch.
**Rule (from S4 fix):** For fields that must be consistent across both stores, always write Supabase FIRST. Only write Dexie if Supabase succeeds. Never fire-and-forget a Supabase write when the local Dexie write already happened.

### R3 — Module-level flag not reset on sign-out (_clubSyncDone)
**Symptom signature:** Second user to sign in on the same tab (without full page reload) sees stale club data — wrong slug, wrong acceptsTopups, wrong coin config.
**Root cause:** `_clubSyncDone` in `src/hooks/useLiveData.ts` is module-level. Sign-out + sign-in as a different user does NOT reset it because the module is never re-evaluated.
**Fix (pending):** Reset `_clubSyncDone = false` in the `authStore.signOut()` flow, or move the flag into the effect cleanup properly. See Pending list item 10.

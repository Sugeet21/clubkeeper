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

**Pattern T4 also applies to `useMemo`:** If a `useMemo` calls `getElapsedMs()` or `calculateAmount()` on running sessions, it only recomputes when its dep array object-references change. `useTick()` re-renders do NOT change `detailSessions` or `detailItemsMap` references, so the memo freezes between DB writes. Fix: remove the `useMemo` wrapper so the computation runs inline on every render (fine for small arrays — ≤30 sessions/day). Fixed in Summary.tsx `rankTables` + `bucketByHour` calls (fix #70, 9f7e2aa, 14 Jun 2026).

**Check this pattern anywhere:** aggregate totals on Home (`todayTotal`), any future dashboard widget showing live revenue. In Summary.tsx: `tablesRevenue`, `canteenRevenue`, `totalElapsedMs`, `rankTables`, and `bucketByHour` are all computed inline (no useMemo) so they tick correctly. `topTables` and `hourlyBuckets` also now computed inline after fix #70.

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

### Pattern T9 — Every Summary aggregation must take ALL revenue streams as explicit args (#93, 20 Jun 2026)
**Symptom signature:** Money tiles on `/summary` (headline revenue, canteen tile, PAYMENT MODE, CASH FLOW) show ₹X,XXX and reconcile with the cash drawer. But analytical surfaces — Top Canteen Items / Top Tables / Hourly Heatmap / yesterday-vs-today delta — show smaller numbers that don't add up to the money tiles. Owner spots it as "why isn't the Quick Sale item in Top Items even though I sold it three times today?"
**Root cause:** Revenue in ClubKeeper comes from at least two independent streams — `Session` (table time + `SessionItem` rows) AND `CanteenSale` (walk-in canteen, no session). The money tiles were updated when Quick Sale shipped (Phase 1), but four pure aggregation functions in `summaryMath.ts` (`topCanteenItems`, `bucketByHour`, `rankTables`) and the `dateRevenues` per-date Map in `Summary.tsx` were left taking only `Session[]` / `SessionItem[]`. TypeScript doesn't catch the omission because the function still type-checks; it just silently under-reports.
**Rule:** Any new aggregation in `summaryMath.ts` or `Summary.tsx` MUST take every applicable revenue stream as an EXPLICIT parameter. Today the streams are:
1. `Session.amount` (table time) — completed = stored, running = `calculateAmount(getElapsedMs(s))` in render body per Pattern T4.
2. `SessionItem[]` aggregated via `itemsBySessionId` — canteen sold against a session.
3. `CanteenSale[]` — walk-in canteen, no session, has its own `createdAt`, `total`, `paymentBreakdown`, and `items[]` lines.
4. (Future: booking advances, refunds — add to this list when shipped.)

Default-`[]` the canteen-sales arg on `summaryMath` functions so call sites that genuinely don't have them (tests, history-only screens) can omit, but new Summary code SHOULD pass the array. Empty-state guards in `Summary.tsx` must check BOTH `detailSessions.length === 0` AND `canteenSalesForDate.length === 0` before short-circuiting to zeros.

**Synthetic-row pattern for `rankTables`:** walk-in revenue has no real `tableId`. Use sentinel `WALKIN_TABLE_ID = -1` (real auto-increment ids are positive) and have the consumer (`TopTablesList`) detect it to render a "QS" pill + "N sales" instead of a medal + "sess · avg".

**Load-bearing deploy note:** `dateRevenues` is used by `RevenueDeltas` (yesterday / last week / 7d avg). Adding walk-in revenue to historical day totals will retroactively SHIFT delta percentages on first deploy — owner will see "yesterday was ₹X higher than I remember." This is the bug being fixed, not a regression. Flag it in the issue comment so the owner doesn't think it's a new bug.

**Grep when reviewing any Summary aggregate:**
```bash
git grep -n "canteenSalesForDate" src/pages/Summary.tsx
```
If you wrote a new aggregate and it doesn't appear in that grep, it's almost certainly buggy.

**Files affected (origin fix):** `src/lib/summaryMath.ts` (sig changes for `bucketByHour`, `rankTables`, `topCanteenItems`; export `WALKIN_TABLE_ID`), `src/pages/Summary.tsx` (4 wiring points), `src/pages/summary/TopTablesList.tsx` (synthetic-row render).

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

### Pattern F8 — Validation effect must clear stale error on the pass branch (#105, 21 Jun 2026)
**Symptom signature:** A debounced validation effect like "must be at least N chars / unique / valid regex" shows a stale error after the user has typed past the failing condition. The Save button stays disabled because its `disabled` prop AND's `slugError` (or equivalent) with `checking`. Often paired with an in-flight spinner that never stops.
**Root cause:** The effect's structure looks like `if (syncErr) { setError(syncErr); return } ... start async check`. When `syncErr` was non-null on the previous run, `setError` was called; when it goes null on the next run, the code path that schedules the async check never resets it back to `null` synchronously. The async branch eventually clears it — but only if the async call resolves. If the async check is on the wrong Supabase client (owner client behind an auth lock — see two-client rule in `ripple_effects.md` § Player Hub), or the user is offline, the promise hangs, `checking` stays `true`, and Save is permanently disabled even though the value is fine.
**Rule:**
1. Synchronously call `setError(null)` BEFORE scheduling the async check, in the same branch that determines the input is sync-valid. Don't rely on the async resolution to clear stale state.
2. On empty-input early-return, also reset `checking` and `error`. Bailing without resetting leaks the prior state.
3. Wrap any cross-network availability check in `Promise.race([check, timeout])`. Pick the safe default for the timeout branch — for slug uniqueness, fail-open (treat as available) and let the server's unique constraint be authoritative. For destructive paths, fail-closed.
4. Use a local `cancelled` flag in the async branch so a re-run doesn't setState on a stale closure.
**Files:** `src/pages/PlayerHubSettings.tsx` — slug setup modal effect.
**Test traces to keep:** input goes `"" → "ab" → "abc" → "helloworld" → ""`. Error must be `null → "Must be at least 3 characters" → null → null → null`. Save disabled at every step except `"abc"` / `"helloworld"` (assuming availability ok).

---

## Dexie & Offline state mutations

Files most affected: `src/db/*`, any component that mutates and re-renders.

### Pattern D12 — Dexie `.add()` on plain `id` schema (no `++`) requires caller-supplied key (#107, 24 Jun 2026)

**Symptom signature:** `DataError: Failed to execute 'add' on 'IDBObjectStore': Evaluating the object store's key path did not yield a value.` Always thrown from a `db.<table>.add({...})` call site, never from `update`/`get`.

**Root cause:** Dexie's store string distinguishes `'++id, ...'` (auto-increment integer; caller may omit `id`) from `'id, ...'` (plain primary key; caller MUST supply `id`). Phase B step 1 flipped 4 tables (`gameTables`, `sessions`, `sessionItems`, `canteenItems`) from `++id` to `id` for the UUID migration but the schema change ONLY takes effect — i.e. the v20 block is reached — when a brand-new IndexedDB is created OR when an existing DB upgrades past 19. The first user to hit v20 with empty Dexie immediately blows up at every legacy `.add()` because the caller-supplied id contract is now in force.

**Detection:** Grep for `\.(sessions|sessionItems|gameTables|canteenItems)\.(add|bulkAdd)\b`. Every match is suspect unless it passes an `id` field in the object literal (or, for `bulkAdd`, the rows arrive pre-keyed from elsewhere — e.g. import paths).

**Rule:** Every `.add()` call on the 4 UUID-flipped tables MUST pre-generate the id:
```ts
const id = crypto.randomUUID()
await db.sessions.add({ ...data, id, /* rest */ })
return id
```
Do NOT rely on the `db.x.add(row)` return value to obtain the id post-v20 — generate first, pass into the row, return your generated id. Same applies inside transactions (the `createBackEntry` pattern). The `restoreSessionItem` undo path mints a FRESH UUID — do not attempt to resurrect the deleted row's key, because the old id may now be a number that no longer satisfies the new schema's key path semantics in some edge cases, and Undo doesn't require key continuity (it's anchored on `addedAt`, not `id`).

**`crypto.randomUUID()` polyfill:** installed at boot in `src/main.tsx`. Always available — no need to feature-detect in call sites.

**Ripple (Step 2 DONE, 24 Jun 2026):** All `number | string` transitional types collapsed to `string` across `types/index.ts`, `queries.ts`, `StartSession.tsx`, `SessionDetail.tsx`, `QuickSale.tsx`, `Piggy.tsx`. Dual-accept route parsers removed. Return types for `addOrIncrementSessionItem`, `createBackEntry` narrowed to `Promise<string>`. `CanteenSaleLineInput.canteenItemId`, `StockPurchase.canteenItemId`, `BackEntryInput.tableId` narrowed to `string`. Internal `Map<number,...>` → `Map<string,...>` in `createBackEntry` and `createCanteenSale`. This pattern is fully resolved — no further migration work needed for the 4 UUID-flipped tables.

**Files affected:** `src/db/queries.ts` (8 sites: `addTable`, `startSession`, `addSessionItem`, `addOrIncrementSessionItem`, `restoreSessionItem`, `addCanteenItem`, `createBackEntry` session + items), `src/components/AddItemBottomSheet.tsx` (freeform add). Import path (`src/lib/importEverything.ts`) does NOT need this treatment — exported rows carry their id verbatim.

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

### Pattern P1 — Player-side (public Player Hub) must NOT recompute owner-side derived values from incomplete inputs (#87, 15 Jun 2026)

**Symptom signature:** Player's QR-flow confirmation screen shows the WRONG ClubCoin total. New-customer first top-up displays 'You earned X coins' where X is the tier-tier earning only — welcome bonus / streak bonus / any future engagement bonus silently missing. Owner side shows the correct total. The actual coin balance written to Dexie + Supabase is correct. Only the player-facing display undercounts.

**Root cause:** The player browser is anon — `clubInfo` from `get_club_public_info` exposes only tier config (`coin_tiers_json` + `coins_enabled`). The welcome bonus is gated on `Customer.firstTopupAt` which lives in owner-side Dexie, not visible to the player. PlayerScan calls `coinsEarnedForTopup(amount, clubInfo.coinTiers)` locally — that function ONLY computes tier coins, never adds bonuses. Any owner-side rule that doesn't flow through the public RPC is invisible to the player and produces a stale display.

**Rule (mandatory for any value the player sees that the owner computes):**
1. **Don't recompute on the player side.** The player browser is fundamentally lower-trust and lower-information. Once the owner-side computes the authoritative total in `recordTopupWithCoins` / `recordSessionPaymentBreakdown` / etc., write that total back to a server-readable place (e.g. column on `topup_intents`).
2. Extend the relevant RPC (`get_topup_intent_status` for the confirmation poll; `get_club_public_info` for static config) to return that authoritative value.
3. Player UI displays the server value when present and falls back to a local computation ONLY for forward-compatibility with legacy rows that pre-date the server field.
4. If you add ANY new engagement rule (streak bonus on first-of-day top-up, tier multiplier, surge bonus, etc.) to `recordTopupWithCoins`, audit every player-side display that shows a coin total. Each one needs to read from the server field, not recompute.

**Files where this matters today:**
- `src/pages/player/PlayerScan.tsx` — `confirmed` state (line ~267) and `form` state preview chip (line ~502) both undercount welcome bonus. To be fixed via #87.
- `src/lib/playerHubApi.ts` — `getTopupIntentStatus` return shape needs `coinsCredited` once #87 ships.

**Don't conflate with:** Pattern A7 (auth lock isolation between player and owner clients) — that one is about runtime queue contention. Pattern P1 is about WHO computes derived values: always the owner, never the player.

### Pattern D11 — Dexie `.first()` returns `undefined` for not-found; `useLiveQuery` cannot distinguish loading from not-found (#86, 15 Jun 2026)

**Symptom signature:** A modal row, panel, or button gated on `useLiveQuery(...).first()` shows "Loading…" forever for queries that have zero matches. Works fine for matches. No console error.

**Root cause:** Dexie's `.first()` returns `T | undefined`. It never returns `null`. `useLiveQuery` returns `undefined` while the query is in-flight AND returns the query's resolved value afterwards. For a query that resolves to "no match", the result stays `undefined` forever — indistinguishable from "still loading". Any gate like `const loaded = result !== undefined` is permanently `false` for the not-found case.

**Rule:**
1. Never gate UI on a `useLiveQuery(...).first()` result if "not found" is a valid outcome.
2. If you need three-state loading semantics (loading / found / not-found), use a one-shot `useEffect` with explicit `useState<'loading' | 'found' | 'not-found'>` instead. Dexie's promise resolves to `undefined` for not-found, but inside an effect you can map `undefined → 'not-found'` immediately.
3. If you only need 'is this row present', a `useLiveQuery(() => db.X.where(...).count(), [], 0)` works fine — `count()` always returns a number, never `undefined`.
4. For Confirm/Submit buttons whose handler does its own authoritative DB lookup anyway (e.g. find-or-create), don't gate the button at all — let the handler do the work. The button can render as soon as the row mounts.

**Files where this matters today:** `src/components/PendingTopupsModal.tsx` (fixed via three-state `useState` lookup). Any future modal that previews customer / table / item metadata before action should follow this pattern.

### Pattern D10 — Lifecycle ops over multiple stores must enumerate ALL stores; drift = silent data leak (15 Jun 2026)

**Symptom signature:** A "wipe everything" or "export everything" operation completes without error, but afterwards a subset of data either survives the wipe or never made it into the export. User reports "I reset/exported, but X is still there / missing X." No console error — the op silently does less than its name promises.

**Root cause:** Any function that iterates over Dexie stores by NAME (`db.gameTables`, `db.sessions`, …) is a hardcoded list that drifts the moment a new store is added in a later Dexie version. The new store gets a table object on `db`, but the lifecycle function doesn't know about it. The op succeeds (it does what it lists) and quietly skips the rest.

This has fired twice in this codebase:
- **#78 (14 Jun 2026):** `getAllDataForExport()` listed 3 of 9 stores → backups silently missed customers, wallet, canteen, items, sales, stock purchases. Phone died → customer lost everything because the "backup" was incomplete.
- **#81 (15 Jun 2026):** `resetEverything()` cleared 3 of 9 stores → canteen items, customers, wallet ledger, session items, canteen sales, stock purchases all survived a "Reset everything."

**Rule:** Three functions in this codebase enumerate all Dexie stores — they MUST stay 1:1 with each other AND with the active Dexie version's store list:
1. `resetEverything()` in `src/db/queries.ts` — clear list
2. `getAllDataForExport()` in `src/db/queries.ts` — read list
3. `importEverythingFromFile()` in `src/lib/importEverything.ts` — tx table list + `clear()` Promise.all + `bulkAdd` block + `requiredArrayKeys` shape validator

**When you add a new Dexie store (new `this.version(N).stores({...})`):**
- Update all 3 functions in the SAME commit
- Bump `CURRENT_SCHEMA_VERSION` in `queries.ts`
- Add the field to `ClubKeeperBackupV16` (rename the interface to bump version if needed)
- Add a snapshot measure to `src/lib/__devTools__/importExportRoundTrip.ts` so the dev self-test fails loudly on drift instead of passing while quietly skipping the new store

**Guard rails:**
- Lifecycle wipes (`resetEverything`, `importEverythingFromFile`) MUST pre-check active sessions (`status !== 'completed'`) and throw before opening the tx. Wiping a DB under a running timer corrupts the next timer's math (Pattern T1).
- Both wipes use a single flat `db.transaction('rw', [all stores], …)`. Partial wipe rolls back atomically.
- `seedIfEmpty()` runs AFTER the tx commits — never inside it (the tx might throw and roll back the seed).

**Cross-link:** `ripple_effects.md` → "If you add a new Dexie table" — same checklist. The ripple file is the canonical list; this pattern explains the failure mode if you skip the ripple.

**Files affected:** `src/db/queries.ts` (resetEverything, getAllDataForExport, CURRENT_SCHEMA_VERSION, ClubKeeperBackupV16), `src/lib/importEverything.ts`, `src/lib/__devTools__/importExportRoundTrip.ts`.

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

### Pattern R4 — Never `useState` a value that lives in Dexie settings (#97, 20 Jun 2026)
**Symptom signature:** A settings toggle (Accept Bookings, Accept Topups, etc.) is flipped ON in Settings. Owner navigates to `/tables` (or any other route) and back to Settings — the toggle has reverted to its prior state, even though Dexie still holds the new value. May also appear as a stale value after hard refresh, or as cross-toggle drift when more than one settings field is mirrored locally.
**Root cause:** The component mirrors a ClubSettings field into local `useState` and then "re-syncs" via `useEffect` when the prop arrives. Three sources of truth coexist — `useState`, Dexie via `useLiveQuery`, and (often) Supabase via `getOwnerClub()` — and they race. The local mirror captures whatever `settings` was on first render (frequently `undefined` while `useLiveQuery` is still resolving), the sync effect papers over it most of the time, and the Supabase backfill effect occasionally overwrites a fresh value. Pattern R3 already documented the read-side fix for this specific symptom on the booking toggle; Pattern R4 generalises: the entire `useState`-mirror approach is the bug class.
**Rule:** Settings values are read via `useDexieSetting('fieldName', fallback)` only. No `useState` mirror of any ClubSettings field. No sync `useEffect`. No `getOwnerClub()` backfill effect in render-tree components — device-init handles initial seeding.
**Typing-buffer variant:** for numeric/text inputs the user can clear and retype, keep a local string `useState` for the typing buffer, but source the authoritative number from `useDexieSetting` and re-sync the draft via a one-line effect (`useEffect(() => { setDraft(String(value)) }, [value])`). Commit on blur after parse/validate.
**Files affected:** `src/hooks/useDexieSetting.ts` (new — the hook), `src/pages/PlayerHubSettings.tsx` (refactored for `acceptsTopups`, `acceptsBookings`, `bookingAdvanceAmount`). Coins fields intentionally untouched — atomic multi-field saves + seeding logic make per-field hooks the wrong shape there; see scoping note in PR.
**Caller responsibility:** the hook does not mirror to Supabase. Different settings fields mirror through different RPCs (`updateAcceptsTopups`, `syncBookingConfigBySlug`, `syncCoinConfig`, `mirrorSettingsToSupabase`, …) and several deliberately mirror BEFORE the Dexie write so a failed remote call never produces a desynced local toggle. Wrap `setValue` with the appropriate mirror in the call site.
**Enforcement:**
- Lint: `npm run check:settings` (runs in `prebuild`). Fails the build on `useState(settings?.X)` and `useState(settings.X)` patterns. Script lives at `scripts/check-settings-pattern.mjs`.
- Process: `checklists/new_settings_field.md` must be filled and pasted into the PR description for any new ClubSettings field.
- Exception escape hatch: `// allow-settings-useState: <reason>` on the same line. Use ONLY for atomic multi-field saves (coins). New uses require a comment-justification a human can review in PR. Currently used at exactly one site: the `coinRedemptionModes` initializer in `PlayerHubSettings.tsx`, batched into Dexie via `handleSaveRates` together with `minutesPerCoin`, `rupeesPerCoin`, and `coinExpiryDays`.

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

### Pattern A7 — Public routes must NOT share supabase-js auth lock with owner (#83, 15 Jun 2026)

**Symptom signature:** `/c/<slug>` (PlayerScan) opens in a second tab and hangs forever on "Loading club info…". Hard-refreshing the original owner tab makes it work on next open. Ping-pongs between owner tab and player tab — whichever was just refreshed works, the other breaks.

**Root cause:** Single `supabase` singleton used for BOTH owner-authenticated calls AND anon public RPCs. When the owner tab is initializing or refreshing the session, supabase-js holds an internal auth lock; any public RPC fired from the second tab via the same client queues behind that lock and never resolves. Cross-tab `BroadcastChannel` sync between two clients on the same domain compounds it. PlayerScan's 8s `AbortController` was a no-op because the call was queued inside supabase-js, not in `fetch`.

**Fix (three layers):**
1. `src/lib/supabasePublic.ts` (NEW) — separate anon client with `persistSession: false`, `autoRefreshToken: false`, `detectSessionInUrl: false`. The three public RPC wrappers in `playerHubApi.ts` (`getClubPublicInfo`, `submitTopupIntent`, `getTopupIntentStatus`) use this client. Owner functions in the same file still use the main `supabase` client.
2. `AuthInitializer` and `ExpirySweepRunner` in `App.tsx` skip when `window.location.pathname` starts with `/c/` or `/poster/` (helper `isPlayerHubRoute()`). Player Hub public pages never trigger owner auth.
3. Defence-in-depth: `withTimeout(rpcPromise, 8000, label)` wraps every public RPC so any future supabase-js queue hang surfaces as a typed error (`error.message` ends in `_timeout`), not an infinite spinner.

**Rule:** Any new public, anon-accessible Supabase RPC for Player Hub or future public pages MUST (a) use `supabasePublic`, (b) be wrapped in `withTimeout`, and (c) never appear on a route that also boots owner auth. If a new public route is added, extend the `isPlayerHubRoute()` check in `App.tsx` to include its prefix.

**See also (Chunk 4.3 / #111):** Pattern S16 — the lock is keyed off `storageKey`. The three `auth: false` flags here do NOT change the lock name. `supabasePublic` was given a distinct `storageKey: 'sb-clubkeeper-public'` to make the lock independent at the runtime level instead of relying on the three flags alone. New REST clients with their OWN auth concerns should use the `accessToken` escape hatch (Pattern S16) rather than spawning yet another GoTrueClient.

**Files affected:** `src/lib/supabase.ts`, `src/lib/supabasePublic.ts` (NEW), `src/lib/playerHubApi.ts`, `src/App.tsx`.

### Pattern A8 — Session-scoped realtime must live at the app shell, not on a single page (#83 follow-up, 15 Jun 2026)

**Symptom signature:** A Supabase realtime subscription "works on the page that opened it" but doesn't deliver updates anywhere else in the app. User on `/tables` taps something on another device → the badge in TopBar never updates → user must navigate to `/wallet` (or refresh) to see it. No console error.

**Root cause:** The subscription was opened inside a single page's mount effect (in the original bug, `Wallet.tsx`'s `useEffect`). Navigating away unmounts that effect → `unsubscribeTopupIntents()` fires → channel torn down. Returning to a different route mounts that other route — which has no subscribe call — so updates from Supabase have nowhere to land. TopBar reads `pendingCount` from a Zustand store, but the store is only being written by the wallet page's mount.

**Fix:** Lift any subscription that drives global UI (badges, toasts, notification icons) to a **mount-once bridge component** at the app shell, alongside `AuthInitializer` and `ExpirySweepRunner`. For #83's case: `src/components/TopupRealtimeBridge.tsx`. The bridge:
1. Gates on `dbReady && session && subscriptionLoaded` (Patterns A6 + D6) so it never queries before auth + Dexie are ready.
2. Gates on `!isPlayerHubPath(pathname)` (Pattern A7) so it never runs on `/c/` or `/poster/`.
3. Uses a per-user `activeUserIdRef` to allow re-subscription when a second user signs in on the same tab — same trick that fixed P3 / #53's `_clubSyncDoneForUser`.
4. Reads `location.pathname` via a ref inside the INSERT callback (NOT via effect deps) so it can suppress its toast on `/wallet` WITHOUT tearing down and rebuilding the channel on every navigation.
5. Has a `cancelled` flag in the async setup path so an auth flip mid-flight doesn't leave a leaked channel bound to the old user.

**Rule:** If a feature is supposed to notify the owner regardless of where they are in the app, the realtime subscription MUST live at the app shell. Never inside a page-level `useEffect`. If you're tempted to put `supabase.channel(...)` inside a page, ask: does TopBar / a badge / a toast need to react to it? If yes → mount the bridge in `App.tsx` instead.

**Files affected:** `src/components/TopupRealtimeBridge.tsx` (NEW), `src/App.tsx` (mounted), `src/lib/realtimeTopups.ts` (added optional `onInsert` callback + `TopupInsertEvent` export), `src/pages/Wallet.tsx` (dropped its own subscribe/unsubscribe calls).

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

### Pattern A9 — Custom Access Token Hook reading a table with RLS must be granted BOTH table-SELECT and an auth-admin-scoped policy (#109 BUG-S13, 26 Jun 2026)
**Symptom signature:** Sign-in succeeds. JWT decoded at jwt.io has no custom claims (`user_club_id`, `user_role` missing) even after fresh sign-out/in + GRANT EXECUTE on the hook function. No errors logged. Direct invocation of the hook as `postgres` returns the correct claims (this is the trap — it masks the real bug).
**Root cause:** The hook is `SECURITY INVOKER` by default (Supabase's recommendation). When Supabase Auth invokes it at token-mint time, it runs as `supabase_auth_admin`. The `SELECT FROM users_meta` inside the hook is therefore subject to `users_meta`'s RLS — and the only SELECT policy was `user_id = auth.uid()`. But `auth.uid()` is **NULL** during token minting (the JWT being minted does not exist yet), so the policy matches zero rows. The hook hits `if not found then return event;` and silently returns the bare JWT with no claims added. Direct calls as `postgres` bypass RLS, which is why the standalone test passed and fooled us.
**Rule:** Any access-token hook that reads from a table with RLS enabled needs **two layers, both mandatory**:
```sql
-- Layer (a): table-level GRANT
GRANT SELECT ON public.<table> TO supabase_auth_admin;

-- Layer (b): RLS policy scoped to the auth-admin role only.
-- Does NOT widen access for anon / authenticated.
CREATE POLICY <table>_auth_admin_read ON public.<table>
  AS PERMISSIVE FOR SELECT
  TO supabase_auth_admin
  USING (true);
```
**Do NOT** "fix" this by marking the hook `SECURITY DEFINER` — works for now, but obscures the real access path and creates a much bigger blast radius the moment a new table joins the access-control surface (Phase D staff). The two-layer fix is the Supabase-documented pattern.
**Verification:** Don't trust the in-editor `SELECT add_user_meta_to_jwt(...)` test — it runs as `postgres` and bypasses RLS. The only true proof is decoding a freshly-minted access_token at jwt.io and seeing the claims present. Compare `iat` against the time the policy was applied.
**Self-test for any future hook:** "Will this query return rows when run by `supabase_auth_admin` with `auth.uid()` = NULL?" If no, add the auth-admin policy.

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

### Pattern S6 — Supabase realtime requires both publication membership AND REPLICA IDENTITY FULL (#85, 15 Jun 2026)

**Symptom signature:** Client subscribes to `supabase.channel('foo').on('postgres_changes', { event: 'INSERT', table: 'X', ... })` — SUBSCRIBED status fires, no errors, but **no events ever arrive** when rows are actually inserted into X. Or: INSERTs arrive but UPDATEs deliver an `old` payload that's missing all columns except the primary key, breaking any handler that compares `old.status !== new.status` to drive a state machine.

**Root cause:** Supabase realtime forwards only what the Postgres logical-replication slot publishes. Two independent gates must both pass:
1. The table must be a member of the `supabase_realtime` publication. By default a new table is NOT added. Migrations have to do it explicitly.
2. The table's REPLICA IDENTITY governs what columns appear in `payload.old` on UPDATE/DELETE. The default (`relreplident = 'd'`) is "primary key only". Full row in `old` requires `REPLICA IDENTITY FULL`.

**Verify in two SQL queries:**
```sql
SELECT schemaname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
SELECT c.relname, c.relreplident FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = '<table>';
```
`relreplident = 'f'` means FULL. `'d'` means default (key only).

**Rule:** Any time you write a `supabase.channel(...).on('postgres_changes', ...)` listener for a new table, ship a migration in the SAME PR that contains:
```sql
alter publication supabase_realtime add table public.<table>;
alter table public.<table> replica identity full;  -- only if you read payload.old fields beyond the PK
```
Apply via `mcp__supabase__apply_migration` so the remote DB picks it up immediately. Save the SQL under `supabase/migrations/` for source control.

**Files where this matters today:** `src/lib/realtimeTopups.ts` (topup_intents — fixed via `supabase/migrations/20260615_enable_realtime.sql`). Any future realtime feature on `customers`, `sessions`, etc. needs the same setup.

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

### Pattern R5 — `Number(routeParam)` is a UUID landmine — dual-accept at the boundary (#107, 24 Jun 2026)

**Symptom signature:** Crash on opening a detail route with a UUID id: `DataError: Failed to execute 'get' on 'IDBObjectStore': The parameter is not a valid key`. Stack trace points at the `useLiveQuery(() => db.X.get(...))` call near the top of the component.

**Root cause:** The component does `const id = Number(routeParam)` at the boundary. When the route was created with a UUID (post-Phase-B-step-1 seed pre-assigns UUIDs to `gameTables`, and `startSession` now mints UUID `sessions` ids), `Number("bec04261-...")` evaluates to `NaN`. `db.X.get(NaN)` is invalid in IndexedDB → throws synchronously inside `useLiveQuery` → bubbles to ErrorBoundary. Same trap fires for ANY page that does `Number(useParams().X)` on a now-UUID-keyed table. Worse: the same `Number(session.id)` re-coercion frequently appears 3-4 times deeper in the same file inside action handlers (stop, pay, redeem), each one a separate landmine.

**Detection:** `grep -n "Number\((sessionId|tableId|itemId|id|rawSessionId|rawTableId)\)" src/`. Also grep `Number(session\.id|table\.id|item\.id)` for downstream re-coercions.

**Rule:** Parse route params with a dual-accept guard. A param is a legacy numeric id ONLY if it parses as a positive finite integer AND round-trips as `String(n) === raw`. Otherwise pass through as the UUID string:
```ts
const tid: number | string = (() => {
  if (tableId === undefined || tableId === '') return NaN
  const n = Number(tableId)
  return Number.isFinite(n) && n > 0 && String(n) === tableId ? n : tableId
})()
const tidValid = typeof tid === 'string' ? tid.length > 0 : Number.isFinite(tid) && tid > 0
```
Gate `useLiveQuery` on `tidValid` (return `Promise.resolve(undefined)` when invalid — never call `db.X.get(NaN)`). The downstream Dexie API + every helper in `queries.ts` is widened to `number | string`, so the value flows through unchanged.

**Don't re-coerce downstream.** If you have a loaded row `session` and need its id, pass `session.id!` (or stringify if you need a string specifically, e.g. for `referenceId`). NEVER write `Number(session.id)` inside the same file again — it's the same bug.

**Files affected:** `src/pages/StartSession.tsx`, `src/pages/SessionDetail.tsx`. Clean reference (already string-native): `CustomerProfile`, `WalletTopup`, `Poster`, `PlayerScan`, `BookingScreen`.

**Step 2 evolution:** once the v20 `.upgrade()` callback rewrites all existing numeric rows to UUIDs, the dual-accept can collapse to "treat everything as a UUID string." Until then, keep the round-trip guard — pre-v20 users still have numeric rows for the lifetime of their DB.

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

### Pattern R3 — Local `useState(prop ?? default)` never re-syncs when `prop` arrives later (#97, 20 Jun 2026)
**Symptom signature:** A toggle / form field initializes from a prop or hook value that is initially `undefined`. The toggle shows the default. When the real value arrives a moment later (Dexie's `useLiveQuery` resolves, or a parent fetches), the UI keeps showing the default. Worst variant: owner toggles ON, navigates away, returns, toggle is OFF — but the underlying store has the correct `true`.
**Root cause:** `useState(initialValue)` only reads `initialValue` on the FIRST render. Subsequent prop/hook changes don't propagate into the local state. If the initial value was a default (because the source was loading), the local state is wrong forever — until a write handler happens to overwrite it.
**Rule:** When local state mirrors an async source (Dexie hook, fetched prop, store value), add a `useEffect(() => { if (source !== undefined) setLocal(source) }, [source])` for each field. This is the read-side counterpart to Pattern S4 (write-side mirror discipline). Dexie is the single source of truth for owner-side UI state — never let a stale `useState` initializer override it.
**Counter-example NOT to follow:** "I'll do a mount-effect `getOwnerClub()` and `setLocal(supabase.value)` on remount." That CLOBBERS Dexie with Supabase on every re-mount. Use mount-effect ONLY to backfill Dexie when the Dexie value is `undefined` (fresh device). After that, the sync-from-Dexie effects own the local state.
**Files affected:** `src/pages/PlayerHubSettings.tsx` (acceptsTopups, acceptsBookings, advanceDraft — fixed in 61d4c9f). Watch for this in any component that does `useState(settings?.X ?? default)`.

### Pattern U10 — Save actions must show visible state (BUG-S2, BUG-S8, 20 Jun 2026)
**Symptom signature:** Owner edits a Settings field, tabs out or taps Save. The save succeeds but nothing on screen confirms it. Owner re-edits to be sure, or assumes nothing happened. Or worse: the save button stays bright accent green even when disabled (`disabled:opacity-40` only fades it), looking clickable.
**Rule:** Every save action (button click OR save-on-blur) MUST use `<SaveIndicator>` from `src/components/SaveIndicator.tsx` driven by the `useSaveIndicator()` hook. The component renders 4 states: idle (nothing), saving (spinner + "Saving…"), saved (green check + "Saved", 1.5s auto-dismiss back to idle), error (red icon + message). Never silently mutate Dexie/Supabase without surfacing the state. Disabled buttons use neutral grey (`disabled:bg-bg disabled:text-text-faint disabled:border disabled:border-border`), NEVER faded primary colour — primary colour is reserved for "action available."
**Files affected:** `src/components/SaveIndicator.tsx` (single source), `src/pages/Settings.tsx` (UPI ID + Club Name), and every future save site.

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

### Pattern M5 — Modals with async-loaded content must distinguish "empty" from "still loading" (#88, 18 Jun 2026)
**Symptom signature:** Owner gets a realtime toast ("1 pending — View"), taps it, lands on a list page, taps the badge → modal opens but shows "No pending" empty state. Owner taps badge again — nothing happens. After hard refresh, modal opens correctly with the row inside. Bug symmetric across `PendingTopupsModal` (`/wallet`) and `PendingBookingsModal` (`/bookings`).
**Root cause:** Two effects race. The Zustand badge count (`pendingCount`) updates synchronously from the realtime channel BEFORE the page mounts. The page-mount effect that fetches `pendingIntents` (keyed on `[dbReady, session]`) is async — it takes ~500ms to resolve `getOwnerClub()` + `getPendingTopups(clubId)`. If the owner taps inside that window, the modal opens with `intents=[]` AND `pendingCount > 0`. The empty-state copy ("No pending top-ups") is misleading; the second tap is a no-op because `modalOpen` is already `true`. Hard refresh fixes it because the round-trip completes before any tap.
**Rule:** When a modal's contents are loaded asynchronously by the parent page, the modal must render THREE distinct states, not two:
- `intents.length > 0` → render rows
- `intents.length === 0 && pendingCount > 0` (or equivalent "we know there's something" signal) → render a spinner + "Loading…"
- `intents.length === 0 && pendingCount === 0` → render "No pending" empty state
```tsx
{isLoadingIntents ? (
  <div className="py-8 flex flex-col items-center gap-3">
    <Spinner size={20} />
    <p className="text-text-dim text-sm">Loading pending bookings…</p>
  </div>
) : intents.length === 0 ? (
  <div className="py-8 text-center">
    <p className="text-text-dim text-sm">No pending bookings</p>
  </div>
) : (
  /* rows */
)}
```
The store's badge count IS the source of truth for "is something there?" — trust it over the not-yet-loaded list. Don't conflate "fetch in flight" with "no data."
**Files affected:** `src/components/PendingTopupsModal.tsx`, `src/components/PendingBookingsModal.tsx` (both fixed bc49c59).

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

### Pattern X — Upsert payload drift between insert and update branches (#104, 21 Jun 2026)
**Symptom signature:** A column is set correctly on the first write (insert branch of an upsert), but never updates afterwards. Downstream code that routes by that column starts silently matching zero rows. No error surfaces — the local Dexie write succeeds, the UI reports success, only the Supabase source of truth is wrong. Bug surfaces days later when a second device, the public-facing surface, or a `mirrorToSupabaseBySlug` zero-row warning exposes the divergence.
**Root cause:** Hand-rolled upsert functions with a `if (existing) { .update({...}) } else { .insert({...}) }` shape, where the two object literals were edited at different times. New columns get appended to one branch (usually `insert`) but not the other. The column becomes effectively write-once. #104 was exactly this: `upsertClub` insert included `slug`, update omitted it; re-running setup left the Supabase `clubs.slug` permanently stale.
**Rule:** Any upsert function MUST build a single shared payload object containing every caller-owned column, then spread it into both branches:
```ts
const fields = { col_a: payload.a, col_b: payload.b, ... }
if (existing) {
  await supabase.from(t).update({ ...fields, updated_at: now }).eq('id', existing.id)
} else {
  await supabase.from(t).insert({ ...fields, owner_id: user.id })
}
```
Branch-specific fields (`updated_at`, `owner_id`, server-defaulted columns) stay in their branch; everything caller-supplied goes in `fields`. If the two branches must legitimately differ on a caller-owned column, leave a one-line comment explaining why — silence here is the failure mode.
**Where else this rule applies in this repo:** Today `upsertClub` is the only hand-rolled upsert against `clubs`. All other clubs-row writes go through `mirrorToSupabaseBySlug` (Pattern S11), which only updates and so cannot drift. If any new upsert is added — for `customers`, `topup_intents`, etc. — apply this pattern at write time, not retroactively after a bug report.
**Files affected:** `src/lib/playerHubApi.ts` (`upsertClub`).

### Pattern S11 — All Dexie↔Supabase clubs-row mirrors go through `mirrorToSupabaseBySlug()` (20 Jun 2026)
**Symptom signature:** A new Settings field is mirrored to Supabase via a hand-rolled `.update(...).eq('id', club.id)` or `.not('id', 'is', null)` call. Falls into Pattern P2 (silent fail from id-routing through a stale `getOwnerClub()`) or Pattern S4-style write-order desync within weeks. Sometimes the symptom is invisible — the update silently matches zero rows because RLS narrowed before the write — and the owner only notices when a second device reads the stale row.
**Rule:** Never write `.update({...}).eq(...)` against the `clubs` table directly in feature code. Always go through `src/lib/mirrorToSupabase.ts → mirrorToSupabaseBySlug(label, slug, columns)`. The helper enforces slug routing (not id), post-write `.select('id')` verification, structured warning log on zero-row matches, and returns a typed `MirrorResult` that quality callers can branch on (`if (!result.ok) showToast(...)`). Fire-and-forget callers can ignore the return, but the warning still lands in the console.
**Files affected:** `src/lib/mirrorToSupabase.ts` (single source). Refactored callers: `syncCoinConfig`, `syncTablesJsonBySlug`, `syncBookingConfigBySlug`, `updateClubNameRemote` (signature now takes slug as first arg), `updateAcceptsTopups` (same).
**When the helper does NOT fit:** topup_intents / booking_intents tables (those are routed by `intent.id`, never by club slug). Those mutations stay in `playerHubApi.ts` direct — but they're not mirrors, they're owner-side state changes.

### Pattern S14 — Dexie camelCase row payloads CANNOT be pushed directly to Supabase (Phase C Chunk 4, #110, 26 Jun 2026)
**Symptom signature:** Every outbox row dead-letters with `"Could not find the '<camelCaseField>' column of '<table>' in the schema cache"`. Local Dexie writes succeed, `db._outbox` fills up, force-drain returns the same row count over and over, and zero rows reach Supabase. Found during Chunk 4 owner E2E — first push of a TEST customer failed with `'createdAt'` (and would have failed identically with `lastVisitAt`, `walletBalance`, every other camelCase field).
**Root cause:** The Dexie row interfaces (`Customer`, `Session`, `CanteenSale`, ...) are declared camelCase because that's the TypeScript convention used everywhere in src/. Supabase columns are snake_case because that's the Postgres convention. The Chunk 3 wrappers wrote a literal copy of the Dexie row into `OutboxRow.payload`, and Chunk 4's `SyncRunner.pushOne` originally sent that copy to `supabase.from(table).upsert(payload)` unchanged. PostgREST rejected the unknown columns with the schema-cache error, the runner caught it as a transient failure, exponential backoff ran the full 10 attempts, then the row dead-lettered.
**Rule:** Never call `supabase.from(<synced-table>).upsert(...)` with a raw Dexie row. The only legitimate path is `toSupabaseRow(table, row, clubId)` from `src/db/syncPayloadMapper.ts`, which:
1. Looks up the per-table mapper. If the table has no mapper yet, throws — silent fallthrough would let half-mapped data hit Supabase.
2. Maps every camelCase field to its declared snake_case column.
3. DROPS any Dexie-only field (e.g. `_migrationSeq`, `walkInCode`, `framesPlayed`, engagement timestamps).
4. Converts epoch-ms numbers to ISO strings for `timestamptz` columns.
5. Stamps `club_id` from the JWT `user_club_id` claim (RLS partition key — NOT NULL on every synced table).
**When a new field is added to a Dexie row that should sync:** update the table's mapper in `syncPayloadMapper.ts`. The allowlist is strict — a new field NOT added to the mapper will be silently dropped on push, which is the failure mode to watch for. Test by writing through TestOutbox and confirming the value lands in Supabase.
**When a new synced table is wired up (Chunk 7 work):** add a mapper entry to `syncPayloadMapper.ts`. Until it's wired, every `syncedCreate('that_table', ...)` will throw on drain, which is the intended fail-loud behavior.
**Files affected:** `src/db/syncPayloadMapper.ts` (single source of truth), `src/db/syncClubId.ts` (JWT claim reader), `src/db/syncRunner.ts:pushOne` (call site).
**Watch-out (Chunk 4.2, 26 Jun 2026):** any future test harness or fixture for a synced table MUST use a real `crypto.randomUUID()` for the row `id`. Supabase's `id` column on every synced table is type `uuid` and rejects non-UUID strings (e.g. a `_test_<uuid>` prefix) BEFORE RLS runs, surfacing as `invalid input syntax for type uuid: "..."`. This masks all downstream payload-mapper failures during E2E. Put any "is this a test row?" marker on a free-text column like `name` instead — see `src/pages/__dev__/TestOutbox.tsx` for the canonical `TEST ` name-prefix pattern.

### Pattern S15 — Singleton runner with bare try/finally lock cannot self-heal under React.StrictMode (Phase C Chunk 4.3, #111, 27 Jun 2026)
**Symptom signature:** A module-level singleton runner (`SyncRunner`) uses a boolean `draining` flag to prevent re-entrancy. After a hang in the in-flight async pass, every subsequent `scheduleDrain()` call returns silently at `if (this.draining) return`. PASS is reported (no throw) but `outboxRemaining` never converges. No error, no log, no Supabase request.
**Root cause:** The orphaned promise from a prior pass — created by React.StrictMode dev double-mount, sign-out flip, or any library-level hang — never settles, so the `finally { this.draining = false }` never runs. The boolean lock becomes a tombstone. A bare promise-handle doesn't help either: awaiting a non-settling promise hangs too.
**Rule (3 mandatory layers for any module-level singleton runner with an async drain):**
1. **Per-unit-of-work watchdog**, not per-batch. The watchdog races each pushOne against a 15s `setTimeout` rejecter. Per-batch fires mid-large-backlog and either (a) stacks concurrent drains when the watchdog reset happens before the orphan finishes, or (b) wastes mobile data killing a slow-but-alive HTTP request on Indian 3G (typical round-trip 1-2s, worst-case 5-8s; 15s gives 2× headroom for worst-case and is well under the 30s heartbeat).
2. **Generation counter** bumped on `start()` AND `stop()`. The drainOnce captures the value at entry and bails after EACH await if `myGen !== this.drainGeneration`. Orphans from a prior cycle exit fast at the next post-await guard instead of stacking.
3. **Sign-out cleanup ordering.** `runner.stop()` (which bumps the generation) MUST run BEFORE `closeDb()` so no in-flight drain ever touches a closing DB. Reset every module-level cache that survives a sign-out (`_resetClubIdCache`, `_resetClubSyncSentinel`) in the same place.
**Why a single safety net is not enough:** the watchdog is a hang-detector, not a latency SLA. The generation guard is a re-entrancy killer, not a hang fix. The cache resets prevent stale per-user state on re-sign-in. All three together make the runner truly self-healing — losing any one re-introduces a hang class.
**The watchdog must NEVER fire in normal operation.** If it does on a single-row drain, the deadlock is masked, not fixed — STOP and re-diagnose. Verify by reading the `pushOne DONE ms` timing log added during debug; healthy round-trips are 200-1500ms on localhost, 1-3s on 4G.
**Files affected:** `src/db/syncRunner.ts` (singleton + watchdog + generation), `src/db/syncClubId.ts` (`_resetClubIdCache` export), `src/hooks/useLiveData.ts` (`_resetClubSyncSentinel` export), `src/store/authStore.ts` (sign-out ordering).

### Pattern S16 — supabase-js library-level navigator-lock; userspace fixes alone cannot dislodge it (Phase C Chunk 4.3, #111, 27 Jun 2026)
**Symptom signature:** Sync drain hangs at exactly the per-pushOne watchdog ceiling (15s) on a localhost machine with healthy network. `outboxRemaining` stays > 0, `attempts: 0`, `lastError: null` until eventually `pushOne watchdog timeout (15000ms) on customers/insert` fires. Browser console shows the supabase-js warning `Multiple GoTrueClient instances detected in the same browser context`.
**Root cause:** supabase-js v2 GoTrueClient acquires `navigator.locks` on every `auth.getSession()` call. The lock name is `lock:${storageKey}`. Two GoTrueClient instances sharing the same default storageKey share the same lock — even with `persistSession: false` (that disables writes, NOT lock acquisition). `SupabaseClient._getAccessToken` (line 555 of `node_modules/@supabase/supabase-js/src/SupabaseClient.ts`) calls `this.auth.getSession()` internally on every PostgREST request to attach the Bearer header, so every `.from(...).upsert(...)` re-acquires the lock. Under React.StrictMode dev double-mount (or any orphan-promise scenario), the lock holder is stranded and every subsequent request hangs forever waiting for the lock.

**THE FIRST FIX ATTEMPT WAS INSUFFICIENT — recorded as a lesson:** patching only OUR own call site (`getOwnerClubIdFromJwt` → lock-free read of in-memory `authStore.session.access_token` + synchronous localStorage fallback) plus giving `supabasePublic` a distinct storageKey DID NOT close the deadlock. Verification (Chunk B Round 1) showed `pushOne watchdog timeout` on a single-row drain because supabase-js itself was still re-acquiring the owner client's lock on every REST request. **Fixing only userspace lock acquisitions cannot dislodge a library-level lock.** This is the lesson.

**Real cure — `accessToken` escape hatch (3-client rule):**
- supabase-js's `createClient` accepts an `accessToken: () => Promise<string | null>` option (`SupabaseClient.ts:316-323`). When set, supabase-js routes Bearer retrieval through OUR function and replaces the GoTrueClient with a throwing Proxy. No `getSession()` call anywhere = no lock acquisition.
- Create a dedicated REST-only client for the sync write path (`src/lib/supabaseSync.ts`) configured with `accessToken: async () => readAccessTokenLockFree()`. Constraints (enforced by header + ripple invariants): WRITE-ONLY, used ONLY by `src/db/syncRunner.ts`, no `.auth` access (Proxy throws), no realtime, no reads. The accessToken getter MUST stay lock-free — never add an `await supabase.auth.*` inside it.
- The defense-in-depth layers (lock-free clubId reader, distinct storageKey on `supabasePublic`, per-row watchdog, generation guard, sign-out cleanup) are all KEPT but they are NOT the root-cause fix; the dedicated client is.

**401 retry semantics (mandatory):** if the storage token is stale/expired, supabaseSync cannot refresh it itself (no GoTrueClient). The upsert returns a 401 inside the `{data, error}` shape; `pushOne` throws on `error`; `drainOnce` treats it as a transient failure (`attempts++`, exponential backoff). The MAIN `supabase` client's autoRefreshToken keeps the storage token fresh in the background, so consecutive 401s should NEVER reach the 10-attempt dead-letter threshold in normal operation. Confirm any new REST client built this way preserves this property — instant dead-letter on first 401 would lose rows.

**Three-client rule (was two):**
- `supabase` (`src/lib/supabase.ts`) — owner auth + reads. Default storageKey. Has working `.auth`. Used by `authStore`, every sign-in / out / session read, and any owner-side reads (Chunk 5 SyncReader will decide reads later).
- `supabasePublic` (`src/lib/supabasePublic.ts`) — anon, player-hub RPCs only. Distinct `storageKey: 'sb-clubkeeper-public'`. Per Pattern A7.
- `supabaseSync` (`src/lib/supabaseSync.ts`) — owner data-WRITE only. Lock-free via `accessToken` option. Used ONLY by SyncRunner.

**Files affected:** `src/lib/supabaseSync.ts` (NEW), `src/lib/supabasePublic.ts` (storageKey), `src/db/syncRunner.ts` (import swap), `src/db/syncClubId.ts` (`readAccessTokenLockFree` exported for the new client).

### Pattern S10 — HMAC / token / secret comparisons MUST use `crypto.timingSafeEqual` (#94, 20 Jun 2026)
**Symptom signature:** No user-visible symptom. Code review or external security report flags a webhook / signed-token verifier that uses `===` / `!==` to compare a computed HMAC against a header value.
**Root cause:** JS string and `Buffer` equality short-circuit on first byte mismatch, so the wall-clock duration leaks how many leading bytes matched. With enough samples an attacker can recover the signature byte-by-byte. Practical exploitability is low over the public internet against HMAC-SHA256, but the fix is one line and the cost of getting this wrong on a payments surface is high.
**Rule:** For any equality check on a secret, signature, HMAC, or auth token:
1. Decode both sides to `Buffer` of the SAME length first (e.g. `Buffer.from(hex, 'hex')`).
2. Length-check explicitly and return the failure response — `timingSafeEqual` THROWS on length mismatch, so an unchecked call becomes a 500 instead of a 401.
3. Then call `crypto.timingSafeEqual(a, b)`.
4. Never `===` / `!==` / `Buffer.compare() === 0` for these comparisons.
**Reference implementation:** `api/razorpay-webhook.ts` after a2f122a.
**Where else this rule applies in this repo:** any future `api/*` that verifies a signed header — Razorpay return-url verification, Supabase JWT signatures we ever verify ourselves (today we delegate to `supabase-js`), any WhatsApp / Twilio webhooks if we add them later.
**Policy note attached to this pattern:** external PRs that touch `api/*` are NOT merged. Thank the contributor, close the PR, re-implement the suggestion ourselves if valid. Repo is public; payments surface is high-value.

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

### Pattern P4 — Stop flow is pause-first; "stopped-but-unrecorded" only exists for legacy sessions (10 Jun 2026 → updated 14 Jun 2026, #73+#74)
**Symptom signature (legacy):** Closing the browser tab during the payment sheet left the session stopped (`endedAt` set, `status='completed'`) but with `paymentBreakdown === undefined`. Re-opening showed no indication that payment was missed.
**Old root cause:** `stopSession` wrote `amount` and flipped `status`, but did NOT write `paymentBreakdown`. A gap existed between stop and confirm.
**Fix (14 Jun 2026, commit 69cd1b4 — #73+#74):** The stop flow is now PAUSE-FIRST. Tapping "End Session" → "Stop & Pay" calls `pauseForPayment(sessionId)` — pauses the session and sets `paymentInProgress=true`. The session stays `paused` in Dexie until the staff confirms payment. `confirmPaymentAndStop` is the single atomic write that sets `endedAt`, `status='completed'`, `amount`, `paymentBreakdown`, and `paymentInProgress=false` in one tx. If staff cancels the sheet, `cancelPaymentAndResume` clears `paymentInProgress` and restores `status='running'`.
**Result:** A completed session ALWAYS has `paymentBreakdown` set for sessions stopped after 69cd1b4. The legacy gap is closed for all new sessions.
**Legacy state still exists:** Sessions stopped before `69cd1b4` may have `status='completed'` + `paymentBreakdown === undefined`. The auto-resume `useEffect` in `SessionDetail.tsx` handles BOTH:
- **Case 1 (new):** `status='paused' && paymentInProgress === true` — paused for payment, tab was closed. Auto-opens payment sheet on remount.
- **Case 2 (legacy):** `status='completed' && paymentBreakdown === undefined` — old stop flow gap. Auto-opens payment sheet on remount.
The auto-open `useEffect` is guarded by `autoOpenHandled` (run-once per mount) AND `paymentScreenOpen` (don't fight the normal Stop path). Without both guards, the auto-open fires immediately after a normal Stop, robbing the user of the QR view.
**Aggregation rule:** Any reducer over "sessions paid in cash/UPI/wallet" MUST filter on `paymentBreakdown !== undefined`. Legacy rows without breakdown contribute 0 to breakdown tiles but are counted in revenue totals.
**`paymentInProgress` on TableCard:** A paused session with `paymentInProgress=true` shows "Paying…" badge (accent, pulsing dot) instead of "Paused" — tells staff the session is in payment handshake, not a regular mid-game pause.
**Update 14 Jun 2026 (#75+#76):** `confirmPaymentAndStop` tx MUST list every table touched inside its callback — including `db.settings` (read for rounding). Missing one throws IDBTransaction "objectStore not found" on Confirm (BUG-75). Post-confirm screen uses `confirmedBreakdown.upi` NOT `finalGrandTotal`. If `upi === 0` → "Payment recorded ✓" card, no QR (BUG-76).
**Update 14 Jun 2026 (#77):** Stop flow now skips the pre-record QR screen entirely. `paymentScreenOpen` state is deleted. End Session → `pauseForPayment` → `PaymentSplitSheet` opens immediately. Only the post-confirm screen (`confirmedBreakdown`) renders after Confirm, and only when `breakdown.upi > 0`. `PaymentSplitSheet` lives in the main render tree (not inside a deleted overlay block), gated by `splitSheetOpen`.
**Files affected:** `src/pages/SessionDetail.tsx` (auto-resume effect, `handleConfirmStop` → `pauseForPayment`, `handleCancelPayment`, `confirmPaymentAndStop` call, `confirmedBreakdown` state), `src/pages/Summary.tsx` (PAYMENT MODE filter), `src/db/queries.ts` (`getPiggyBalance` filter, `pauseForPayment`, `confirmPaymentAndStop` tx table list, `cancelPaymentAndResume`), `src/components/TableCard.tsx` ("Paying…" badge), `src/types/index.ts` (`paymentInProgress?` field).

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

### Pattern P2 — Fire-and-forget mirrors must target by slug, not by indirected id (#84, 16 Jun 2026)

**Symptom signature:** Owner-side write to Supabase via a fire-and-forget mirror silently never lands. Column stays at default. No console error. RLS + columns + schema are all correct. The sibling mirror (e.g. `syncCoinConfig`) works.

**Root cause:** Mirror function routed the write as `getOwnerClub() → .eq('id', club.id).update(...)`. `getOwnerClub` is an unfiltered `.maybeSingle()` that depends on RLS narrowing — any transient null-return (auth refresh window, brief session drop, RLS deny on a row the user shouldn't see) makes the helper return null. The mirror exits on `if (!club) return`. The outer catch swallows even that signal. Net effect: write skipped, no log, no failure.

**Rule:** Owner-side fire-and-forget mirrors MUST target the clubs row by `slug` (`.eq('slug', settings.slug)`), matching the proven `syncCoinConfig` pattern. RLS still scopes to the owner's row. No extra round-trip, no extra null-failure surface. Always add `.select('id')` after the update and log a warning when `data.length === 0` so a future silent mismatch surfaces in DevTools instead of staying invisible.

**Anti-pattern:** Never use `getOwnerClub()` to fetch the id and then update by id. The detour costs one network round-trip AND adds a null-failure surface that the catch will hide.

**How to apply:** For any new mirror, look at `syncCoinConfig` first, copy that shape exactly, just swap the columns. If you need a value other than `slug` as the matcher (e.g. owner_id), explicitly include `auth.getUser()` and let exceptions throw — never lean on `getOwnerClub` for a write path.

---

### R3 — Module-level flag not reset on sign-out (_clubSyncDone)
**Symptom signature:** Second user to sign in on the same tab (without full page reload) sees stale club data — wrong slug, wrong acceptsTopups, wrong coin config.
**Root cause:** `_clubSyncDone` in `src/hooks/useLiveData.ts` is module-level. Sign-out + sign-in as a different user does NOT reset it because the module is never re-evaluated.
**Fix (pending):** Reset `_clubSyncDone = false` in the `authStore.signOut()` flow, or move the flag into the effect cleanup properly. See Pending list item 10.

---

## Workflow / Deploy

### Pattern W1 — Localhost shares prod Supabase; a feature can look "working locally / broken on prod" while really running two different code versions (#84, 16 Jun 2026)

**Symptom signature:** Owner reports "the feature works on localhost but the production page still shows nothing / the column stays empty / nothing changes in Supabase." Code on disk is correct. Local test passes. Repeated re-reads of the code find no bug.

**Root cause:** ClubKeeper localhost and `app.handbookhq.in` both point at the same Supabase project (one DB, one set of tables). The commit with the fix was never `git push`ed, or Vercel hadn't finished the deploy, or the production tab's PWA service worker was still serving the previously-cached bundle. Localhost ran the NEW code against the shared DB and worked. Production ran the OLD code against the SAME shared DB and didn't. The DB looks "broken" because the prod page is silently running pre-fix logic.

**Rule (before debugging a "works local, broken on prod" report):**
1. `git log --oneline origin/main..HEAD` — is the fix commit actually pushed?
2. After `git push`, watch the Vercel deploy finish (dashboard, or poll `index.html` for the new bundle hash).
3. On the production tab: hard reload, OR unregister the service worker via DevTools → Application → Service Workers → Unregister, then reload. PWA SWs aggressively cache JS — the new bundle won't reach an already-open tab until the SW updates.
4. THEN reproduce. Only after all three confirm-the-deploy steps pass is it worth re-reading the code.

**Why this keeps biting:** Pending #7 (PWA update banner via `useRegisterSW`) hasn't shipped, so there's no in-app prompt when a new bundle is available. Until S6/Pending-7 ships, this is a per-deploy manual step the owner has to remember.

**How to apply:** Any future bug report that opens with "I just shipped X and prod doesn't work" — FIRST validate the deploy chain (commit pushed → Vercel green → SW refreshed). Do NOT start re-reading source until that's confirmed. Saves hours of phantom debugging.

**Addendum (22 Jun 2026 — localhost variant, post-#106):** The same trap fires on **localhost** when a brand-new Settings surface ships. Owner reported the new Opens at / Closes at selects rendered empty (no options) AND the SaveIndicator stuck on "Saving…". Code on disk was correct; reading the JSX line-by-line found no bug; `OPEN_OPTIONS` / `CLOSE_OPTIONS` were static module-level arrays that could not possibly render empty. Root cause was the dev tab still running the pre-#106 bundle via Vite HMR's module cache + a stale service worker registration from a prior `npm run build` preview. Hard refresh resolved both symptoms instantly.

**Rule (for any brand-new Settings UI surface that looks half-rendered):** Before re-reading the source or filing the bug:
1. Hard refresh the dev tab (Ctrl+Shift+R / Cmd+Shift+R).
2. DevTools → Application → Service Workers → Unregister any `localhost` SW.
3. Restart `npm run dev` (clears Vite's module graph).
4. If the dev server has been running across a `git pull` that bumped Dexie schema or added new ClubSettings fields, also clear IndexedDB for `localhost` (Application → Storage → Clear site data) — `useDexieSetting`'s diag logs and the v(N+1) upgrade path don't fire on a stale DB and can mask a real bug.
5. THEN reproduce. Only after all four pass is it worth re-reading the source.

**Why the localhost variant exists:** `vite-plugin-pwa` registers a service worker in dev for parity with prod. Owner pulls the new commit, but the tab is still controlled by the SW that cached the pre-commit bundle. HMR appears to update — but a fresh module added in the new commit (e.g. the `OPEN_OPTIONS` const) can be silently absent from the running graph if the SW intercepts the JS request and serves stale. Symptom looks like a real render bug because the surface is partially rendered with the new JSX but the new constants are missing.

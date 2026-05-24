# Bug History

Every bug found in ClubKeeper, with root cause and fix. Always check this before suggesting a code change — the bug might have been seen before.

## How to use this file

When Sugeet reports a new bug:
1. Search this file for similar symptoms first.
2. If similar pattern found → apply same fix pattern.
3. If new → fix it, then APPEND a new entry to this file.

Format for entries:
```
### [Date] — [Short title]
**Symptom:** What Sugeet saw  
**Root cause:** Technical explanation  
**Fix:** What was changed and where  
**Lesson:** What to remember to avoid this class of bug  
```

---

### 19 May 2026 — Toggle button misaligned

**Symptom:** Out-of-Service toggle in TableFormModal had knob overlapping the track, looked broken.  
**Root cause:** Built as styled checkbox with hand-rolled CSS, position math was off.  
**Fix:** Rebuilt as a `<button role="switch">` with absolute-positioned knob using `translateX`. Now a reusable `<Toggle>` component.  
**Lesson:** Don't reinvent form controls with checkboxes + CSS. Use semantic buttons with proper ARIA.

---

### 19 May 2026 — Date inputs in History not editable

**Symptom:** Tapping From/To dates did nothing.  
**Root cause:** Dates were rendered as `<div>` not `<input type="date">`.  
**Fix:** Real `<input type="date">` with `[color-scheme:dark]` for theme matching. Use YYYY-MM-DD strings, not Date objects, for state.  
**Lesson:** Use native HTML inputs when possible. They give free mobile keyboards/pickers.

---

### 19 May 2026 — Amount column touching screen edge

**Symptom:** History session amounts had no breathing room from right edge.  
**Root cause:** Container used `px-4` or no horizontal padding.  
**Fix:** Standardized all page-level horizontal padding to `px-5`.  
**Lesson:** Pick one horizontal padding value and use it everywhere. Inconsistent padding looks unprofessional.

---

### 19 May 2026 — Time Rounding setting did nothing

**Symptom:** Set rounding to 15min, stopped a session at 1 min — amount calculated as 1 min, not 15.  
**Root cause:** `applyRounding()` existed in `money.ts` but `stopSession()` never called it.  
**Fix:** In `stopSession()`, read settings, if `billingMode === 'per_hour'` and rounding !== 'none', round elapsed UP to nearest 15/30 min, use rounded value for amount. Store rounded duration in new `roundedDurationMs` field.  
**Lesson:** Settings must actually be plumbed into the action that uses them. Add a test scenario after every settings flag added.

---

### 19 May 2026 — Delete table crashes app

**Symptom:** Tapping Delete on a table → "Cannot read properties of undefined (reading 'name')".  
**Root cause:** After soft-delete, modal stayed open and tried to re-render with deleted table data.  
**Fix:** Close modal IMMEDIATELY via `setEditingTableId(null)` after the action. Add `if (!table) return null` guard at top of modal component.  
**Lesson:** Always close UI before mutating data, OR keep stale data accessible until UI is gone.

---

### 19 May 2026 — "Delete" button label was misleading

**Symptom:** Button said "Delete" but actually soft-deleted (set outOfService). Toggle let users un-delete. Confusing.  
**Root cause:** Inherited from earlier prompt that used "Delete" terminology.  
**Fix:** Renamed to "Disable Table" / "Enable Table" based on current state. Removed redundant "Out of Service" toggle. Single source of truth.  
**Lesson:** Button labels must match what they actually do. If a "Delete" doesn't actually delete, name it correctly.

---

### 19 May 2026 — Edit pencil on disabled table opens broken form

**Symptom:** Disabled tables looked fully faded including the edit pencil. Tapping pencil still worked but form had stale state.  
**Root cause:** `opacity-50` was applied to the entire row, including the action button.  
**Fix:** Apply opacity ONLY to text/info div. Pencil stays full opacity. Form button row is context-aware: shows "Enable Table" when editing a disabled table.  
**Lesson:** Don't fade clickable elements. Either disable them properly (pointer-events-none) or keep them at full opacity.

---

### 19 May 2026 — Calendar date picker had light theme

**Symptom:** Native date picker on Summary opened with white background, jarring against dark app.  
**Root cause:** No `color-scheme: dark` CSS property set.  
**Fix:** Quick fix: add `[color-scheme:dark]` Tailwind class. Better fix: replace with `react-day-picker` themed to match.  
**Lesson:** Native browser UI (date pickers, scrollbars, etc.) needs `color-scheme` for dark mode. Always add it.

---

### 19 May 2026 — Long player name overflows everywhere

**Symptom:** Sugeet tested with 100-char garbage name. Text overflowed Home cards, Session Detail, suggestion chips, and the input itself.  
**Root cause:** No maxLength on input. No truncation in display.  
**Fix:** `maxLength={50}` on input. Validation regex blocking special chars. Truncate + ellipsis in all display contexts via `truncate min-w-0 flex-1`.  
**Lesson:** Every text input needs a maxLength. Every text display needs a max-width with truncate. Plan for adversarial input.

---

### 19 May 2026 — Special characters in player name pollute suggestions

**Symptom:** Garbage characters from testing showed up in recent-players chip list, broke layout further.  
**Root cause:** `getRecentPlayerNames()` returned anything stored, no filter.  
**Fix:** Filter in two places — at query time (skip names that fail validation) and at storage time (validate before save). Also added "Clean Invalid Data" button in Settings to retroactively clean.  
**Lesson:** Validate at write AND read. If validation rules change later, old data may not match — provide a cleanup tool.

---

### 19 May 2026 — Could disable a running table

**Symptom:** User started a session on Pool 1, went to Settings, disabled Pool 1. Pool 1 disappeared from Home. The running session was now orphaned and inaccessible from the UI.  
**Root cause:** No check that the table is in use before allowing disable.  
**Fix:** In TableFormModal, check for active session before allowing disable. Disable button + warning text if blocked. Re-check on submit to handle race conditions.  
**Lesson:** Destructive/state-changing actions must check related data integrity, not just the target entity.

---

## Patterns to Watch For

These are recurring bug classes — be paranoid when these come up:

### Pattern A: Stale data after mutation
After delete/soft-delete, components re-render with the now-missing data. Always close UI BEFORE mutating, OR add null guards.

### Pattern B: Settings not wired to action
A toggle in Settings does nothing because the action code doesn't read the setting. Add a checklist when implementing new settings: where is this read?

### Pattern C: Native HTML controls don't theme
Date pickers, file inputs, select dropdowns, scrollbars — all need explicit theming. Test in actual dark mode.

### Pattern D: Adversarial input
Always assume users will paste 10,000 chars, type emoji, special chars, SQL injection. maxLength + validation + truncation in display.

### Pattern E: Race conditions
Two tabs open, both tap the same button. Or: user taps fast twice. Pre-check + re-check pattern. Or disable button after first tap.

### Pattern F: Timer state from counters
ANY time someone proposes `setInterval` to increment a number — STOP. Use timestamps and derive on render.

---

## Known Limitations (Not Bugs — By Design for Now)

### 21 May 2026 — IndexedDB data is shared across users in same browser

**Symptom:** Two different Google accounts signing in on the same browser see the same tables and session data.
**Root cause:** IndexedDB is per-browser-origin, not per-user. All data in `db.gameTables` and `db.sessions` is completely shared.
**Current state:** Acceptable for v1 — product is single-user (one owner, one device).
**Fix when:** Adding cloud sync (Supabase). At that point, scope all Dexie reads/writes by `userId`. Tables and sessions will need a `userId` field added to the schema (Dexie version bump required).
**Lesson:** Mention this to Sugeet if he ever suggests letting multiple staff log in from one phone — it would cause data confusion until user-scoping is done.

---

---

### 24 May 2026 — BUG-009: handleStop navigated to `/` instead of `/tables`

**Symptom:** Stopping a session via the "Yes, End Session" button navigated back to the root route (`/`) which is the Landing page, not the app's table list.
**Root cause:** `handleStop()` in `SessionDetail.tsx` called `navigate('/', { replace: true })`. The `/` → `/tables` migration from Prompt 9 missed this specific line (line 200 was inside an async try block).
**Fix:** Changed `navigate('/', { replace: true })` → `navigate('/tables', { replace: true })` in `handleStop()`. Confirmed no other `navigate('/')` calls remain in the file.
**Lesson:** When migrating route names, search for ALL occurrences in a file including those inside try/catch blocks. grep for `navigate\('/'` after every route rename.

---

### 24 May 2026 — BUG-011: Session amounts in History and Summary missing Indian formatting

**Symptom:** Session amounts in row-level `SessionRow` components showed raw numbers (e.g. `1500`) instead of Indian-formatted numbers (e.g. `1,500`). Day totals and the Summary hero were already correct.
**Root cause:** `SessionRow` in both `History.tsx` and `Summary.tsx` rendered `{currency}{amount}` with no `toLocaleString`. The aggregate/hero displays had `toLocaleString('en-IN')` but the individual row renders were missed.
**Fix:** Changed `{currency}{amount}` → `{currency}{amount.toLocaleString('en-IN')}` in the `SessionRow` component in both files. Swept entire files to confirm no other raw currency renders remain.
**Lesson:** When adding `toLocaleString` in one place, sweep the entire file for similar patterns. Row-level displays are often added after top-level aggregates and miss the formatting treatment.

---

### 24 May 2026 — BUG-003: PaymentBottomSheet not hidden from screen readers when closed

**Symptom:** The payment bottom sheet was visually hidden via `translateY(100%)` when closed, but `role="dialog" aria-modal="true"` still announced it to screen readers as an open dialog.
**Root cause:** No `aria-hidden` attribute on the dialog div when closed; screen readers could still focus into the sheet's content.
**Fix:** Added `aria-hidden={!open}` and `tabIndex={open ? 0 : -1}` to the outer dialog div. Visual translateY animation is unchanged. When `open=false`, `aria-hidden=true` hides all descendants from the accessibility tree.
**Lesson:** Visual-only show/hide (translateY, opacity) doesn't hide content from screen readers. Always pair with `aria-hidden` for dialog/sheet components that slide in/out.

---

### 24 May 2026 — BUG-001: FAQ accordion content not hidden from accessibility tree when collapsed

**Symptom:** Collapsed FAQ answer panels were visually hidden via `maxHeight: 0` but still readable by screen readers and accessible via Tab key.
**Root cause:** No `aria-hidden` or `inert` attribute on the content div when collapsed.
**Fix:** Added `aria-hidden={!isOpen}` and `inert={isOpen ? undefined : ''}` to the collapsible content div. Also added `inert` to `React.HTMLAttributes<T>` in `vite-env.d.ts` so TypeScript accepts it (React 18 doesn't include `inert` natively). The `maxHeight` transition is unchanged.
**Lesson:** `maxHeight: 0` / `overflow: hidden` is CSS-only — it doesn't affect the accessibility tree. For interactive collapsibles, always add `aria-hidden` + `inert` to the hidden content.

---

### 24 May 2026 — BUG-008: Player name input silently truncated at 50 chars

**Symptom:** If a player name was longer than 50 characters, the `maxLength={50}` HTML attribute silently cut the input at 50 with no feedback to the user. The validation error message was never shown because the input never actually exceeded the limit.
**Root cause:** `maxLength={PLAYER_NAME_MAX}` on the `<input>` meant the browser truncated before React's `onChange` could fire with the full value, so `validatePlayerName()` never received a >50-char string.
**Fix:** Removed `maxLength={50}` from the player name input. The existing `validatePlayerName()` check in `handlePlayerNameChange()` now correctly fires and sets `playerNameError` when length > 50, the error message displays under the input, and `disabled={... || Boolean(playerNameError)}` on the submit button blocks submission. Removed unused `PLAYER_NAME_MAX` import to satisfy `noUnusedLocals`.
**Lesson:** `maxLength` silences the user without feedback. Always prefer explicit validation that shows an error message. The submit disable + error message is the correct UX — `maxLength` fights against it.

---

### 24 May 2026 — BUG-013: Subscription section hidden when subscription state is null

**Symptom:** On the Settings page, the entire "Subscription" section was invisible when auth was still loading or when `refreshProfile()` hadn't completed yet. Users saw no subscription info at all during load.
**Root cause:** The render condition was `{subscription && subscription.status !== 'none' && (...)}`. When `subscription` is `null` (the initial state in authStore before `initialize()` resolves), the condition short-circuits and renders nothing.
**Fix:** Changed to a ternary: when `subscription === null` show a `<Section title="Subscription">` with "Loading subscription…" text; when `subscription.status !== 'none'` show the full subscription details; else render `null`. The section position is preserved in both states.
**Lesson:** Don't `&&`-gate entire UI sections on async state — it causes invisible layout jumps. Show a loading placeholder in the same position so the page layout is stable.

**BUG-013 resolved (24 May 2026). Decision: option (b).** For `status='none'`, `Settings.tsx` now renders a "No active plan, Subscribe →" card instead of hiding the section. Better UX (no blank space) + conversion nudge for unsubscribed users. The final three branches are: `null` → loading placeholder, `status !== 'none'` → full subscription detail UI, else (`status='none'`) → subscribe CTA card.

---

---

### 24 May 2026 — BUG-005: FilterPills below 44px touch target

**Symptom:** Game-type filter pills (All / Pool / Snooker / Carrom / PlayStation) on the Home screen were ~24px tall — too small for reliable tapping on mobile.
**Root cause:** `py-1.5 px-3` gave only ~24px height on a 12px font; no `min-h` constraint.
**Fix:** In `src/components/FilterPills.tsx`, replaced `py-1.5 px-3` with `min-h-[44px] px-4`. Active accent styling and count badge untouched.
**Lesson:** Pills/chips are interactive — they need the same `min-h-[44px]` as buttons. `py-*` alone is unreliable; always anchor with `min-h`.

---

### 24 May 2026 — BUG-006: TopBar settings gear button below 44px touch target

**Symptom:** Settings gear icon in TopBar was `w-9 h-9` (36×36px) — below the 44px minimum.
**Root cause:** `w-9 h-9` = 36px, no `min-w`/`min-h` override.
**Fix:** In `src/components/TopBar.tsx`, changed `w-9 h-9` → `w-11 h-11` (44px). SVG icon size (20px) unchanged.
**Lesson:** Icon-only buttons sized purely by `w-N h-N` Tailwind shorthand are easy to miss. Always check that N ≥ 11 (44px) for touch targets.

---

### 24 May 2026 — BUG-010: SessionDetail "Home" back button and pencil edit button below 44px

**Symptom:** The "← Home" back button was ~32px tall (`py-1.5`); the pencil edit button was 34×34px (`p-2` around an 18px icon).
**Root cause:** Both used padding-based sizing with no `min-h`/`min-w` floor.
**Fix:** In `src/pages/SessionDetail.tsx`:
- "Home" button: replaced `py-1.5` with `min-h-[44px]`
- Pencil button: replaced `p-2` with `min-w-[44px] min-h-[44px] flex items-center justify-center`
Icon sizes and dark-theme colours unchanged.
**Lesson:** Back-nav buttons and icon-only action buttons in page headers are the most commonly missed touch-target failures. Add `min-h-[44px]` as a default for any header button.

---

### 24 May 2026 — BUG-007: StartSession "Back" chevron and recent-name chips below 44px

**Symptom:** The "← Back" button on StartSession was ~32px tall; recent-player-name suggestion chips used `py-1` (~28px).
**Root cause:** Same `py-1.5` pattern as other back buttons; chips used `py-1` with no min-h.
**Fix:** In `src/pages/StartSession.tsx`:
- Back button: replaced `py-1.5` with `min-h-[44px]`
- Name chips: replaced `py-1` with `min-h-[44px] flex items-center`
**Lesson:** Suggestion chips are tapped frequently — they need the same 44px floor as navigation buttons.

---

---

### 24 May 2026 — BUG-012: Modal overlay blocks clicks + missing Escape close + scrim z-index

**Symptom:** (a) Pressing Escape did not close any modal — the handler simply wasn't there. (b) The Modal scrim (`absolute inset-0`) and sheet (`relative z-10`) shared the same parent `fixed inset-0` container, causing the scrim to sit ON TOP of the sheet's clickable area in certain browser hit-test scenarios (confirmed by Playwright test: "scrim subtree intercepts pointer events"). (c) After close, no leftover DOM — `if (!open) return null` handled that correctly.
**Root cause (found):** Two issues: (1) No Escape key handler at all. (2) The layout used `fixed inset-0 flex items-end` wrapping both an `absolute inset-0` scrim child and a `relative z-10` sheet child — the scrim's `absolute inset-0` expands to fill the whole parent including the sheet region, and stacking context tie-breaking caused the scrim to intercept pointer events on the sheet.
**Fix:** `src/components/Modal.tsx` — complete restructure:
1. Added `useEffect` for Escape key: `document.addEventListener('keydown', handler)` with cleanup, dep `[open, onClose]`
2. Restructured layout: scrim is now `fixed inset-0 z-40` (independent fixed layer), sheet is `fixed bottom-0 left-0 right-0 z-50` (independent fixed layer). No shared container. Scrim has higher z-index than body but lower than sheet.
**Cleanup code:**
```
useEffect(() => {
  if (!open) return
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose()
  }
  document.addEventListener('keydown', handleKeyDown)
  return () => { document.removeEventListener('keydown', handleKeyDown) }
}, [open, onClose])
```
**Lesson:** Never nest `absolute inset-0` scrim as sibling of interactive sheet content. Always use two independent `fixed` layers with explicit z-index separation so stacking context never creates a pointer-events conflict.

---

### 24 May 2026 — BUG-004: Home FAB navigated to /settings instead of opening Add Table modal

**Symptom:** The `+` FAB button on the Home screen (`/tables`) navigated to `/settings` instead of opening an inline Add Table modal. Users had to navigate away from Home to add a table.
**Root cause:** The FAB `onClick` was hardcoded to `navigate('/settings')` — the Add Table functionality existed only inside Settings. There was no `/add-table` route; this was purely a navigation choice from early development.
**Fix:** `src/pages/Home.tsx` — three changes:
1. Added `import { TableFormModal }` 
2. Added `const [addTableOpen, setAddTableOpen] = useState(false)`
3. FAB `onClick` → `setAddTableOpen(true)`; added `<TableFormModal open={addTableOpen} onClose={() => setAddTableOpen(false)} existingTables={tables} />` at end of JSX
**Result:** `+` opens an inline modal on Home. Settings still has its own `+ Add Table` button — both work independently. No orphaned route was found.
**Lesson:** FABs on a list/grid page should open inline modals, not navigate away. Navigation-on-FAB breaks the user's mental model (they expect to stay on the page).

---

---

### 24 May 2026 — BUG-002: authStore.refreshProfile() fires twice on every page load (over-fetch)

**Symptom:** On every page load (any route), Supabase `profiles` and `subscriptions` tables were each queried twice (4 total requests in prod, 8 in dev with StrictMode). Visible as duplicate Supabase REST calls in DevTools Network tab.
**Root cause:** `initialize()` calls `refreshProfile()` once (#1), then immediately registers `supabase.auth.onAuthStateChange`. Supabase fires a synthetic `INITIAL_SESSION` event synchronously on listener registration, which triggers `refreshProfile()` a second time (#2) within milliseconds. In React 18 StrictMode (dev only), each `useEffect` runs twice, doubling the count to 4×.
**Fix:** Added `_lastFetchedAt: number` (epoch ms, default 0) to `AuthState`. `refreshProfile()` now accepts `force?: boolean` param. On non-forced calls, it no-ops if `Date.now() - _lastFetchedAt < 3000ms`. `_lastFetchedAt` is set to `Date.now()` before the fetch. Changed two legitimate post-action calls to use `force=true`:
  - `Subscribe.tsx:128` — post-payment Razorpay handler: `refreshProfile(true)` (already has 1500ms delay so dedup guard would catch it otherwise)
  - `Settings.tsx:185` — post-cancel-subscription API call: `refreshProfile(true)` (real server mutation, must always refetch)
**Files changed:** `src/store/authStore.ts`, `src/pages/Subscribe.tsx`, `src/pages/Settings.tsx`
**Request count:** was 4 per page load (prod), now 2 (1 profile + 1 subscription). Dev was 8, now 2.
**Option chosen:** Option 2 — `lastFetchedAt` timestamp guard in authStore. Selected over Option 1 (centralize) because Settings and Subscribe legitimately need forced refreshes after server mutations. Selected over Option 3 (useRef per consumer) because the source of duplication is inside authStore itself, not at component level.
**Lesson:** Supabase always fires a synchronous `INITIAL_SESSION` event on `onAuthStateChange` registration when a session already exists. Any code that calls refreshProfile before registering the listener AND inside the listener will always double-fetch.

---

---

### 24 May 2026 — BUG-015: Google OAuth auto-selects account — no picker shown

**Symptom:** In a Chrome profile already signed into Google, clicking "Sign in with Google" on /signup immediately picks the most-recently-used Google account without showing the account picker. Users with multiple Google accounts can't choose. First-time users on shared devices get the wrong account.
**Root cause:** `supabase.auth.signInWithOAuth` was called without `queryParams: { prompt: 'select_account' }`. Google's default behavior skips the picker if a recent session exists.
**Fix:** Added `queryParams: { prompt: 'select_account' }` to the `options` object in `authStore.ts:signInWithGoogle()`. One-line change.
**Files changed:** `src/store/authStore.ts`
**Lesson:** Always pass `prompt: 'select_account'` for Google OAuth in apps where the user might have multiple Google accounts, or be on a shared device.

---

### 24 May 2026 — BUG-016: PaymentBottomSheet traps user with no escape

**Symptom:** After clicking "Select Standard" → payment sheet opens → user has no intuitive way to dismiss it. ESC key did nothing. Backdrop click worked but wasn't obvious. X button existed but lacked visual weight. No "safe exit" button at all.
**Root cause:** (1) No ESC key listener in PaymentBottomSheet. (2) X button had no background fill — visually weak. (3) No explicit "I'm not ready" button — users who changed their mind felt trapped.
**Fix (multi-path escape design):**
1. `PaymentBottomSheet.tsx` — added `useEffect` ESC key listener (same pattern as BUG-012 Modal fix). Fires only when `open=true` and `!paying`.
2. X button — added `bg-zinc-800/50 rounded-full` for visual weight; added `disabled={paying}` guard.
3. Backdrop click — already existed in `Subscribe.tsx` overlay div (`!paying && setSheetOpen(false)`).
4. "Maybe later" button — added at bottom of sheet footer, `min-h-[44px]`. Calls `onMaybeLater` prop.
5. `handleMaybeLater()` in `Subscribe.tsx` — closes sheet, sets `selectedPlan` to `null`, clears error.
6. `StickyCheckout` — updated to accept `PlanId | null` and renders `null` when no plan selected (hides checkout bar).
7. `PlanSelection` — updated `selectedPlan: PlanId | null` prop type.
8. Body scroll lock already handled by `sheetOpen` useEffect in Subscribe.tsx — unchanged.
**Files changed:** `src/components/subscribe/PaymentBottomSheet.tsx`, `src/pages/Subscribe.tsx`, `src/components/subscribe/StickyCheckout.tsx`, `src/components/subscribe/PlanSelection.tsx`
**Lesson:** Any bottom sheet that appears over content must have ≥3 independent escape paths: X button, ESC key, backdrop click. If the action is financially consequential (payment), add a 4th explicit "exit without committing" button.

---

### 24 May 2026 — BUG-017: Payment click spins forever + cryptic JSON error

**Symptom:** Clicking "Start Free Trial" (with `npm run dev`, no vercel dev) → indefinite spinner → `SyntaxError: Unexpected end of JSON input` → user completely trapped (no retry, no exit info).
**Root cause:** (1) No timeout on the `fetch` to `/api/create-subscription` — hung forever when the endpoint returned an empty 404 body (Vite doesn't serve api/* routes). (2) `await res.json()` was not wrapped in try/catch — 404 returns empty body, `.json()` throws `SyntaxError`. (3) No 404-specific message to guide the developer.
**Fix:**
1. Added 15-second `AbortController` timeout to the fetch call. On `AbortError`, throws a user-friendly timeout message.
2. Wrapped `res.json()` in try/catch at two points: the error body parse and the success body parse.
3. Added explicit `res.status === 404` branch: throws the message "Backend payment service is unavailable. If you're testing locally, run `vercel dev` instead of `npm run dev`. If you're on production, contact support."
4. Generic `!res.ok` path: tries to parse error body, falls back to "Payment failed. Please try again or contact support."
5. Added "Retry" button inline in the payError block inside `PaymentBottomSheet` — calls `onRetry` prop → `handleRetryPayment()` in Subscribe.tsx (clears error + re-calls handlePayNow).
6. "Maybe later" button (from BUG-016) always visible below error → user can exit if they don't want to retry.
**Files changed:** `src/pages/Subscribe.tsx`, `src/components/subscribe/PaymentBottomSheet.tsx`
**Lesson:** Every fetch call needs: (a) AbortController timeout, (b) HTTP status checks before `.json()`, (c) try/catch around `.json()` itself, (d) env-specific error messages for 404 (very common in local dev with serverless functions). Spinners must always have an exit path.

---

---

### 25 May 2026 — BUG-018: Razorpay 400 "The ID provided is invalid or could not be found"

**Symptom:** `/api/create-subscription` returned HTTP 500. Frontend showed generic "Payment failed" error. Vercel function logs showed Razorpay API responding 400 with description "The ID provided is invalid or could not be found."
**Root cause:** The 6 plan IDs in `src/lib/razorpayPlans.ts` were created in a *different* Razorpay test account than the one whose keys (`VITE_RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`) were set in Vercel env vars. Razorpay accounts (test and live) are fully isolated — a key from account A cannot resolve plan IDs from account B, even if the plan ID string is valid.
**Diagnostic that found it:** Catch block in `api/create-subscription.ts` patched to log `JSON.stringify(err, null, 2)` (commit `7ad20b1`). Vercel function logs exposed the raw Razorpay 400 response body with the real description.
**Fix:** Recreated all 6 plans inside the same Razorpay account that owns the active API keys. Replaced the 6 plan IDs in `src/lib/razorpayPlans.ts` with the newly-created IDs.
**Related:** BUG-019 (server/frontend error shape mismatch that hid this error).
**Lesson:** After any key rotation or account change, verify key+plan pairing with: `curl -u KEY_ID:KEY_SECRET https://api.razorpay.com/v1/plans/PLAN_ID`. 200 = same account. 400 = mismatch. See Pattern S5.

---

### 25 May 2026 — BUG-019: Server/frontend error response shape mismatch

**Symptom:** Frontend showed the old generic "Payment failed. Please try again or contact support." even after the server was patched (commit `7ad20b1`) to return real Razorpay error details.
**Root cause:** The server's error responses used the field name `error` (e.g. `{ error: 'Failed to...' }`) but `Subscribe.tsx`'s `handlePayNow()` reads `.message` from the response body. The real Razorpay description was thrown away by the destructure and the frontend fell back to its own hardcoded string.
**Fix:** Server `api/create-subscription.ts` now returns `{ message, code, razorpayStatus }` on all error paths. Field name `message` matches what the frontend reads. Aligned as part of commit `b99388b`.
**Lesson:** Any API route that wants to surface server-side error detail to the user must use the exact same field name the frontend reads (`message`, not `error`). Document the success + error JSON shape in a comment at the top of each `api/*.ts` file. See Pattern S6.

---

### 25 May 2026 — BUG-020: Auth hang on /auth/callback if refreshProfile throws

**Symptom:** After Google OAuth succeeded (URL contained valid `access_token` in hash fragment), the app was stuck on "Signing you in…" indefinitely. No navigation to `/subscribe` or `/tables`. Refreshing the page was the only escape.
**Root cause:** `authStore.initialize()` had no `try/catch/finally` around `set({ loading: false })`. If `refreshProfile()` threw for any reason (network blip, Supabase RLS error, bad response), the exception propagated up and `loading` stayed `true` forever. `AuthCallback` gates all navigation on `if (loading) return`, so it would never navigate — permanent hang.
**Fix:** Wrapped the body of `initialize()` in `try/catch/finally`. Moved `set({ loading: false })` into the `finally` block — it now fires unconditionally regardless of what throws. Commit `b99388b`.
**Files changed:** `src/store/authStore.ts`
**Lesson:** Any async store initializer that gates UI via a loading flag MUST use `try/finally` to guarantee the loading flag resets. A single unhandled throw can permanently freeze the UI. See Pattern A5.

---

### 25 May 2026 — BUG-021: Razorpay 400 "ID not found" — mode-mismatch variant (TEST key + LIVE plan IDs)

**Symptom:** Same surface as BUG-018 — `/api/create-subscription` returns HTTP 500, frontend shows "Payment failed". Vercel logs: Razorpay 400 `statusCode`, description "The ID provided is invalid or could not be found."
**Variant:** Mode-mismatch. Keys in Vercel were TEST (`rzp_test_...`) but the plan IDs in `razorpayPlans.ts` were LIVE plans (created under a different Razorpay mode). Razorpay TEST and LIVE modes are fully isolated universes — plans created in LIVE mode are invisible to TEST keys, and vice versa.
**Root cause:** After fixing BUG-018 (account-mismatch), new TEST-mode plan IDs were needed. LIVE plan IDs were left in code. TEST key can't see LIVE plans — same 400 error, different axis of isolation.
**Fix:**
1. Created 6 fresh TEST-mode plan IDs in Razorpay dashboard.
2. Refactored `src/lib/razorpayPlans.ts` to define `TEST_PLANS` and `LIVE_PLANS` as separate `const` objects, then auto-select based on key prefix:
   ```ts
   const isTestMode = keyId?.startsWith('rzp_live_') !== true
   export const PLANS = isTestMode ? TEST_PLANS : LIVE_PLANS
   ```
3. Created `api/_shared/plans.ts` — server-side mirror (uses `process.env`, same auto-select logic). `api/create-subscription.ts` now imports from `_shared/plans.ts` instead of `src/lib/razorpayPlans.js`.
4. `getPlanId()` signature unchanged — zero changes needed in callers.
5. `console.warn` at module load if `VITE_RAZORPAY_KEY_ID` is missing or has unexpected prefix.
**Files changed:** `src/lib/razorpayPlans.ts` (refactored), `api/_shared/plans.ts` (new), `api/create-subscription.ts` (import swap)
**Permanent fix guarantee:** Switching Vercel env between TEST and LIVE mode now requires zero code changes. Set `rzp_test_...` keys → TEST_PLANS auto-selected. Set `rzp_live_...` keys → LIVE_PLANS auto-selected.
**Lesson:** Razorpay has two orthogonal isolation dimensions: (1) account isolation (BUG-018), (2) mode isolation (this bug). Pattern S5 now covers both. The canonical fix is the auto-select pattern — it eliminates the entire class of mode-mismatch bugs forever.
**See:** Pattern S5 (updated to cover mode isolation).

---

## Open Issues / Not Yet Reproduced

(Move here when Sugeet reports something but it can't be reproduced. Revisit later.)

(none currently)

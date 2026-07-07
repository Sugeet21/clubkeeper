# Decisions — Active

Currently-load-bearing decisions affecting the codebase. Each entry is one line of decision + brief why + revisit trigger (when relevant).

For rejected ideas, historical decisions that have been superseded, and full reasoning of why alternatives were rejected, see `decisions_archive.md`.

---

## Stack & Architecture

- **Vite + React 18 + TS + Tailwind v3.4 + Dexie + Zustand + react-router-dom v6 + vite-plugin-pwa** — beginner-friendly, PWA = no app stores, free Vercel hosting, one codebase for Android + iOS. Revisit if Play Store presence becomes important.
- **Tailwind locked to v3.4** — v4 breaks PostCSS in test runs. Revisit when v4 ecosystem stabilizes (~6-12 months).
- **Offline-first via Dexie/IndexedDB** — Indian clubs have terrible WiFi; Dexie stays the source of truth on device. **The "no backend / defer sync until 3+ asks" half of this decision is SUPERSEDED (25 Jun 2026):** owner green-lit the multi-device sync project at 2 asks (Ball Bender pressure); Phase C sync is shipped and live. Offline-first itself is unchanged — the app must keep working with zero connectivity.
- **Skill-based project memory** — multiple reference files (architecture, design, bugs, business, etc.) survive across AI sessions. Revisit if updates aren't happening.

## Data model rules

- **Soft delete only.** `outOfService: true`, never delete rows. Historical sessions reference `table_id`. Acceptable storage cost.
- **Rate snapshot per session.** Each session stores its own `rateSnapshot` at start. Editing a table's rate later does NOT change in-progress sessions. **Load-bearing correctness — never revisit.**
- **Timer derived from timestamps.** `Date.now() - startedAt - pausedTotalMs`, recomputed every render. **Load-bearing — never revisit.**

## UX & visual rules

- **Mobile-first, 360px width.** Desktop shows the same layout in a centered column. Revisit when admin dashboard becomes needed.
- **Indian Rupee `₹` only.** No multi-currency. Revisit only for international expansion (not v1/v2).
- **Dark theme only for v1.** Clubs are dimly lit, easier on eyes. Revisit if strong customer feedback or premium "white-glove" tier wants light theme.
- **Player name: max 50 chars, alphanumeric + basic punctuation.** Covers "Rohit + 2" style names. Filter blocks XSS-like and emoji that break layout. Revisit if Indian-language names need devanagari — expand regex.

## Pricing & billing

- **V1-LAUNCH: only Standard Monthly (₹599) shown in UI.** Starter and Pro cards hidden in PricingSection.tsx and PlanSelection.tsx via `VISIBLE_PLAN_IDS` filter. All plan data and Razorpay plan IDs intact — display-only change, trivially reversible. Revisit when tiering is re-enabled (remove filter + restore hidden cards).
- **Tiers: ₹299 / ₹599 / ₹999 monthly. ₹599 is target.** ₹599 hits the ROI math sweet spot (18× return at ₹10k/month leakage). ₹999 leaves room for Pro v2 features. Revisit at 3 months: <5% conversion → lower entry; >20% → raise.
- **Razorpay for payments.** Dominant Indian provider, best NACH auto-debit support. 2% fee accepted. Revisit at 500+ customers — negotiate enterprise pricing.
- **Razorpay Subscription API, not Orders API.** Recurring billing requires Subscription API. Orders API is one-time only.
- **Cardless 7-day trial — new signups land directly on `/tables` with `status='trialing'` and `trial_ends_at = now+7d` via Postgres trigger.** Razorpay subscription created only when owner taps Subscribe (early) or trial expires (forced). No card mandate during trial period. `useAccessGuard` checks `trialEndsAt > Date.now()` — expired → `reason: 'trial_expired'` → RequireAccess redirects to `/subscribe` with state. AuthCallback routes trialing+active users to `/tables`, expired trial to `/subscribe`.
- **Subscribe page shows three distinct headlines based on entry path.** `trial_expired` → "Your free trial has ended". `subscribe_early` (from trial strip "Manage →") → "Subscribe early to lock in ₹599/month" + days-left copy. Default (`welcome`) → existing PlanSelection welcome. `HeadlineState` discriminated union in `useMemo`; derives from `location.state.reason` first, falls back to live subscription state on refresh.
- **7-day trial via Razorpay `start_at`, server-side 3-scenario logic (Decision S4 — shipped Phase 3 Commit 2, 4 Jun 2026).** Server reads existing `trial_ends_at` from Supabase before calling Razorpay. Three scenarios: `new` (no row → `start_at = now+7d`), `mid_trial` (existing future → `start_at = existing trial_ends_at`, honors remaining days, DO NOT overwrite DB), `expired` (past or within 60s → `start_at = now+60s`, mark `trial_ends_at = now`). Frontend sends `{ tier, cycle }` only — never timestamps or scenario flags. `trial_ends_at` is NEVER overwritten if existing value is in the future and still valid. Decided 4 Jun 2026 after BUG-026 (free trial extension bug).
- **Webhook is source of truth, frontend optimistic.** Webhook updates Supabase status authoritatively. Frontend calls `refreshProfile(true)` after Razorpay's `handler()` callback with 1500ms delay.
- **`SubscriptionStatusBanner` uses `razorpaySubscriptionId` presence to split trialing into two display states.** `status='trialing'` stays the correct DB value from signup through first charge. The banner differentiates "pure trial" (`!razorpaySubscriptionId`) from "mandate registered, waiting for charge" (`razorpaySubscriptionId` present) — no status enum change needed. See Pattern S9.

## Auth

- **Supabase + Google OAuth only.** No email/password for v1. Lowest friction for Indian SMB owners (everyone has Gmail). Revisit on first customer ask for non-Google login.
- **Google OAuth always shows account picker.** `queryParams: { prompt: 'select_account' }` enforced — protects multi-account users and shared-device first-time users.
- ~~**Auth-first app, no anonymous trial mode.**~~ **Superseded — see "Cardless 7-day trial" in Pricing & billing.**
- **`.env.local` never committed.** Supabase URL + anon key local-only. Service role key NEVER in client code.

## IndexedDB / Dexie

- **DB name is `ClubKeeperDB_<userId>` (Supabase UUID).** Schema stays v4. Two Google accounts on the same browser see isolated data. The old `ClubKeeperDB` (no suffix) is left untouched on disk for a future one-time migration if needed. Revisit when cloud sync is added — at that point, per-browser scoping becomes redundant.
- **`db` export is a Proxy over a re-openable instance.** `initDbForUser(userId)` swaps the backing instance; `closeDb()` resets to placeholder. Never replace this with a static singleton — the whole point is that the backing DB can change when the user switches accounts. Pattern: `authStore` calls `initDbForUser` / `closeDb`, no one else does.
- **Never query `db` before `dbReady === true`.** The Proxy forwards to a placeholder DB pre-auth; Dexie won't crash but writes go to the wrong store. `useAccessGuard` blocks all private routes with `'db_loading'` until `dbReady` is set (Pattern D6).
- **Full cloud sync SHIPPED (Phase C, Jun–Jul 2026).** Outbox write path + SyncReader read path + realtime + polling fallback are live; queries.ts cutover in progress (Chunk 7, refs #126). Working contract: `ripple_effects.md` §Sync + Patterns S14–S24. The old "defer until 3+ asks" framing is history — see decisions_archive.

## Canteen feature (Phase 1, 7 Jun 2026)

- **[2026-06-07] Canteen uses a destination model (/canteen page via TopBar cart icon), not a mode-switch toggle.** Avoids bottom-nav semantics change, smaller blast radius, scales to Phase 2 (stock-in entries, canteen P&L report, category grouping) via internal tabs on `/canteen`. Revisit if bottom-nav canteen tab is requested by customers.
- **[2026-06-07] Canteen item deletion is soft-delete (`isActive=false`).** Rows persist in IndexedDB — historical session item references remain valid. Filter at query time via `getCanteenItems(includeInactive=false)` default. Never hard-delete.
- **[2026-06-07] Low-stock threshold is global per club (`ClubSettings.lowStockThreshold`, default 5), not per-item.** Per-item thresholds were considered overkill for v1. Revisit if a customer with varied-volume items requests it. **[2026-06-20] UI lives in Settings → Canteen section (moved from Club Info per BUG-S5).** Discovery: low-stock + peak-pricing are both canteen-domain settings; co-locating them reduces hunt time.
- **[2026-06-07] Out-of-stock items in AddItemBottomSheet chip list are disabled (greyed), not hidden.** Staff see what items exist and can recognize when stock needs refilling. Hiding would cause "did this item get deleted?" confusion. Revisit if the disabled chips cause UI clutter feedback.
- **[2026-06-07] Stock decrement ONLY fires when a canteen master-list chip is tapped.** Free-text item adds (typed name + price, no chip selected) do NOT touch stock. Preserves the "ad-hoc one-off item" use case (e.g. a custom charge, a non-canteen item). This is intentional — never change it without explicit decision.
- **[2026-06-07] Owner cloud sync (remote view) deferred.** Customer #1 (12-table club) requested ability to see sales remotely. Scoped plan exists (manual sync → JSON blob → Supabase row → read-only parent login) but NOT built. Trigger: build only when 3+ paying customers explicitly ask. Keeps Supabase costs at ₹0. Avoids premature architecture lock-in.
- **[2026-06-07] Canteen Phase 2 reserved but not scoped.** Reserved for: stock-in entries (purchase cost tracking), canteen-only P&L (sale revenue − purchase cost), category grouping (snacks/cold drinks/cigarettes). Reachable via tabs on `/canteen` when built. Do not scope until shipped to first customer and validated.
- **[2026-06-07] Local-only testing protocol confirmed as canonical workflow.** Building in 6 small prompts (each verified in browser before next) caught 5 bugs that would have been impossible to isolate in a single mega-prompt. Never attempt feature work via single large prompts on a 50+ file codebase. Small prompt → browser verify → next prompt.

## Operational patterns

- **`authStore.refreshProfile` has 3000ms dedup window.** `_lastFetchedAt` timestamp prevents the `initialize() + onAuthStateChange(INITIAL_SESSION)` double-fire. `force=true` only after real server mutations (post-payment, post-cancel). **Permanent correctness fix — never revisit.**
- **PaymentBottomSheet: 4 escape paths.** X button (with bg fill) + ESC key + backdrop click + "Maybe later" text button. All disabled while `paying=true`. Applies to any future commitment sheets.
- **`handlePayNow` error handling: timeout + status checks + .json() try/catch.** 15s `AbortController` timeout, explicit 404 → "run `vercel dev`" message, try/catch around every `.json()`. Pattern applies to ALL fetches (see `bug_patterns.md` S1).
- **Home FAB opens inline modal, not navigates.** `<TableFormModal>` in state. Settings's own Add Table button kept. Revisit if duplication becomes confusing.
- **Settings shows "No active plan, Subscribe →" CTA when `status='none'`.** Never `null`-render a section based on async state — always show something meaningful.
- **Settings page uses collapsible sections, one open at a time.** Order: Club Info (name / currency / UPI / time rounding), Tables, Canteen (low-stock / peak pricing), Alerts, Subscription, Piggy, Player Hub, Data & Backup, About, Account. Club Info open by default. `openSection: string` state — tapping an open section closes it (sets to `''`), tapping a closed section opens it (and closes whatever was open). Persisted in `sessionStorage` (UI flag only — not Dexie, not localStorage).
- **Payment/QR screen uses `fixed inset-0 z-50 flex-col` with QR sized `min(72vw, 280px)`.** Fits any viewport without scroll. Middle `flex-1` zone centers QR + amount. "Done" button pinned at bottom via `shrink-0` footer. Bottom nav is hidden because the screen sits above the layout as a `fixed inset-0 z-50` overlay (z-50 is required — `fixed inset-0` alone is NOT enough, bottom nav bleeds through). Overlay root uses `paddingTop: max(12px, env(safe-area-inset-top))` and `paddingBottom: max(16px, env(safe-area-inset-bottom))` so the Done button clears the home indicator. White QR card uses `aspect-square flex items-center justify-center p-3` so the QR is a perfect square with equal borders on all 4 sides (do NOT use p-4 / p-8 / 2rem padding — fixes the symptom on one width, breaks others). QR child element uses `width:100%; height:auto; display:block` and renders internally at 2× (560 for 280 cap) for retina.
- **Session alarm: per-session `notifyAtMs` absolute timestamp set at `startSession()`, checked in `useSessionAlarm` hook on Home/Tables page via timestamp comparison (Pattern T1, Pattern T4).** `notifyAtMs = startedAt + notifyAfterMs` (absolute, not duration). Snooze anchors to the ORIGINAL `notifyAtMs` (`notifyAtMs = original + snoozeMs`) so user reaction time never accumulates drift; falls back to `Date.now() + snoozeMs` only when the result would already be in the past — **Pattern T6 is authoritative** (this line previously said the opposite; corrected 7 Jul 2026). `notifyAcknowledgedAt` prevents re-fire after "Stop session" is tapped. Paused sessions skip the alarm check — clock is frozen. `alarmSoundEnabled`/`alarmVibrationEnabled` stored in Dexie settings (NOT localStorage — see Critical Rule #2). Sound uses Web Audio API oscillator (no asset file). Modal is `fixed inset-0 z-50` — no backdrop/ESC dismiss, owner must tap a button. Only Home.tsx mounts the modal; SessionDetail does not (owner is already on that session).

---

## Wallet / Prepaid Credit

- **Wallet data lives in Dexie, not Supabase.** Customers and wallet_transactions are IndexedDB tables — fully offline-first, same as sessions. Supabase remains auth + payments only. Revisit when cloud sync ships.
- **Phone is the public customer identity, UUID is the DB primary key.** Phone is indexed but NOT unique in Dexie (null walk-ins would violate a unique index). Uniqueness enforced in `customerStore` pre-check. UUID key means promoting a walk-in to a phone customer is an update, not a delete+insert.
- **Walk-in codes are sequential per club, stored in `settings.walkInCounter`.** Format: `WALK-001`, `WALK-002`… Counter + new customer row inserted in a single `db.transaction('rw', settings, customers)` — crash-safe. No separate counter table.
- **WalletTransaction rows are immutable.** Corrections are new rows. `balanceAfter` snapshot on every row is the audit trail. Enforced in `customerStore` — there is no `updateTransaction()` method, only `add`.
- **Manual debit cannot make balance negative (Phase 1).** `applyManualAdjustment()` throws if `newBalance < 0`. Phase 2+ may allow overdraft with owner override — decision deferred.
- **WhatsApp receipt link is shown only when `customer.phone !== null`.** Not disabled — hidden entirely. Walk-in customers never see a WhatsApp button.

---

## Split payments + walk-in canteen + piggy (v13, 10 Jun 2026)

- **Split payment = 3-way (cash + UPI + wallet).** All three must sum to grand total exactly. Any one can be zero. UI uses numeric steppers + quick-fill chips, not radio buttons.
- **`paymentBreakdown` is captured at "Record payment" confirm, NOT at `stopSession`.** Between Stop and confirm, the session is `status:'completed'` with `paymentBreakdown:undefined`. SessionDetail auto-resumes the payment flow on re-mount if it finds this state (ADDENDUM-4).
- **No "Skip for now" on the post-stop QR screen.** Payment capture is mandatory. Cancel inside the sheet returns to the QR; closing the tab is the only escape; reopening re-prompts.
- **Zero-amount sessions write `{0,0,0}` directly without opening the sheet (ADDENDUM-5).** Button label becomes "Mark as paid".
- **`Session` has NO `customerId` field.** Wallet linking on sessions is captured in PaymentSplitSheet state only; the durable link is `WalletTransaction.referenceId = sessionId.toString()`. Avoids a schema change for a feature that's needed in 2 places.
- **Existing UPI QR screen preserved (ADDENDUM-1).** PaymentSplitSheet is the staff-side capture; the QR is the customer-facing display. Two distinct UIs, sequenced not merged.
- **PaymentSplitSheet is shared between SessionDetail and QuickSale.** `total` prop is the grand total — caller computes it (`session.amount + Σ items` for sessions, `subtotal` for QuickSale). The sheet itself knows nothing about sessions vs sales.
- **Walk-in Quick Sale = structured items only.** No free-text items in v1 (would let staff typos pollute master list and break stock tracking). If owner needs a one-off item, add it to /canteen first.
- **No edit / refund / void flow for `paymentBreakdown` in v1.** BUG-022 lesson applied — post-stop drift is prevented by never allowing the field to be re-written. Future refund flow will use a separate WalletTransaction row with `referenceType:'refund'`.
- **Piggy is a derived value (Pattern P6).** No `piggy_balance` column, no `piggy_ledger` table. Single source of truth = sessions + canteenSales + walletTransactions + stockPurchases + `piggyOpeningBalance` + `piggyStartedAt`.
- **Piggy aggregation window is `piggyStartedAt`-bounded EVERYWHERE.** Total balance, cash-in-today, cash-by-week — all scoped via `Math.max(windowStart, piggyStartedAt)`. Historic data never leaks in.
- **Wallet top-ups paid in cash count toward piggy but NOT toward PAYMENT MODE.** The cash is physically in the till (piggy) but it's a deposit not revenue (so it's excluded from the revenue breakdown tile). This is the only place where piggy and PAYMENT MODE diverge in their cash-in sources.
- **Restock paid-from = Piggy | Other.** Owner picks at restock time. Only `source='piggy'` deducts from piggy. `'other'` still writes a StockPurchase row so future inventory cost reports can include it.
- **Piggy radio disabled when `cost > piggy`.** UI is the only enforcement; piggy can technically go negative in computation (clamped to ₹0 in UI + warning) but the disabled-chip rule prevents it on the happy path.

---

## Decisions Pending (Open)

### How to bill: per-table or flat tier?
- Flat tier (current): ₹299/₹599/₹999 with table limits
- Per-table: ₹100 per table, no tiers

Pending market response. Flat is simpler; per-table feels fairer to small clubs but harder to scale revenue.

### When to require Razorpay setup?
- Day 1 of free trial
- After trial ends (day 30)
- Soft-prompt on day 25

Discuss when polishing the signup → subscribe flow.

### Offline data migration when cloud sync ships
- Existing IndexedDB data needs migration strategy
- Tables/sessions need `userId` field (Dexie version bump required)
- Multi-staff-on-one-phone scenario blocked until this is done

Deferred. Surface when first customer asks for cloud sync or multi-device.


---

### Back entry items must write inside `createBackEntry` tx — never via `AddItemBottomSheet` (9 Jun 2026)

**Decision:** All writes for a back entry (session row + sessionItems + canteen stock decrements) happen inside the single `createBackEntry` transaction. `AddItemBottomSheet` must NEVER be used to add items to back entry sessions.

**Why:** `AddItemBottomSheet` expects a live `sessionId` that already exists in IndexedDB. A back entry session has no `id` until after `db.sessions.add()` commits inside the tx. Splitting into two transactions (session first, then items) means an `InsufficientStockError` on items would NOT roll back the session row — leaving an orphaned session with no items. The single-tx approach ensures the entire operation is atomic.

**How to apply:** Any future extension to back entries (e.g. editing items after the fact) must open a new transaction that includes both `db.sessions` and `db.sessionItems` — never reuse the live-session item add flow.

---

### Canteen item matching — strict name+price (8 Jun 2026)

**Decision:** All non-canteen-chip add paths in AddItemBottomSheet match against active canteen items by `(normalizedName, exactPrice)`. Matched → decrement stock via inline atomic tx (`runCanteenAddTransaction`). Unmatched → freeform sessionItem, no stock touch. NO "save to canteen?" prompt for freeform items.

**Why:**
- Same logical item must behave the same regardless of add path (consistency)
- Freeform stays available as escape hatch (one-off items, items not yet in master list)
- No auto-save prevents staff-typo pollution of the canteen master list ("wtr", "cokee", etc.) which would make stock tracking useless
- Manual form collapsed by tap to encourage canteen chip use as the default path

**Supersedes:** Previous behavior where Quick Add and manual form silently skipped stock decrement.

---

### Session-item merge-on-add (8 Jun 2026)

**Decision:** When a user adds a session item (any path), if a row with the same sessionId + normalizeName(name) + exact price already exists, increment its qty instead of creating a new row. Edits still go through the existing tap-row-to-edit modal.

**Why:**
- Staff can answer "how many Cokes?" by reading one number, not counting rows
- Settlement disputes are faster + less error-prone
- No new UI surface — uses existing edit modal for corrections
- Consistent with how chip-based POS systems work

**Out of scope:** Stock restore on qty-down edit (separate fix).

**Supersedes:** Previous behavior where every tap created a new sessionItems row.

---

### Canteen stock syncs with sessionItem mutations (8 Jun 2026)

**Decision:** updateSessionItem, deleteSessionItem, and restoreSessionItem all sync canteen stock atomically when the row matches an active canteen item by (normalizeName, exactPrice).

**Stock direction:**
- updateSessionItem qty-up by N → stock −N (blocked if insufficient; InsufficientStockError)
- updateSessionItem qty-down by N → stock +N
- deleteSessionItem → stock +quantity (always succeeds)
- restoreSessionItem (Undo) → stock −quantity (blocked if insufficient; InsufficientStockError)

**Error surface:** InsufficientStockError thrown from queries layer; caught in AddItemBottomSheet. Edit modal shows inline error via setError (Pattern F7). Undo path surfaces toast (justified exception — no inline surface once toast dismisses).

**Why:** Closes the three-way stock leak — staff can no longer over-edit, delete-without-restore, or undo-without-redecrement items out of the canteen inventory.

**Supersedes:** Previous behavior where these three operations silently bypassed stock.

---

### [2026-06-09] Rate card + pro-rated tolerance billing — shipped

**Decision:** Replace simple `ratePerHour × hours` linear billing as the default for Indian indoor-game clubs with per-table rate cards (tier grid + tolerance), pro-rated billing model as the default mode, minimum-charge model retained as opt-in alternate.

**Why:** Every Indian club we surveyed (M416, Ball Bender, others) prices in non-linear tiers — half-hour, hourly, beyond-hourly — with a 5–15 min grace period for "tolerance". Linear was the wrong model. Pro-rated default is trust-building: live display matches what player would pay if they stop now, no surprises. Minimum-charge alternate retained for traditional clubs that prefer flat-rate minimum tiers.

**How:** `RateTier { minutes, price }` array on `GameTable`, snapshotted onto `Session` at start (Pattern T3). Two billing algorithms in `money.ts`: `priceForElapsedMinimum` (existing tier-floor model) and `priceForElapsedProrated` (new). Per-table toggle `rateCardBilling: 'minimum' | 'prorated'` defaults to `'prorated'` when undefined. `calculateAmount` dispatches based on session's snapshot.

**Tested:** All 14 acceptance values verified (0/1/5/15/29/30/35/40/41/50/59/60/65/70/71/80/100 min × both modes) against the canonical Ball Bender card (tier1=30/₹70, tier2=60/₹150, tolerance=10). Pre-tier-1 pro-rate, tier plateau, between-tier climb, last-tier overflow at `last.price/last.minutes` per minute — all correct within ±₹1.

**Revisit:** If 3+ owners report the post-last-tier rate feels wrong (current: `last.price/last.minutes` per min after plateau), make the extrapolation rate a per-table setting. Until then, this default is fine — Ball Bender accepted it during demo.

### [2026-06-09] Default new tables to 'prorated' mode

**Decision:** When an owner creates a new table or edits a table where `rateCardBilling` is undefined, the UI defaults the toggle to `'prorated'`. The 'minimum' option is visible but unselected by default.

**Why:** Pro-rated is the better customer-trust UX (live total matches final bill, no awkward ₹70-at-1-minute), and Ball Bender's owner specifically called out the "trust" angle in his demo feedback. Most new owners won't know which to pick — give them the better default.

**Revisit:** If founder feedback shows >50% of owners flip to 'minimum' after onboarding, reconsider the default.

### [2026-06-09] Rate card seed example uses Ball Bender values, but label is generic

**Decision:** `src/db/seed.ts` includes the 6-tier Ball Bender pool rates on the Pool 1 seed as a working demo. ALL user-facing labels are generic — the preset button says "standard preset (30 / 60 / 90 min) →", never "Ball Bender". The 3-tier preset is the UI default (90 / 60 / 30 min slots); seed has 6 tiers for richer demo data.

**Why:** New users benefit from seeing a fully-populated rate card on first launch — they understand the feature instantly. But hardcoding a customer name into UI strings would (a) confuse new clubs and (b) leak our customer info. Seed values are example data, the system is fully dynamic. Sugeet's instinct flagged this correctly mid-build; fix landed in same session.

### [2026-06-09] Multi-device sync — second ask, still deferred — **SUPERSEDED 25 Jun 2026**

> Owner overrode the 3-ask threshold ~2 weeks later under continued Ball Bender pressure; the sync project (sync_architecture_v2.md → Phase B/C) started 24–25 Jun and is now shipped. Kept for the reasoning record.

**Decision (historical):** Ball Bender's 4-partner club is the second paying customer to ask for cross-device sync. Threshold for building cloud sync remains 3+ customers. Stay deferred.

**Why:** Building Supabase sync is a multi-day architectural change. Two asks isn't enough signal to justify the work. Interim option for Ball Bender (not yet built): "Shift Handover" — partner ending shift exports a JSON blob, partner starting shift imports it. Solves the same problem with zero server cost. Build only when Ball Bender explicitly complains about the lack — they accepted the limitation during demo.

**Also corrected mid-session:** Sugeet was under the impression that cloud sync would cost ~₹600/month for server. Supabase free tier provides 500MB database storage, easily handles 100+ clubs of session data. Cost is not the blocker; engineering time is.

### [2026-06-09] Sales pitch order — Summary first, NOT Tables first

**Decision:** When demoing ClubKeeper to a new club owner, lead with the Summary page (data-driven decisions on revenue, peak hours, table utilization). THEN show Canteen ("the real raw gold"). THEN show Tables (the timer mechanic). Never lead with Tables.

**Why:** Founder discovered this empirically on 9 Jun 2026. First demo of the day (M416 club, 1 hour earlier): led with Tables → owner refused rudely, said "I'm already paying my employee to write in notebook, why would I pay for this?" Second demo (Ball Bender, same day): led with Summary → owner immediately loved it → progressed to Canteen → progressed to Tables → closed the sale. Same product, different pitch order, opposite outcome.

**Mechanism:** Tables look like a digital notebook to skeptical owners — they see no value over paper. Summary shows them something paper CAN'T do — instant aggregation, peak-hour insight, leakage detection. Once they see "decisions on data", the tables become the obvious data source.

**Revisit:** After 10+ sales calls, if Summary-first conversion < 30%, restructure the demo flow.

---

### [2026-06-11] Owner-side intent updates go through Supabase client, not Vercel function

**Decision:** Confirm and reject actions on topup_intents use `supabase.from('topup_intents').update(...)` directly from the client (owner is authenticated; RLS `topup_intents_owner_update` policy permits). The Vercel serverless functions `api/confirm-topup.ts` and `api/pending-topups.ts` have been deleted.

**Why:** The Vercel functions don't exist on `npm run dev` (only `vercel dev`). This caused every confirm/reject on localhost to fail. Since the owner is always authenticated and RLS covers the authorization, a serverless function adds zero security value here. Simplest correct solution = go through the client.

**How to apply:** Any future owner-side mutation on Supabase tables can use the Supabase JS client directly if the owner has a valid session and the RLS policy covers it. Only use serverless functions when server-side secrets (Razorpay key, service role key) are required.

---

### [2026-06-11] Coin redemption modes default 'both' for existing clubs, 'time' default for UI dropdown

**Decision:** `ClubSettings.coinRedemptionModes?: 'time' | 'canteen' | 'both'`. New field added to types (no Dexie schema bump needed — additive field read with `?? 'both'` default in `resolveCoinConfig`). For Sugeet's existing club (My Club), `settings.coinRedemptionModes` is `undefined` → resolves to `'both'` — no regression. Default for the UI dropdown in PlayerHubSettings is 'both' (preserves current behavior). New clubs can choose; the UI guides toward enabling the appropriate mode.

**CoinRedemptionPill visibility rules:**
- Session-end screen: pill hidden when `coinRedemptionModes === 'canteen'`
- Canteen checkout (QuickSale): not yet implemented — reserve for when canteen coin redemption is built

**How to apply:** Always read `coinConfig.coinRedemptionModes` before showing any redemption UI. The `resolveCoinConfig` function returns the merged value; never inline `settings.coinRedemptionModes` checks in UI code.

---

## D-PlayerHub-1 — Player Hub ships as Supabase-first (no local-first)

**Context:** Player Hub (clubs + topup_intents) is Supabase-only — no Dexie tables mirror it. Only `ClubSettings.slug/acceptsTopups/coinsEnabled/coinTiers` are mirrored to Dexie for offline reads.
**Decision:** Club setup and topup intent confirm/reject are Supabase-only writes. `useSyncClubFromSupabase()` does a one-way Supabase→Dexie sync for the fields staff need offline.
**Rationale:** Player Hub is an online feature (players scan a QR, owners confirm via realtime push). Offline support adds complexity for zero offline-use-case benefit.

## D-PlayerHub-2 — Realtime with polling fallback, not polling-only

**Context:** Supabase realtime may not connect on spotty networks.
**Decision:** Open realtime channel first; if not `SUBSCRIBED` in 5s, fall back to 30s polling. Both can run simultaneously (known bug — not harmful, just wastes bandwidth).
**Rationale:** Realtime gives instant badge updates; polling is the reliability net. Owner clubs in India often have variable connectivity.

## D-ClubCoins-1 — Coins earned only at topup, not at session end

**Context:** Choosing when to award coins: topup time vs. session payment time.
**Decision:** Coins earned only when a player's topup is confirmed by owner (not when they pay at session end).
**Rationale:** Ties coins to wallet top-ups (encourages pre-loading). Simpler tx model — one confirm event, one coin credit. Session payments may be cash/UPI with no customer identity.

## D-ClubCoins-2 — Coin expiry uses FIFO lot accounting

**Context:** How to track which coins expire when (oldest first).
**Decision:** Each earn event is a "lot" with remaining coins. Expiry debits oldest lots first. Implemented in `src/lib/coinExpiry.ts`.
**Rationale:** Customers don't lose recently-earned coins when older coins expire. Standard loyalty programme expectation.

## D-Engagement-1 — All engagement features off by default

**Context:** Streak bonus, welcome bonus, dormancy nudges are new and unproven.
**Decision:** `welcomeBonusEnabled`, `streakEnabled`, `dormancyEnabled` all default to `false`/`undefined` in ClubSettings. Owner must explicitly enable each in PlayerHubSettings.
**Rationale:** Prevents surprise coin grants before owner has configured tiers and coin values. Avoids support calls for "where did these coins come from."

## D-Engagement-2 — ExpirySweepRunner runs every 4h, not on every launch

**Context:** Coin expiry sweep is a read-heavy operation (scans all customer walletTransactions for FIFO lots).
**Decision:** `sessionStorage.lastExpirySweep` debounces to max once per 4h per browser session. Per-customer inner debounce via `expiryAppliedAt` (1h).
**Rationale:** A club with 500 customers would scan 500 × N transaction rows on every page load. 4h cadence is imperceptible to players but avoids IndexedDB thrash.

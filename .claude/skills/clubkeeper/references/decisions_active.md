# Decisions — Active

Currently-load-bearing decisions affecting the codebase. Each entry is one line of decision + brief why + revisit trigger (when relevant).

For rejected ideas, historical decisions that have been superseded, and full reasoning of why alternatives were rejected, see `decisions_archive.md`.

---

## Stack & Architecture

- **Vite + React 18 + TS + Tailwind v3.4 + Dexie + Zustand + react-router-dom v6 + vite-plugin-pwa** — beginner-friendly, PWA = no app stores, free Vercel hosting, one codebase for Android + iOS. Revisit if Play Store presence becomes important.
- **Tailwind locked to v3.4** — v4 breaks PostCSS in test runs. Revisit when v4 ecosystem stabilizes (~6-12 months).
- **Offline-first via Dexie/IndexedDB, no backend for app data in v1** — Indian clubs have terrible WiFi; owner uses one device; zero hosting cost. Revisit when 3+ paying customers explicitly ask for multi-device sync — then add Supabase sync for app data.
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
- **7-day trial via Razorpay `start_at`, NOT `trial_period`.** Set `start_at = now + 7 days`. Our `trial_ends_at` in Supabase + `useAccessGuard` is the truth.
- **Webhook is source of truth, frontend optimistic.** Webhook updates Supabase status authoritatively. Frontend calls `refreshProfile(true)` after Razorpay's `handler()` callback with 1500ms delay.

## Auth

- **Supabase + Google OAuth only.** No email/password for v1. Lowest friction for Indian SMB owners (everyone has Gmail). Revisit on first customer ask for non-Google login.
- **Google OAuth always shows account picker.** `queryParams: { prompt: 'select_account' }` enforced — protects multi-account users and shared-device first-time users.
- **Auth-first app, no anonymous trial mode.** `/tables` requires auth + active subscription. Revisit if conversion is very low.
- **`.env.local` never committed.** Supabase URL + anon key local-only. Service role key NEVER in client code.

## IndexedDB / Dexie

- **DB name is `ClubKeeperDB_<userId>` (Supabase UUID).** Schema stays v4. Two Google accounts on the same browser see isolated data. The old `ClubKeeperDB` (no suffix) is left untouched on disk for a future one-time migration if needed. Revisit when cloud sync is added — at that point, per-browser scoping becomes redundant.
- **`db` export is a Proxy over a re-openable instance.** `initDbForUser(userId)` swaps the backing instance; `closeDb()` resets to placeholder. Never replace this with a static singleton — the whole point is that the backing DB can change when the user switches accounts. Pattern: `authStore` calls `initDbForUser` / `closeDb`, no one else does.
- **Never query `db` before `dbReady === true`.** The Proxy forwards to a placeholder DB pre-auth; Dexie won't crash but writes go to the wrong store. `useAccessGuard` blocks all private routes with `'db_loading'` until `dbReady` is set (Pattern D6).
- **Full cloud sync still pending.** Cross-device access requires Supabase sync layer — deferred until 3+ paying customers ask. Per-user IndexedDB is the bridge: it's now safe to add `userId`-keyed sync without a schema redesign.

## Operational patterns

- **`authStore.refreshProfile` has 3000ms dedup window.** `_lastFetchedAt` timestamp prevents the `initialize() + onAuthStateChange(INITIAL_SESSION)` double-fire. `force=true` only after real server mutations (post-payment, post-cancel). **Permanent correctness fix — never revisit.**
- **PaymentBottomSheet: 4 escape paths.** X button (with bg fill) + ESC key + backdrop click + "Maybe later" text button. All disabled while `paying=true`. Applies to any future commitment sheets.
- **`handlePayNow` error handling: timeout + status checks + .json() try/catch.** 15s `AbortController` timeout, explicit 404 → "run `vercel dev`" message, try/catch around every `.json()`. Pattern applies to ALL fetches (see `bug_patterns.md` S1).
- **Home FAB opens inline modal, not navigates.** `<TableFormModal>` in state. Settings's own Add Table button kept. Revisit if duplication becomes confusing.
- **Settings shows "No active plan, Subscribe →" CTA when `status='none'`.** Never `null`-render a section based on async state — always show something meaningful.
- **Settings page uses collapsible sections, one open at a time.** Order: Club Info, Tables, Subscription, Data & Backup, About, Account. Club Info open by default. `openSection: string` state — tapping an open section closes it (sets to `''`), tapping a closed section opens it (and closes whatever was open). Persisted in `sessionStorage` (UI flag only — not Dexie, not localStorage).
- **Payment/QR screen uses `fixed inset-0 z-50 flex-col` with QR sized `min(72vw, 280px)`.** Fits any viewport without scroll. Middle `flex-1` zone centers QR + amount. "Done" button pinned at bottom via `shrink-0` footer. Bottom nav is hidden because the screen sits above the layout as a `fixed inset-0 z-50` overlay (z-50 is required — `fixed inset-0` alone is NOT enough, bottom nav bleeds through). Overlay root uses `paddingTop: max(12px, env(safe-area-inset-top))` and `paddingBottom: max(16px, env(safe-area-inset-bottom))` so the Done button clears the home indicator. White QR card uses `aspect-square flex items-center justify-center p-3` so the QR is a perfect square with equal borders on all 4 sides (do NOT use p-4 / p-8 / 2rem padding — fixes the symptom on one width, breaks others). QR child element uses `width:100%; height:auto; display:block` and renders internally at 2× (560 for 280 cap) for retina.

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

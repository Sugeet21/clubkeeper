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

## Operational patterns

- **`authStore.refreshProfile` has 3000ms dedup window.** `_lastFetchedAt` timestamp prevents the `initialize() + onAuthStateChange(INITIAL_SESSION)` double-fire. `force=true` only after real server mutations (post-payment, post-cancel). **Permanent correctness fix — never revisit.**
- **PaymentBottomSheet: 4 escape paths.** X button (with bg fill) + ESC key + backdrop click + "Maybe later" text button. All disabled while `paying=true`. Applies to any future commitment sheets.
- **`handlePayNow` error handling: timeout + status checks + .json() try/catch.** 15s `AbortController` timeout, explicit 404 → "run `vercel dev`" message, try/catch around every `.json()`. Pattern applies to ALL fetches (see `bug_patterns.md` S1).
- **Home FAB opens inline modal, not navigates.** `<TableFormModal>` in state. Settings's own Add Table button kept. Revisit if duplication becomes confusing.
- **Settings shows "No active plan, Subscribe →" CTA when `status='none'`.** Never `null`-render a section based on async state — always show something meaningful.

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

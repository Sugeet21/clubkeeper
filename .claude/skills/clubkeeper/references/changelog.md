# Changelog

Chronological record of what shipped, when, and what manual setup was done. Read only when Sugeet asks "when did we ship X" or needs to retrace a specific past step. Current state of the app lives in `SKILL.md` under "Current State Snapshot" — read that first for "where are we now?" questions.

---

## Prompts 0–8 — Foundations and polish

- **Prompts 0–6:** Project setup, data layer, all 4 main screens, Add/Edit Table modal, PWA install support.
- **Prompt 7:** Bug fixes — toggle alignment, date picker editable, time rounding plumbed, "Delete → Disable" rename.
- **Prompt 8:** Validation & overflow fixes — 50-char player name, special-char filter, "disable running table" guard.

---

## Prompt 9 (21 May 2026) — Supabase auth foundation

**Shipped:**
- `@supabase/supabase-js` installed
- `.env.local` with Supabase URL + anon key (gitignored, never commit)
- `.gitignore`: added `.env.local` + `.env*.local`
- `src/lib/supabase.ts`: client with `persistSession`, `autoRefreshToken`, `detectSessionInUrl`
- `src/store/authStore.ts`: Zustand store — session, user, profile, subscription, loading; `initialize()`, `signInWithGoogle()`, `signOut()`, `refreshProfile()`
- `src/hooks/useAccessGuard.ts`: typed guard returns `{ canAccess, reason }` for all subscription states
- `src/components/RequireAccess.tsx`: Outlet-pattern route guard; redirects to `/signup` or `/subscribe`
- `src/pages/Landing.tsx`, `Signup.tsx`, `Subscribe.tsx`: placeholders
- `src/pages/AuthCallback.tsx`: real OAuth callback — reads loading+subscription, routes to `/subscribe` or `/tables`
- `src/App.tsx`: split into public routes (`/, /signup, /subscribe, /auth/callback`) and private routes (`/tables, /start/:id, …`); AuthInitializer calls `initialize()` on mount; BottomNav hidden on public paths
- `src/components/BottomNav.tsx`: Tables tab `/` → `/tables`
- `src/pages/SessionDetail.tsx` + `Settings.tsx`: all `navigate('/')` → `navigate('/tables')`
- `src/pages/Settings.tsx`: Sign Out button
- `src/types/index.ts`: added `UserProfile`, `SubscriptionStatus`, `PlanTier`, `Subscription`
- `src/vite-env.d.ts`: typed env vars for Supabase + Razorpay

**Manual SQL run in Supabase dashboard (approved by Sugeet):**
- `public.profiles` table + RLS (view/update own row)
- `public.subscriptions` table + RLS (view own row)
- `handle_new_user()` trigger: auto-creates profile + subscription row on every signup

---

## Prompt 10 — Landing page

**Shipped (`src/pages/Landing.tsx` + `src/components/landing/*`):**
- `Landing.tsx`: orchestrator — outer radial glow bg, 390px device column, sticky top bar (logo + Sign in → `/signup`), sections in order
- `Eyebrow.tsx`: shared eyebrow label (18px line + mono uppercase text)
- `HeroSection.tsx`: headline, live hero timer (useTick + useRef, offset 1h24m36s), app mockup with 3 table cards (Free/Running/Paused), primary CTA button
- `PainPointSection.tsx`: 3 pain cards with emoji icons
- `ROICalculator.tsx`: interactive — `forgetCount × ratePerHour × 30 = monthly loss`; `monthly/599 = ROI multiplier`; Indian format via `toLocaleString('en-IN')`
- `HowItWorks.tsx`: 3 numbered steps (01/02/03 in accent mono)
- `PricingSection.tsx`: Starter / Standard (featured with glow + badge) / Pro (disabled), trial pill, trial banner
- `ComparisonTable.tsx`: overflow-x-auto scrollable, sticky left column
- `FAQ.tsx`: 6 items, `openIndex: number | null`, max-height CSS transition, `+` rotates to `×` when open
- `FinalCTA.tsx`: accent green CTA block with corner glow
- `Footer.tsx`: logo, nav links, Made in Pune

---

## Prompt 11 — Signup state machine + Google sign-in

**Shipped:**
- `src/pages/Signup.tsx`: state machine (`form | loading | transition | error`)
  - Effect 1: detects `?error=` in URL → `error` state on mount
  - Effect 2: redirects authenticated users — no sub → `transition`, has sub → `/tables`
  - `isOAuthInFlight` ref prevents double-tap; `handleRetry` uses 50ms tick
- `src/components/GoogleSigninButton.tsx`: reusable — white bg, Google multi-color logo SVG, spinner swap on loading
- `src/components/signup/SigninForm.tsx`: full page layout — back chevron → `/`, hero, Google button, legal, 3 trust rows, spacer, Sign in outline button, footer. Renders `SigninError` when `hasError`
- `src/components/signup/PostSigninTransition.tsx`: "Almost there!" screen — accent check circle, trial pills, "Add Payment Method →" → `/subscribe`, "Why card?" max-height expandable, signed-in-as account line (reads `profile.email` or `user.email`)
- `src/components/signup/SigninError.tsx`: fixed bottom toast (busy/red), `!` icon, Retry button

**Auth flow after this prompt:**
`/signup` → Google OAuth → `/auth/callback` → if no sub: `/subscribe`, else: `/tables`

---

## Prompt 12 (21 May 2026) — Subscribe UI (fake payment)

**Shipped (`src/pages/Subscribe.tsx` + `src/components/subscribe/*`):**
- `Subscribe.tsx`: orchestrator — auth guard, state (billing, plan, sheetOpen, paying, backWarning), fake 1.4s payment simulation, ProgressStep component inline, avatar initial from profile
- `BillingToggle.tsx`: Monthly/Annual toggle, "save 2 mo" badge, accent glow on active
- `PlanCard.tsx`: all 3 plans — select-tick for Starter, featured glow + badge for Standard, disabled + Coming soon for Pro. Annual shows per-month + savings line
- `PlanSelection.tsx`: welcome + toggle + 3 cards + ROI note. `pb-40` clears sticky bar
- `StickyCheckout.tsx`: flex-shrink-0 sticky bottom bar, gradient+blur bg, plan+price summary, CTA
- `PaymentBottomSheet.tsx`: `translateY` slide-up sheet, accordion methods (UPI default open), GPay/PhonePe/Paytm/BHIM grid, UPI input, paying spinner, Razorpay branding
- `ConfirmationScreen.tsx`: full-page on simulated success — check circle, "Trial started!", email, Continue → `/tables`

**Known limitation added:** IndexedDB data is browser-local and shared across all users on the same browser. No user-scoping yet. Will be addressed when cloud sync is added.

---

## Prompt 13 (23 May 2026) — Real Razorpay + Supabase webhook

**Shipped:**
- `api/create-subscription.ts`: Vercel serverless — authenticates JWT, creates Razorpay subscription, writes `status='trialing'` + `trial_ends_at` to Supabase via service role
- `api/razorpay-webhook.ts`: Vercel serverless — HMAC signature-verified, maps all 6 subscription events to Supabase status updates
- `api/cancel-subscription.ts`: Vercel serverless — authenticates JWT, cancels subscription at cycle end, sets `cancel_at_period_end=true`
- `src/lib/razorpayPlans.ts`: single source of truth for 6 Razorpay plan IDs
- `src/types/index.ts`: added `RazorpayCheckoutOptions`, `RazorpayResponse`, `RazorpayInstance`, `Window.Razorpay` global
- `src/pages/Subscribe.tsx`: replaced fake setTimeout with real Razorpay Checkout; `payError` state; scroll-bleed `useEffect`; imports `supabase` directly for `getSession()`
- `src/components/subscribe/PaymentBottomSheet.tsx`: added `payError` prop + inline red error display; `overscroll-contain` on scrollable panel
- `src/pages/Settings.tsx`: new Subscription section (plan/status/next-charge/cancel/change-plan); cancel modal; `handleCancelSubscription()` calls `/api/cancel-subscription`
- `src/components/SubscriptionStatusBanner.tsx`: trialing/past_due/cancelling banners with Indian rupee formatting
- `src/pages/Home.tsx`: renders `<SubscriptionStatusBanner />` above tables grid
- `index.html`: added Razorpay `checkout.js` `<script>` in `<head>`
- `razorpay` + `@vercel/node` packages installed

---

## 24 May 2026 — 16-bug sprint (commit `5587be6`)

Phase 1–3.5 bug fixes, all in one commit, pushed to main, Vercel auto-deployed. Each bug has its own entry in `bug_archive.md` and the recurring pattern is captured in `bug_patterns.md`.

**Fixed:** BUG-001 (FAQ a11y), BUG-002 (authStore double-fire), BUG-003 (PaymentSheet a11y), BUG-004 (Home FAB → inline modal), BUG-005 (FilterPills 44px), BUG-006 (TopBar gear 44px), BUG-007 (StartSession back/chips 44px), BUG-008 (player name maxLength), BUG-009 (handleStop route), BUG-010 (SessionDetail 44px), BUG-011 (Indian formatting in rows), BUG-012 (Modal escape + scrim z-index), BUG-013 (Settings status='none' card), BUG-015 (Google OAuth account picker), BUG-016 (PaymentBottomSheet escape paths), BUG-017 (handlePayNow timeout + error handling).

**Also shipped:** Playwright suite — 8 spec files × 3 viewports.

---

## 25 May 2026 — Razorpay + Auth bug session (4 commits)

**Context:** First real end-to-end payment attempt on production (clubkeeper.vercel.app) surfaced two live bugs.

**Commits shipped:**
1. `7ad20b1` — `diag: surface real Razorpay error in create-subscription` — patched catch block to log `JSON.stringify(err)` and return `{ message, code, razorpayStatus }` (was returning generic `{ error: '...' }`)
2. *(plan-IDs fix)* — `fix: replace razorpay plan IDs to match active account` — recreated all 6 plans in the correct Razorpay account; replaced IDs in `src/lib/razorpayPlans.ts`
3. `b99388b` — `diag: log AuthCallback + authStore lifecycle to find hang` — added `try/finally` to `initialize()` (loading=false now guaranteed); added diagnostic console logs; added `user` to AuthCallback useEffect deps; aligned server error response shape to `{ message }`

**Bugs fixed:**
- **BUG-018** — Razorpay 400: plan IDs were from a different account than the active key
- **BUG-019** — Server returned `{ error }` but frontend read `.message` — real error description was silently swallowed
- **BUG-020** — Auth hang: `initialize()` had no `try/finally` on `loading=false`; a `refreshProfile()` throw left loading=true forever

**Verified end-to-end on production:**
- ✅ Google OAuth → `/auth/callback` → `/subscribe` (new user flow)
- ✅ Subscribe page → Start Free Trial → Razorpay Checkout opens → payment completes → free trial subscription created in Razorpay (TEST mode)
- ✅ `/api/create-subscription` returns 200 with `subscriptionId` + `shortUrl`

**New patterns added:** S5 extended (key+plan account matching + curl verification), S6 (API response shape contract), A5 (try/finally on loading flags).

---

## Manual setup steps — status

### ✅ Done
- Supabase tables + RLS + `handle_new_user()` trigger
- `.env.local` populated (Supabase URL + anon key)
- GitHub repo at `github.com/Sugeet21/clubkeeper`
- Vercel auto-deploy from main
- Razorpay plan IDs created in dashboard (TEST mode)

### ⏳ Pending
- **Razorpay webhook setup:**
  1. Razorpay Dashboard → Settings → Webhooks → Add webhook URL: `https://YOUR-VERCEL-URL/api/razorpay-webhook`
  2. Generate webhook secret → add `RAZORPAY_WEBHOOK_SECRET=<secret>` to Vercel env vars
  3. Redeploy Vercel to pick up the new env var
  4. Enable events: `subscription.authenticated`, `.activated`, `.charged`, `.halted`, `.cancelled`, `.completed`, `payment.failed`
- **Razorpay LIVE mode switch** (needs KYC first)
- **End-to-end payment test on deployed Vercel**

---

## 27 May 2026 — Session Items (POS) + UPI QR + Stop-Session improvements (commit `3c0ca58`)

### Build Prompt 1 — Session Items (POS)
**Shipped:**
- `src/types/index.ts`: `SessionItem` interface; `ClubSettings.upiId?: string`
- `src/db/database.ts`: Dexie v3 (`sessionItems: '++id, sessionId, addedAt'`); v4 documents `upiId` field
- `src/lib/validation.ts`: `validateItemName()` (unicode regex, 1-50 chars); `validateUpiId()` (format `handle@provider`, optional)
- `src/lib/money.ts`: `calculateItemsTotal(items: SessionItem[]): number`
- `src/db/queries.ts`: `addSessionItem`, `updateSessionItem`, `deleteSessionItem`, `restoreSessionItem`; `RecentItem` interface + `getRecentItems(limit=8)` (last 30 days, sorted by useCount)
- `src/hooks/useLiveData.ts`: `useSessionItems(sessionId)`, `SessionWithItems` type, `useSessionsInRange(startMs, endMs)`, `useRecentItems(limit=8)`
- `src/components/AddItemBottomSheet.tsx`: full POS bottom sheet — add/edit/delete items, Undo toast, Pattern M1+M2, 44px touch targets, no maxLength, recent-items chips
- `src/components/ToastContainer.tsx`: renders `actionLabel` Undo button (`z-[60]`); `toastStore` extended with `actionLabel?/onAction?/durationMs?`
- `src/pages/SessionDetail.tsx`: bill split card (Table time + Items + Grand Total); rounding preview before stop; post-stop payment screen with QR
- `src/pages/Home.tsx`: Today total includes items
- `src/pages/Summary.tsx`: full rewrite — `useSessionsInRange`, row amounts include items, CSV has `Table Amount/Items/Total` columns
- `src/pages/History.tsx`: full rewrite — `useSessionsInRange`, day subtotals include items, same CSV format

### Build Prompt 2 — Items v2 + UPI QR + fixes
**Shipped on top of Build Prompt 1:**
- `src/components/PaymentQR.tsx`: new component using `qrcode` npm package — generates UPI deeplink QR as data URL; white bg; loading skeleton; error fallback
- `src/pages/Settings.tsx`: UPI ID field in Club Info section (optional, `validateUpiId` on blur, Save button); rounding-change warning modal if active sessions exist
- `src/pages/SessionDetail.tsx`: post-stop payment screen shows `PaymentQR` if `settings.upiId` set, otherwise plain amount card; "Done — back to tables" button
- AddItemBottomSheet: recent-items chips visible above name input; placeholder changed from "Cigarette" → "Cold drink, Chips, Water bottle"
- Summary + History: fixed row amounts to include items (were showing table-time only)
- Stop confirm: shows rounded time + items + grand total preview before confirming stop

**npm package added:** `qrcode` + `@types/qrcode`

---

## Open future work (not yet started)

- GST invoicing (Prompt 14)
- Email notifications (Prompt 14)
- Existing offline data migration strategy when cloud sync arrives (deferred — needs user-scoping by `userId` first; Dexie version bump required)

---
name: clubkeeper
description: ClubKeeper is Sugeet's offline-first PWA for managing indoor games clubs in India (pool, snooker, carrom, PlayStation). Use this skill whenever Sugeet mentions ClubKeeper, club app, indoor games, pool table app, carrom app, table timer, session timer, or anything related to building, debugging, or extending his SaaS product. Also trigger when he discusses pricing strategy, subscription plans, payment integration (Razorpay/UPI), customer acquisition for the app, signup/auth flows, deployment to Vercel, or shares screenshots from localhost:5173 / clubkeeper.vercel.app. Trigger even when he just shares an error or asks "what should I do next" inside this project context. This skill carries the project's full architecture, design system, code conventions, all bugs found and fixed, business context, and decision history — consult it BEFORE answering anything about the app so advice stays consistent with prior decisions.
---

# ClubKeeper — Project Memory

This skill is the persistent memory for Sugeet's ClubKeeper SaaS project. Read the relevant reference files based on what Sugeet is asking, then respond with full context of prior decisions.

## About Sugeet

- Solo founder in Pune, Maharashtra, India
- Has **less coding knowledge** — relies on AI to write code via Claude Code
- Building ClubKeeper as recurring-income SaaS while also has other projects (HRMS SaaS, hrdocs)
- Speaks English with Indian phrasing; replies are often short and pragmatic
- Prefers: ready-to-paste prompts > theoretical explanations
- Communicates by sharing screenshots when bugs occur

## About ClubKeeper

ClubKeeper replaces the paper notebook used at indoor game clubs in India for tracking who plays which table, when, and for how long. Target customer: small club owners (1-2 staff, ₹50k–₹5L monthly revenue) who currently lose money to forgotten timers and notebook errors.

**Sales pitch frame:** "If your staff forgets to start/stop the timer 3 times a day, that's ₹10,800/month lost. My app prevents that for ₹599/month."

## ⚠️ THE MOST IMPORTANT RULE

**Before changing any code, consult `references/ripple_effects.md`.** Find what's being changed, see what else it affects, and update ALL affected files in the same change.

Sugeet's biggest fear (correctly): a fix in one file creates bugs in 3 other files because the AI didn't know they were connected. The ripple_effects.md file prevents this. **Read it first. Always.**

If a requested change isn't documented in ripple_effects.md yet, STOP and trace the dependencies manually before writing code. Then add the new ripples to ripple_effects.md.

## Critical Rules (Never Violate)

These rules apply to EVERY response about ClubKeeper. They reflect hard-won decisions:

1. **Tech stack is LOCKED.** Vite + React 18 + TypeScript + Tailwind v3.4 + Dexie + react-router-dom v6 + date-fns + Zustand + vite-plugin-pwa. Do NOT suggest swapping any of these. Tailwind especially must stay on v3.4, never v4.
2. **Offline-first via IndexedDB (Dexie).** Never suggest localStorage for session/timer data. localStorage is OK only for UI flags like "install banner dismissed".
3. **Timers use timestamps, never counters.** Always `Date.now() - startedAt - pausedTotalMs`. Never `setInterval(() => setElapsed(e+1))`. This is the #1 bug source.
4. **No backend yet.** Single-user PWA. When auth/payment comes, will add Supabase or similar — discuss before implementing.
5. **Indian context.** Currency `₹`, format with `toLocaleString('en-IN')`. Use Razorpay/Cashfree for payments (NACH auto-debit support). UPI is the user payment method.
6. **Mobile-first.** Design for 360px width. Touch targets ≥44×44px.
7. **Dark theme only** (for v1). Color palette is locked — see `references/design_system.md`.
8. **No HTML `<form>` with submit.** Use button onClick handlers.
9. **All Dexie operations awaited.** No fire-and-forget.
10. **Strict TypeScript.** No `any` types.
11. **Verify with `npm run build` after every change.** TypeScript catches most ripple-effect breaks.
12. **Test 3 scenarios after any change:** happy path, existing-data path, edge case (empty/max/error).

## How to use this skill

When Sugeet asks something, route to the right reference file:

| Sugeet's topic | Read |
|---|---|
| **ANY code change at all** | **`references/ripple_effects.md` FIRST (mandatory)** |
| Architecture, file structure, why X library was chosen | `references/architecture.md` |
| Colors, typography, spacing, component styles | `references/design_system.md` |
| Database schema, types, queries | `references/data_model.md` |
| Past bugs and their fixes (so they don't repeat) | `references/bug_history.md` |
| Pricing, customer acquisition, sales pitch, business strategy | `references/business_context.md` |
| Deployment, GitHub, Vercel, CI/CD | `references/deployment.md` |
| Test scenarios, what's been verified | `references/test_status.md` |
| Decisions made and rejected, with reasoning | `references/decision_log.md` |

Read MULTIPLE files when the question spans domains. E.g., "should I add a new field for X?" needs `data_model.md` + `decision_log.md`.

## Response Style for Sugeet

- **Use ready-to-paste prompts when he asks for code.** Wrap them in ```` ``` ```` blocks. Include validation rules, file paths, and what NOT to do.
- **Use tables for comparisons** — he reads them faster than prose.
- **Number multi-step instructions.** He follows them in order.
- **Anticipate the next question.** End with "next, you'll probably want X" so he doesn't get stuck.
- **Show the why briefly.** "Razorpay because it supports NACH auto-debit which is critical for monthly billing in India" — not 3 paragraphs.
- **Indian numbers.** ₹1,00,000 not ₹100,000.
- **Don't over-formalize.** Match his informal tone. He's a founder building fast, not writing a research paper.

## Updating This Skill

After every meaningful work session with Sugeet:

1. **New bug found and fixed?** Append to `references/bug_history.md` with date, symptom, root cause, fix.
2. **New decision made?** Append to `references/decision_log.md` with date, context, what was chosen, what was rejected, why.
3. **New feature shipped?** Update `references/test_status.md` with what's verified.
4. **Pricing or business strategy changed?** Update `references/business_context.md`.
5. **New architectural pattern?** Update `references/architecture.md`.

The skill is meant to be a LIVING document. The more it's updated, the more useful it becomes. At the end of substantial sessions, proactively ask: "Want me to update the skill with what we just decided?"

## Current Project State

(Update this section after each session.)

**Last updated:** 23 May 2026 (Prompt 13)

**Completed:**
- Prompts 0-6: project setup, data layer, all 4 main screens, Add/Edit Table, PWA install support
- Prompt 7: bug fixes (toggle, date picker, time rounding, soft-delete rename)
- Prompt 8: validation & overflow fixes (player name 50-char, special chars, disable running table guard)
- Prompt 9: Supabase auth foundation — see details below
- Deployed to Vercel (auto-deploys on push to main)
- GitHub: `github.com/Sugeet21/clubkeeper`
- Supabase project: `vkczmgzujpidbwtzulel.supabase.co`

**Prompt 9 — what was shipped:**
- `@supabase/supabase-js` installed
- `.env.local`: real Supabase URL + anon key (gitignored — never commit this)
- `.gitignore`: added `.env.local` and `.env*.local`
- `src/lib/supabase.ts`: Supabase client (persistSession, autoRefreshToken, detectSessionInUrl)
- `src/store/authStore.ts`: Zustand store — session, user, profile, subscription, loading; initialize(), signInWithGoogle(), signOut(), refreshProfile()
- `src/hooks/useAccessGuard.ts`: typed guard — returns `{ canAccess, reason }` for all subscription states
- `src/components/RequireAccess.tsx`: Outlet-pattern route guard; redirects to /signup or /subscribe
- `src/pages/Landing.tsx`: placeholder at `/`
- `src/pages/Signup.tsx`: placeholder at `/signup`
- `src/pages/Subscribe.tsx`: placeholder at `/subscribe`
- `src/pages/AuthCallback.tsx`: real OAuth callback — reads loading+subscription, routes to /subscribe or /tables
- `src/App.tsx`: split into public routes (/, /signup, /subscribe, /auth/callback) and private routes (/tables, /start/:id, etc.); AuthInitializer calls initialize() on mount; BottomNav hidden on public paths
- `src/components/BottomNav.tsx`: Tables tab changed from `/` → `/tables`
- `src/pages/SessionDetail.tsx` + `Settings.tsx`: all `navigate('/')` → `navigate('/tables')`
- `src/pages/Settings.tsx`: Sign Out button added (calls useAuthStore.getState().signOut())
- `src/types/index.ts`: added UserProfile, SubscriptionStatus, PlanTier, Subscription
- `src/vite-env.d.ts`: typed env vars for Supabase + Razorpay

**Supabase setup needed (manual step — run SQL in Supabase dashboard):**
- `public.profiles` table + RLS (view/update own row)
- `public.subscriptions` table + RLS (view own row)
- `handle_new_user()` trigger: auto-creates profile + subscription row on every signup
- SQL was provided and approved by Sugeet in Prompt 9 session

**Prompt 10 — what was shipped:**
- `src/pages/Landing.tsx`: full orchestrator — outer radial glow bg, 390px device column, sticky top bar (ClubKeeper logo + Sign in → /signup), sections in order
- `src/components/landing/Eyebrow.tsx`: shared eyebrow label (18px line + mono uppercase text)
- `src/components/landing/HeroSection.tsx`: headline, live hero timer (useTick + useRef, offset 1h24m36s), app mockup with 3 table cards (Free/Running/Paused), primary CTA button
- `src/components/landing/PainPointSection.tsx`: 3 pain cards with emoji icons
- `src/components/landing/ROICalculator.tsx`: interactive — `forgetCount` × `ratePerHour` × 30 = monthly loss; `monthly/599` = ROI multiplier; Indian format via `toLocaleString('en-IN')`
- `src/components/landing/HowItWorks.tsx`: 3 numbered steps (01/02/03 in accent mono)
- `src/components/landing/PricingSection.tsx`: Starter / Standard (featured with glow + badge) / Pro (disabled), trial pill, trial banner
- `src/components/landing/ComparisonTable.tsx`: overflow-x-auto scrollable table, sticky left column
- `src/components/landing/FAQ.tsx`: 6 items, `openIndex: number | null`, max-height CSS transition, `+` rotates to `×` when open
- `src/components/landing/FinalCTA.tsx`: accent green CTA block with corner glow
- `src/components/landing/Footer.tsx`: logo, nav links, Made in Pune

**Prompt 11 — what was shipped:**
- `src/pages/Signup.tsx`: state machine (`form | loading | transition | error`)
  - Effect 1: detects `?error=` in URL → `error` state on mount
  - Effect 2: redirects authenticated users — no sub → `transition`, has sub → `/tables`
  - `isOAuthInFlight` ref prevents double-tap; `handleRetry` uses 50ms tick
- `src/components/GoogleSigninButton.tsx`: reusable — white bg, Google multi-color logo SVG, spinner swap on loading, works on Signup and potentially Subscribe page
- `src/components/signup/SigninForm.tsx`: full page layout — back chevron → `/`, hero, Google button, legal, 3 trust rows, spacer, Sign in outline button, footer. Renders `SigninError` when `hasError`
- `src/components/signup/PostSigninTransition.tsx`: "Almost there!" screen — accent check circle, trial pills, "Add Payment Method →" → `/subscribe`, "Why card?" max-height expandable, signed-in-as account line (reads `profile.email` or `user.email`)
- `src/components/signup/SigninError.tsx`: fixed bottom toast (busy/red), `!` icon, Retry button

**Key auth flow after Signup:**
`/signup` → Google OAuth → `/auth/callback` → if no sub: `/subscribe`, else: `/tables`

**Prompt 12 — what was shipped:**
- `src/pages/Subscribe.tsx`: orchestrator — auth guard, all state (billing, plan, sheetOpen, paying, backWarning), fake 1.4s payment simulation, ProgressStep component inline, avatar initial from profile
- `src/components/subscribe/BillingToggle.tsx`: Monthly/Annual toggle, 'save 2 mo' badge, accent glow on active
- `src/components/subscribe/PlanCard.tsx`: all 3 plans — select-tick for Starter, featured glow + badge for Standard, disabled + Coming soon for Pro. Annual shows per-month + savings line
- `src/components/subscribe/PlanSelection.tsx`: welcome + toggle + 3 cards + ROI note. `pb-40` clears sticky bar
- `src/components/subscribe/StickyCheckout.tsx`: flex-shrink-0 sticky bottom bar, gradient+blur bg, plan+price summary, CTA
- `src/components/subscribe/PaymentBottomSheet.tsx`: `translateY` slide-up sheet, accordion methods (UPI default open), GPay/PhonePe/Paytm/BHIM grid, UPI input, paying spinner, Razorpay branding
- `src/components/subscribe/ConfirmationScreen.tsx`: full-page on simulated success — check circle, 'Trial started!', email, Continue → /tables

**⚠️ Known limitation added (Prompt 12):**
IndexedDB data is browser-local and shared across all users on the same browser. No user-scoping yet. Will be addressed when cloud sync is added.

**Payment is REAL via Razorpay test mode.** `handlePayNow()` calls `/api/create-subscription` → Razorpay SDK opens modal → webhook updates Supabase status authoritatively.

**Prompt 13 — what was shipped:**
- `api/create-subscription.ts`: Vercel serverless — authenticates JWT, creates Razorpay subscription, writes `status='trialing'` + `trial_ends_at` to Supabase via service role
- `api/razorpay-webhook.ts`: Vercel serverless — HMAC signature-verified, maps all 6 subscription events to Supabase status updates
- `api/cancel-subscription.ts`: Vercel serverless — authenticates JWT, cancels subscription at cycle end, sets `cancel_at_period_end=true`
- `src/lib/razorpayPlans.ts`: single source of truth for 6 Razorpay plan IDs (starter/standard/pro × monthly/annual)
- `src/types/index.ts`: added `RazorpayCheckoutOptions`, `RazorpayResponse`, `RazorpayInstance`, `Window.Razorpay` global declaration
- `src/pages/Subscribe.tsx`: replaced fake setTimeout with real Razorpay Checkout; added `payError` state; scroll-bleed `useEffect`; imports `supabase` directly for `getSession()`
- `src/components/subscribe/PaymentBottomSheet.tsx`: added `payError` prop + inline red error display; `overscroll-contain` on scrollable panel
- `src/pages/Settings.tsx`: new Subscription section (plan/status/next-charge/cancel/change-plan); cancel modal; `handleCancelSubscription()` calls `/api/cancel-subscription`
- `src/components/SubscriptionStatusBanner.tsx`: trialing/past_due/cancelling banners with Indian rupee formatting
- `src/pages/Home.tsx`: renders `<SubscriptionStatusBanner />` above tables grid
- `index.html`: added Razorpay checkout.js `<script>` tag in `<head>`
- `razorpay` and `@vercel/node` packages installed

**Manual step still needed (post-deploy):**
1. Razorpay Dashboard → Settings → Webhooks → Add `https://YOUR-VERCEL-URL/api/razorpay-webhook`
2. Generate webhook secret → add `RAZORPAY_WEBHOOK_SECRET=<secret>` to Vercel env vars
3. Re-deploy Vercel to pick up the new env var
4. Enable events: subscription.authenticated, .activated, .charged, .halted, .cancelled, .completed, payment.failed

**Razorpay Plan IDs (production values, saved in `src/lib/razorpayPlans.ts`):**
- starter_monthly: plan_5shBXPM8XV0HwB
- starter_annual: plan_5shDtaqKDM84Ie
- standard_monthly: plan_5shF1qj5PW0A19
- standard_annual: plan_5shFh5N1LH24eF
- pro_monthly: plan_5sh3Rj6D3rEMe7
- pro_annual: plan_SshJ4iqI7iICkz

**Pending:**
- Webhook setup (manual — see above)
- Switch Razorpay to LIVE mode (KYC needed first)
- Test /subscribe end-to-end with real auth in browser (post-webhook-setup)
- GST invoicing (Prompt 14)
- Email notifications (Prompt 14)
- Existing offline data migration strategy when cloud sync arrives (deferred)

**Open Questions:**
- Existing offline data migration strategy when cloud sync arrives (deferred)

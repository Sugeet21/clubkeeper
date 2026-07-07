# Decision Log

Every significant decision made about ClubKeeper, with reasoning. When Sugeet asks "why did we go with X?" — answer is here.

Format:
```
### [Date] — [Topic]
**Decision:** What was chosen  
**Considered:** Alternatives  
**Why:** Reasoning  
**Trade-offs accepted:** What we give up  
**Revisit when:** Trigger to reconsider  
```

---

### 19 May 2026 — Tech stack

**Decision:** Vite + React + TypeScript + Tailwind v3.4 + Dexie + Zustand + vite-plugin-pwa  
**Considered:** Flutter, React Native + Expo, plain HTML/JS, Next.js  
**Why:**
- Sugeet has less coding experience, needs the most beginner-friendly stack
- PWA = zero setup pain (no Android Studio, no app stores), works on Android + iPhone instantly
- Vite has fast HMR and great error messages
- Tailwind keeps styling in markup, no CSS bugs
- Dexie wraps IndexedDB cleanly for offline-first
- Free hosting on Vercel
- Same codebase deploys instantly  

**Trade-offs accepted:**
- No Play Store listing in v1
- Slightly slower than native (negligible for timer app)
- iOS PWAs have limited features (no push notifications)

**Revisit when:** First request for Play Store presence, or when iOS PWA limitations actively hurt sales.

---

### 19 May 2026 — Tailwind v3.4, not v4

**Decision:** Lock Tailwind to 3.4.x  
**Considered:** Tailwind v4  
**Why:** v4 broke PostCSS in test runs, caused build failures. v3.4 is stable and well-supported.  
**Trade-offs accepted:** Slightly older API.  
**Revisit when:** v4 ecosystem stabilizes (~6-12 months).

---

### 19 May 2026 — Offline-first with no backend

**Decision:** No backend for v1. IndexedDB via Dexie only.  
**Considered:** Firebase, Supabase, custom API  
**Why:**
- Indian clubs often have terrible WiFi
- Owner only uses one device
- Zero hosting cost
- No latency
- Ship faster  

**Trade-offs accepted:**
- No multi-device sync
- No cross-device backup
- If owner loses phone, loses data

**Revisit when:** 3+ paying customers explicitly ask for multi-device. Then add Supabase.

---

### 19 May 2026 — Soft delete only, no hard delete

**Decision:** "Disable Table" sets `outOfService:true`, never actually deletes rows  
**Considered:** Hard delete with confirmation  
**Why:** Historical sessions reference table_id. Deleting a table breaks past data. Soft delete preserves audit trail.  
**Trade-offs accepted:** DB has stale tables forever (negligible storage).  
**Revisit when:** Users complain about clutter in Settings → add "Archived" tab and filter.

---

### 19 May 2026 — Rate snapshot per session

**Decision:** Each session stores its own `rateSnapshot` at start. Editing a table's rate later does NOT change in-progress sessions.  
**Considered:** Always use current table rate  
**Why:** Owner might edit rate mid-day. Customers playing now expected the original rate. Audit trail integrity.  
**Trade-offs accepted:** Two values to track per table (current rate vs snapshot rate).  
**Revisit when:** Never — this is a hard correctness requirement.

---

### 19 May 2026 — Timer from timestamps, never counter

**Decision:** Display elapsed = `Date.now() - startedAt - pausedTotalMs`, recomputed every render  
**Considered:** `setInterval` to increment a counter in state  
**Why:** Counter approach loses state on refresh/tab close. Timestamp approach survives anything because timestamps are stored in DB.  
**Trade-offs accepted:** Slight extra computation per render (negligible).  
**Revisit when:** Never. This is a load-bearing rule.

---

### 19 May 2026 — Mobile-first, no desktop layout

**Decision:** Design for 360px width. Desktop users see same layout in centered column.  
**Considered:** Responsive desktop dashboard  
**Why:** Target user is a phone-only club owner. Desktop is bonus, not primary.  
**Trade-offs accepted:** Desktop looks "wasteful" of space.  
**Revisit when:** First request for desktop-specific dashboard, or when admin panel needs to be built.

---

### 19 May 2026 — Indian Rupee only, no currency switching

**Decision:** Currency hardcoded to `₹`  
**Considered:** Multi-currency support  
**Why:** Target market is India only. Currency switching adds complexity for zero immediate value.  
**Trade-offs accepted:** Cannot serve non-Indian markets.  
**Revisit when:** Considering international expansion (probably never for v1-v2).

---

### 19 May 2026 — Dark theme only

**Decision:** Dark theme is the only theme  
**Considered:** Light theme toggle  
**Why:** Clubs are dimly lit. Dark UI is easier on eyes and saves battery. One theme = less code, fewer bugs.  
**Trade-offs accepted:** Some users prefer light themes.  
**Revisit when:** Customer feedback strongly asks for light theme, OR when premium tier wants a "white-glove" look.

---

### 19 May 2026 — Soft validation on player name, max 50 chars

**Decision:** Player name max 50 chars, alphanumeric + basic punctuation only  
**Considered:** No limit; allow any unicode  
**Why:** 50 chars covers "Rohit + 2", "Akash & friends, table booked by Vishal" type names. Special char filter prevents XSS-style issues and broken layout from emoji/symbols.  
**Trade-offs accepted:** Cannot store emoji or special unicode names.  
**Revisit when:** Indian-language names need devanagari or similar — then expand regex.

---

### 19 May 2026 — Subscription pricing tiers

**Decision:** ₹299 / ₹599 / ₹999 monthly. ₹599 is the target tier.  
**Considered:** ₹149 / ₹399 / ₹799  
**Why:**
- ₹149 attracts customers who churn fast and complain most
- ₹599 hits the ROI math sweet spot (18x return at ₹10k/month leakage prevention)
- ₹999 leaves room for Pro features in v2  

**Trade-offs accepted:** May lose budget-conscious owners. Acceptable — they'd churn anyway.  
**Revisit when:** 3 months in — if conversion is below 5%, lower entry tier. If above 20%, raise.

---

### 19 May 2026 — Razorpay for payments

**Decision:** Razorpay for monthly auto-debit  
**Considered:** Cashfree, Stripe (India), direct UPI  
**Why:**
- Razorpay is the dominant Indian payment provider
- Best NACH auto-debit support (critical for recurring monthly)
- Free developer tier
- Sugeet (and his customers) already familiar with it

**Trade-offs accepted:** 2% transaction fee.  
**Revisit when:** Scaling and 2% feels expensive — negotiate enterprise pricing at 500+ customers.

---

### 19 May 2026 — Skill-based project memory

**Decision:** Create a project skill with multiple reference files (architecture, design, bugs, business, etc.)  
**Considered:** Single large doc; CLAUDE.md file; nothing  
**Why:** Sugeet has multiple AI sessions over months. Each session forgets prior decisions. Skill provides persistent project memory.  
**Trade-offs accepted:** Sugeet has to remember to update the skill after sessions.  
**Revisit when:** If updates aren't happening, add stronger trigger reminders in skill description.

---

## Decisions Pending (Open Questions)

### Should signup be required before using the app?

**Options:**
- **A — Try-before-signup:** Anonymous local-only use, prompt for signup before saving to cloud
- **B — Require signup upfront:** No app access until signup
- **C — Hybrid:** Free local-only forever, signup unlocks cloud + premium features

**Pending:** Sugeet to decide.

**Sugeet's lean:** Probably A or C — wants people to try first.

---

### How to bill: per-table or flat tier?

**Options:**
- Flat tier (current plan): ₹299/₹599/₹999 with table limits
- Per-table: ₹100 per table, no tiers

**Pending:** Test market response. Flat is simpler. Per-table feels more "fair" to small clubs but harder to scale revenue.

---

### When to require Razorpay setup?

**Options:**
- Day 1 of free trial
- After trial ends (e.g., day 30)
- Soft-prompt on day 25

**Pending:** Discuss when building signup flow.

---

### 21 May 2026 — Fake payment simulation in Prompt 12, real Razorpay in Prompt 13

**Decision:** Subscribe page shows full payment UI (sheet, UPI methods, pay button) but payment is simulated with a 1.4s setTimeout. No Supabase write yet.
**Considered:** Integrating real Razorpay in Prompt 12 at the same time as the UI
**Why:** UI and payment integration are two independent concerns. Building the UI first lets Sugeet verify the flow visually before any money moves. Reduces risk of mixing UI bugs with payment bugs.
**Trade-offs accepted:** A user who goes through the flow gets confirmation screen but no real subscription. This is fine since it's pre-launch.
**Revisit when:** Prompt 13 — replace `setTimeout(1400)` with Razorpay SDK + Supabase write.

---

### 21 May 2026 — Full auth→subscribe→app funnel now live (UI only)

**Decision:** The complete user journey Landing → Signup → Subscribe → Tables is now wired as UI. All redirects work. Payment is fake.
**Flow:** `/` → Sign in → Google OAuth → `/auth/callback` → `/subscribe` → Plan selection → Fake pay → `/tables`
**What's real:** Auth (Supabase), session persistence, profile auto-create, route guards
**What's fake:** Payment (setTimeout), subscription status (not written to Supabase)
**Revisit when:** Prompt 13 (Razorpay) and beyond (Supabase subscription webhook).

---

## Decisions Rejected (Don't Reopen)

---

### 23 May 2026 — Razorpay Subscription API (not Orders API) for billing

**Decision:** Use `razorpay.subscriptions.create()` (Subscription API), not `razorpay.orders.create()` (Orders API).
**Considered:** Orders API (one-time charge), Subscription API (recurring)
**Why:** Monthly recurring billing requires the Subscription API. Orders API is one-time only. Subscription API handles NACH auto-debit, retry on failure, and the `current_period_start/end` lifecycle events that update Supabase automatically via webhook.
**Trade-offs accepted:** Can't use Razorpay Checkout for subscriptions the same way as one-time payments — `subscription_id` is passed instead of `order_id` to the checkout config.
**Revisit when:** Never — this is the correct API for recurring billing.

---

### 23 May 2026 — 7-day trial via `start_at` param (not trial_period)

**Decision:** Trial implemented by setting `start_at = now + 7 days` on the Razorpay subscription, NOT using Razorpay's built-in `trial_period` feature.
**Considered:** `trial_period` param in subscription create, manual `start_at` delay
**Why:** `start_at` gives exact control over when the first charge fires. The trial is entirely implemented on our side (Supabase `trial_ends_at` column + `useAccessGuard` date check). Razorpay just delays the first debit — no separate Razorpay "trial" to manage.
**Trade-offs accepted:** We must trust our own date math for "is trial still active?" checks.
**Revisit when:** Never — simple and working.

---

### 23 May 2026 — Webhook as source of truth, frontend optimistic

**Decision:** Webhook updates Supabase status authoritatively. Frontend calls `refreshProfile()` after Razorpay's `handler()` callback with a 1500ms delay to give webhook a head start.
**Considered:** Direct Supabase write from frontend on payment success, webhook-only
**Why:** Direct frontend write has no server-side verification (payment could be spoofed). Webhook-only means user sees no feedback until webhook fires. Hybrid: frontend shows success optimistically, webhook confirms. The 1500ms delay is a best-effort grace period; even if webhook is slow, the user can still use the app (status was written to `trialing` by `create-subscription` before Checkout even opened).
**Trade-offs accepted:** Brief window where Supabase status and Razorpay status could diverge if webhook is delayed. Acceptable for this scale.
**Revisit when:** Webhook delays become a user complaint.

---

### 21 May 2026 — Auth: Supabase + Google OAuth only (no email/password)

**Decision:** Sign in via Google OAuth only. No email/password form for v1.
**Considered:** Email + password, phone OTP, magic link
**Why:** Google OAuth is lowest friction for Indian SMB owners who all have Gmail. No password reset flows to build. Supabase handles token refresh automatically.
**Trade-offs accepted:** Users without Google account cannot sign up (extremely rare in target market).
**Revisit when:** First customer asks for non-Google login.

---

### 21 May 2026 — Auth-first app (no anonymous trial mode)

**Decision:** `/tables` requires auth + active subscription. No anonymous use of the main app.
**Considered:** Anonymous trial (use app without signup, prompt later), require auth only for cloud sync
**Why:** Subscription gating is the business model. Anonymous use makes conversion harder to track and complicates data ownership.
**Trade-offs accepted:** Higher friction to try the app. Mitigated by landing page + 7-day trial.
**Revisit when:** Conversion is very low — may need to offer a demo mode.

---

### 21 May 2026 — .env.local never committed (Supabase keys)

**Decision:** `.env.local` added to `.gitignore`. Real Supabase URL/anon key stored locally only.
**Why:** Anon key is semi-public (safe for client-side), but URL leaks project identity. Service role key (future) must never be in client code at all.
**How to apply:** On new machine, create `.env.local` manually from Supabase dashboard → Settings → API.

---

### 24 May 2026 — Home FAB: inline modal over route navigation

**Decision:** The `+` FAB on `/tables` now opens `<TableFormModal>` inline (state-driven) instead of navigating to `/settings`.
**Considered:** (a) Navigate to `/settings` (original behaviour), (b) dedicated `/add-table` route, (c) inline modal (chosen)
**Why:**
- FABs on list/grid pages should not navigate away — users expect to stay on the page
- No `/add-table` route existed; it was just `navigate('/settings')` which sent users to an entirely different screen
- Inline modal keeps context (tables grid visible behind the scrim), feels native to the app
- `<TableFormModal>` was already fully built and Settings uses it the same way — zero duplication
- `existingTables` is already in scope on Home (`useTables()` result), so no extra data fetching needed
**Trade-offs accepted:** FAB and the "Add Table" button in Settings both create tables; two entry points. Acceptable — Settings is for management, Home FAB is for quick add.
**Revisit when:** If Settings "Add Table" becomes confusing alongside Home FAB, remove one. Likely keep FAB, demote Settings button.

---

---

### 24 May 2026 — authStore.refreshProfile dedup: Option 2 (lastFetchedAt guard)

**Decision:** Add `_lastFetchedAt: number` timestamp to authStore. `refreshProfile()` is a no-op if called within 3000ms of the last fetch, unless called with `force=true`.
**Considered:**
- Option 1: Centralize — only `initialize()` calls refreshProfile; remove calls from all consumers. Rejected: Settings and Subscribe have legitimate post-mutation refresh needs that can't be removed.
- Option 2: `lastFetchedAt` guard (chosen) — single change in authStore, zero changes to call sites except adding `force=true` to the two intentional post-mutation calls.
- Option 3: useRef-guarded useEffect per consumer — only solves component-level duplication, not the initialize() + onAuthStateChange double-call inside the store itself.
**Why:** The root duplication lives inside authStore (initialize calls refreshProfile, then onAuthStateChange fires INITIAL_SESSION synchronously and calls it again). Option 2 solves it at the source. The 3000ms window is intentionally short — it covers the <100ms gap between initialize() and the INITIAL_SESSION event while still allowing legitimate forced refreshes (post-payment has a 1500ms delay before calling with force=true anyway).
**Trade-offs accepted:** If somehow two real mutations fire within 3s of each other, the second one's refreshProfile is skipped (non-forced). Acceptable — that scenario doesn't exist in the current app.
**Revisit when:** Never expected — this is a permanent correctness fix.

---

---

### 24 May 2026 — Multi-path escape design for PaymentBottomSheet (BUG-016)

**Decision:** Implement 4 independent escape paths from the payment sheet: X button, ESC key, backdrop click, "Maybe later" button.
**Considered:**
- (a) X button only — too easy to miss; ESC not obvious on mobile
- (b) X + ESC — better but still feels trapped on mobile (no explicit "I'm not ready" text)
- (c) X + ESC + backdrop + "Maybe later" text button at bottom (chosen)
**Why:** Payment sheets are high-anxiety UX moments. Any perceived trap kills trust. "Maybe later" at the bottom reassures the user before they even feel trapped. All 4 paths are disabled while `paying=true` (can't interrupt mid-payment).
**"Maybe later" behavior:** closes sheet AND sets `selectedPlan = null`, which hides StickyCheckout bar. User is back on /subscribe in plan-selection mode with no sticky prompt, giving them breathing room.
**Trade-offs accepted:** `selectedPlan` is now nullable (`PlanId | null`) — required minor type updates in StickyCheckout and PlanSelection. Small change, safe.
**Revisit when:** Never — this is the correct pattern for any payment/commitment sheet in the app.

---

### 24 May 2026 — handlePayNow: AbortController timeout + layered error handling (BUG-017)

**Decision:** Add 15-second fetch timeout (AbortController) + try/catch around every `.json()` call + HTTP 404 detection with env-specific message.
**Considered:**
- Simple try/catch only — doesn't handle hung responses (no timeout)
- Timeout only — doesn't handle empty body from 404
- Full layered approach (chosen): timeout + status checks + json try/catch + 404 special case
**Why:** Local dev with `npm run dev` returns empty 404 for /api/* routes. This is a predictable failure mode that every developer hits. The 404 message directly tells them "run vercel dev" — eliminates 10-minute debugging sessions.
**15-second timeout:** Long enough for slow mobile connections and Razorpay subscription creation (hits Razorpay API). Short enough that users know something is wrong within a reasonable time.
**Trade-offs accepted:** Slightly more complex error path in handlePayNow. Worth it — errors on payment pages are the worst user experience.
**Revisit when:** If Razorpay API latency regularly exceeds 15s, increase timeout. Currently ~1-3s in test mode.

---

---

### 24 May 2026 — Settings subscription section for unsubscribed users (BUG-013 final fix)

**Decision:** Show a "No active plan, Subscribe →" CTA card when `subscription.status === 'none'`
**Considered:**
- (a) Render `null` — hide section entirely (Phase 2A behaviour for the else branch)
- (b) Show subscribe CTA card (chosen)
**Why:** Blank space looks broken — users don't know if the section failed to load or simply doesn't apply. A CTA card both informs ("no active plan") and converts (direct path to /subscribe). Consistent with the principle of never hiding UI sections on async/conditional state — always show something meaningful.
**Files changed:** `src/pages/Settings.tsx` — else branch of the subscription ternary (lines ~363-379)
**Trade-offs accepted:** Unsubscribed users see a "Subscribe" nudge on the Settings page — could feel pushy. Acceptable: ClubKeeper requires a subscription to function; the nudge is accurate.
**Revisit when:** Never expected to need revision — this is the correct pattern.

---

## Decisions Rejected (Don't Reopen)

These were considered and rejected. Don't bring them back unless major context change:

- **Building native iOS/Android apps separately** — PWA covers both at 10% the effort
- **Using Firebase** — Supabase is preferred (cheaper at scale, Postgres > Firestore, fewer surprises)
- **Building a web admin dashboard for Sugeet** — overkill at <50 customers; manage via Supabase console
- **Allowing custom currencies** — India only, no need
- **Building a customer-facing booking app** — out of scope for v1, possibly v2+
- **Adding gamification (badges, streaks for staff)** — owner-focused product, not staff-focused

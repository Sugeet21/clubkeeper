---
name: clubkeeper
description: ClubKeeper is Sugeet's offline-first PWA for managing indoor games clubs in India (pool, snooker, carrom, PlayStation). Use this skill whenever Sugeet mentions ClubKeeper, club app, indoor games, pool table app, carrom app, table timer, session timer, or anything related to building, debugging, or extending his SaaS product. Also trigger when he discusses pricing strategy, subscription plans, payment integration (Razorpay/UPI), customer acquisition for the app, signup/auth flows, deployment to Vercel, or shares screenshots from localhost:5173 / app.handbookhq.in (or clubkeeper.vercel.app backup). Trigger even when he just shares an error or asks "what should I do next" inside this project context. This skill carries the project's full architecture, design system, code conventions, all bugs found and fixed, business context, and decision history — consult it BEFORE answering anything about the app so advice stays consistent with prior decisions.
---

# ClubKeeper — Project Memory

Persistent memory for Sugeet's ClubKeeper SaaS. Read the relevant reference files for what's being asked, then respond with full context of prior decisions.

## About Sugeet

- Solo founder in Pune, India
- Less coding experience — relies on AI to write code via Claude Code (Sonnet)
- Building ClubKeeper as recurring-income SaaS alongside HRMS SaaS and hrdocs
- Indian English, short and pragmatic. Communicates by sharing screenshots
- Prefers: ready-to-paste prompts > theoretical explanations

## About ClubKeeper

Replaces the paper notebook used at Indian indoor game clubs for tracking who plays which table, when, for how long. Target customer: small club owners (1-2 staff, ₹50k–₹5L monthly revenue) currently losing money to forgotten timers and notebook errors.

**Sales pitch frame:** "If your staff forgets to start/stop the timer 3 times a day, that's ₹10,800/month lost. My app prevents that for ₹599/month."

## ⚠️ RULE 1 — RIPPLE EFFECTS

**Before changing any code, consult `references/ripple_effects.md`.** Find what's changing, see what else it affects, update ALL affected files in the same change.

Sugeet's biggest fear: a fix in one file creates bugs in 3 other files because the AI didn't know they were connected. ripple_effects.md prevents this. If a requested change isn't documented there yet, STOP and trace dependencies manually, then add the new ripples to it.

## ⚠️ RULE 2 — PREVENT BUG REPEATS

**Before writing code in a known-bug area, read the relevant section of `references/bug_patterns.md`.** Patterns are grouped by domain — Timer, Forms, Dexie, Auth, Subscription, Routing, UI/A11y, Modals. Each entry is symptom-signature + root cause + the rule. Most bugs in this project repeat. Patterns kill that.

## Critical Rules (Never Violate)

1. **Tech stack is LOCKED.** Vite + React 18 + TypeScript + Tailwind v3.4 + Dexie + react-router-dom v6 + date-fns + Zustand + vite-plugin-pwa. Do NOT suggest swapping any. Tailwind stays on v3.4, never v4.
2. **Offline-first via IndexedDB (Dexie).** Never localStorage for session/timer data. localStorage is OK only for UI flags (e.g. "install banner dismissed").
3. **Timers use timestamps, never counters.** Always `Date.now() - startedAt - pausedTotalMs`, recomputed every render. Never `setInterval(() => setElapsed(e+1))`. #1 bug source.
4. **Indian context.** Currency `₹`, format with `toLocaleString('en-IN')`. Razorpay for payments (NACH auto-debit). UPI is the user payment method.
5. **Mobile-first.** Design for 360px width. Touch targets ≥44×44px.
6. **Dark theme only** for v1. Palette locked — see `design_system.md`.
7. **No HTML `<form>` with submit.** Use button onClick handlers.
8. **All Dexie operations awaited.** No fire-and-forget.
9. **Strict TypeScript.** No `any`.
10. **Verify with `npm run build` after every change.** TS catches most ripple breaks.
11. **Test 3 scenarios after any change:** happy path, existing-data path, edge case (empty/max/error).

## Routing — read these references on demand

| Topic | File |
|---|---|
| **ANY code change** | **`ripple_effects.md` (mandatory first)** |
| **About to touch a known-bug area** | **`bug_patterns.md` (mandatory for that area)** |
| Architecture, file structure, library choices | `architecture.md` |
| Colors, typography, spacing, components | `design_system.md` |
| Database schema, types, queries | `data_model.md` |
| Currently-active design decisions and why | `decisions_active.md` |
| Pricing, customer acquisition, sales pitch, business strategy | `business_context.md` |
| Deployment, GitHub, Vercel, CI/CD | `deployment.md` |
| What's verified end-to-end | `test_status.md` |
| When something specifically shipped, manual setup history | `changelog.md` |
| Full chronological bug log (forensic, rarely needed) | `bug_archive.md` |
| Rejected ideas, historical context (rarely needed) | `decisions_archive.md` |

Read MULTIPLE files when the question spans domains.

## Response Style for Sugeet

- **Ready-to-paste prompts** for code requests. Include file paths, validation, what NOT to do.
- **Tables for comparisons** — he reads them faster than prose.
- **Number multi-step instructions.**
- **Anticipate the next question.** End with "next, you'll probably want X."
- **Show the why briefly.** One line, not three paragraphs.
- **Indian numbers.** ₹1,00,000 not ₹100,000.
- **Match his informal tone.** Founder building fast, not a research paper.

## Current State Snapshot

*Last updated: 8 Jun 2026 (Summary dashboard rebuild + calendar icon date picker fix)*

**Built and live on app.handbookhq.in (primary) / clubkeeper.vercel.app (backup):**
- 11 screens: Tables (`/tables`), StartSession, SessionDetail, Settings, History, Summary + **Wallet (`/wallet`), WalletNewCustomer (`/wallet/new`), WalletTopup (`/wallet/topup/:id`), CustomerProfile (`/customer/:id`)** + **Canteen (`/canteen`)**
- Landing → Signup → **directly to /tables (cardless trial)** flow, all wired with route guards
- Auth: Supabase + Google OAuth (`prompt: 'select_account'` enforced)
- Payment: REAL Razorpay (TEST mode). Serverless `/api/*`: create-subscription, razorpay-webhook, cancel-subscription
- Settings: **collapsible section cards** — Club Info (default open), Tables, Subscription, Data & Backup, About, Account. Only one section open at a time. `openSection` in React state + `sessionStorage`. Subscription header shows live status badge. Tables header shows live non-disabled count. Account section shows logged-in email.
- Session Items (POS): add snacks/drinks per session with Undo, bill split, grand total
- Post-stop payment screen: **fixed-viewport no-scroll layout** — `fixed inset-0 flex-col`, QR sized `min(72vw,280px)`, Done button always pinned. UPI QR (via `qrcode` npm pkg) if `upiId` set; plain amount card if not.
- Stop Session confirm: shows rounded time preview + items + grand total before stopping
- Recent-items chips: top 8 from last 30 days appear in AddItemBottomSheet
- Summary + History: all row/day totals include items; CSV has Table Amount / Items / Total columns
- **Summary dashboard rebuild (8 Jun 2026):** `src/pages/Summary.tsx` rebuilt as end-of-day dashboard. Pure aggregation in `src/lib/summaryMath.ts`. Sub-components in `src/pages/summary/`: `RevenueDeltas.tsx` (yesterday/last week/7d avg delta chips), `RevenueSplitBar.tsx` (tables vs canteen), `HourlyHeatmap.tsx` (collapsible, default collapsed, peak hour labelled), `TopTablesList.tsx` (medal ranked), `LowStockStrip.tsx` (navigates to /canteen), `TopCanteenItems.tsx`. Header has compact 44×44 calendar icon button for date navigation. Pattern T4 compliant — DB-static in `useLiveQuery`, running sessions computed in render body. History.tsx date inputs have `cursor-pointer`. **Date picker pattern: Pattern U9** — opacity-0 full-size input overlaid over a label, NOT clip/sr-only. See bug_patterns.md §Pattern U9.
- Rounding change: warns when active sessions exist (change only affects future stops)
- **Wallet / Prepaid Credit (Phase 1 + polish + Phase 1.5):** Customers table (UUID PK, phone, walkInCode, walletBalance), WalletTransactions table (compound index `[customerId+createdAt]`). TopUp with amount/bonus chips + payment mode + UPI QR (`<UpiQrCard>`). Manual adjustment (credit/debit, mandatory notes). Walk-in codes (WALK-001…). WhatsApp receipt link. Duplicate phone blocked (inline error + "View profile →" link, no toast). Transaction history with correct ₹ sign and color for all row types. Dexie v6 backfill migration for legacy `type:'adjustment'` rows. `<UpiQrCard>` shared between WalletTopup and SessionDetail post-stop screen. TopBar has wallet icon (right side, between online dot and gear). **Phase 1.5:** `src/lib/customerDisplay.ts` centralizes display name logic — `customerDisplayName` / `phoneTail` / `customerFullLabel` / `formattedPhone`. "Walk-in" label now only for truly anonymous (no name + no phone). `EditCustomerModal.tsx` (renamed from `EditPhoneModal`) supports editing both name and phone. Entire name+phone block in CustomerProfile header is tappable. `buildWhatsAppReceiptUrl` takes `Customer` directly.
- **V1-LAUNCH plan filter:** Subscribe page and landing `/pricing` show ONLY Standard Monthly (₹599). Starter and Pro hidden via `VISIBLE_PLAN_IDS` filter in `PlanSelection.tsx` + hidden cards in `PricingSection.tsx`. All 6 Razorpay plan IDs and `PLANS` array untouched. Revert = remove filter + restore cards.
- **Canteen management (Phase 1, 7 Jun 2026):** `CanteenItem` type (`id, name, defaultPrice, stockEnabled, currentStock, isActive, createdAt, sortOrder`). Dexie v8 adds `canteenItems: '++id, name, isActive, sortOrder'`. `lowStockThreshold` setting (default 5) in `ClubSettings`. 6 query functions: `getCanteenItems(includeInactive)`, `addCanteenItem`, `updateCanteenItem`, `softDeleteCanteenItem`, `decrementCanteenItemStock`, `getLowStockThreshold`. **IMPORTANT: `getCanteenItems` uses `.filter(item => item.isActive === true)` NOT `.where('isActive').equals(1)` — Dexie boolean index quirk.** Canteen page (`/canteen`): item list with StockPill badges, add/edit via `CanteenItemFormModal`, soft-delete with confirm modal, FAB. TopBar: cart icon (between online dot and wallet) navigates to `/canteen`.
- **Canteen POS stock sync — full coverage (8 Jun 2026):** Three coordinated fixes shipped in one commit:
  1. **`src/lib/canteenMatch.ts` (NEW):** Pure utility — `normalizeName(name)` (trim+lowercase+collapse spaces), `findMatchingCanteenItem(name, price, canteenItems)`, `findCanteenItemByName(name, canteenItems)`. No Dexie imports.
  2. **AddItemBottomSheet — all add paths now sync stock:** (a) Canteen chips tap directly → `handleCanteenChipTap` adds item + decrements stock in one inline flat tx; (b) Quick Add chips filtered to canteen-matched recent items ONLY (non-canteen recent items no longer appear); (c) manual form collapsed behind `+ Add other item` button (default hidden, expands on tap, collapses on successful add); (d) manual submit matches by `(name, price)` → runs same inline tx; (e) price-mismatch inline warning if name matches canteen but price differs — "Use ₹X" button auto-confirms; (f) `addOrIncrementSessionItem` — freeform path uses this new helper that merges into existing row by `(sessionId, normalizeName(name), price)` instead of always inserting; (g) repeated chip taps increment qty on existing row (merge-on-add), not new rows.
  3. **`updateSessionItem` / `deleteSessionItem` / `restoreSessionItem` — all three now sync stock atomically:** Each opens `db.transaction('rw', db.sessionItems, db.canteenItems, ...)` with stock logic INLINED via private `findMatchingCanteenItemForRow`. `InsufficientStockError` class (exported) thrown when qty-up edit or Undo would push stock negative — tx rolls back both writes atomically. Edit modal shows inline error via `setError` (Pattern F7). Undo callback catches it and shows a toast (justified exception — no inline surface once toast dismisses). Delete always succeeds (stock goes up). `restoreSessionItem` return type changed to `Promise<void>` (was `Promise<number>`; return value was unused).
  - **Pattern D7 invariant:** ALL stock logic across all six paths (3 add + 3 mutate) is inlined inside a single flat outer tx. Zero calls to `decrementCanteenItemStock` or `addOrIncrementSessionItem` from inside any outer transaction. Both remain safe to call standalone.
  - **Known limitation (tracked):** Editing qty down via the edit modal restores canteen stock correctly now. Freeform rows (no canteen match) never touch stock in any path.
- **Table Move — Phase 1 (8 Jun 2026):** Players can move a running or paused session to a different empty table of the same game type, billing mode, and rate — keeping one continuous session with one bill.
  - **Data:** `TableMove` interface (`fromTableId, toTableId, movedAt`). `Session.tableMoves?: TableMove[]` (Dexie v9, optional, no index). `session.tableId` always points to the CURRENT table after any moves.
  - **Query:** `moveSessionToTable(sessionId, toTableId)` — single `db.transaction('rw', db.sessions, db.gameTables)`. Validates: status is running/paused; dest exists + not outOfService; gameType matches; billingMode rate matches (per_hour → ratePerHour, per_frame → ratePerFrame); dest not occupied by any active session. Throws `IncompatibleTableError` or `TableOccupiedError` — both exported for typed UI catches.
  - **SessionDetail UI:** "Add Item" button → "Move table" button → "Edit Start Time" (order: Add Item is higher, used far more often). "Move table" hidden for completed sessions. Modal: list phase shows compatible free tables with "Same rate (₹X/hr|frame)" subtitle; confirm phase shows from→to names; inline error on race conditions. Table Journey row ("Pool 1 → Pool 2 → Pool 3") above bill split when `tableMoves.length > 0`.
  - **History:** `↻ N tables` appended to time range line when moves present.
  - **Home page:** No code change — `sessionMap` is keyed by `s.tableId` which Dexie updates; live query re-fires automatically. Old table goes free, new table goes occupied.
  - **Scope exclusions:** No cross-game-type moves. No per-segment billing. No move undo. No swap of two running sessions.
- **Subscribe back-button fix (8 Jun 2026):** `handleBack` in `Subscribe.tsx` now checks `headline.kind`. `'early'` (mid-trial, tapped Manage) → navigates to `/tables` freely. `'expired'` and `'welcome'` → show nag warning toast and stay on page.
- **Auth race fix (7 Jun 2026):** `subscriptionLoaded` boolean flag in authStore. Set `true` after `refreshProfile()` resolves in both `initialize()` and `onAuthStateChange`; set `false` on sign-out. `useAccessGuard` returns `{ canAccess: false, reason: 'subscription_loading' }` while `!subscriptionLoaded`. `RequireAccess` shows spinner for this reason. Prevents `subscription===null` being misread as `no_subscription` in the window between `loading=false` and `refreshProfile()` completing. Critical for any new private route that Dexie-queries on mount.
- **Alarm / Notify-at (Phase 2):** Per-session optional alarm. Threshold persisted on `Session.notifyAtMs` (Dexie v7, absolute Unix ms). Settable from BOTH `StartSession` (duration from session start) AND `SessionDetail` edit pill (duration from now). Chip presets in `src/lib/notifyPresets.ts` — 30 min / 1 hr / 1.5 hr / 2 hr / custom 1–600 min. Detection: `useSessionAlarm` — Pattern T1 timestamp comparison, `status === 'running'` only, paused sessions deferred, completed sessions excluded via `activeSessions`. Visibility: passive bell icon on table card (`Home.tsx`) when armed + unacknowledged; pulsing on running sessions. Edit pill on `SessionDetail` shows armed time + opens Modal to change/remove. Snooze anchors to original `notifyAtMs` (Pattern T6) with `Date.now()` fallback if past. Sound via `src/lib/alarm.ts` (gain 1.0, looped, 60-sec cap, iOS unlock). Wall-clock semantics — pause does NOT shift `notifyAtMs`.
- **Cardless 7-day trial (Phase 1 + 1.5 + duplication fix + banner two-state split):** New signups land directly on `/tables` — no card required. Postgres trigger `handle_new_user()` creates `status='trialing'` + `trial_ends_at = now()+7d` on every new signup. `useAccessGuard` reason values: `trial_expired` (trialing + past date), `no_subscription` (none/cancelled/expired). `RequireAccess` passes `state: { reason: 'trial_expired' }` on redirect. `AuthCallback` routes by status: active/past_due/trialing-active → `/tables`; trialing-expired → `/subscribe` with state. **`SubscriptionStatusBanner` trialing branch is split in two:** (a) `!razorpaySubscriptionId` → "Free trial: N days left · Manage →" to `/subscribe` with `state: { reason: 'subscribe_early' }`; (b) `razorpaySubscriptionId` present → "Subscribed ✓ — ₹599 will be charged on {d MMM} · View →" sets `sessionStorage('ck_settings_section', 'subscription')` then navigates to `/settings`. **Subscribe page three-branch headline (all in Subscribe.tsx):** `expired` ("Your free trial has ended"), `early` ("Subscribe early to lock in ₹599/month" + days left + trial-end date `d MMM`), `welcome` ("Welcome, {Name} 👋 / Start your 7-day free trial"). `HeadlineState` discriminated union computed via `useMemo` — `location.state.reason` takes priority, falls back to live subscription state on refresh. All three branches live in `Subscribe.tsx`; `PlanSelection` always receives `hideWelcome={true}` and never renders its own welcome header. Migration file: `supabase/migrations/20260602_cardless_trial.sql` (run manually in SQL editor).
- PWA install support
- Playwright suite: 8 spec files × 3 viewports
- GitHub: `github.com/Sugeet21/clubkeeper`
- Supabase project: `vkczmgzujpidbwtzulel.supabase.co`
- Razorpay plan IDs: single source of truth in `src/lib/razorpayPlans.ts`
- ✅ End-to-end payment verified on production (TEST mode)
- Per-user IndexedDB: DB name is `ClubKeeperDB_<userId>`. Two Gmail accounts on same browser see isolated data. `db` export is a Proxy; `authStore` manages `initDbForUser` / `closeDb` lifecycle. `dbReady` flag gates all private routes via `useAccessGuard`.

**Dexie version history:**
- v1/v2: gameTables + sessions + settings
- v3: added sessionItems table (`++id, sessionId, addedAt`)
- v4: documents `upiId` field on settings (no index)
- v5: adds `customers` + `walletTransactions` tables; `ClubSettings.walkInCounter?` field
- v6: one-time `.upgrade()` backfill of legacy `type:'adjustment'` wallet transaction rows
- v7: adds optional `notifyAtMs` + `notifyAcknowledgedAt` fields on sessions (alarm feature, no new index)
- v8: adds `canteenItems` table (`++id, name, isActive, sortOrder`). New `CanteenItem` type and `lowStockThreshold` on `ClubSettings`.
- **v9 (current): adds optional `tableMoves` field to sessions (`TableMove[]`). No index. No `.upgrade()` — undefined = zero moves on legacy rows.**

**⚠️ Razorpay key rotation warning:** If `VITE_RAZORPAY_KEY_ID` or `RAZORPAY_KEY_SECRET` is ever rotated, or LIVE mode is enabled, the 6 plan IDs in `razorpayPlans.ts` MUST be re-verified against the new account. Run: `curl -u KEY_ID:KEY_SECRET https://api.razorpay.com/v1/plans/PLAN_ID` — expect 200. See Pattern S5.

**⚠️ Supabase migration pending manual run:** `supabase/migrations/20260602_cardless_trial.sql` must be pasted into the Supabase SQL editor and executed. Until this runs, new signups still get `status='none'` (old trigger behavior) and land on `/subscribe` instead of `/tables`. Existing `status='none'` users also not backfilled yet.

**Pending (not blockers):**
1. **Run `supabase/migrations/20260602_cardless_trial.sql` in Supabase SQL editor** — cardless trial doesn't work until this is done
2. Vercel webhook config: Razorpay Dashboard → add `/api/razorpay-webhook` URL + `RAZORPAY_WEBHOOK_SECRET` env var → redeploy
3. ~~**Phase 3: Razorpay `start_at` honoring remaining trial**~~ — **DONE (Phase 3 Commit 2, 4 Jun 2026).** `create-subscription.ts` reads `trial_ends_at` from Supabase and uses 3-scenario logic. `mid_trial` path sets `start_at = existing trial_ends_at`. See Pattern S8.
4. Razorpay LIVE mode switch (needs KYC first)
5. BUG-013 visual verification of `status='none'` card
6. GST invoicing + email notifications (next sprint)
7. PWA stale service worker on regular Chrome — needs "Update Available" banner so users get new deploys without hard-refresh
8. Manual test of Build Prompt 3 validation checklist (Settings collapsibles, payment QR fits viewport, all actions still work)
9. One-time migration from old `ClubKeeperDB` → `ClubKeeperDB_<userId>` for any existing user who had data before this change (write migration script when first customer reports missing data)
10. Playwright specs may need updating — selectors looking for old Settings labels (e.g. "CLUB INFO" allcaps) need to target "Club Info" and the new collapsible structure
11. **Wallet Phase 2:** Session-end "Pay from Wallet" deduction UI. Data model ready — `WalletTransaction.referenceType: 'session'` is the pattern.
12. **Wallet Phase 3:** Refund UI. New debit row with `referenceType: 'refund'` + mandatory notes.

**Known limitations:**
- **LIMIT-001 (partially fixed):** IndexedDB is now per-user per-browser (`ClubKeeperDB_<userId>`). Two Gmail accounts on the same browser see separate data. Cross-device sync is still not implemented — same account on Chrome vs Edge sees different data. Full fix requires cloud sync (Supabase). Warn Sugeet if he asks for multi-device access.
- **LIMIT-002:** `/api/*` requires `vercel dev` locally, not `npm run dev`. Handled with friendly 404 error in `handlePayNow`.

## Updating This Skill

After every meaningful session:
1. **New bug fixed?** Append entry to `bug_archive.md`. If it's a new class of bug or matches an existing pattern → update the relevant section of `bug_patterns.md`.
2. **New active decision?** Append to `decisions_active.md`. If it supersedes an old one → move the old one to `decisions_archive.md`.
3. **Feature shipped?** Update Current State Snapshot above + append to `changelog.md`.
4. **Pricing/business shift?** Update `business_context.md`.
5. **New architectural pattern?** Update `architecture.md`.

At end of substantial sessions, proactively ask: "Want me to update the skill with what we just decided?"
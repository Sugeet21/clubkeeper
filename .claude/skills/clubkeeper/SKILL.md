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
12. **TopBar has NO gear icon.** Settings is reachable ONLY via bottom-nav. Do not re-add a gear to TopBar under any circumstance.
13. **Desktop modal behaviour:** shared `<Modal>` becomes a centered dialog at `md:` and up. `PaymentSplitSheet` is the ONLY non-shared bottom-sheet that also goes centered on desktop. `RestockSheet` and `PaymentBottomSheet` stay true bottom-sheets on every viewport. Container cap for centered desktop pages is `max-w-[1400px] mx-auto` (NOT `max-w-5xl` — rejected by owner as "most of the space is empty"). FAB and modals stay OUTSIDE the centered wrapper.

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

## Current State

One entry per module. Overwrite in place when status changes — never append a second entry for the same module. For phase-by-phase history, build sizes, commit SHAs, and dates, see `changelog.md` and `git log`.

- **Desktop responsiveness (#91)** — Verified by owner. Tables, Canteen, Bookings, shared `<Modal>`, QuickSale, PaymentSplitSheet desktop-responsive. Settings page + Wallet topup success screen still mobile-only.
- **Advance booking (#84)** — Phase 1 code-complete end-to-end: owner-side surfaces, player flow at `/c/<slug>/book`, session linkage + advance-as-prepaid, cancellation, no-show sweep. Pending owner E2E verification.
- **Pricing visibility (#84 Phase 0)** — Player Hub shows collapsible "View pricing" card. Gated on `acceptsPricingDisplay` + `tables_json` populated.
- **Player Hub + topups** — Owner slug + accept-topups toggle live. Player `/c/:slug` form → UPI → "I've paid" polling. Realtime channel `topup_intents_{clubId}` with 30s polling fallback. Pending count in `topupInbox` Zustand store. `/poster/:slug` auto-prints.
- **ClubCoins** — Off by default. Tiered earn on topup, configurable redemption, FIFO expiry sweep every 4h (`ExpirySweepRunner` in `App.tsx`).
- **Engagement** — Welcome bonus, streak bonus, dormancy nudges, BringBackList. All off by default; configured in `PlayerHubSettings`.
- **Wallet / prepaid credit** — Customers, walletTransactions, top-ups, manual adjustments, walk-in codes, WhatsApp receipts. Refund UI still pending (Phase 3).
- **Canteen management + POS stock sync** — Item CRUD, stock pills, RestockSheet, all 6 add/mutate paths sync stock atomically inside one flat tx. Freeform rows never touch stock.
- **Peak Hour Pricing (#68)** — Phase 1 shipped: Dexie v18 schema + Settings toggle/window picker with `PeakWindowBottomSheet`. Phases 2–4 (Canteen card layout, AddItem/QuickSale chips with `PEAK` tag, bulk-edit modal + onboarding banner) pending. Pending owner verification on laptop + phone.
- **Quick Sale (`/quick-sale`)** — Walk-in canteen sales with PaymentSplitSheet. `createCanteenSale` single flat tx with stock check.
- **Split payments + PAYMENT MODE + Piggy** — `Session.paymentBreakdown`, PaymentSplitSheet shared across SessionDetail + QuickSale, PAYMENT MODE + CASH FLOW summary strips, `/piggy` page, RestockSheet sources Piggy/Other. Mandatory payment capture (no "Skip"). v13 backfill caveat — items revenue missing from `paymentBreakdown.cash` for pre-v13 sessions; defer until owner notices.
- **Table Move (Phase 1)** — Move running/paused session to another empty same-game-type, same-rate table. Single continuous bill. No cross-type, no per-segment billing, no undo.
- **Back Entries** — Log past completed sessions from paper notebook with canteen items, rate-card snapshots, overlap + stock checks. `per_frame` tables excluded.
- **Rate card + tolerance billing (Phase 1)** — Per-table tiers + tolerance + `'minimum' | 'prorated'` billing mode. Snapshots captured on session. Rounding setting ignored on rate-card sessions.
- **Alarm / Notify-at (Phase 2)** — Per-session optional alarm, `Session.notifyAtMs` (absolute Unix ms, wall-clock semantics — pause does NOT shift). Snooze anchors to original `notifyAtMs`.
- **Summary dashboard** — End-of-day dashboard with revenue deltas, split bar, hourly heatmap, top tables/items, low stock, PAYMENT MODE + CASH FLOW strips. Pattern T4 — DB-static deps, running sessions in render body. Date picker = Pattern U9.
- **Auth + cardless trial** — Supabase + Google OAuth, `select_account` enforced. 7-day cardless trial via Postgres `handle_new_user()` trigger. Three-branch Subscribe headline (`expired` / `early` / `welcome`). `useAccessGuard` returns `subscription_loading` while `subscriptionLoaded === false` to prevent race.
- **Subscription (Razorpay)** — TEST mode verified end-to-end on production. Serverless `api/create-subscription`, `api/razorpay-webhook`, `api/cancel-subscription`. V1-LAUNCH filter shows only Standard Monthly (₹599) — Starter + Pro hidden via `VISIBLE_PLAN_IDS`.
- **Settings** — Collapsible section cards (Club Info, Tables, Subscription, Piggy, Data & Backup, About, Account). Only one section open at a time. Subscribe header shows live status badge.
- **Import / Export** — `getAllDataForExport` covers all stores incl. `schemaVersion` + `exportedAt`. `importEverythingFromFile` is single atomic tx with 7 typed failure reasons. DEV-only round-trip self-test on `window.__importEverythingFromFile`.
- **PWA + deployment** — `vercel.json` SPA rewrite (excludes `/api/*`), all PWA icons in `public/`. Per-user IndexedDB `ClubKeeperDB_<userId>` (two Gmail accounts on one browser = isolated data). `db` is a Proxy; `authStore` manages `initDbForUser` / `closeDb`.
- **Bug tracking** — All bugs as GitHub issues at github.com/Sugeet21/clubkeeper/issues. `bug_archive.md` has one-line pointers only.

## Pending — load-bearing, delete when done

Things that BLOCK something if forgotten. Delete the line the moment it's resolved.

- **Migration: `supabase/migrations/20260618_booking_cancel.sql`** — adds `cancel_booking_intent` RPC. Until run, player Cancel button surfaces generic "Could not cancel" error. Owner-side reconcile + no-show sweep work without it.
- **Migration: `supabase/migrations/20260619_booked_slots_rpc.sql`** — anon `get_booked_slots` RPC for #90. Until run, player time picker shows everything available.
- **Migration: `supabase/migrations/20260616_pricing_visibility.sql`** — adds `tables_json` + `accepts_pricing_display` + RPC update. Player Hub pricing card stays hidden until run AND owner re-saves a table.
- **Migration: `supabase/migrations/20260610_player_hub.sql`** — creates `clubs` + `topup_intents` + `get_club_public_info` RPC. ⚠ Confirm if already run in production.
- **Migration: `supabase/migrations/20260610_clubcoins.sql`** — adds `coins_enabled` + `coin_tiers_json`. ⚠ Confirm if already run.
- **Migration: `supabase/migrations/20260602_cardless_trial.sql`** — cardless trial broken until done (new signups land on `/subscribe`, not `/tables`).
- **Razorpay LIVE mode switch** — needs KYC first.
- **Vercel webhook config** — Razorpay Dashboard → add `/api/razorpay-webhook` URL + `RAZORPAY_WEBHOOK_SECRET` → redeploy.
- **GST invoicing + email notifications** — next sprint.
- **PWA update banner (S6)** — needs `useRegisterSW` + banner UI; without it, users on old SW don't get new deploys without hard refresh.
- **Wallet Phase 3 (refund UI)** — `referenceType: 'refund'` + mandatory notes.
- **PAYMENT MODE backfill (v13 follow-up)** — `paymentBreakdown.cash` understates pre-v13 sessions by items value. Defer until Ball Bender notices.
- **`_clubSyncDone` bug (`useLiveData`)** — module-level flag never resets on sign-out → second user to sign in on same tab skips club sync. Fix: reset flag in auth sign-out path.
- **Session persistence** — `storage` option removed from `createClient` by linter. Monitor if session drops recur in production.
- **Razorpay key rotation warning** — if `VITE_RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` is ever rotated or LIVE mode is enabled, the 6 plan IDs in `razorpayPlans.ts` MUST be re-verified. See Pattern S5.

## Known limitations

- **LIMIT-001 (partially fixed):** IndexedDB is per-user per-browser (`ClubKeeperDB_<userId>`). Two Gmail accounts on same browser = isolated data. Cross-device sync still not implemented — same account on Chrome vs Edge sees different data. Full fix requires cloud sync (Supabase). Warn Sugeet if he asks for multi-device access.
- **LIMIT-002:** `/api/*` requires `vercel dev` locally, not `npm run dev`. Handled with friendly 404 error in `handlePayNow`.
- **LIMIT-003 (multi-device sync request count: 2/3):** Two paying customers have asked (Customer #1: 12-table club, 7 Jun 2026; Customer #2: Ball Bender 4-partner club, 9 Jun 2026). Threshold per decision is 3+. Keep deferring full Supabase sync. Interim for Ball Bender: "Shift Handover" JSON export/import (not yet built; defer until they complain).

## Dexie schema — current

**Current version: v18** — adds Peak Hour Pricing (#68) optional fields: `CanteenItem.peakPrice?` and `ClubSettings.peakPricingEnabled?/peakStartHour?/peakStartMinute?/peakEndHour?/peakEndMinute?`. Additive only, no `.upgrade()`, no index changes.

Full version history (v1–v17) lives in `changelog.md`. When bumping the version, also update `CURRENT_SCHEMA_VERSION` in `queries.ts`, the backup interface alias, `getAllDataForExport` + `importEverythingFromFile` + `resetEverything` + `importExportRoundTrip` (Pattern D10).

## Bug Tracking — GitHub Issues

**As of 14 Jun 2026, bugs are tracked at: https://github.com/Sugeet21/clubkeeper/issues**

- **67 issues created** covering all bugs from bug_archive.md + the June 2026 audit
- **Issues #1–54:** fixed bugs (all closed with commit reference)
- **Issues #55–67:** open bugs from the audit (A1–A5, P1–P2, W1–W2, S1–S2, R1–R2)
- **Q1 skipped:** was a false alarm — null-guard already existed in PlayerScan.tsx:102

`bug_archive.md` now contains one-line pointers only. Full description, root cause, and fix details live on GitHub.

**When Sugeet reports a new bug or set of bugs — MANDATORY ORDER:**

1. **STOP. Do NOT write any code yet.** First, search GitHub for prior occurrences:
     gh issue list --search "<keywords>" --state all --repo Sugeet21/clubkeeper
   If a similar issue exists, reference it. Do not create a duplicate.

2. **Create a GitHub issue for EACH distinct bug** before any code change:
     gh issue create --repo Sugeet21/clubkeeper \
       --title "BUG-XX — <short symptom>" \
       --label "bug,priority-<p0|p1|p2>,domain-<area>,status-open" \
       --body "<symptom / repro / expected / suspected root cause / files likely affected>"
   Multiple bugs in one report = multiple issues. Never bundle.

3. **Reply to Sugeet with the issue numbers and links** before writing fix code. Wait for his go-ahead.

4. **Fix the bug.** Reference the issue number in the commit message:
     git commit -m "fix(<area>): <one-line>  (closes #NN — pending owner verification)"

5. **NEVER close the issue yourself.** After the commit, post a comment on the issue with the commit SHA and a one-line of what was changed. Then explicitly ask Sugeet:
     "Issue #NN — fix committed in <SHA>. Please verify on your device. Reply 'close #NN' (or 'closed') only after you've tested it. I will not close it until you do."

6. **Only close after Sugeet confirms.** When Sugeet replies "close #NN" / "closed" / "verified" for that specific issue number:
     gh issue close NN --repo Sugeet21/clubkeeper --comment "Verified by owner. Fixed in <SHA>."
   Then update the bug_archive.md pointer to add the SHA.

**This rule overrides any urge to be efficient.** Even if a bug is trivial and the fix is one line, the issue gets created first and stays open until Sugeet says close. The only exception is a typo/wording fix Sugeet asked for in plain English with no symptom — those don't need an issue.

## Updating This Skill — MANDATORY RULES

### Rule A: Update skill AFTER EVERY PHASE, not after the module
When Opus gives multi-phase prompts, the skill MUST be updated at
the end of EACH phase before moving to the next. Compaction will
eat details otherwise.

### Rule B: Every src/ commit needs a paired skill commit
If you change anything in src/, you MUST update at least one of:
changelog.md, ripple_effects.md, bug_archive.md, decisions_active.md,
or Current State Snapshot in SKILL.md — in the same working session.
Run `git log --since="2 hours ago" --name-only` before declaring
"done" — if src/ files appear but no skill files do, the skill is
stale. Fix it before stopping.

### Rule C: Bugs go to GitHub Issues, not bug_archive.md
New bugs → `gh issue create` with the format established in
github.com/Sugeet21/clubkeeper/issues. bug_archive.md only gets a
one-line pointer. Full description, discussion, and fix details live
on GitHub.

### Rule D: Before fixing any bug in a known-bug area
1. Read the relevant section of bug_patterns.md (existing rule).
2. Search GitHub issues for prior occurrences:
     gh issue list --search "<keywords>" --state all
   If a similar issue exists (open or closed), read it before writing
   code. Reference it in your commit message.

### Rule E: At end of every session
Proactively ask Sugeet: "Skill update checklist:
- changelog.md updated?
- ripple_effects.md updated for files touched?
- Any new bug → GitHub issue created?
- Any new pattern → bug_patterns.md updated?
- Current State Snapshot still accurate?"
Do NOT skip this. Sugeet has explicitly asked for this check.

### Rule F: Bug fix flow — issue first, owner closes last
- New bug report → create GitHub issue(s) BEFORE writing any code
- One bug = one issue. Never bundle multiple bugs into one issue.
- After commit, post SHA as comment on the issue and ask Sugeet to verify
- Only Sugeet's explicit "close #NN" / "closed" / "verified" triggers `gh issue close`
- The AI never auto-closes an issue, even if the fix is trivial or "obviously works"

### Rule G: Current State is OVERWRITE, not APPEND
The "## Current State" section has ONE entry per module. The section is a snapshot of "what is true now", not a log of "what happened". Before adding to it:

1. **Grep the section for the module name first** (e.g. "Advance booking", "Canteen", "Wallet"). If an entry exists → use `Edit` to replace it in place. NEVER append a second entry for the same module.
2. **Each entry is one line.** Format: `**Module name (#issue if relevant)** — one-line current state.` No bullet sub-lists. No build sizes. No commit SHAs. No dates inside the line.
3. **Phase-by-phase history, commit SHAs, build sizes, "shipped on X date" all belong in `changelog.md` and `git log`** — NOT in the snapshot. If a fact is already in `git log` or `changelog.md`, do not duplicate it here.
4. **"Pending" entries get deleted (not archived, not struck-through) the moment they're resolved.** A pending migration is "load-bearing" — something breaks if it's forgotten. If it's not load-bearing, it doesn't belong in Pending.
5. **Newly-discovered hard invariants get promoted** to "Critical Rules (Never Violate)" or `bug_patterns.md` — they do NOT live in the snapshot. "Do not re-add the TopBar gear" is a rule, not a snapshot fact.
6. **At end of every session,** as part of Rule E, also ask: "Did any Current State entry need overwriting? Any Pending entry resolved? Any new invariant to promote?"
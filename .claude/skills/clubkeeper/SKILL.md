---
name: clubkeeper
description: ClubKeeper is Sugeet's offline-first PWA for managing indoor games clubs in India (pool, snooker, carrom, PlayStation). Use this skill whenever Sugeet mentions ClubKeeper, club app, indoor games, pool table app, carrom app, table timer, session timer, or anything related to building, debugging, or extending his SaaS product. Also trigger when he discusses pricing strategy, subscription plans, payment integration (Razorpay/UPI), customer acquisition for the app, signup/auth flows, deployment to Vercel, or shares screenshots from localhost:5173 / clubkeeper.vercel.app. Trigger even when he just shares an error or asks "what should I do next" inside this project context. This skill carries the project's full architecture, design system, code conventions, all bugs found and fixed, business context, and decision history — consult it BEFORE answering anything about the app so advice stays consistent with prior decisions.
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

*Last updated: 25 May 2026 (post Razorpay+Auth bug session, commits `7ad20b1`–`b99388b`)*

**Built and live on Vercel:**
- 6 screens: Tables (home `/tables`), StartSession, SessionDetail, Settings, History, Summary
- Landing → Signup → Subscribe → Tables flow, all wired with route guards
- Auth: Supabase + Google OAuth (`prompt: 'select_account'` enforced)
- Payment: REAL Razorpay (TEST mode). Serverless `/api/*`: create-subscription, razorpay-webhook, cancel-subscription
- Settings has Subscription section (plan/status/next-charge/cancel/change-plan); `status='none'` shows Subscribe CTA card
- PWA install support
- Playwright suite: 8 spec files × 3 viewports
- GitHub: `github.com/Sugeet21/clubkeeper`
- Supabase project: `vkczmgzujpidbwtzulel.supabase.co`
- Razorpay plan IDs: single source of truth in `src/lib/razorpayPlans.ts`
- ✅ End-to-end payment verified on production (TEST mode) — free trial subscription created successfully

**⚠️ Razorpay key rotation warning:** If `VITE_RAZORPAY_KEY_ID` or `RAZORPAY_KEY_SECRET` is ever rotated, or LIVE mode is enabled, the 6 plan IDs in `razorpayPlans.ts` MUST be re-verified against the new account. Run: `curl -u KEY_ID:KEY_SECRET https://api.razorpay.com/v1/plans/PLAN_ID` — expect 200. See Pattern S5.

**Pending (not blockers):**
1. Vercel webhook config: Razorpay Dashboard → add `/api/razorpay-webhook` URL + `RAZORPAY_WEBHOOK_SECRET` env var → redeploy
2. Razorpay LIVE mode switch (needs KYC first)
3. BUG-013 visual verification of `status='none'` card
4. GST invoicing + email notifications (next sprint)
5. PWA stale service worker on regular Chrome — needs "Update Available" banner so users get new deploys without hard-refresh

**Known limitations:**
- **LIMIT-001:** `/api/*` requires `vercel dev` locally, not `npm run dev`. Handled with friendly 404 error in `handlePayNow`.
- IndexedDB is per-browser-origin, not per-user. Deferred until cloud sync. Warn Sugeet if he asks for multi-staff login on one phone.

## Updating This Skill

After every meaningful session:
1. **New bug fixed?** Append entry to `bug_archive.md`. If it's a new class of bug or matches an existing pattern → update the relevant section of `bug_patterns.md`.
2. **New active decision?** Append to `decisions_active.md`. If it supersedes an old one → move the old one to `decisions_archive.md`.
3. **Feature shipped?** Update Current State Snapshot above + append to `changelog.md`.
4. **Pricing/business shift?** Update `business_context.md`.
5. **New architectural pattern?** Update `architecture.md`.

At end of substantial sessions, proactively ask: "Want me to update the skill with what we just decided?"
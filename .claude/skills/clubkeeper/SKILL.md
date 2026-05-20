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

**Last updated:** 19 May 2026

**Completed:**
- Prompts 0-6 done: project setup, data layer, all 4 main screens (Home, Summary, History, Settings), Add/Edit Table, PWA install support
- Prompt 7 done: bug fixes including toggle alignment, date picker theme, time rounding wired into stopSession, soft-delete renamed to Disable Table
- Prompt 8 done: validation & overflow fixes — see details below
- Deployed to Vercel: `clubkeeper.vercel.app` (or similar — confirm with Sugeet)
- GitHub: `github.com/Sugeet21/clubkeeper`
- Test sections A-D run by Sugeet; A12, B9, B10 bugs confirmed and now fixed

**Prompt 8 — what was shipped:**
- `src/lib/validation.ts` created: `validatePlayerName` (50 chars, regex), `validateNote` (200 chars), `validateTableName` (30 chars, regex)
- `src/store/toastStore.ts` created: Zustand toast store, 3s auto-dismiss
- `src/components/ToastContainer.tsx` created: fixed top, theme-aware (success/error/info), mounted in App.tsx
- `getRecentPlayerNames()` in queries.ts: now filters out names that fail validation (cleans polluted history)
- `TableFormModal.tsx`: checks `getActiveSessionForTable` on open; Disable button disabled + warning shown; race-condition re-check with toast if session starts between check and confirm
- `StartSession.tsx`: player name `maxLength=50`, per-keystroke validation + error, Start button disabled on invalid; note `maxLength=200`; suggestion chips use `flex-wrap max-h-24 overflow-y-auto` + `max-w-[150px] truncate`
- `TableCard.tsx`: player name gets `max-w-[140px] truncate` in both Running and Paused cards
- `SessionDetail.tsx`: `DetailRow` value gets `truncate min-w-0 flex-1 text-right`; container gets `gap-3 min-w-0`
- `Settings.tsx`: "Clean Invalid Player Names" button → confirm modal → iterates sessions, nulls invalid names, shows toast with count

**Pending:**
- Manual device test of A12, B9, B10 after Prompt 8
- Test sections E-L still to run
- Signup/Signin pages (next priority for Sugeet)
- Subscription/pricing page
- Razorpay payment integration

**Open Questions:**
- Final pricing tier numbers (starter/standard/pro)
- Whether to require auth before letting users add tables, or allow anonymous trial first
- How to migrate existing offline-only data when adding cloud sync later

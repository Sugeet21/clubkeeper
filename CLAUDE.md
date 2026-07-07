# ClubKeeper — CLAUDE.md

Project memory and rules for Claude Code sessions on this repo.

## Quick orientation

Indoor games club management PWA. Offline-first. Indian market. Vite + React 18 + TypeScript + Tailwind v3.4 + Dexie + Zustand + react-router-dom v6.

Full project memory lives in `.claude/skills/clubkeeper/` — load the skill before answering anything about this codebase.

## Mandatory reading order before any code change

1. `.claude/skills/clubkeeper/SKILL.md` — laws, workflow, loading map
2. `.claude/skills/clubkeeper/STATE.md` — what is true RIGHT NOW (module status, pending blockers, open P0/P1s, migration ledger)
3. `.claude/skills/clubkeeper/references/ripple_effects.md` — what breaks when you change X
4. `.claude/skills/clubkeeper/references/bug_patterns.md` — bug classes already solved (don't repeat them; an older revision of this file pointed at a nonexistent "bug_history.md")

## Project agents — default is main thread

Three scope-restricted helper agents live in `.claude/agents/`:

- `clubkeeper-explorer` — read-only navigation (Read/Grep/Glob). Use for "where is X called", "what does ripple_effects say about Y". Returns `file:line` citations.
- `clubkeeper-reviewer` — fresh-eyes diff review (Opus). Use BEFORE commit on chunks >100 LOC of new code. Returns `VERDICT + violations`; does NOT auto-fix.
- `clubkeeper-skill-auditor` — Phase 4 close gate. Checks Rule B/E/G + memory-link integrity.

**Decision rule:** "Does the intermediate work matter?" YES → main thread. NO → subagent.

**NEVER create or use:** debug agent, test-runner agent, sequential pipeline agent, expert-persona agent, auto-fix agent. Forbidden delegations: live debugging, `npm run build`, design/planning, anything in Phase 3 EXECUTE beyond a discrete lookup, bug RCA.

Full rules in SKILL.md `## Project Agents` section + Rule J.

## Hard rules (never violate)

- **Tailwind v3.4 only.** Never upgrade to v4.
- **No `any` type** in `src/` files. Strict TypeScript throughout.
- **No HTML `<form>` with submit.** Button `onClick` only.
- **All async ops awaited.** No fire-and-forget.
- **Dark theme only.** Color palette locked — see `references/design_system.md`.
- **Mobile-first, 360px target width.**
- **Indian context:** `₹` currency, `toLocaleString('en-IN')` for amounts.
- **Run `npm run build` after every meaningful change.** Stop and report if it fails.

## api/*.ts files — extra rules

Vercel serverless functions use Node16 module resolution, which is stricter than Vite:

1. All relative imports MUST have `.js` extension:
   Wrong: `import { PLANS } from '../src/lib/razorpayPlans'`
   Right:  `import { PLANS } from '../src/lib/razorpayPlans.js'`

2. Razorpay SDK return types are incomplete. Always cast to avoid void overload:
   Wrong: `const sub = await razorpay.subscriptions.create(...)`
   Right:  `const sub = await (razorpay.subscriptions.create(...) as unknown as Promise<{ id: string; short_url: string }>)`

3. Never import from `razorpay/dist/types/...` deep paths — use `'razorpay'` only, cast response if types are wrong.

4. Run `npm run build` locally before pushing any `api/` change — Vite dev server won't catch these errors but `tsc` will.

Ripple: If you change `src/lib/razorpayPlans.ts` → update the `.js` import in all `api/*.ts` files that import it (currently only `api/create-subscription.ts`).

## Key env vars

Stored in `.env.local` (gitignored — never commit):
- `VITE_SUPABASE_URL` — Supabase project URL
- `VITE_SUPABASE_ANON_KEY` — client-side anon key
- `SUPABASE_SERVICE_ROLE_KEY` — server-only, used in `api/` functions
- `VITE_RAZORPAY_KEY_ID` — test key (prefix `rzp_test_`)
- `RAZORPAY_KEY_SECRET` — server-only
- `RAZORPAY_WEBHOOK_SECRET` — set in Vercel env vars only (not in .env.local)

## Deployment

- Push to `main` → Vercel auto-deploys frontend + serverless functions
- GitHub: `github.com/Sugeet21/clubkeeper`
- Supabase: `vkczmgzujpidbwtzulel.supabase.co`

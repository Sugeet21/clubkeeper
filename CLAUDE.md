# ClubKeeper — CLAUDE.md

Project memory and rules for Claude Code sessions on this repo.

## Quick orientation

Indoor games club management PWA. Offline-first. Indian market. Vite + React 18 + TypeScript + Tailwind v3.4 + Dexie + Zustand + react-router-dom v6.

Full project memory lives in `.claude/skills/clubkeeper/` — load the skill before answering anything about this codebase.

## Mandatory reading order before any code change

1. `.claude/skills/clubkeeper/SKILL.md` — project state, what's shipped, what's pending
2. `.claude/skills/clubkeeper/references/ripple_effects.md` — what breaks when you change X
3. `.claude/skills/clubkeeper/references/bug_history.md` — bugs already fixed (don't repeat them)

## Hard rules (never violate)

- **Tailwind v3.4 only.** Never upgrade to v4.
- **No `any` type** in `src/` files. Strict TypeScript throughout.
- **No HTML `<form>` with submit.** Button `onClick` only.
- **All async ops awaited.** No fire-and-forget.
- **Dark theme only.** Color palette locked — see `references/design_system.md`.
- **Mobile-first, 390px target width.**
- **Indian context:** `₹` currency, `toLocaleString('en-IN')` for amounts.
- **Run `npm run build` after every meaningful change.** Stop and report if it fails.

## api/*.ts files — extra rules

Vercel serverless functions use Node16 module resolution, which is stricter than Vite:

1. All relative imports need `.js` extension:
   `import { x } from '../src/lib/foo.js'` ← correct
   `import { x } from '../src/lib/foo'`    ← will fail on Vercel

2. Never import from `razorpay/dist/types/...` deep paths — use `'razorpay'` only.

3. Run `npm run build` locally before pushing any `api/` change — Vite dev server won't catch these errors but `tsc` will.

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

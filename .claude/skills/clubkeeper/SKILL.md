---
name: clubkeeper
description: ClubKeeper is Sugeet's offline-first PWA for managing indoor games clubs in India (pool, snooker, carrom, PlayStation). Trigger whenever Sugeet mentions ClubKeeper, club app, indoor games, table/session timers, pricing or subscription plans, Razorpay/UPI payments, customer acquisition, signup/auth flows, Vercel deploys, or shares errors/screenshots from localhost:5173 or app.handbookhq.in — even if he only asks "what should I do next" in this project context. Carries the full architecture, design system, code conventions, bug history, business context and decision history — consult it BEFORE answering so advice stays consistent. Structure: SKILL.md = stable laws + loading map; STATE.md (same folder — read it second, EVERY time) = what is true right now (module status, pending blockers, open-bug snapshot, freshness stamp); references/ = working maps (ripple_effects, bug_patterns, ...); references/history/ = append-only history — never read history/ for current truth.
---

# ClubKeeper — Project Memory

**Read order, every session: this file → `STATE.md` (what is true right now) → task-specific references (loading map below).** This file holds only STABLE content — laws, workflow, routing. Volatile truth (module status, pending blockers, open-issue snapshot, migration ledger) lives in `STATE.md` and is overwritten in place, never appended.

**One fact, one home:** what-is-true-now → STATE.md · laws → this file · what-breaks-if-you-change-X → `references/ripple_effects.md` · bug classes → `references/bug_patterns.md` · why-we-chose-X → `references/decisions_active.md` · what-happened-when → `references/history/changelog.md` + git log + GitHub. Cross-reference, never copy — duplicated facts are how this skill previously accumulated 27 contradictions (see `skill_redesign_proposal.md` at repo root).

## About Sugeet

- Solo founder in Pune, India
- Less coding experience — relies on AI to write all code via Claude Code (Opus/Fable-class sessions; Haiku explicitly rejected for project work)
- Building ClubKeeper as recurring-income SaaS alongside HRMS SaaS and hrdocs
- Indian English, short and pragmatic. Communicates by sharing screenshots
- Prefers: ready-to-paste prompts > theoretical explanations

## About ClubKeeper

Replaces the paper notebook used at Indian indoor game clubs for tracking who plays which table, when, for how long. Target customer: small club owners (1-2 staff, ₹50k–₹5L monthly revenue) currently losing money to forgotten timers and notebook errors.

**Sales pitch frame:** "If your staff forgets to start/stop the timer 3 times a day, that's ₹10,800/month lost. My app prevents that for ₹599/month."

## ⚠️ RULE 1 — RIPPLE EFFECTS

**Before changing any code, consult `references/ripple_effects.md`.** Find what's changing, see what else it affects, update ALL affected files in the same change. Sugeet's biggest fear: a fix in one file creates bugs in 3 other files because the AI didn't know they were connected. If a requested change isn't documented there yet, STOP and trace dependencies manually, then add the new ripples to it.

## ⚠️ RULE 2 — PREVENT BUG REPEATS

**Before writing code in a known-bug area, read the relevant section of `references/bug_patterns.md`.** Patterns are grouped by domain — Timer, Forms, Dexie, Auth, Subscription, Routing, UI/A11y, Modals, Payment (PM*), Player Hub (P*/PH*), Sync (S14–S25). Most bugs in this project repeat. Patterns kill that.

## Critical Rules (Never Violate)

1. **Tech stack is LOCKED.** Vite + React 18 + TypeScript + Tailwind v3.4 + Dexie + react-router-dom v6 + date-fns + Zustand + vite-plugin-pwa. Do NOT suggest swapping any. Tailwind stays on v3.4, never v4.
2. **Offline-first via IndexedDB (Dexie).** Never localStorage for session/timer data. localStorage is OK only for UI flags (e.g. "install banner dismissed").
3. **Timers use timestamps, never counters.** Always `Date.now() - startedAt - pausedTotalMs`, recomputed every render. Never `setInterval(() => setElapsed(e+1))`. #1 bug source.
4. **Indian context.** Currency `₹`, format with `toLocaleString('en-IN')`. Razorpay for payments (NACH auto-debit). UPI is the user payment method.
5. **Mobile-first.** Design for 360px width. Touch targets ≥44×44px.
6. **Dark theme only** for v1. Palette locked — see `references/design_system.md`.
7. **No HTML `<form>` with submit.** Use button onClick handlers.
8. **All Dexie operations awaited.** No fire-and-forget.
9. **Strict TypeScript.** No `any`.
10. **Verify with `npm run build` after every change.** (⚠ its `tsc` step is currently vacuous — #118; for a true typecheck run `npx tsc --noEmit -p tsconfig.app.json` and diff against the known pre-existing baseline.)
11. **Test 3 scenarios after any change:** happy path, existing-data path, edge case (empty/max/error).
12. **TopBar has NO gear icon.** Settings is reachable ONLY via bottom-nav. Do not re-add a gear to TopBar under any circumstance.
13. **Desktop modal behaviour:** shared `<Modal>` becomes a centered dialog at `md:` and up. `PaymentSplitSheet` is the ONLY non-shared bottom-sheet that also goes centered on desktop. `RestockSheet` and `PaymentBottomSheet` stay true bottom-sheets on every viewport. Container cap for centered desktop pages is `max-w-[1400px] mx-auto` (NOT `max-w-5xl`). FAB and modals stay OUTSIDE the centered wrapper.
14. **Settings values are read via `useDexieSetting` only.** No `useState` mirror of any ClubSettings field. No `useEffect` re-sync of a settings prop into local state. Dexie is the single source of truth on this device; the typing-buffer variant is the only legitimate local `useState` over a settings value. See `bug_patterns.md` Pattern R4.
15. **Adding or touching any ClubSettings field requires reading `references/checklists/new_settings_field.md` first** and pasting the filled checklist into the PR/commit description. No exceptions. Enforced by `npm run check:settings` (runs in `prebuild`).

**Post-v20 ID law (promoted after #107/#127):** all Dexie data-table ids are UUID **strings**. `.add()` requires caller-supplied `crypto.randomUUID()` (Pattern D12); never `Number()` a route param or row id (Pattern R5); validity = `id.length === 36`.

## Loading map — what to read when

| Situation | Load |
|---|---|
| **Every session, first** | This file → **`STATE.md`** |
| ANY code change | `references/ripple_effects.md` (Quick Index → matching sections) + `references/session_loop.md` (4-phase loop, mandatory) |
| Known-bug area | `references/bug_patterns.md` (that domain's section) |
| ClubSettings field | `references/checklists/new_settings_field.md` (mandatory, Rule 15) |
| Settings.tsx edit | Rule H below + patterns T2/R4/F5/U6/U10/S11 |
| Schema / types question | `references/data_model.md`, then `src/types/index.ts` (code is the type authority) |
| Sync work | ripple_effects §Sync + bug_patterns S14–S25; `references/history/sync_architecture_v2.md` ONLY for Phase-D/staff plans + contracts (it's design history — code wins) |
| Phase D / staff-login work | `references/phase_d_plan.md` (chunk plan D1–D9, the working doc) + sync_architecture_v2 §2–3/§4.5/Appendix B (locked contracts) |
| Owner-app UI | `references/design_system.md` |
| Player-facing UI (`/c/:slug`) | `references/player_design_system.md` (note its status header — shipped pages use the dark theme) |
| Architecture / file structure | `references/architecture.md` |
| "Why did we…" | `references/decisions_active.md`, then `references/history/decisions_archive.md` |
| "When did we ship…" | `references/history/changelog.md` (newest at top) + `git log` |
| Business / pricing / sales | `references/business_context.md` |
| Deploy / infra / domains | `references/deployment.md` |
| Bug report intake | GitHub first (`gh issue list --search`, CLI) or STATE.md issue snapshot (claude.ai); `references/history/bug_archive.md` = offline pointer index |
| Considering a subagent | `## Project Agents` below (CLI only) |

Read MULTIPLE files when the question spans domains.

## Response Style for Sugeet

- **Ready-to-paste prompts** for code requests. Include file paths, validation, what NOT to do.
- **Tables for comparisons** — he reads them faster than prose.
- **Number multi-step instructions.**
- **Anticipate the next question.** End with "next, you'll probably want X."
- **Show the why briefly.** One line, not three paragraphs.
- **Indian numbers.** ₹1,00,000 not ₹100,000.
- **Match his informal tone.** Founder building fast, not a research paper.

## Project Agents (CLI sessions only — claude.ai sessions skip this section)

Three scope-restricted helpers in `.claude/agents/`: **clubkeeper-explorer** (Sonnet, Read/Grep/Glob — "where is X called", single-fact lookups from big reference files; returns `file:line` citations), **clubkeeper-reviewer** (Opus — fresh-eyes diff review AFTER build-clean, BEFORE commit; verdict + violations, never auto-fixes), **clubkeeper-skill-auditor** (Opus — end-of-session Rule B/E/G + link-integrity gate; runs `npm run check:skill` first, then judgment checks).

**Decision rule before ANY `Agent()` call: "Does the intermediate work matter to me?" YES → main thread. NO → subagent.** Debugging, test-running, design/planning, bug RCA, and anything in Phase 3 EXECUTE beyond a discrete lookup are ALWAYS main-thread. NEVER create: debug agent, test-runner agent, sequential-pipeline agent, expert-persona agent, auto-fix agent (each hides intermediate state you need — #109 is the cautionary tale). Required delegations: pre-commit review of >100 LOC chunks → reviewer; session close → auditor. Model choices + rationale are recorded in `references/decisions_active.md`; per-call override example:

```
Agent({ subagent_type: "clubkeeper-explorer", description: "Locate scheduleDrain callers",
  prompt: "Find every call site of scheduleDrain() in src/. Return file_path:line_number each + 2 lines of context. Skip the definition." })
```

Brief agents like a colleague who just walked in — goal, file paths, response cap. Agent-definition changes take effect in NEW sessions only.

## Bug Tracking — GitHub Issues (the flow is law)

**GitHub (github.com/Sugeet21/clubkeeper/issues) is the ONLY authoritative issue state.** Never trust counts/open-closed claims written in skill files; use `gh` (CLI) or STATE.md's dated snapshot (claude.ai).

**When Sugeet reports a new bug or set of bugs — MANDATORY ORDER:**

1. **STOP. Do NOT write any code yet.** Search first: `gh issue list --search "<keywords>" --state all --repo Sugeet21/clubkeeper`. If a similar issue exists, reference it — never duplicate (#114/#121 happened by skipping this).
2. **Create a GitHub issue for EACH distinct bug** before any code change: `gh issue create --repo Sugeet21/clubkeeper --title "BUG-XX — <short symptom>" --label "bug,priority-<p0|p1|p2>,domain-<area>,status-open" --body "<symptom / repro / expected / suspected root cause / files likely affected>"`. Multiple bugs = multiple issues. Never bundle.
3. **Reply to Sugeet with the issue numbers and links** before writing fix code. Wait for his go-ahead.
4. **Fix.** Commit message uses `refs #NN`, NEVER `closes/fixes/resolves` (those auto-close on push; only Sugeet closes): `fix(<area>): <one-line> (refs #NN — pending owner verification)`.
5. **NEVER close the issue yourself.** Post the SHA as an issue comment, then: "Issue #NN — fix committed in <SHA>. Please verify on your device. Reply 'close #NN' only after you've tested it. I will not close it until you do."
6. **Only after Sugeet's explicit "close #NN" / "verified":** `gh issue close NN --repo Sugeet21/clubkeeper --comment "Verified by owner. Fixed in <SHA>."` Then update the `history/bug_archive.md` pointer.

**This overrides any urge to be efficient.** Even a one-line fix gets an issue first. Only exception: a typo/wording change Sugeet asked for in plain English with no symptom.

## Session Rules (A–M)

- **Rule A — Update the skill after EVERY phase** of multi-phase work, not after the module. Compaction eats details otherwise.
- **Rule B — Every src/ commit needs a paired skill commit** in the same session: at least one of changelog.md, ripple_effects.md, bug_archive.md, decisions_active.md, bug_patterns.md, or STATE.md. Check with `git log --since="2 hours ago" --name-only` before declaring done. (Machine-checked by `npm run check:skill`.)
- **Rule C — Bugs go to GitHub, not prose.** bug_archive.md gets a one-line pointer only.
- **Rule D — Before fixing any bug in a known-bug area:** read the relevant bug_patterns section AND search GitHub for prior occurrences; reference them in the commit.
- **Rule E — At end of every session, run the close checklist:** changelog entry? ripple_effects updated for touched files? new bug → issue? new pattern → bug_patterns? STATE.md still accurate (module lines overwritten, resolved pending deleted, new invariants promoted to rules/patterns)? Then run the auditor agent. Do NOT skip — Sugeet explicitly asked for this.
- **Rule F — Issue-first, owner-closes-last** (the Bug Tracking flow above, restated as law).
- **Rule G — STATE.md is OVERWRITE, not APPEND.** One line per module; no SHAs, build sizes, or dates in status lines; phase history goes to changelog.md; resolved pending lines are DELETED; new hard invariants get promoted to Critical Rules or bug_patterns, not parked in STATE. (Machine-checked by `npm run check:skill`.)
- **Rule H — Settings.tsx pre-flight is mandatory.** Before any edit to `src/pages/Settings.tsx`: read bug_patterns T2, R4 (settings useState-mirror class — NOT "S4", a Razorpay pattern; old revisions had the wrong pointer), F5, U6, U10, S11 + the ripple_effects §Settings entry; STATE which patterns apply BEFORE writing code; cite patterns in the commit message; any new save site uses `useSaveIndicator()` + `<SaveIndicator>`; any new clubs-row mirror goes through `mirrorToSupabaseBySlug()`.
- **Rule I — Every src/ change follows the 4-phase loop** in `references/session_loop.md` (GROUND → PLAN → EXECUTE → CLOSE), phases stated out loud, gates enforced, build per logical chunk. Abbreviated loop (Phase 1+3) ONLY for typo/comment/skill-markdown/revert work. One-line fixes run the full loop — Pattern R4 came from a one-line fix.
- **Rule J — Default is main thread; delegation needs stated reasons** (which agent, does-intermediate-work-matter answer, why it's not an anti-pattern). Forbidden: debugging, builds/tests, design, Phase-3 execution, bug RCA. Required: auditor at close, reviewer for >100-LOC chunks.
- **Rule K — PATTERN SWEEP before close.** Once a bug's root cause is confirmed (not before — a guessed cause sweeps for the wrong thing):
  1. **Write the sweep query** — the grep/regex that finds this exact anti-pattern anywhere in `src/`.
  2. **Run it across the whole codebase.** List every other occurrence as `file:line`.
  3. **Report to Sugeet:** "Root cause = X. Sweep found N more instances: `<list>`." (Say "0 more" explicitly when clean — silence reads as "didn't check".)
  4. **Sugeet decides:** fix all in the same commit (identical pattern, low risk) OR file a separate `SWEEP-#NN` issue per distinct area. Still NEVER bundle unrelated bugs (Rule F holds).
  5. **Add the sweep query itself** to that pattern's entry in `bug_patterns.md`, so the next sweep is one command, not a re-derivation. This is the paired-skill artifact for the fix (satisfies Rule B).

  Precedent: #134's one-file symptom was actually a 7-file Pattern R5 id-type class; the sweep caught the other 6. Skipping the sweep is how #114/#121 and the R5 debt (#138) accumulated.

- **Rule L — SEARCH BEFORE CREATE.** Before writing any new helper, hook, component, util, or type: grep `src/` for an existing one by name AND by behaviour (e.g. `grep -rn "formatINR\|toLocaleString" src/`). State the search and its result in Phase 2 PLAN: "Reusing X from `file:line`" or "No existing match — creating new". Reuse only on EXACT fit; if it needs a new param or a mode flag to fit, that's a deliberate extension (name it in the plan) — never copy-paste-modify a near-duplicate. The explorer agent is allowed for the lookup (it's a discrete "where is X" search, Rule J compliant). Precedent for why: as of Jul 2026 the repo carries `formatINR` ×9, `formatRupees` ×4, `withTimeout` ×2, 117 raw `toLocaleString('en-IN')` call sites, and inline phone-digit stripping in ~8 components despite `src/lib/phone.ts` — all written without searching first. That existing debt is a separate owner-approved refactor; this rule stops new debt.

- **Rule M — DATABASE CHANGES ARE PROVEN, NOT CLAIMED.** *Trigger: this rule activates ONLY when the session creates/edits a file under `supabase/migrations/`, runs `apply_migration`/DDL/RPC-or-policy changes against Supabase, or makes ANY statement about whether a migration is applied. Sessions that never touch the database skip it entirely.* When triggered: (1) an apply success response is NOT proof — same session, probe the object itself via `execute_sql` (`pg_proc`/`pg_get_functiondef` for functions, `pg_policies` for policies, `pg_trigger` for triggers, `information_schema.columns` for column/type changes) and record the probe + its result in the STATE.md ledger line; (2) any "it's live in prod" message to Sugeet MUST include a 10-second self-check he can run himself (Dashboard path, e.g. Database → Functions → search the name, or a one-line SQL-Editor snippet) — owner verification is the close gate, not our probe; (3) if Sugeet reports the object missing, his observation outranks the ledger: re-probe live prod and reconcile before repeating any claim. Why it exists: #154's RPC was declared applied, the owner couldn't find it and re-ran the SQL by hand — `create or replace` made that harmless, but a data-moving migration run twice would not be.

---

**Current truth (module status, pending blockers, open P0/P1s, migration ledger, limitations) → `STATE.md`. Always read it before acting.**

---
name: clubkeeper
description: ClubKeeper is Sugeet's offline-first PWA for managing indoor games clubs in India (pool, snooker, carrom, PlayStation). Use this skill whenever Sugeet mentions ClubKeeper, club app, indoor games, pool table app, carrom app, table timer, session timer, or anything related to building, debugging, or extending his SaaS product. Also trigger when he discusses pricing strategy, subscription plans, payment integration (Razorpay/UPI), customer acquisition for the app, signup/auth flows, deployment to Vercel, or shares screenshots from localhost:5173 / app.handbookhq.in (or clubkeeper.vercel.app backup). Trigger even when he just shares an error or asks "what should I do next" inside this project context. This skill carries the project's full architecture, design system, code conventions, all bugs found and fixed, business context, and decision history — consult it BEFORE answering anything about the app so advice stays consistent with prior decisions.
---

# ClubKeeper — Project Memory

Persistent memory for Sugeet's ClubKeeper SaaS. Read the relevant reference files for what's being asked, then respond with full context of prior decisions.

## About Sugeet

- Solo founder in Pune, India
- Less coding experience — relies on AI to write all code via Claude Code (current sessions run Opus/Fable-class models; Haiku explicitly rejected for project work)
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
14. **Settings values are read via `useDexieSetting` only.** No `useState` mirror of any ClubSettings field. No `useEffect` re-sync of a settings prop into local state. Dexie is the single source of truth on this device; the typing-buffer variant of Pattern R4 is the only legitimate local `useState` over a settings value. See `bug_patterns.md` Pattern R4 (#97, 20 Jun 2026).
15. **Adding or touching any ClubSettings field requires reading `checklists/new_settings_field.md` first** and pasting the filled checklist into the PR/commit description. No exceptions. Enforced by `npm run check:settings` (runs in `prebuild`).

## Routing — read these references on demand

| Topic | File |
|---|---|
| **ANY code change** | **`ripple_effects.md` (mandatory first)** |
| **ANY src/ code change** | **`references/session_loop.md` (mandatory 4-phase loop)** |
| **About to touch a known-bug area** | **`bug_patterns.md` (mandatory for that area)** |
| **About to add/touch a ClubSettings field** | **`checklists/new_settings_field.md` (mandatory)** |
| **Considering delegating to a subagent** | **`## Project Agents` section below (mandatory before any Agent() call)** |
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

## Project Agents — when to delegate vs main-thread

Three project agents live in `.claude/agents/`. They are SCOPE-RESTRICTED helper hands, NOT autonomous workers. **Default is main thread.** Delegate only when the decision rule below says yes — losing main-thread visibility into intermediate work is the failure mode that produced bug #109 (see `feedback_postgres_rls_diagnosis.md` in memory).

### The decision rule (from `SubAgent.txt`)

**Ask one question before delegating: "Does the intermediate work matter to me?"**

| If… | Then… |
|---|---|
| You need the journey (each step depends on the last) | Main thread |
| You only need the final answer | Subagent |
| You need to see full error output (debugging, tests) | Main thread — ALWAYS |
| You need to design / argue tradeoffs / negotiate with owner | Main thread |
| You need to read a 30k-token reference file to extract one fact | Subagent |
| You need fresh eyes on code YOU just wrote | Subagent (reviewer) |
| You need to verify skill files at session close | Subagent (auditor) |

### The three agents

**1. `clubkeeper-explorer` (Sonnet, read-only — Read/Grep/Glob)**
- USE FOR: "Where is X called?" "What does `ripple_effects.md` say about `gameTables`?" "Find every component importing from `src/db/queries.ts`." "List all places that read `auth.jwt() ->> 'user_club_id'`."
- RETURNS: `file_path:line_number` citations + tight summary. No prose.
- DO NOT USE FOR: design, debugging, code review, multi-step exploration where each step depends on the last.
- **Why this exists:** Replaces ad-hoc `Grep+Read` chains that dump 5–20k tokens of file contents into main context for one fact.

**2. `clubkeeper-reviewer` (Sonnet, Read/Grep/Glob/Bash)**
- USE FOR: Fresh-eyes review of a diff AFTER `npm run build` is clean, BEFORE the commit. Runs `git diff`, reads modified files, cross-references Critical Rules 1–15 + bug patterns + ripple_effects.
- RETURNS: `VERDICT: APPROVE | REQUEST_CHANGES | BLOCKED` + numbered violations with `file:line` + fix suggestions. Does NOT auto-fix.
- DO NOT USE FOR: greenfield design, debugging, "is this approach right" questions before code exists.
- **Why this exists:** The doc's "Code Reviews" use case — Claude reviews code more strictly when it didn't write it. Pairing with explicit project rules makes reviews consistent across sessions.

**3. `clubkeeper-skill-auditor` (Sonnet, Read/Grep/Glob/Bash)**
- USE FOR: End-of-session gate. Checks Rule B (paired src+skill commits), Rule E (changelog/issues/patterns), Rule G (Current State overwrite-not-append), memory-link integrity, CLAUDE.md drift.
- RETURNS: `AUDIT VERDICT: PASS | FAIL` + action items.
- DO NOT USE FOR: mid-session checks, code review, any writing.
- **Why this exists:** Rule B/E/G in this skill exist BECAUSE past sessions skipped them. An automated final-gate agent makes "session closed" a verifiable state, not a vibe.

### Anti-patterns — NEVER create or use

Per `SubAgent.txt`, these subagent types make things WORSE:

| Anti-pattern | Why it fails | What to do instead |
|---|---|---|
| **Debug agent** | Hides intermediate logs / error chains. #109 happened because I treated an SQL Editor test as proof — same failure mode at agent scale. | Main thread, always. Read full Supabase logs + stack traces directly. |
| **Test-runner agent** | Returns "tests failed" — forces you to re-run for details that should have been visible the first time. | Run `npm run build` and any test suite in main thread; see full output. |
| **Sequential pipeline agent** | "Repro → debug → fix" chains lose information at each handoff. | Sequential bug work IS the main thread. |
| **"Expert" persona** ("you are a TypeScript expert") | Adds zero capability — main-thread Opus already knows TS. Just noise. | Don't. |
| **Auto-fix agent** | Strips your veto on changes to production code. | Reviewer reports, main thread decides. |

### How to actually invoke

```
Agent({
  subagent_type: "clubkeeper-explorer",
  description: "Locate scheduleDrain callers",
  prompt: "Find every call site of scheduleDrain() in src/. Return file_path:line_number for each, plus the immediately surrounding 2 lines of context. Skip the definition file itself."
})
```

Brief the agent like a colleague who just walked in — it has no memory of this conversation. State the goal, give file paths, cap the response length if needed. Vague prompts produce vague answers.

### Model choice

Models are scoped to the job, not blanket-applied:

- **`clubkeeper-reviewer` → Opus** (raised from Sonnet, 30 Jun 2026, sync phase). Pre-commit review of code the main thread just wrote is the high-stakes catch-the-bug surface — accuracy beats token cost. The Chunk 4.3 navigator-lock miss is the canonical example: a Sonnet review would not have flagged the supabase-js library-level lock acquisition because spotting it requires deep reasoning across the supabase-js source + our drain loop semantics.
- **`clubkeeper-skill-auditor` → Opus** (raised from Sonnet, 30 Jun 2026, sync phase). Final session gate. Cross-references commits, ripple_effects, bug_patterns, Current State entries, and memory-link integrity — a Sonnet miss here ships a stale skill into the next session, which is the failure mode Rule B/E/G exist to prevent.
- **`clubkeeper-explorer` → Sonnet.** Pure retrieval (`Read/Grep/Glob`, no Bash, no writes). Opus adds cost, not accuracy — there is nothing for Opus's deeper reasoning to do when the job is "return `file:line` citations for `scheduleDrain` callers."

Never use Haiku — accuracy > speed for project-specific work; owner explicitly rejected Haiku.

Frontmatter-level model changes only take effect in NEW sessions. For the current session, override to Opus per-call when invoking reviewer/auditor (`Agent({ model: "opus", subagent_type: "clubkeeper-reviewer", ... })`).

### Gates — when delegation is FORBIDDEN

- Anything in **Phase 3 EXECUTE** of session_loop.md beyond a discrete lookup. Implementation stays main-thread.
- Anything where the owner is **debugging a live production issue** with you. Full logs in main thread, no summary handoffs.
- Anything that **writes to files** outside the agent's defined tool list (explorer can never write; reviewer/auditor are reporting-only by design).
- **Bug reproduction or root-cause analysis.** RCA is a sequential pipeline by definition — main thread.
- **First exposure to a new ClubKeeper area you don't yet have a mental model for.** Subagents can give you the lookup but not the model — read the relevant file yourself the first time.

### Updating an agent

Agents live in `.claude/agents/*.md` and ride main → Vercel only as repo files; they don't deploy anywhere runtime. Update freely with normal commits. Pair the agent change with a skill update if you change WHEN to use the agent (Rule B applies). After updating, the change takes effect in any NEW session — existing sessions keep the old agent definition.

## Current State

One entry per module. Overwrite in place when status changes — never append a second entry for the same module. For phase-by-phase history, build sizes, commit SHAs, and dates, see `changelog.md` and `git log`.

- **Desktop responsiveness (#91)** — Verified by owner. Tables, Canteen, Bookings, shared `<Modal>`, QuickSale, PaymentSplitSheet desktop-responsive. Settings page + Wallet topup success screen still mobile-only.
- **Advance booking (#84, #106)** — Operating hours per-club; advance per-30-min-slot (default ₹50). Bookings toggle gated on hours set. Pending owner E2E verification.
- **Pricing visibility (#84 Phase 0)** — Player Hub shows collapsible "View pricing" card. Gated on `acceptsPricingDisplay` + `tables_json` populated.
- **Player Hub + topups** — Owner slug + accept-topups toggle live. Player `/c/:slug` form → UPI → "I've paid" polling. Realtime channel `topup_intents_{clubId}` with 30s polling fallback. Pending count in `topupInbox` Zustand store. `/poster/:slug` auto-prints.
- **ClubCoins** — Off by default. Tiered earn on topup, configurable redemption, FIFO expiry sweep every 4h (`ExpirySweepRunner` in `App.tsx`).
- **Engagement** — Welcome bonus, streak bonus, dormancy nudges, BringBackList. All off by default; configured in `PlayerHubSettings`.
- **Wallet / prepaid credit** — Customers, walletTransactions, top-ups, manual adjustments, walk-in codes, WhatsApp receipts. Refund UI still pending (Phase 3).
- **Canteen management + POS stock sync** — Item CRUD, stock pills, RestockSheet, all 6 add/mutate paths sync stock atomically inside one flat tx. Freeform rows never touch stock.
- **Low-stock threshold (#92)** — Owner-configurable cutoff (1–999, default 5). Settings → Canteen → "Low stock alert at" (relocated from Club Info per BUG-S5). All surfaces use `getLowStockThreshold()` with `?? 5` fallback. Rides Dexie v18 as additive optional.
- **Peak Hour Pricing (#68)** — Verified by owner. All four phases shipped: schema + Settings picker (P1, aee59da), Canteen card + form field (P2, d2995fe), AddItemBottomSheet + QuickSale POS chips (P3, b3bf4ce), `BulkPeakPriceModal` + one-time amber onboarding banner + permanent "Bulk peak prices" header button (P4, 00453da). Onboarding state lives in `localStorage('ck_peak_onboarding_seen')` — per-browser, one-time, doesn't revive on toggle-off/on. QuickSale cart locks captured price across window edge. Quick Add chips + manual freeform entry intentionally NOT peak-aware.
- **Quick Sale (`/quick-sale`)** — Walk-in canteen sales with PaymentSplitSheet. `createCanteenSale` single flat tx with stock check.
- **Split payments + PAYMENT MODE + Piggy** — `Session.paymentBreakdown`, PaymentSplitSheet shared across SessionDetail + QuickSale, PAYMENT MODE + CASH FLOW summary strips, `/piggy` page, RestockSheet sources Piggy/Other. Mandatory payment capture (no "Skip"). v13 backfill caveat — items revenue missing from `paymentBreakdown.cash` for pre-v13 sessions; defer until owner notices.
- **Table Move (Phase 1)** — Move running/paused session to another empty same-game-type, same-rate table. Single continuous bill. No cross-type, no per-segment billing, no undo.
- **Back Entries** — Log past completed sessions from paper notebook with canteen items, rate-card snapshots, overlap + stock checks. `per_frame` tables excluded.
- **Rate card + tolerance billing (Phase 1)** — Per-table tiers + tolerance + `'minimum' | 'prorated'` billing mode. Snapshots captured on session. Rounding setting ignored on rate-card sessions.
- **Alarm / Notify-at (Phase 2)** — Per-session optional alarm, `Session.notifyAtMs` (absolute Unix ms, wall-clock semantics — pause does NOT shift). Snooze anchors to original `notifyAtMs`.
- **Summary dashboard** — End-of-day dashboard with revenue deltas, split bar, hourly heatmap, top tables/items, low stock, PAYMENT MODE + CASH FLOW strips. Pattern T4 — DB-static deps, running sessions in render body. Pattern T9 — Quick Sale included in topItems / hourly / topTables (synthetic 'Walk-in Canteen' row, sentinel `WALKIN_TABLE_ID=-1`) / per-date `dateRevenues` for deltas (#93, 20 Jun 2026 — pending owner verification). Date picker = Pattern U9.
- **Auth + cardless trial** — Supabase + Google OAuth, `select_account` enforced. 7-day cardless trial via Postgres `handle_new_user()` trigger. Three-branch Subscribe headline (`expired` / `early` / `welcome`). `useAccessGuard` returns `subscription_loading` while `subscriptionLoaded === false` to prevent race. Boot survives a stranded GoTrue navigator lock via 8s race + lock-free degraded boot, no steal (Pattern A11, #120 — pending owner verification).
- **Subscription (Razorpay)** — **LIVE mode in production (corrected 24 Jun 2026)**. Auto-pay (NACH) collecting ₹599 successfully. Razorpay fee ~₹4 + GST per txn (planned: charge ₹599 + GST after sync ships). Serverless `api/create-subscription`, `api/razorpay-webhook`, `api/cancel-subscription`. V1-LAUNCH filter shows only Standard Monthly (₹599) — Starter + Pro hidden via `VISIBLE_PLAN_IDS`.
- **Settings** — Collapsible section cards in order: Club Info (name / currency one-liner / UPI / time rounding), Tables, Canteen (low-stock + peak pricing), Alerts, Subscription, Piggy, Player Hub, Data & Backup, About, Account. Only one section open at a time. Subscribe header shows live status badge. Club Name + UPI Save use `<SaveIndicator>` (Pattern U10). All clubs-row mirrors go through `mirrorToSupabaseBySlug` (Pattern S11).
- **Import / Export** — `getAllDataForExport` covers all stores incl. `schemaVersion` + `exportedAt`. `importEverythingFromFile` is single atomic tx with 7 typed failure reasons. DEV-only round-trip self-test on `window.__importEverythingFromFile`.
- **PWA + deployment** — `vercel.json` SPA rewrite (excludes `/api/*`), all PWA icons in `public/`. Per-user IndexedDB `ClubKeeperDB_<userId>` (two Gmail accounts on one browser = isolated data). `db` is a Proxy; `authStore` manages `initDbForUser` / `closeDb`.
- **Bug tracking** — All bugs as GitHub issues at github.com/Sugeet21/clubkeeper/issues. `bug_archive.md` has one-line pointers only.
- **Sync project (Phase C Chunks 0–5.2b OWNER-VERIFIED; Chunks 5.3 + 5.4 COMMITTED + RUNTIME-PROVEN, pending owner verification)** — Write path (Chunk 4.3): 50-row backlog → 50 unique rows in Supabase, zero watchdog timeouts. Read path: `SyncReader` singleton (`src/db/syncReader.ts`) — serialized job queue (Chunk 5.3: FIFO of deduped `pull` jobs + one `apply` job per realtime event, single worker + S15 generation guards), compound per-table cursor in `settings.pullCursors` (`created_at` cursor for append-only `wallet_transactions`, `updated_at` for the other 8), 4 grouped realtime channels per §7.2 on the MAIN `supabase` client (Pattern S22 — subscribe on login after claim resolution, teardown on logout; teardown now AWAITED per Pattern S23). Chunk 5.3: handlers DIRECT-APPLY `payload.new` (§7.3) — outbox-guard → numeric epoch-ms LWW compare (S17) → tie-break (equal ms yields to remote; `updated_by` NULL from our pushes so the same-user branch is unreachable today) → `fromSupabaseRow` → `put` → monotonic cursor advance (never from a null cursor); DELETE/malformed events fall back to the doorbell `requestPull`. Chunk 5.4: §7.4 polling fallback — a channel group down (CHANNEL_ERROR/TIMED_OUT/CLOSED) for >30s (idempotent first-failure timestamp, not reset on repeats) starts a shared 60s poll that calls the SAME `requestPull` doorbell for every table in a currently-down group; stops the instant the group re-SUBSCRIBEs. No new apply/cursor-reset path. ALL 9 tables mapped bidirectionally (`syncReadMapper` + `syncPayloadMapper`) under the #117 contract (CLOSED): Dexie-side LWW metadata is camelCase epoch-ms `updatedAt`/`deletedAt`, ISO only at the wire (Pattern S17); nested jsonb always real objects. Server-side LWW guard triggers (20260628) + client-field columns (20260702) both verified in prod. `pushOne` soft-delete on `wallet_transactions` throws (append-only). Three-client architecture (Pattern S16): `supabase` (owner AUTH + realtime), `supabasePublic` (anon RPCs), `supabaseSync` (owner data plane, lock-free). Broken-hook recovery via `deferForRefresh` — RUNTIME-PROVEN, #116 CLOSED by owner 3 Jul 2026. Chunk 5.3 runtime proof complete: INSERT/UPDATE direct-apply, stale-remote skip, newer-remote apply + cursor advance, DELETE doorbell fallback, canteen_sales/session_items pull shapes all captured live. Chunk 5.4 runtime proof complete: 30s grace fired on schedule, 60s poll ticks confirmed, SQL edit landed via poll within one cycle, poll stopped cleanly on reconnect with zero orphan ticks observed. clubkeeper-reviewer (Opus) caught + the fix cycle resolved a real async-teardown race (Pattern S23, NEW) across 3 review rounds before final APPROVE. Open sync issues: #119 (duplicate realtime delivery, P2), #120 (GoTrue lock-jam boot hang, P1 — fix committed 7b69c11, pending owner verification; re-observed live mid-session on 3 Jul 2026, self-healed via the A11 degraded-boot path with zero intervention needed once the stray tab was closed), #121 (supabaseSync accessToken TDZ warning at module init, cosmetic — observed again live 7 Jul 2026 at boot, still harmless), #123 (bulk peak-price partial-failure toast, P2), #124 (deleteSessionItem/restoreSessionItem hard-delete has no sync round-trip, P2 — deferred from #122 as an out-of-scope semantics change). DEV proof pages `/__dev/test-outbox` + `/__dev/test-sync-reader` (incl. LWW conflict-test buttons). **#122 syncedBatch mixed-op atomic wrapper SHIPPED (b1407e3, runtime-proven into prod Supabase, pending owner verification):** `syncedBatch(tables, fn)` in `syncWrappers.ts` opens ONE tx over caller-declared synced tables + `_outbox`, runs a callback that reads `db.*` directly + emits ops via `BatchContext` (insert/update/softDelete write data+outbox rows together), drains once; the power-cut guarantee (softDelete on wallet_transactions throws — append-only). Chunk 7 progress: Group A (8ff1e6d) + 4 of 6 formerly-blocked multi-table sites now converted (b1407e3): `createCanteenSale` (sale+stock+wallet-debit-ledger+customer-balance all atomic — proven: Coke×2 ₹40, ₹20 wallet debit dropped Aditya to ₹77, ledger balance_after==customer balance==local), `recordStockPurchase` (proven), `updateSessionItem`, `createBackEntry` (settings read hoisted — not a synced table). `deleteSessionItem`/`restoreSessionItem` stay RAW → #124. Next: Group B (sessions/sessionItems/customers/walletTransactions/bookings, ~45 sites — same mixed create+update shape, now use `syncedBatch`).

## Pending — load-bearing, delete when done

Things that BLOCK something if forgotten. Delete the line the moment it's resolved.

- **#120 (P1) — FIX COMMITTED 7b69c11, awaiting owner verification**: boot races `getSession()` vs 8s → lock-free degraded boot from stored session + toast + in-place recovery when the lock frees (Pattern A11 — NO steal; steal rejected as a refresh-token-family risk). Runtime-proven against both the real zombie jam and a deliberate strand. Owner: verify on the affected second Chrome profile, then "close #120". Residual (documented on issue): jam + EXPIRED stored token still waits, now with an explanatory amber hint instead of a silent spinner.
- **#119 (P2) — duplicate realtime event delivery after StrictMode-raced channel teardown**: leaked server-side pg_changes subscription doubles every event until reload; idempotent applies make it correctness-safe, cost only. Evaluate teardown-after-JOIN-ack / per-generation topics / event dedupe in a later chunk.
- **Build gate is vacuous (#118)** — `npm run build`'s `tsc` step typechecks NOTHING (solution-style root tsconfig, no `-b`). ~15 pre-existing errors sit in `tsconfig.app.json` scope; some look like real post-v20 string/number comparison bugs (AddItemBottomSheet.tsx:361, Home.tsx:291). Until fixed, "build passed" ≠ "types clean" — run `npx tsc --noEmit -p tsconfig.app.json` for a true check (expect the known pre-existing noise). Needs its own triage session.
- **ALL "pending manual run" migrations VERIFIED APPLIED in prod (7 Jul 2026, live anon-RPC probe against `vkczmgzujpidbwtzulel`):** `20260622_booking_hours` (RPC returns `booking_open_minutes=240`), `20260618_booking_cancel` (RPC raises `not_found`, i.e. exists), `20260619_booked_slots` (exists — but see #127: its `p_table_id` is still `integer`), `20260616_pricing_visibility` (RPC returns `tables_json` + `accepts_pricing_display`), `20260610_player_hub` + `20260610_clubcoins` (RPC returns coins fields; hub live for weeks). Their old "until run, X breaks" caveat lines are deleted — none apply.
- **Migration `20260602_cardless_trial.sql` — inferred applied** (trial signups have worked in prod since early June); confirm incidentally on the next fresh signup, then delete this line.
- **#127 (P1, NEW 7 Jul) — player booking flow broken post-v20**: `BookingScreen.tsx:216` + PlayerScan CTA filter tables to `typeof t.id === 'number'` but `tables_json` ids are UUID strings since v20 → every table filtered out, booking CTA hidden. `get_booked_slots.p_table_id` is `integer` (probe: 22P02 on UUID) and `submit_booking_intent`'s table-id type needs the same audit. Needs a code + migration session.
- **#110 (P0, open since 26 Jun) — S14 outbox dead-letter**: the Pattern S14 mapper fix shipped (Chunk 4.1) but the issue was never owner-verified/closed. Verify drain is clean on owner device, then ask Sugeet to close.
- **#103 (P0, open) — isSlugAvailable on owner client freezes slug-setup Save**: #105 added a 5s fail-open race as mitigation; root issue (owner-client auth-lock queueing) still open on the issue.
- **#100 (P0, open) — Time Rounding not applied on stop (Pattern T2 recurrence)**: investigated 20 Jun as cannot-reproduce; stays open pending owner repro on a per-minute table.
- **#97 (P0, REOPENED) — Accept-bookings toggle flips after nav-away (Pattern R4 recurrence)**: original fix closed 20 Jun, recurred. Needs fresh RCA against the useDexieSetting path.
- **#126 (P1) — "Group C": ~20 customer/wallet/booking write sites OUTSIDE queries.ts still raw** (customerStore/coinExpiry/streak/nudge/walkInCode/Pending modals) — do after #125 verification.
- **Vercel webhook config** — Razorpay Dashboard → add `/api/razorpay-webhook` URL + `RAZORPAY_WEBHOOK_SECRET` → redeploy.
- **GST invoicing + email notifications** — next sprint.
- **PWA update banner (S6)** — needs `useRegisterSW` + banner UI; without it, users on old SW don't get new deploys without hard refresh.
- **Wallet Phase 3 (refund UI)** — `referenceType: 'refund'` + mandatory notes.
- **PAYMENT MODE backfill (v13 follow-up)** — `paymentBreakdown.cash` understates pre-v13 sessions by items value. Defer until Ball Bender notices.
- **Session persistence** — `storage` option removed from `createClient` by linter. Monitor if session drops recur in production.
- **Razorpay key rotation warning** — if `VITE_RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` is ever rotated or LIVE mode is enabled, the 6 plan IDs in `razorpayPlans.ts` MUST be re-verified. See Pattern S5.

## Known limitations

- **LIMIT-001 (partially fixed):** IndexedDB is per-user per-browser (`ClubKeeperDB_<userId>`). Two Gmail accounts on same browser = isolated data. Cross-device sync still not implemented — same account on Chrome vs Edge sees different data. Full fix requires cloud sync (Supabase). Warn Sugeet if he asks for multi-device access.
- **LIMIT-002:** `/api/*` requires `vercel dev` locally, not `npm run dev`. Handled with friendly 404 error in `handlePayNow`.
- **LIMIT-003 (multi-device sync request count: 2/3):** Two paying customers have asked (Customer #1: 12-table club, 7 Jun 2026; Customer #2: Ball Bender 4-partner club, 9 Jun 2026). Threshold per decision is 3+. Keep deferring full Supabase sync. Interim for Ball Bender: "Shift Handover" JSON export/import (not yet built; defer until they complain).

## Dexie schema — current

**Current version: v21 (Chunk 5.0, 1 Jul 2026 — store strings identical to v20; `CURRENT_SCHEMA_VERSION = 21`, `ClubKeeperBackupV21`).** v20 (24 Jun 2026) was the UUID migration, fully shipped. 4 tables (`gameTables`, `sessions`, `sessionItems`, `canteenItems`) have `id` schema (caller-supplied UUID string). `.upgrade()` callback atomically rewrites all existing numeric-id rows to UUIDs, remaps all FK fields (including nested `Session.tableMoves[]`), adds `_migrationSeq` per row for Phase C resumable upload. `_outbox` table added for Phase C sync queue. All `number | string` transitional unions collapsed to `string`. `CURRENT_SCHEMA_VERSION = 20`. DB naming stays `ClubKeeperDB_${userId}`. No pre-v20 backup (owner waived).

Full version history (v1–v19) lives in `changelog.md`. When bumping the version, also update `CURRENT_SCHEMA_VERSION` in `queries.ts`, the backup interface alias, `getAllDataForExport` + `importEverythingFromFile` + `resetEverything` + `importExportRoundTrip` (Pattern D10).

## Bug Tracking — GitHub Issues

**Since 14 Jun 2026, bugs are tracked at: https://github.com/Sugeet21/clubkeeper/issues — GitHub is the ONLY authoritative issue state.** Never trust issue counts or open/closed claims written into skill files (they drift — proven twice); run `gh issue list` (CLI) or check the Pending section's dated snapshot (claude.ai). `bug_archive.md` is a pointer index for sessions without `gh` access.

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

4. **Fix the bug.** Reference the issue number in the commit message — use `refs`, NEVER `closes/fixes/resolves` (those auto-close the issue when the push lands on `main`, and only Sugeet closes after verifying):
     git commit -m "fix(<area>): <one-line>  (refs #NN — pending owner verification)"

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

### Rule H: Settings.tsx pre-flight is mandatory
Settings.tsx has had recurring bugs across toggles, save indicators, persistence, and section ordering (BUG-S1 through BUG-S8, 20 Jun 2026). Before any edit to `src/pages/Settings.tsx`:
1. Read `bug_patterns.md` sections T2 (Settings flag plumbing), R4 (settings useState-mirror class — NOT "S4", which is a Razorpay pattern; old revisions had the wrong pointer), F5 (toggle component), U6 (collapse state), U10 (SaveIndicator), S11 (mirror helper), and any other pattern the change touches.
2. Read the `## Settings` entry in `ripple_effects.md` — note the section ordering and that Club Name + UPI save use `<SaveIndicator>` (Pattern U10).
3. **State in your reply WHICH patterns apply to the requested change, BEFORE writing code.** No exceptions, even for one-line edits.
4. Commit message MUST cite the patterns when relevant. Example: `fix(settings): accept-bookings persistence (Pattern S4 + S11)`. This makes pattern recurrence searchable in `git log`.
5. Any NEW save site MUST go through `useSaveIndicator()` + `<SaveIndicator>`. Any NEW clubs-row mirror MUST go through `mirrorToSupabaseBySlug()`.

### Rule I: Every coding session follows the 4-phase loop

Every change to `src/` MUST follow `references/session_loop.md` — Phase 1 GROUND → Phase 2 PLAN → Phase 3 EXECUTE → Phase 4 CLOSE.

1. **State the phase explicitly** before each major tool call. Example: `Phase 1 — GROUND. Reading ripple_effects.md for the canteen module...`
2. **Each phase has a gate.** If the gate fails, stop and fix before proceeding — do NOT push through.
3. **Phase 1 is non-negotiable.** No code is written until ripples, patterns, and the files-to-touch list are stated in the reply.
4. **`npm run build` runs per logical chunk in Phase 3**, not only at the end. TS errors = stop, re-ground, do not patch around.
5. **Phase 4 closes the loop with the Rule E checklist + git log check.** A session where `src/` changed but no skill files did is an open session, not a closed one.
6. **Abbreviated loop (Phase 1 + 3 only)** is allowed ONLY for typo/comment/skill-markdown/revert work. Everything else, including "one-line fixes," runs the full loop. Pattern R4 came from a one-line fix.

This rule exists because rules without gates get skipped — BUG-S1 through BUG-S8 and Pattern R4 all happened with the existing rules in place. The loop turns rules into checkpoints.

### Rule J: Default is main thread — subagent delegation requires a reason

Three project agents live in `.claude/agents/`. Before invoking ANY of them, state in the reply:

1. **Which agent** (`clubkeeper-explorer` / `clubkeeper-reviewer` / `clubkeeper-skill-auditor`).
2. **The decision-rule answer:** Does the intermediate work matter? If YES, do NOT delegate.
3. **Why this is not an anti-pattern.** The skill's `## Project Agents` section enumerates the forbidden uses (debug, test runner, sequential pipeline, expert persona, auto-fix). Confirm your use is not one of those.

Forbidden delegations (no exceptions):
- **Debugging a live failure.** Read logs and full error output in main thread.
- **Running `npm run build` or tests.** Output stays in main thread.
- **Designing or planning** any code (Phase 1 + 2 of session_loop.md).
- **Anything in Phase 3 EXECUTE** beyond a discrete read-only lookup.
- **Bug RCA.** Sequential by nature — main thread.

Required delegations (use the relevant agent — don't do these in main thread):
- **End-of-session skill audit** → `clubkeeper-skill-auditor` (Phase 4 close).
- **Pre-commit review of any chunk >100 LOC of new code** → `clubkeeper-reviewer`.

This rule exists because the agent system is brand-new and the easy failure mode is the one `SubAgent.txt` warned about: spinning up agents for tasks where intermediate visibility matters. #109 is the recent example of what happens when you trust a summarised result. Don't repeat it at agent scale.
# ClubKeeper Skill Architecture Redesign — Phase 1 Proposal

**Date:** 7 Jul 2026 · **Author:** Claude (Fable), full read of every skill file, agent file, CLAUDE.md, and open GitHub issues · **Status:** PROPOSAL ONLY — no skill files changed.

**Primary goal: correctness.** The verdict up front: the *content* of this system is excellent and battle-tested — roughly **85% of it survives**. The *architecture* has one systemic disease: **the same fact lives in 3–5 places, and nothing forces the copies to agree.** I found 27 concrete contradictions/stale facts (Section 4), including several that would cause a future session to write wrong code with full confidence. The redesign is therefore not a rewrite — it is (a) fix every falsehood, (b) give every fact exactly one home, (c) shrink the always-loaded surface, (d) replace prose gates with machine-enforced checks where mechanically possible.

---

## 0. Baseline measurements

Token counts measured by the Read tool where available, otherwise estimated from bytes. "Loaded when" = what actually happens today.

| File | Lines | ~Tokens | Loaded when (today) |
|---|---|---|---|
| SKILL.md | 364 | ~12,000 | **Every session, always** |
| references/ripple_effects.md | 1,421 | 67,764 (measured) | Mandatory before any code change (usually grepped, not fully read) |
| references/bug_patterns.md | 1,146 | 53,347 (measured) | Mandatory per-domain before known-bug-area edits |
| references/changelog.md | 1,793 | 42,036 (measured) | "When did we ship X" |
| references/sync_architecture_v2.md | 1,523 | 32,927 (measured) | Sync work |
| references/decisions_active.md | 294 | ~9,000 | Decision questions |
| references/data_model.md | 533 | ~8,000 | Schema questions |
| references/decisions_archive.md | 380 | ~5,500 | Rarely |
| references/player_design_system.md | 664 | ~5,500 | Player-facing UI work |
| references/architecture.md | 240 | ~4,200 | Structure questions |
| references/bug_archive.md | 247 | ~4,500 | Rarely (pointer index) |
| references/test_status.md | 280 | ~4,200 | Almost never (stale since 19 May) |
| references/business_context.md | 235 | ~3,200 | Business/pricing questions |
| references/design_system.md | 227 | ~2,200 | UI work |
| references/deployment.md | 206 | ~1,700 | Deploy questions |
| references/session_loop.md | 106 | ~1,300 | Every coding session |
| references/checklists/new_settings_field.md | 41 | ~600 | Settings-field work |
| CLAUDE.md (repo root) | 74 | ~1,000 | Every CLI session, always |
| .claude/agents/*.md (3 files) | 246 | ~3,800 | Agent invocations (CLI only) |
| **Total skill folder** | **~9,700** | **~258,000** | |

**What a fresh session actually loads vs needs:** every session pays ~13k tokens (SKILL.md + CLAUDE.md) before doing anything. Of SKILL.md's 12k, roughly half is the Current State + Pending + bug-tracking-history sections — volatile content that is stale within days and is exactly the part Rule G was written to keep small (the Sync entry alone is ~1,500 words with commit SHAs and dates, violating Rule G's own text). The stable laws a session always needs (hard rules, workflow, routing) are ~4k tokens. The redesign splits these.

**Uncommitted right now:** SKILL.md + changelog.md have working-tree edits (a Current State status-line correction + a changelog entry) that were never committed — a live demonstration that the end-of-session pairing gate is not machine-enforced.

---

## 1. Inventory + verdict table

| File / section | ~Tokens | Purpose | Verdict | Reason |
|---|---|---|---|---|
| **SKILL.md — persona, product, response style** | ~1.5k | Who Sugeet is, how to answer | **KEEP, trim** | Fix "(Sonnet)" stale note. Core context, cheap. |
| **SKILL.md — Critical Rules 1–15** | ~1.5k | Hard laws | **KEEP** | Battle-tested. Stays always-loaded. |
| **SKILL.md — routing table** | ~0.5k | What to read when | **KEEP, extend** | Becomes the explicit loading map. |
| **SKILL.md — Project Agents section** | ~2.5k | Delegation rules | **SPLIT** | Rules stay (condensed ~40%); model-change history + invocation examples move to the agent files themselves. CLI-only content; mark it so web Claude skips it. |
| **SKILL.md — Current State** | ~3.5k | Module snapshot | **MOVE → STATE.md** | Volatile content out of the always-stable file. Sync entry rewritten to comply with Rule G (it currently violates it worse than any other entry ever has). |
| **SKILL.md — Pending** | ~1.5k | Load-bearing blockers | **MOVE → STATE.md + partially generate** | Today it silently omits open P0s #97, #100, #103, #110 — the exact failure it exists to prevent. Open-issues block becomes script-generated from GitHub. |
| **SKILL.md — Known limitations, Dexie schema summary** | ~0.7k | Status facts | **MOVE → STATE.md** | Same volatility class. |
| **SKILL.md — Bug Tracking (flow + history)** | ~1.5k | Issue-first flow | **SPLIT** | The mandatory flow (steps 1–6) stays in SKILL.md verbatim — hard requirement. The historical "67 issues created, #55–67 open" snapshot is DELETED (stale; GitHub is truth; live snapshot lives in STATE.md). |
| **SKILL.md — Rules A–J** | ~2.5k | Process laws | **KEEP, consolidate** | Rewritten tighter; Rule G's target moves to STATE.md; Rule B/E/G gain a machine check (see §5). Fix Rule H's wrong pattern pointer ("S4" → R4). |
| **ripple_effects.md** | 67.8k | Change-impact map | **KEEP — this is the crown jewel — but clean** | (a) Fix 3 stale sections (Peak Pricing, gear-icon line, low-stock location). (b) Strip the Advance-Booking-style "Files in scope (P1c shipped <date>)" phase-narrative blocks — that's changelog content duplicated; sections become steady-state (files + invariants + ripples). Est. −20% size, +much trust. |
| **bug_patterns.md** | 53.3k | Bug-class catalog | **KEEP — second crown jewel — but fix IDs** | Duplicate IDs (two F8, two S6, three R3, P1/P2 collide across two domains) make "read Pattern P2" ambiguous. Renumber ONLY the collisions (new unique codes), leave cited-in-git-log IDs stable. Archive superseded Pattern P3 (its advice — `Number(routeParam)` — is now the exact bug R5 warns about). Fix stale LIMIT-001 copy + stub-R3 "fix pending" note. |
| **changelog.md** | 42k | Session history | **KEEP as append-only history, repair** | Fix broken ordering (entries from 4 Jun and 10 Jun sit at the bottom, after May; "Open future work" is mid-file), move the purpose header from line 1118 to line 1. Delete the superseded "Manual setup steps — status" block (says LIVE mode pending KYC; LIVE has been collecting ₹599 since 24 Jun) after extracting the still-true webhook item to STATE.md. New rule: entries ONLY prepend at top. |
| **sync_architecture_v2.md** | 32.9k | Sync design doc | **KEEP, demote to design-history with a WARNING banner** | Still needed: §2 permission matrix, §3 identity model, §4.5–4.9 contracts, Phase D staff plan. Actively dangerous: §6.3/§7.3 pseudocode (string-compares `updated_at` — the precise bug Pattern S17 exists to prevent; SyncRunner sketch lacks S15/S16). Banner: "DESIGN HISTORY — where this conflicts with shipped code or bug_patterns S14–S24, the code wins." Strike the superseded pseudocode with pointers. |
| **data_model.md** | ~8k | Schema reference | **REWRITE (most dangerous file in the skill)** | Says current = v16/v17; reality = v20. Types show numeric ids on the 4 UUID-migrated tables and their FK fields — a session trusting this file writes pre-migration code. Rewrite to v20 reality; keep only non-code-derivable content (invariants, version history table, billing acceptance values, export contract); point to `src/types/index.ts` as the type authority. |
| **decisions_active.md** | ~9k | Live decisions | **KEEP, prune** | Move superseded entries (offline-only/no-backend, "sync deferred at 2/3 asks") to archive with SUPERSEDED markers. Fix the snooze-anchor line that flatly contradicts Pattern T6. |
| **decisions_archive.md** | ~5.5k | Historical decisions | **KEEP as-is** | Cheap, correct, rarely loaded. |
| **architecture.md** | ~4.2k | Code structure | **KEEP, trim stale** | useDexieSetting section is current and good. Delete "Future Architecture (When Adding Cloud Sync)" (shipped), fix the stale "Realtime Pattern (topup_intents)" block (contradicts the A8 bridge described in the same file), fix "_clubSyncDone fix pending item 10" (fixed in Chunk 4.3), extend routing map (missing /quick-sale, /piggy, /bookings, /c/:slug, …). |
| **design_system.md** | ~2.2k | Owner-app tokens | **KEEP, fix one section** | "Responsive Strategy: no desktop layout, max-w-md centered" contradicts Critical Rule 13 + the whole #91 effort. Rewrite that section. |
| **player_design_system.md** | ~5.5k | Player-app tokens | **KEEP, reconcile** | Two conflicts: "prefer Lucide React (already in stack)" vs the owner-app "inline SVG only, no icon libraries" rule; and it claims to be source of truth while the shipped `/c/:slug` pages use the owner dark theme. Add a status note (aspirational vs shipped), fix the icon rule, remove the dead `/mnt/user-data/...` reference. |
| **business_context.md** | ~3.2k | Business memory | **KEEP as-is** | Minor drift (1-month trial vs 7-day) fixed in place. Nothing else in the repo holds this. |
| **deployment.md** | ~1.7k | Ops runbook | **KEEP, trim** | Delete future-tense sections for things long done (env vars "when added", custom domain "future"). |
| **test_status.md** | ~4.2k | Test checklist | **ARCHIVE** | Last real update 19 May. Duplicate section names (two "Section N", two "Section O"). Since then, verification truth lives in changelog runtime-proof records + owner-verified GitHub issues. Move to `references/history/` with a banner; the "3 scenarios per change" discipline already lives in session_loop. Zero info deleted. |
| **bug_archive.md** | ~4.5k | Issue pointer index | **KEEP (web Claude needs it), add sync check** | claude.ai Claude cannot run `gh` — this file is its only issue view. But pointers drift (#97 marked fixed/closed; GitHub says OPEN P0). The check-skill script cross-checks pointer states against `gh` in CLI sessions. |
| **session_loop.md** | ~1.3k | 4-phase loop | **KEEP** | Good. Fix the "S4" pattern pointer; Phase 4 gains "run `npm run check:skill`". |
| **checklists/new_settings_field.md** | ~0.6k | Pre-write checklist | **KEEP as-is** | Paired with a real machine gate (`check:settings`). This is the model the rest should follow. |
| **CLAUDE.md** | ~1k | CLI bootstrap | **KEEP, fix drift** | Two errors: "390px target width" (everything else says 360px) and "clubkeeper-reviewer (Sonnet)" (agent runs Opus since 30 Jun). Add: "read STATE.md before acting." |
| **agents/clubkeeper-explorer.md** | ~0.9k | Read-only lookup | **KEEP as-is** | Well-scoped. |
| **agents/clubkeeper-reviewer.md** | ~1.5k | Pre-commit review | **KEEP** | Update its hard-rules list when SKILL.md sections move (it cites live files, so low risk). |
| **agents/clubkeeper-skill-auditor.md** | ~1.3k | Session-close gate | **KEEP + give it a deterministic core** | Auditor stays for judgment calls; the mechanical checks (Rule B pairing, Rule G shape, pattern-ID uniqueness, pending-vs-GitHub) move into `scripts/check-skill.mjs` which the auditor runs FIRST, then judges the rest. An LLM-only gate provably missed things (Rule-G-violating sync entry passed multiple audits). |
| **NEW: STATE.md** (inside skill folder) | ~2k | Volatile truth snapshot | **CREATE** | See §2. |
| **NEW: scripts/check-skill.mjs** (repo root) | — | Machine gate | **CREATE** | See §5. |

---

## 2. Proposed architecture

### Folder tree (target)

```
CLAUDE.md                          # CLI bootstrap: hard-rule digest + "load SKILL.md then STATE.md"
.claude/
  agents/                          # unchanged trio (CLI-only)
  skills/clubkeeper/
    SKILL.md                       # ~4k tokens, STABLE ONLY: persona, product, Critical Rules,
                                   #   workflow (loop + bug flow + Rules A–J condensed),
                                   #   loading map, response style, agents digest (CLI-only tag)
    STATE.md                       # ~2k tokens, VOLATILE ONLY, overwrite-in-place:
                                   #   - "Last verified: <date>" stamp (staleness signal for web Claude)
                                   #   - Current focus (1-3 lines)
                                   #   - Module status (ONE line each — Rule G lives here now)
                                   #   - Load-bearing pending: unapplied migrations, manual-config steps
                                   #   - OPEN ISSUES P0/P1 (script-generated block from GitHub)
                                   #   - Known limitations
    references/
      ripple_effects.md            # cleaned: steady-state sections, no phase narratives
      bug_patterns.md              # unique IDs, superseded patterns in an ARCHIVED section at bottom
      session_loop.md              # + Phase 4 runs check:skill
      checklists/new_settings_field.md
      data_model.md                # rewritten to v20; types authority = src/types/index.ts
      architecture.md              # trimmed
      design_system.md             # fixed responsive section
      player_design_system.md      # reconciled
      decisions_active.md          # pruned
      business_context.md
      deployment.md                # trimmed
      history/                     # append-only / archived — never load for "what is true now"
        changelog.md               # newest-first enforced, purpose header at top
        decisions_archive.md
        bug_archive.md             # pointer index (web Claude's issue view)
        sync_architecture_v2.md    # banner: DESIGN HISTORY, code wins
        test_status.md             # archived with banner
scripts/
  check-settings-pattern.mjs       # existing (unchanged)
  check-skill.mjs                  # NEW deterministic skill gate (see §5)
  sync-state.mjs                   # NEW (optional, phase 6): regenerates STATE.md issues block via gh
```

Everything inside `.claude/skills/clubkeeper/` travels to claude.ai in the zip — including STATE.md and history/. The scripts and agents are CLI-only, and SKILL.md marks the agent section "CLI sessions only" so web Claude doesn't try to invoke them.

### Loading map ("a fresh session loads X always, Y when doing Z")

| Situation | Load |
|---|---|
| **Every session (CLI)** | CLAUDE.md → SKILL.md → **STATE.md** (all three ≈ 7k tokens, down from ~13k with the volatile half now guaranteed-fresh) |
| **Every session (claude.ai)** | SKILL.md → STATE.md (check its "Last verified" stamp; if old, say so to Sugeet) |
| Any code change | + ripple_effects.md (grep the Quick Index → read matching sections) + session_loop.md |
| Known-bug area | + bug_patterns.md (that domain's section) |
| ClubSettings field | + checklists/new_settings_field.md (gated by `check:settings`) |
| Schema/typing question | + data_model.md, then `src/types/index.ts` (authority) |
| Sync work | + ripple_effects §Sync + bug_patterns S14–S24; history/sync_architecture_v2.md only for Phase-D/contract questions, never for implementation shapes |
| UI work | + design_system.md (owner) or player_design_system.md (player) |
| "Why did we…" | + decisions_active.md, then history/decisions_archive.md |
| "When did we ship…" | + history/changelog.md (top = newest, enforced) |
| Business/pricing | + business_context.md |
| Deploy/infra | + deployment.md |
| Bug report intake | GitHub first (`gh issue list --search`), STATE.md open-issues block second; web Claude uses bug_archive.md + STATE.md |

The **one-fact-one-home rule** that makes this work:

| Fact class | Sole home |
|---|---|
| What is true right now | STATE.md |
| Laws (never violate) | SKILL.md |
| What breaks if you change X | ripple_effects.md |
| Bug classes + prevention rules | bug_patterns.md |
| Why we chose X | decisions_active.md / archive |
| What happened, when | history/changelog.md + git log + GitHub |
| Types/schema shape | `src/types/index.ts` (code), summarized in data_model.md |

Cross-references are links, never copies. Copying a fact into a second file becomes a check-skill warning (it looks for duplicated Current-State-style status lines outside STATE.md — heuristic, warn-only).

---

## 3. Migration map (old → new)

Every piece of information, by section. **D** = deletion with justification.

| Old location | → New location |
|---|---|
| SKILL.md: About Sugeet / About ClubKeeper / Response Style | SKILL.md (kept; "(Sonnet)" fixed) |
| SKILL.md: Rules 1–2 (ripple/patterns preambles), Critical Rules 1–15 | SKILL.md |
| SKILL.md: routing table | SKILL.md loading map (extended) |
| SKILL.md: Project Agents — decision rule, anti-patterns, gates | SKILL.md condensed digest |
| SKILL.md: Project Agents — invocation example, model-change history/rationale | respective `.claude/agents/*.md` bodies |
| SKILL.md: Current State (all module lines) | STATE.md module status (each rewritten to ONE line; detail already exists in ripple_effects/changelog — verified per line during migration, anything not already there gets moved there first) |
| SKILL.md: Pending (migrations, webhook, PWA banner, wallet phase 3, backfill, key rotation, session persistence) | STATE.md load-bearing pending |
| SKILL.md: Pending gaps (#97/#100/#103/#110 absent) | STATE.md script-generated open-issues block (structural fix) |
| SKILL.md: Known limitations LIMIT-001/002/003 | STATE.md known limitations |
| SKILL.md: Dexie schema summary (v20 + bump checklist) | data_model.md (version history) + ripple_effects §Schema (bump checklist already there); STATE.md keeps one line "Dexie v20" |
| SKILL.md: Bug Tracking mandatory flow (steps 1–6) | SKILL.md verbatim (hard requirement) |
| SKILL.md: "67 issues created / #1–54 closed / #55–67 open" | **D** — stale historical snapshot; GitHub is authoritative; live view = STATE.md |
| SKILL.md: Rules A–J | SKILL.md workflow section (consolidated; G retargeted to STATE.md; H's "S4" pointer corrected to R4; B/E/G gain check-skill enforcement) |
| ripple_effects.md: all 22 sections' invariants + files-in-scope + cross-ripples | ripple_effects.md (cleaned in place) |
| ripple_effects.md: Advance Booking P1a–P2 phase blocks, Peak Pricing phase plan, similar "shipped <date>" narratives | steady-state rewrite; narrative facts verified present in history/changelog.md (they already are — checked during audit); anything unique (e.g. P1e-2 invariants) promoted into the section's Invariants list |
| ripple_effects.md: stale gear-icon line, low-stock-location line, Peak "Phases 2–4 deferred" | corrected in place (Phase 1 of migration) |
| bug_patterns.md: all current patterns | bug_patterns.md (collision IDs renamed: second F8→F10, second S6→S12, Dexie-R3→(already generalized by R4; kept as R4 addendum), stub R1/R2/R3→folded into S22/S4-class notes or archived; Payment P1/P2 vs Player P1/P2 → Payment ones renamed PM1/PM2 with alias note "formerly P1/P2 in Payment section" so old commit messages remain traceable) |
| bug_patterns.md: Pattern P3 (route params via Number()) | ARCHIVED section at file bottom, marked SUPERSEDED BY R5/D12 — **kept, not deleted**, because git-log commits cite it |
| bug_patterns.md: Known Limitations block (stale LIMIT-001 copy) | **D** — duplicate of STATE.md limitation; stale copy contradicted per-user-DB reality |
| bug_patterns.md: "When you find a new bug" protocol | bug_patterns.md (kept) |
| changelog.md: all dated entries | history/changelog.md, re-sorted newest-first |
| changelog.md: purpose paragraph (currently line 1118) | top of file |
| changelog.md: "Manual setup steps — status" | still-true item (webhook env config) → STATE.md; "LIVE mode pending KYC" → **D** (false since 24 Jun; correct fact already in STATE via Current State) |
| changelog.md: "Open future work" section | items merged into STATE.md pending (GST/email already there) ; stale "old ClubKeeperDB migration" → decisions_archive note; then **D** the section |
| sync_architecture_v2.md: §1–5, §8–15, amendments | history/sync_architecture_v2.md under DESIGN HISTORY banner |
| sync_architecture_v2.md: §6.2/6.3/7.3 pseudocode | struck through in place with pointers: "superseded — see src/db/syncWrappers.ts / syncRunner.ts / syncReader.ts + Patterns S14–S24" (**kept visible for history, marked unsafe to copy**) |
| sync_architecture_v2.md: Appendix H pattern reservations (S20/S21/S23-as-role-guard/A20) | corrected note added (S23 was consumed by removeChannel-async; role-guard pattern will get a fresh ID in Phase D) |
| data_model.md: schema version table v1–v17 | data_model.md extended to v20 (v18/v19/v20 rows added from changelog) |
| data_model.md: v16 "current" claim, numeric-id interfaces, ClubKeeperBackupV16-as-current, stale FK types | **REPLACED** by v20 reality (this is correction, not deletion — old text is recoverable from git) |
| data_model.md: piggy formula, invariants 1–7, time/money math, rate-card algorithms + acceptance table, export contract + ripple checklist | data_model.md (kept — this is the file's real value) |
| data_model.md: "When to Add Cloud Sync: NOT YET" | **D** — superseded by shipped Phase C; decision trail lives in decisions_archive + sync doc |
| decisions_active.md: all still-true decisions | decisions_active.md |
| decisions_active.md: "offline-first no backend", "full cloud sync still pending", "multi-device second ask, still deferred" | history/decisions_archive.md with SUPERSEDED-BY-SYNC-PROJECT markers |
| decisions_active.md: snooze "from tap moment" sentence | corrected to match Pattern T6 (anchor to original notifyAtMs) — T6 + ripple + shipped code all agree; this sentence is the outlier |
| architecture.md: stack table, file structure, patterns, useDexieSetting spec, Player Hub flow, ClubCoins flow | architecture.md (routing map extended) |
| architecture.md: "Future Architecture (cloud sync)" | **D** — superseded (sync shipped); nothing unique |
| architecture.md: stale "Realtime Pattern — called from TopBar" + fallback-timer known bug + "_clubSyncDone fix pending item 10" | corrected in place (bridge + Chunk 4.3 reality) |
| design_system.md: everything except Responsive Strategy | design_system.md |
| design_system.md: Responsive Strategy ("no desktop layout") | rewritten to the #91 reality (max-w-[1400px], md:2-col lg:3-col grids, FAB/modals outside wrapper) — Critical Rule 13 is the summary, this becomes the detail |
| player_design_system.md: all tokens/components/voice | player_design_system.md + status header ("shipped player pages currently use owner dark theme; this system is the target for the player-app redesign — Sugeet decides when") + icon-rule reconciliation + dead sandbox path removed |
| business_context.md: everything | business_context.md ("1-month trial" mention aligned to 7-day cardless) |
| deployment.md: current setup, DNS, keep-alive, git help, vercel.json, rollback | deployment.md |
| deployment.md: "Environment Variables (when added)", "Custom Domain (Future)" | **D** — done long ago; current state already documented in the same file + CLAUDE.md |
| test_status.md: whole file | history/test_status.md with ARCHIVED banner ("verification truth = runtime-proof records in changelog + owner-verified GitHub issues since Jun 2026") |
| bug_archive.md: whole file | history/bug_archive.md; #97/#71 pointer states corrected; check-skill cross-checks against gh |
| session_loop.md | session_loop.md (+check:skill in Phase 4; "S4" pointer fixed) |
| checklists/new_settings_field.md | unchanged |
| CLAUDE.md | corrected (390→360, reviewer Sonnet→Opus) + STATE.md pointer |
| agents/*.md | unchanged in Phase 1–5 (reviewer's SKILL-section references verified after SKILL.md shrink) |

Nothing else is deleted. Every **D** above is either (a) provably false today, with the correct fact already housed elsewhere, or (b) a stale duplicate of a fact whose sole home now holds the current version.

---

## 4. Contradictions found (memory bugs)

Ordered by danger. Each one is a case where two skill files (or a skill file and reality) disagree.

**Would cause wrong code:**
1. **data_model.md says current schema is v16/v17 with numeric ids** on gameTables/sessions/sessionItems/canteenItems and numeric FK fields. Reality: v20, UUID strings (SKILL.md, changelog, code). A session trusting this writes pre-migration code.
2. **bug_patterns Pattern P3** instructs `const id = Number(rawId)` at route boundaries — the exact crash Pattern R5 documents (`Number("<uuid>") → NaN → db.get(NaN)` DataError). Two live patterns give opposite orders.
3. **sync_architecture §7.3** LWW pseudocode string-compares `updated_at` and leans on `updated_by` tie-breaks — precisely the #117 bug Pattern S17 fixed (compare epoch-ms numbers; `updated_by` is always NULL from our pushes). The doc's own header says "this doc is the source of truth."
4. **decisions_active** says snooze anchors to "the tap moment, not original alarm time" — the opposite of Pattern T6, the ripple invariant, and the shipped code.
5. **design_system Responsive Strategy** says "no desktop-specific layout, max-w-md centered column" — contradicts Critical Rule 13 and all of #91.
6. **architecture.md "Realtime Pattern"** says the topup channel is opened from TopBar on mount with a known timer leak — the same file's Player Hub section describes the current app-shell bridge (A8). Self-contradiction within one file.

**Would cause wrong process / missed state:**
7. **SKILL.md Pending omits open P0s** #97 (toggle desync recurrence), #100 (rounding not applied), #103 (slug save freeze), #110 (S14 dead-letter). The "load-bearing pending must be impossible to miss" guarantee does not hold today.
8. **bug_archive says #97 fixed+closed (238001f)**; GitHub shows #97 OPEN, P0. Also #71 marked open but actually closed. Pointer drift in both directions.
9. **changelog "Manual setup steps"** says Razorpay LIVE mode pending KYC; SKILL.md says LIVE collecting ₹599 since 24 Jun.
10. **#114 vs #121 are duplicate issues** (supabaseSync accessToken TDZ) — Rule D's "search before create" was skipped, and nothing detected it.
11. **CLAUDE.md: "390px target width"** vs 360px everywhere else; **"clubkeeper-reviewer (Sonnet)"** vs Opus frontmatter + SKILL.md.
12. **SKILL.md Rule H + session_loop cite "Pattern S4 (toggle desync)"** — bug_patterns S4 is "Razorpay trial via start_at". The toggle-desync class is R3/R4. A dutiful session reads the wrong pattern.

**Retrieval hazards / stale copies:**
13. bug_patterns has **two Pattern F8**, **two Pattern S6**, **three things called R3**, and **P1/P2 defined twice** (Payment vs Player-Hub domains). ripple_effects references "Pattern M3 (single source of truth: canConfirm)" which is actually Payment-P2; M3 is the 4-escape-paths rule.
14. ripple_effects Wallet section: "TopBar right side has 4 elements … (online dot, canteen, wallet, **gear**)" vs Critical Rule 12 and the Tables-page section ("NO gear").
15. ripple_effects Peak Hour Pricing section: "Phases 2–4 deferred… files NOT yet created — do not assume they exist" vs Current State/changelog (all 4 phases shipped 19 Jun, files exist).
16. ripple_effects Canteen section says the low-stock input lives in Settings→Club Info; the Settings section (and decisions_active, per BUG-S5/#99) says it moved to the Canteen section.
17. bug_patterns "Known Limitations" claims two accounts share IndexedDB — per-user DB shipped 27 May; SKILL.md's LIMIT-001 says "partially fixed". Three divergent copies of one fact.
18. bug_patterns stub-R3 says "_clubSyncDone fix pending — see Pending list item 10"; fixed in Chunk 4.3; numbered Pending list no longer exists. architecture.md repeats the same stale claim.
19. architecture.md + data_model.md both still instruct "do NOT build cloud sync until 3+ customers ask" while the sync engine is shipped and running.
20. sync_architecture Appendix H reserved S23 for the role-guard pattern; S23 was later consumed by the removeChannel-async pattern. Future Phase D work following Appendix H would collide.
21. player_design_system: "prefer Lucide React (already in stack)" vs "inline SVG only, no icon libraries" (design_system + architecture). Lucide is not in the stack.
22. player_design_system claims to be the source of truth for `/c/:slug` visuals; shipped PlayerScan/BookingScreen use owner dark-theme tokens (per changelog Phase 0 entry). Aspiration presented as fact.
23. SKILL.md persona: "relies on AI to write code via Claude Code (Sonnet)" — sessions have run Opus/Fable for weeks; trivially wrong in the always-loaded file.
24. SKILL.md Current State sync entry: ~1,500 words, SHAs, dates, sub-histories — violates Rule G ("one line, no SHAs, no dates") in the same file that defines Rule G. It passed multiple auditor runs, proving the LLM-only gate misses mechanical violations.
25. test_status has two "Section N" and two "Section O" headings; header says last session 19 May 2026 — presented as a live status file.
26. changelog ordering: entries for 4 Jun and 10 Jun sit BELOW late-May entries near EOF; "Open future work" floats mid-file; the file's purpose statement is at line 1118. Bottom-up reading (a natural "find latest" strategy) returns 14-Jun content.
27. player_design_system references `/mnt/user-data/outputs/clubkeeper-roadmap.html` — a claude.ai sandbox path that does not exist in this repo or on this machine.

---

## 5. Machine enforcement: `scripts/check-skill.mjs` (the new gate)

Rules without gates get skipped — this repo's own history proves it (BUG-S1–S8, Pattern R4, and contradiction #24 above all happened with the rules already written). `check:settings` is the one rule that has never regressed since it got a script. The redesign copies that success.

`npm run check:skill` — deterministic, no LLM, exits 1 on failure:

| Check | Enforces | Method |
|---|---|---|
| **Paired commits** | Rule B | `git log --name-only` over the window: any commit touching `src/`, `api/`, or `supabase/migrations/` without a same-session skill/STATE commit → FAIL with SHA list |
| **STATE shape** | Rule G | STATE.md module lines: one line per module (regex), no `[0-9a-f]{7,}` SHAs, no build-size strings, no dates inside status lines, no duplicate module names → FAIL |
| **Pattern ID uniqueness** | retrieval integrity | Parse `### Pattern XN` headings in bug_patterns.md → duplicate codes FAIL (would have caught F8/S6/R3/P-collisions the day they were created) |
| **Pattern reference integrity** | correct cross-refs | Every `Pattern [A-Z]+[0-9]+` mention across skill files must exist as a heading in bug_patterns.md → unknown refs FAIL (catches Rule H's "S4" class of bug) |
| **Migration coverage** | "impossible to miss" guarantee | Every `supabase/migrations/*.sql` filename must appear in STATE.md either under "unapplied" or in an "applied" ledger line → missing FAIL |
| **Open-P0/P1 coverage** (CLI only) | "impossible to miss" guarantee | `gh issue list --state open --label P0,P1` (with graceful skip if `gh` unavailable) — every result must appear in STATE.md's issues block → missing FAIL |
| **Changelog ordering** | history usability | First dated heading in changelog.md must be the newest date in the file → FAIL (catches append-at-bottom regressions) |
| **STATE freshness stamp** | web-Claude trust | "Last verified:" date must be ≥ the newest skill-file commit date → FAIL |
| **Link integrity** | no rot | Relative file references in SKILL.md/STATE.md loading map must exist → FAIL |

Wiring: `package.json` gets `"check:skill": "node scripts/check-skill.mjs"`. The **skill-auditor agent's first step becomes "run `npm run check:skill` and report its output"**, then it does the judgment-only checks a script can't (does the changelog entry actually capture the decision? is the ripple update semantically right?). Session_loop Phase 4 lists it. It is NOT added to `prebuild` (a code build shouldn't fail on a mid-session stale skill; the gate is for session close).

`sync-state.mjs` (phase 6, optional): regenerates STATE.md's open-issues block from `gh issue list --json`. Until it exists, the block is hand-maintained but check-skill still FAILS on omissions — the guarantee holds either way; the generator just removes the typing.

---

## 6. Failure-mode analysis (design-against-failure, mechanically)

| Failure (from mandate) | Mechanical prevention in new design |
|---|---|
| **Session forgets context / compaction eats details** | Always-loaded surface shrinks to ~7k tokens and is stable+fresh (SKILL laws + STATE snapshot). Re-grounding after compaction = re-read 2 small files, not reconstruct a 12k mixed file where half is stale. Phase headers (session_loop) remain the visible re-entry points. |
| **Hallucination** | One-fact-one-home kills the "two files disagree, model picks the wrong one confidently" class — 27 instances found today would be structurally impossible to sustain silently because the duplicate doesn't exist. Design docs get "code wins" banners with superseded blocks struck through, not deleted (a struck-through wrong answer is safer than an absent one — the model sees WHY it's wrong). |
| **Skips rules** | Rules with mechanical shape get scripts (check:settings exists; check:skill added). Rule B/G violations become exit-code-1, not vibes. The auditor's judgment checks run on top. Commit-message pattern citations remain searchable. |
| **Ignores checklists** | new_settings_field checklist keeps its build-failing enforcement. Session close now has the same property: an unpaired src commit is a red exit code the moment anyone (human or AI) runs check:skill — including the auditor, which is a Required delegation in Rule J. |
| **Misses ripple effects** | ripple_effects stays mandatory Phase-1 reading and becomes MORE trustworthy (stale sections were the #1 reason a smart session might learn to distrust it). Reviewer agent's RIPPLE GAPS section unchanged. |
| **Loads irrelevant files** | Explicit loading map with situations → files. History/ directory is a physical signal: "nothing in here tells you what is true now." |
| **Fixes the wrong bug** | Issue-first flow unchanged. STATE's generated open-issues block + check-skill's gh cross-check mean the session's view of open bugs cannot silently diverge from GitHub (today it has: 4 open P0s invisible in Pending, one fixed-but-marked-open, one duplicate pair #114/#121). |
| **Introduces regressions** | bug_patterns (fixed IDs) + reviewer agent unchanged. Honest note: the single biggest regression-catcher would be fixing #118 (the vacuous `tsc` gate) — that is a src/-adjacent task explicitly out of scope here, but the proposal records it as the first recommended post-migration code session. |
| **Stops following workflow after compaction** | The loop's gates are stateless — each phase re-derivable from SKILL.md's ~4k. check-skill at close is the backstop that catches a drifted session's output even if the session itself lost the plot. |
| **Human paste errors (Sugeet)** | Ready-to-paste blocks keep full paths + expected output lines (existing style). STATE.md's migration ledger gives him ONE place to see "what SQL have I not run yet" instead of eight scattered ⚠ lines. The "⚠ Confirm if already run" uncertainty items become explicit verification tasks in phase 1. |
| **Two-Claude drift (CLI vs claude.ai)** | STATE.md travels in the zip and carries "Last verified: <date>". Web Claude is instructed (SKILL.md) to state the staleness aloud when the stamp is old and to distrust STATE in favor of asking Sugeet. Re-zip instruction becomes part of the close ritual whenever STATE/SKILL change materially. |
| **3-year scale (500 features, 100s of patterns)** | Volatile/stable split scales: SKILL stays ~constant; STATE stays ~constant (one line per module — enforced); growth lands in ripple sections, pattern entries, and append-only history — all grep-retrieved, never bulk-loaded. Pattern-ID uniqueness check prevents the collision entropy that already appeared at 46 patterns. At 10× patterns, split bug_patterns by domain into a folder — the unique-ID checker already makes that a mechanical move. |

---

## 7. Migration plan — one commit per phase, skill fully usable after every commit

Branch `skill-redesign` (per your Phase 2 instructions). No `src/` changes in any phase.

| Phase | Commit | Contents | Risk |
|---|---|---|---|
| **0** | `chore(skill): commit stranded working-tree skill edits` | The currently-uncommitted SKILL.md/changelog.md edits land first so migration diffs are clean. | none |
| **1** | `fix(skill): correct 27 audited falsehoods in place` | Every item in §4 that is fixable without moving content: data_model v20 rewrite, Pattern P3 supersession note, sync §6/§7 strike-throughs + banner, T6/snooze line, gear line, peak-pricing section, low-stock location, responsive strategy, architecture stale blocks, CLAUDE.md 360px/Opus, LIMIT-001 copies, Rule H "S4"→R4, bug_archive #97/#71 pointers, changelog manual-setup block, persona "(Sonnet)", player_design reconciliation notes, test_status banner. **Biggest correctness win of the whole project, zero structural risk.** Also: verify the two "⚠ confirm if run" migrations against prod (via MCP/dashboard read) and record the answer. | low |
| **2** | `refactor(skill): unique bug-pattern IDs + cross-ref sweep` | Rename only colliding IDs (alias notes preserve git-log traceability), grep-fix every reference across all skill files + agents. | low (mechanical, grep-verified) |
| **3** | `feat(skill): STATE.md — volatile state split out of SKILL.md` | Create STATE.md (Current State one-liners incl. a Rule-G-compliant sync entry, Pending incl. the 4 missing P0s, migration ledger, limitations, freshness stamp). SKILL.md shrinks to stable content + loading map + pointer "read STATE.md next". CLAUDE.md pointer. Rule G retargeted. | medium — the SKILL.md shrink is the one step where content moves; mitigated by the migration map + Phase-2-of-your-flow self-verification (12 facts) |
| **4** | `feat(skill): scripts/check-skill.mjs machine gate` | The script (§5), `package.json` entry, auditor agent updated to run it first, session_loop Phase 4 updated. From this commit on, Rule B/G/coverage violations are exit codes. | low |
| **5** | `refactor(skill): history/ directory + changelog repair + ripple steady-state pass` | Move changelog/decisions_archive/bug_archive/sync_architecture/test_status into `references/history/` (routing table + loading map updated in same commit), fix changelog ordering + header, strip ripple phase-narrative blocks (verifying each stripped fact exists in changelog first). | medium — largest diff; but pure moves + verified deletions |
| **6** (optional) | `feat(skill): sync-state.mjs STATE generator` | gh-driven regeneration of the open-issues block. | low |
| — | **Self-verify** (your Phase 2 requirement) | 12 facts from the old skill traced to new locations, shown to you; frontmatter/description refreshed for the claude.ai zip; numbered merge + re-zip steps. | — |

After every commit the skill remains loadable and internally consistent: phases 1–2 only correct text; phase 3 leaves a pointer chain; phases 4–6 are additive/moves with same-commit reference updates.

---

## 8. What I rejected, and why

- **One consolidated mega-file** ("everything in SKILL.md so nothing can drift apart"): kills progressive loading (258k tokens), makes every session pay for everything, and drift would just become intra-file. Rejected.
- **Splitting bug_patterns/ripple_effects into many small per-domain files now**: more files = more link rot and more Rule-B pairing surface; both files are grep-navigated, so size isn't a retrieval problem yet. Revisit at ~2× current size — the unique-ID gate makes that split mechanical later.
- **Auto-generating data_model.md from `src/types/index.ts`**: seductive, but an AI-maintained generator script is one more thing that silently rots; the failure mode (generator broken, file frozen) looks identical to today's staleness. Instead: slim the file to non-derivable facts and make the code the declared authority. Cheaper, same correctness.
- **Wholesale pattern renumbering** (clean domain-prefixed scheme): commit messages since May cite current IDs (`Pattern R4`, `S11`…) and Rule H makes those citations searchable in git log. Renaming everything breaks that forensic thread. Only collisions get renamed, with aliases.
- **Replacing the skill-auditor agent with the script entirely**: the script can't judge whether a changelog entry actually captured a decision or whether a ripple update is semantically complete. Script = floor, agent = judgment on top. Both stay.
- **Moving Pending/state fully to GitHub** (issues as the only state): web Claude has no `gh`, and Sugeet pastes the skill zip there. STATE.md is the bridge; the script keeps it honest from the CLI side.
- **Deleting changelog.md** ("git log has it"): it holds non-git facts — owner decisions made mid-session, runtime-proof narratives, manual-setup records. Demoted to history/, kept append-only, ordering fixed.
- **Deleting sync_architecture_v2.md**: §2 permission matrix and the staff-login design are the Phase D spec and exist nowhere else. Banner + strike-throughs instead.
- **A "compaction survival file" auto-written each session**: your harness already handles compaction summaries; a second hand-rolled mechanism would drift against it. STATE.md + phase headers cover the re-grounding need.
- **Doing nothing structural** ("just fix the 27 bugs"): tempting, and Phase 1 alone is worth shipping — but the 27 bugs are symptoms. Without one-home-per-fact and machine gates, the copies regrow. The history shows exactly this: Rule G existed and was violated by its own file; Pending existed and missed 4 P0s.

### Self-critique (what could go wrong with THIS design)
- **STATE.md becomes the new dumping ground.** Mitigation: check-skill enforces its shape mechanically (one line per module, no SHAs) — the thing Rule G could never enforce by prose.
- **The migration itself introduces errors while moving text.** Mitigation: phases are small, each is one reviewable commit, deletions are listed and justified, and your Phase-2 12-fact spot-check runs at the end. Phase 1 (pure corrections) carries no move risk at all.
- **check-skill's gh checks fail offline.** The script degrades gracefully (skip with a warning) — it never blocks work when GitHub is unreachable.
- **A future smarter Claude finds the structure constraining.** The design is subtractive (fewer duplicated facts, smaller mandatory reads), not prescriptive about how to think; the only hard constraints are gates that encode Sugeet's explicit requirements. A smarter model loses nothing and gains a trustworthy substrate.
- **Honest residual:** no file structure can force a session to *read* ripple_effects. The loop + reviewer + check-skill make skipping visible after the fact; making it impossible would require pre-commit hooks on code content, which is a heavier regime you can ask for later if violations recur.

---

## 9. Honest percentage

- **Information: ~85% survives verbatim, ~10% relocated, ~5% deleted** — and every deletion is listed in §3 with a reason (provably false, or a stale duplicate of a fact that now has a single current home).
- **Files: 17 of 20 keep their identity** (5 of those move into `history/`). One file is rewritten (data_model), one is archived (test_status), two are created (STATE.md, check-skill.mjs).
- **Rules/process: 100% of the behavior you mandated survives** — issue-first bug flow, owner-closes-only, paired skill commits, load-bearing pending guarantee, end-of-session gate, your working style. What changes is enforcement: three of those move from "prose a session might skip" to "script that exits 1."
- If you want the single highest-value slice with the least change: **Phase 1 alone (fix the 27 falsehoods) is ~40% of the total correctness gain at ~5% of the risk.** The remaining phases are what stop the falsehoods from growing back.

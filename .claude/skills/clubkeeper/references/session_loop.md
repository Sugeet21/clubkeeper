# Session Loop — Every Coding Session

This is the loop Claude Code (and Opus) MUST follow for every code change in ClubKeeper. Skipping a phase = skipping the loop. Each phase has a **gate** — if the gate condition isn't met, STOP and fix it before proceeding.

State the current phase explicitly before each major tool call. Example: `Phase 1 — GROUND. Reading ripple_effects.md...`

---

## Phase 1 — GROUND (before any code)

State all four out loud in the reply:

1. **The change in one sentence.** ("Add a 'low stock alert' threshold field to Settings → Canteen.")
2. **Applicable `ripple_effects.md` entries.** Grep the file for the module/file name. List each match.
3. **Applicable `bug_patterns.md` patterns.** Grep by domain (Timer/Forms/Dexie/Auth/Subscription/Routing/UI-A11y/Modals/Settings). List each pattern code (e.g. "Pattern R4, Pattern S11").
4. **Files that will be touched.** Predict the full list. If you're not sure, view the directory first.

If the change involves `src/pages/Settings.tsx` → Rule H applies, also list patterns T2/R4/F5/U6/U10/S11 explicitly (R4 = settings useState-mirror class; an older revision cited "S4" which is a Razorpay pattern — wrong pointer).
If the change involves a ClubSettings field → read `checklists/new_settings_field.md` and paste the filled checklist.

**Gate:** If any of the four is empty or "none apply," stop and re-read the relevant reference. Empty is almost never the right answer in this codebase.

---

## Phase 2 — PLAN (still no code)

1. **Pseudocode the diff as a numbered list.** ("1. In `src/db/schema.ts`, add `lowStockThreshold: number` to ClubSettings. 2. In `src/pages/Settings.tsx`, add input under Canteen section. 3. ...")
2. **Predict the 3 test scenarios** per Rule 11:
   - Happy path: ___
   - Existing-data path: ___ (what about clubs that already have data without this field?)
   - Edge case: ___ (empty/max/error/offline)
3. **Predict the ripple.** Which other files MUST change for this to not break? Add them to the touched-files list from Phase 1.

**Gate:** If you can't articulate the edge case, the design is incomplete. Go back to Phase 1.

---

## Phase 3 — EXECUTE

1. Make the changes from the Phase 2 plan, in order.
2. Run `npm run build` after each **logical chunk**, not just at the very end. A logical chunk = "schema + one consumer" or "one screen + its types." Three files max per chunk.
3. If TS errors → **STOP**. Do not patch around the error. Go back to Phase 1 and re-ground — the ripple was wrong.
4. No `any`. No `// @ts-ignore`. No silent catches.
5. Commit message format: `<type>(<area>): <one-line> (Pattern XX if applicable)` — patterns make recurrence searchable in `git log`.

**Gate:** Build must pass with zero TS errors and zero new warnings before moving to Phase 4.

---

## Phase 4 — CLOSE

Before saying "done":

1. **Mentally run the 3 scenarios** from Phase 2. If happy/existing-data/edge can't all be answered, the feature isn't done.
2. **Run the Rule E checklist:**
   - `changelog.md` updated?
   - `ripple_effects.md` updated for files touched?
   - Any new bug found → GitHub issue created?
   - Any new pattern → `bug_patterns.md` updated?
   - Current State Snapshot still accurate? (Rule G — overwrite, don't append.)
3. **Run:** `npm run check:skill` — the deterministic gate (Rule B pairing, STATE.md shape, pattern IDs/refs, migration ledger, open-P0/P1 coverage, changelog ordering, freshness stamp). Any FAIL = the session is not closed; fix and re-run. (`git log --since="2 hours ago" --name-only` remains the manual fallback if node is unavailable.)
4. **Tell Sugeet what to verify.** Format: "Please test on your phone: (a) ___, (b) ___, (c) ___. Reply 'verified' or 'close #NN' when done. I will not close the issue."

**Gate:** If any step above is missed, the session isn't closed — even if the code works.

---

## Quick Reference — Phase Headers

Use these exact headers in replies so Sugeet can see the loop running:

```
Phase 1 — GROUND
- Change: ...
- Ripples: ...
- Patterns: ...
- Files: ...

Phase 2 — PLAN
- Diff: 1. ... 2. ... 3. ...
- Happy: ...
- Existing-data: ...
- Edge: ...

Phase 3 — EXECUTE
[tool calls + npm run build per chunk]

Phase 4 — CLOSE
- Scenarios mentally checked ✓
- Skill files updated ✓
- Verify list for Sugeet: ...
```

---

## When This Loop Can Be Shortened

The loop is mandatory for `src/` changes. It can be **abbreviated** (Phase 1 + 3 only) for:

- Typo fixes Sugeet asked for in plain English
- Comment-only edits
- README / markdown-only changes in skill files (no code)
- Reverting a commit Sugeet explicitly named

Everything else — including "one-line fixes" — runs the full loop. One-line fixes are how Pattern R4 was born.

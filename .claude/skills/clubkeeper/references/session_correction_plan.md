# Session Correction + Runaway Prevention — Plan (DRAFT for owner review)

**Status:** proposal, not started. Owner (Sugeet) approved the direction 20 Jul 2026; some sub-decisions defaulted to "recommended" while owner was away — flagged below with ⚠ REVISIT.

## The problem (owner's words, distilled)

Two failure modes killing trust during the trial:

- **A — Runaway timer.** Staff starts a session, ignores/forgets it, realises 2–3h later. Bill is hugely inflated; the day's Summary is "ruined by one mistake." Owners keep the paper notebook running in parallel because they don't trust that a mistake is fixable.
- **B — No correction path.** Once a completed session is wrong, there's no owner way to fix it. So the notebook never goes away.

B is downstream of A: make mistakes cheaply fixable → the notebook goes away on its own.

## Chosen solution (owner's model — it's the safe one)

Two layers:

### Layer 1 — Prevention gate (Problem A)
- When a running session passes an **owner-configurable threshold** (default ~2.5h, new ClubSettings field), fire the existing alarm loudly + show a **persistent red "Running Xh Ym — still playing?" banner** on Home and the table card.
- No auto-pause (⚠ REVISIT — owner may prefer auto-pause; recommended default is nudge-only so it never surprises staff mid-real-game).
- Pure UI + one settings field. **Does NOT touch money recompute or sync.** Low risk. Ships fast.

### Layer 2 — Correction (Problem B) — owner-only, from History
Owner opens History → a completed entry → **Edit** (today view-only) becomes actionable with two operations:

**2a. Delete = FULL REVERSAL (as if it never existed), then owner re-enters via Back Entry.**
This is the smart part: reuse two already-tested flows (reversal + `createBackEntry` w/ overlap+stock logic) instead of a risky edit-in-place money recompute.
Reversal must atomically (one `syncedBatch`):
- Remove the session + its session_items (soft-delete tombstone so it syncs — Pattern S27/#124).
- **Stock:** re-add each line's qty to the CURRENT stock of the matching canteen item **if it still exists and is stock-tracked**; if the item was deleted or untracked, **skip + record in the reversal note** ("couldn't restore 3× Cola — item removed"). Never blocks the delete; stock only ever moves up correctly. (⚠ REVISIT — owner asked "re-add stock"; this is the safe interpretation.)
- **Piggy/cash:** reverse the session's cash effect — if it was paid cash, subtract from piggy; mirror whatever `paymentBreakdown`/piggy the completion added. Append-only ledger → write a REVERSAL `wallet_transactions` row (referenceType 'reversal'), never a hard delete.
- **Summary:** falls out automatically once the session is tombstoned + reversal rows exist (Pattern T9 aggregates read live).

**2b. Edit in place (without delete)** — same reversal-then-reapply discipline for the money-affecting fields (time, canteen lines, stock), so there's never a half-edited state that corrupts Summary. Simpler fields (notes) can edit directly.

**Audit trail (owner: YES).** Every correction records who/what/when — `edited/deleted by <owner>, was X now Y, at <ts>` — visible on the session and surviving sync. Essential: 4 partners share money; a silently-rewritten number = dispute with no record. Makes owners MORE willing to trust the app.

## Pros / Cons

**Pros:** kills the "one mistake ruins the day" fear → notebook goes away. Reuses reversal + back-entry rather than an edit-in-place recompute engine (far less corruption risk). Audit trail turns a scary feature into a trust feature.

**Cons / risk (honest):**
- Highest-risk area in the app — touches Summary (T9), piggy/cash-flow, payment breakdown, stock, AND sync. A wrong recompute silently corrupts money = the exact fear we're removing. → mitigated by delete-and-re-enter (no half state) + audit trail + heavy verification.
- Retroactive stock is the trickiest bit (item deleted/restocked/sold-down since). → mitigated by "restore-if-exists, else note."
- Must all be owner-only (staff can't rewrite history) and re-sync correctly to all partner devices.

## Effort estimate
- Layer 1 (prevention): **small–medium.** 1 settings field + Home/table banner + reuse alarm. ~1 focused session.
- Layer 2a (delete+reversal+audit): **large.** New `reverseSession()` atomic helper (the missing piece — confirmed no reversal helper exists today; `createBackEntry` DOES exist), History edit-mode unlock, audit schema, sync, Summary/piggy/stock verification.
- Layer 2b (edit-in-place): **medium**, on top of 2a's reversal helper.

## Build order recommendation
1. **Layer 1 first** — cheap, low-risk, stops most messes immediately, buys trust while 2 is built.
2. **Layer 2a** (delete + full reversal + audit) — the core correction.
3. **Layer 2b** (edit-in-place) — reuses 2a's reversal helper.

## Grounding facts (verified 20 Jul 2026)
- `SessionDetail.tsx` already edits start-time (`editSessionStart`, `handleSaveEditStart`) and recomputes amount → precedent for time edits.
- Canteen add/edit/delete inside a session already works (`runCanteenAddTransaction`).
- `createBackEntry` exists (queries.ts:1102) with overlap + stock checks — the re-entry half.
- **No** `reverseSession`/`voidSession`/`deleteSession` reversal helper exists — Layer 2a's main build.
- Money aggregates: Pattern T9 (every revenue stream explicit). Sync deletes: Pattern S27 (server-side counterpart, soft-delete tombstone). Both MUST be honoured.

## Open decisions for owner (⚠ REVISIT when back)
1. Prevention gate: nudge-only (default) vs auto-pause at threshold?
2. Stock revert on delete: restore-if-exists+note (default) vs recreate-deleted-item vs don't-touch?
3. Threshold default value + is it owner-configurable? (assumed yes, ~2.5h)

## Next step
On owner go-ahead: file GitHub issues (Layer 1 = one enhancement; Layer 2a + 2b = separate enhancements — NEVER bundle, Rule F), then build Layer 1 first behind the full 4-phase loop. No code until issues exist + owner picks build order.

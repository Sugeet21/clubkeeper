# Changelog

**Purpose:** chronological record of what shipped, when, and what manual setup was done — read when Sugeet asks "when did we ship X" or a past step must be retraced. "Where are we NOW?" lives in `../../STATE.md`, not here. **Ordering law: newest entry at the top, always PREPEND** (enforced by `npm run check:skill`). Below the "Early history" divider near the bottom, the May-2026 foundation entries run oldest-first — that block is frozen.

---

## 10 Jul 2026 — Phase D Session D0: staff-login chunk plan + migration draft (docs + SQL only, no src/)

- **NEW `references/phase_d_plan.md`** — the Phase D build plan: 9 chunks (D1 apply-migration → D2 staff admin endpoints → D3 role-in-auth-state + staff login + owner-subscription gate → D4 account-switch/seed-gate/staff-Account-card → D5/D6/D7 role gates by page cluster → D8 Settings staff management → D9 two-profile E2E runtime proof), each with a paste-ready prompt, gates, and commit lines. Fresh-JWT-only verification law baked into every RLS chunk (SQL editor runs as postgres — proves nothing).
- **NEW migration `20260710_phase_d_staff_login.sql` (UNAPPLIED)** — users_meta owner-read-club policy + updated_at trigger; `handle_new_user()` skips the 7-day trial for staff (`ck_role` metadata marker + `.ck.local` belt-and-braces); `get_club_subscription_status()` SECURITY DEFINER RPC (staff gate follows the OWNER's subscription); per-matrix staff RLS on the 9 sync tables (owner-only: game_tables/stock_purchases/canteen_items-INSERT; both: sessions/session_items/customers/canteen_sales/bookings/canteen_items-UPDATE with staff-no-`deleted_at` WITH CHECK; wallet_transactions INSERT-only with staff kinds limited to topup/debit/coin_redeem — and the Phase C update-policy artifact on it DROPPED).
- **D0 grounding findings (they reshaped the plan):** (1) the JWT hook needs NO change — `add_user_meta_to_jwt` has read `users_meta` for both roles since 20260625, incl. the active=false mint-time block; the real gap was `role='owner'` in every Phase C INSERT/UPDATE policy (staff writes would 403 → outbox dead-letter). (2) `handle_new_user` fires on admin-API staff creation → staff would get their own trial (fixed in the draft). (3) `seedIfEmpty` seeds 5 demo gameTables on any empty per-user Dexie → staff first sign-in would get ghost tables (D4 gates the seed on the `user_club_id` claim; also fixes owner-second-device). (4) `wallet_transactions` had an UPDATE policy despite §4.6 append-only (dropped).
- **Open questions parked for Sugeet in the plan:** History owner-only? staff may create customers? staff-device ClubSettings parity (deferred, gap documented — billing-critical values mostly ride synced game_tables rows).
- No src/ changes; #127 untouched (migration held by owner).

---

## 9 Jul 2026 — #124: session-item soft-delete cutover — Phase C write-site cutover 100% — commits 39f44c5, ca69c55 (refs #124)

- **Chunk 1 (39f44c5, queries.ts + syncPayloadMapper.ts):** `deleteSessionItem` hard `db.sessionItems.delete()` → restock + `b.softDelete('session_items')` in one `syncedBatch(['session_items','canteen_items'])` (Pattern S24 — callback reads `sessionItems.get` + `canteenItems` match scan, writes both). `restoreSessionItem` fresh-UUID re-insert → same-row un-delete `b.update('session_items', id, { deletedAt: null })` (a fresh insert would leave peers the tombstone AND a duplicate); rides op `update` because `soft_delete` can only SET `deleted_at`. **Wire fix that makes restore possible:** the `session_items` payload mapper dropped `deletedAt: null` — now emits an EXPLICIT `deleted_at: null` (`undefined` still omits; S14 allowlist intact; grounding also confirmed the pull side already handles it — read mapper omits `deletedAt` for null + reader `put`/`bulkPut` full-row replace clears the local tombstone). New idempotency guards on `existing.deletedAt`: double-delete can't double-restock, double-undo can't double-decrement.
- **Chunk 2 (ca69c55, readers):** `!row.deletedAt` filters on all 11 live `session_items` read sites — queries.ts `pauseForPayment`/`confirmPaymentAndStop`/`recordSessionPaymentBreakdown` bill totals, `addOrIncrementSessionItem` match, `getRecentItems`; `useLiveData` `useSessionsInRange`+`useSessionItems`; `Home` today-totals; `Summary` dateRevenues+currentDateItems; `AddItemBottomSheet` canteen-add match. The two match-filter sites also stop a new add from incrementing an invisible tombstoned row. Raw BY DESIGN: export/import (backup round-trips tombstones), database.ts v20 migration, `updateSessionItem` id-targeted get, dev round-trip tool.
- **Gates:** build clean both chunks; `npx tsc -p tsconfig.app.json` 117 = #118 baseline both chunks, error signatures identical (line shifts only), zero new. clubkeeper-reviewer (Opus) on the combined diff: APPROVE, 0 violations (S24 tx-zone, S14 three-way `deleted_at` handling, S17 no manual `updatedAt`, reader-filter completeness sweep, InsufficientStockError abort-before-un-delete all independently verified).
- **Runtime proof (owner-run on localhost:5173 + prod Supabase, 9 Jul 2026):** Round 1 delete → `session_items.deleted_at` set (row NOT deleted), stock restocked, item gone from bill, outbox 0. Round 2 Undo → `deleted_at` back to null on the SAME row id, stock re-decremented, outbox 0. Round 3 reset-cursors + force pull → no ghost resurrection anywhere; restored item appears exactly once.
- **refs #124** — not closed; owner verified rounds 1–3 live but closes himself per Rule F.

---

## 9 Jul 2026 — Phase C Chunk 7 Group C (final): ~20 non-queries.ts write sites to wrappers — commits 4001014, 5bb0736, 11a616c (refs #126)

- **Chunk C1 (4001014, customerStore.ts):** createCustomerWithPhone → `syncedCreate('customers')` (dup-phone pre-check untouched); updateCustomerPhone/updateCustomerName/updateCustomer → `syncedUpdate<Customer & {id}>`; topUp + applyManualAdjustment rewritten from `db.transaction` to `syncedBatch(['customers','wallet_transactions'])` — reads/balance-math/final re-read inside the callback, outer `let` captures preserve the `{customer, transaction}` return shape; the insufficient-balance throw stays inside so a rejected debit aborts data + outbox together.
- **Chunk C2 (5bb0736, engagement credits):** coinExpiry.applyExpiryForCustomer → one `syncedBatch(['customers','wallet_transactions'])` with all four branches preserved (missing customer / hourly debounce / zero-coin stamp / FIFO expiry debit+balance); streak.checkAndAwardStreak award block → same batch shape (the distinct-days count read stays hoisted — it was outside the original tx too); nudge.logNudgeSent → lone `syncedCreate('wallet_transactions')` (single-table audit append, no paired customer write).
- **Chunk C3 (11a616c, approvals + canteen add):** walkInCode.createWalkInCustomer restructured — `settings` is NOT a synced table so the counter allocation gets its own settings-only tx, COUNTER-FIRST (crash between txs skips a code number, never duplicates), then `syncedCreate('customers')`; PendingTopupsModal approve-create → `syncedCreate('customers')` (wallet credit already synced via recordTopupWithCoins); PendingBookingsModal → `syncedCreate('bookings')` (ConstraintError re-tap guard survives the wrapper's rethrow); AddItemBottomSheet **drift vs issue text**: the raw sites now live in `runCanteenAddTransaction` (stock check→decrement + item merge over TWO synced tables), converted to `syncedBatch(['canteen_items','session_items'])`; the freeform path already delegated to Group B's addOrIncrementSessionItem.
- **Gates:** build clean per chunk; `npx tsc -p tsconfig.app.json` vs #118 baseline — zero NEW errors all three chunks (C3 absorbed one baseline error: the AddItemBottomSheet add-literal sessionId number→string mismatch no longer surfaces through `b.insert(SyncedRow)`; the same mismatch is still reported on the freeform path, baseline 118→117). clubkeeper-reviewer (Opus) on the combined diff: APPROVE, 0 violations (D7, tables-list completeness, §4.6 append-only, type args, byte-for-byte semantics, return shapes all independently verified).
- **Runtime proof (Claude-in-Chrome on localhost:5173 + prod Supabase, 9 Jul 2026):** ₹200 cash top-up + ₹50 manual adjustment on customer `TEST Backlog2 49` (46097a6d) — Supabase received the wallet_transactions INSERTs (incl. the manual row `1026f017`, notes "TEST Group C sync proof") + customers UPDATE to wallet_balance 250.00; realtime echo applied clean with remote epoch 1783614210026 exactly matching `updated_at` (LWW round-trip); `_outbox` count 0 after drain.
- **Left raw BY DESIGN (per #126 scope):** deleteSessionItem/restoreSessionItem (#124), importEverything bulkAdd, TestOutbox dev deletes, Settings.tsx one-off, clearAllSessions/resetEverything.
- **refs #126** — not closed; owner to verify a wallet top-up + a walk-in create sync to a second device, then reply "close #126".

---

## 8 Jul 2026 — #127 fix: player booking table-id retyped number→string (post-v20)

- **Root cause:** post-v20 `tables_json` ids are UUID **strings**, but the booking CTA gate (`PlayerScan`) + `BookingScreen` filter used `typeof t.id === 'number'` → every table filtered out → "Book a table" hidden / `no_tables`. Second layer: `get_booked_slots`/`submit_booking_intent` RPCs + `booking_intents.table_id` still `int` → `22P02` on UUID.
- **Code (Pattern R5/D12 — never `Number()` an id):** `PublicTableInfo.id?: number`→`string`; `BookingScreen` `tableId` state + `pickTable` + the load-time filter + the table-row onClick gate now use `typeof t.id === 'string' && t.id.length > 0`; `PlayerScan` CTA `.some()` gate likewise; `playerHubApi` `submitBookingIntent`/`getBookedSlots`/`PendingBookingRow` tableId + the `getPendingBookings` mapper cast → `string`. Side effect: removed 2 pre-existing #118-baseline tsc errors (PendingBookingsModal:65 number→string mismatch, playerHubApi:274 tables_json id) — `npx tsc -p tsconfig.app.json` went 120→118, **zero new**. `npm run build` clean.
- **NEW migration `20260708_booking_table_id_uuid.sql` (UNAPPLIED):** retypes `booking_intents.table_id` + `submit_booking_intent.p_table_id` + `get_booked_slots.p_table_id` `int`→`text` (drop+recreate for the two functions; `::text` cast for existing rows). Supersedes the `p_table_id integer` decls in `20260617`/`20260619`. Awaiting owner run in Supabase SQL editor.
- **refs #127** — not closed; awaiting owner migration-run + device E2E on `/c/<slug>/book` against prod.

---

## 8 Jul 2026 — Skill-redesign Phase 6 (final): STATE generator + frontmatter — MIGRATION COMPLETE

- **NEW `scripts/sync-state.mjs`** — regenerates STATE.md's open-issues block from `gh issue list` (markers `ISSUES:BEGIN/END`; hand-notes live above the markers) + refreshes the "Last verified" stamp. Ran live: 4 P0 / 13 P1 / 15 P2 captured. `check:skill` remains the independent verifier.
- SKILL.md frontmatter description updated for claude.ai: documents the SKILL → STATE → references → references/history structure so web Claude navigates the zip correctly.
- Migration complete: Phases 0–6 all shipped on branch `skill-redesign`, one commit each; `npm run check:skill` PASS at every phase boundary. Self-verification (12 old-skill facts traced to new homes) recorded in the session log; merge + re-zip steps handed to owner.

---

## 8 Jul 2026 — Skill-redesign Phase 5: history/ directory + changelog repair + ripple steady-state (branch skill-redesign)

- **`references/history/` created**; moved in: `changelog.md`, `decisions_archive.md`, `bug_archive.md`, `sync_architecture_v2.md`, `test_status.md`. Every live-file reference swept to the new paths (SKILL, STATE, references, agents, CLAUDE.md); Rule G targets in session_loop + auditor now point at STATE.md.
- **Changelog repaired:** purpose header moved from mid-file to the top; misordered entries relocated (4-Jun Phase-3-Commit-2, 10-Jun v13, 12-Jun deploy fix, three loose 14-Jun notes); "Open future work" section deleted (GST/email live in STATE.md pending; the old-`ClubKeeperDB` migration + offline-migration-strategy items are superseded by per-user DB + sync §10); explicit "Early history — oldest-first" divider added before the frozen May block.
- **ripple_effects §Advance Booking consolidated to steady-state:** seven per-phase "Files in scope (shipped <date>)" narrative blocks (~120 lines) replaced by one consolidated files list; ALL invariants (main + P2) preserved verbatim; phase narratives already lived in this changelog's 16–22 Jun entries. Section header now flags #127. (First scripted attempt hit a shell-quoting corruption; file was restored from git and redone via a script file — worth remembering: never inline-heredoc markdown with backticks through bash.)
- `npm run check:skill` PASS after all moves (its path resolution is history/-aware).

---

## 7 Jul 2026 — Skill-redesign Phase 4: `npm run check:skill` machine gate (branch skill-redesign)

- **NEW `scripts/check-skill.mjs`** — deterministic, no-LLM session-close gate (exit 1 on failure): Rule B commit pairing, Rule G STATE.md shape (one line/module, no SHAs/sizes/dates, no duplicates), bug-pattern ID uniqueness, pattern-reference integrity across live files, migration-ledger coverage, open-P0/P1 GitHub coverage (graceful offline skip), changelog newest-first ordering, STATE.md freshness stamp, loading-map link integrity.
- `package.json` gains `check:skill` (NOT in prebuild — it's a session-close gate, not a build gate).
- `clubkeeper-skill-auditor` now runs the script FIRST (its FAILs are audit FAILs), then does judgment-only checks. session_loop Phase 4 step 3 now runs the script.
- First live run caught a real gap immediately (STATE ledger had `20260619_booked_slots` vs actual filename `_rpc`) — fixed; gate now PASS 0/0.

---

## 7 Jul 2026 — Skill-redesign Phase 3: STATE.md split (branch skill-redesign, docs only)

- **NEW `STATE.md`** inside the skill folder (travels to claude.ai): "Last verified" freshness stamp, current focus, one-line-per-module status (Rule G now enforced here), load-bearing pending, Supabase migration ledger (all applied, verified), open P0/P1 issue snapshot from `gh`, known limitations.
- **SKILL.md shrunk to stable-only** (~12k → ~5k tokens): persona, Critical Rules 1–15 (+ promoted post-v20 ID law), loading map (now the routing table), response style, condensed agents digest (CLI-only marker), bug-flow law, Rules A–J consolidated. Current State / Pending / Known limitations / Dexie summary / stale issue counts all moved to STATE.md or their sole homes.
- Agent model-choice rationale moved to `decisions_active.md`. CLAUDE.md reading order now includes STATE.md and fixes a pointer to nonexistent "bug_history.md" (28th audit find).

---

## 7 Jul 2026 — Skill-redesign Phase 1: 27 audited falsehoods corrected in place (branch skill-redesign, docs only)

- Full audit of every skill file (see `skill_redesign_proposal.md` §4 for the numbered list). No `src/` changes.
- **data_model.md rewritten to reality:** current schema is **v21** (not v16/v17 as the file claimed; even SKILL.md was behind at "v20"). All ids UUID strings post-v20; LWW metadata documented; `ClubKeeperBackupV21`; `src/types/*.ts` declared the type authority.
- **Live prod probe (anon RPC) resolved every "⚠ pending manual run" migration:** 20260610×2 / 20260616 / 20260618 / 20260619 / 20260622 are ALL APPLIED. Pending list rewritten accordingly.
- **NEW BUG FOUND during verification → #127 (P1):** player booking flow broken post-v20 — BookingScreen/PlayerScan still filter tables to numeric ids while `tables_json` carries UUID strings; `get_booked_slots.p_table_id` still `integer`. Issue filed, no code touched (needs own session).
- **Dangerous stale guidance neutralized:** bug_patterns Pattern P3 marked SUPERSEDED (its `Number(routeParam)` advice is the R5 crash); sync_architecture_v2 got a DESIGN-HISTORY banner + do-not-copy warnings on §6/§7.3 (string-compare LWW = the #117 bug) + Appendix H reservation corrections.
- **Cross-file contradictions fixed:** snooze anchor (decisions_active now matches Pattern T6), TopBar gear line (ripple Wallet section), low-stock input location (Canteen section per BUG-S5), Peak Pricing ripple section (P1–P4 all shipped 19 Jun — was stale at "Phase 1 only"), design_system responsive strategy (#91 desktop reality), architecture.md realtime/bridge + _clubSyncDone + cloud-sync sections, player_design_system status note + icon rule (inline SVG, not Lucide), CLAUDE.md (360px, reviewer=Opus), Rule H + session_loop pattern pointer (R4, not "S4"), bug_archive #97 (reopened)/#71 (closed) pointers, stale LIMIT-001 copies, test_status ARCHIVED banner, deployment/business future-tense trims, SKILL.md persona + stale issue-count block.
- SKILL.md Pending now lists the previously-missing open P0s (#97, #100, #103, #110) + #126/#127.

---

## 7 Jul 2026 — Phase C Chunk 7 Group B: ~20 queries.ts sites to wrappers + #125 Wallet fix — commits 0536abf, 9693fe9

- **Step 0 (snapshot fix):** corrected the Sync Current-State header the auditor flagged last session — "Chunk 5.3 COMMITTED, runtime proof pending" → "Chunks 5.3 + 5.4 COMMITTED + RUNTIME-PROVEN" (body already said proven; header was stale). Abbreviated loop, no code.
- **#124 sequencing decision:** convert Group B AROUND the two deferred sites (deleteSessionItem/restoreSessionItem stay raw, #124 mops up) rather than landing #124 first — #124 is a UI-visible semantics change (soft-delete + reader deletedAt filters) and bundling it into a plumbing chunk would violate PLUMBING-ONLY + make the diff un-reviewable as pure plumbing.
- **Group B cutover (0536abf, ~20 sites in queries.ts):** sessions single-table → `syncedCreate`/`syncedUpdate<Session & {id}>` (startSession, acknowledge/snooze/updateNotify, pause/resume/stop, pauseForPayment, cancelPaymentAndResume, editSessionStart, updateSession). Sessions atomic → `syncedBatch`: confirmPaymentAndStop + recordSessionPaymentBreakdown (`['sessions','session_items','customers','wallet_transactions']`; confirmPaymentAndStop hoists its `db.settings` read — not a synced table), moveSessionToTable (`['sessions','game_tables']`, game_tables read-only). sessionItems → addSessionItem (`syncedCreate`), addOrIncrementSessionItem (`syncedBatch(['session_items'])`, id captured outside). Wallet/customers → `syncedBatch(['customers','wallet_transactions'])`: recordTopupWithCoins (3 append-only INSERT ledger rows), redeemCoins. Bookings → `syncedBatch`: linkBookingToSession (`['bookings','customers']`), creditBookingAdvanceRemainder (`['customers','wallet_transactions']`), reconcileCancelledBooking (`['bookings','customers','wallet_transactions']`, read-your-writes insert+update same customer), applyNoShowSweep (`['bookings']` loop). wallet_transactions all `b.insert` (append-only §4.6). LEFT RAW: deleteSessionItem/restoreSessionItem (#124); clearAllSessions/resetEverything/import `.clear()` (bulk teardown).
- **`syncedUpdate` generic gotcha (caught by tsc gate):** `syncedUpdate` without an explicit type arg infers `T = SyncedRow`, so `patch` collapses to `Partial<SyncedRow>` and rejects domain fields — all 11 sessions calls need `<Session & { id: string }>` (matches Group A's `updateTable<GameTable & {id}>` precedent). Fixed before the gate passed.
- **Group B gates:** build clean per cluster (5 clusters); `npx tsc -p tsconfig.app.json` vs baseline ZERO new (queries.ts 2→0: old confirmPaymentAndStop db.transaction overload + an unused var both resolved). clubkeeper-reviewer (Opus) APPROVE, 0 violations — independently verified tables-list completeness, settings hoist, append-only inserts, read-your-writes edge, value-return captures, type args.
- **Group B runtime proof (partial, owner-driven, 7 Jul 2026):** session close synced — Supabase session `fd1d3217` completed, table_charge 106.00, payment_breakdown {cash:83,upi:83,wallet:0}, full rateCardSnapshot preserved in config jsonb (rate-card semantics byte-for-byte through the syncedBatch conversion). Outbox drained to 0, zero stuck. The wallet-debit-at-session-close variant was BLOCKED by #125 (below) at proof time — now unblocked, one run outstanding.
- **#125 FOUND + FIXED during Group B proof (9693fe9) — pre-existing read gap, NOT a Group B regression:** Wallet showed "No customers yet" despite 77 customers, and the session-end wallet picker was empty. Root cause (Pattern S14): `customer.lastVisitAt` has no Supabase column and is dropped by BOTH mappers, so every pulled customer has `lastVisitAt: undefined`; `db.customers.orderBy('lastVisitAt')` (Wallet.tsx, PaymentSplitSheet.tsx, getRecentCustomers) SILENTLY SKIPS missing-key rows → empty. Once repopulated, `formatDistanceToNow(undefined)` threw "Invalid time value". Fix (reader-resilient, owner-chosen): shared `recentCustomersQuery(limit)` sorts by `lastVisitAt ?? createdAt` + drops soft-deleted, used by all 3 former orderBy sites; 3 date-format sites guarded with `?? createdAt` (Wallet/CustomerProfile/BringBackList). Runtime-proven: Wallet RECENT shows Aditya ₹77 + all customers, no crash. lastVisitAt still doesn't sync (migration option open on #125).
- **New issues filed (not bundled):** #125 (customer lastVisitAt mapper gap — FIXED 9693fe9, pending verification), #126 (~20 customer/wallet/booking write sites OUTSIDE queries.ts still raw — customerStore/coinExpiry/streak/nudge/walkInCode/Pending modals; "Group C", do after #125).
- **Files affected:** `src/db/queries.ts` (Group B); `src/store/customerStore.ts`, `src/pages/Wallet.tsx`, `src/pages/CustomerProfile.tsx`, `src/components/PaymentSplitSheet.tsx`, `src/components/BringBackList.tsx` (#125). Skill: `changelog.md`, `ripple_effects.md`, `SKILL.md` (Current State + Pending), `bug_patterns.md` (Pattern S14 cross-ref on #125).

---

## 7 Jul 2026 — Phase C Chunk 7 #122: syncedBatch mixed-op atomic wrapper + 4 cutover sites — commit b1407e3, pending owner verification

- **New wrapper `syncedBatch(tables: SyncTableName[], fn: (b: BatchContext) => Promise<void>)`** in `src/db/syncWrappers.ts` — the mixed INSERT+UPDATE atomic batch the Chunk 3 API could not express (`syncedCreateBatch` is create-only). Opens ONE Dexie `'rw'` tx over the caller-declared synced tables + `_outbox`, runs the callback INSIDE the tx, and calls `scheduleDrain()` ONCE after commit. The callback does its own reads on `db.*` (they auto-join the ambient tx) and emits ops via a `BatchContext`; every data write + its OutboxRow are written TOGETHER inside the tx — that all-or-nothing IS the power-cut guarantee.
- **Design refinement from the issue's ops-list sketch → callback form (owner-approved mid-session):** an ops-list `syncedBatch(ops[])` would compute ops BEFORE opening the tx, moving read-dependent decisions (stock sufficiency check) outside the tx and letting a concurrent writer slip between check and decrement. The callback form keeps every read+write in one tx, preserving each function's checks byte-for-byte. `tables` must list every synced table the callback READS or WRITES — omitting one → loud Dexie "not part of transaction" throw (the safety net; do NOT lock-all-tables to dodge it).
- **`BatchContext` (discriminated by method):** `b.insert(table, row)` → `.add` + outbox `insert`; `b.update(table, id, patch)` → read→merge→stamp `updatedAt` epoch-ms (S17)→`put` full merged row + outbox `update` (byte-for-byte identical to `syncedUpdate`); `b.softDelete(table, id)` → stamp `deletedAt`+`updatedAt`→outbox `soft_delete`, THROWS on `wallet_transactions` (append-only, §4.6). tx-zone discipline: callback does only Dexie + pure sync compute, never awaits supabase/network/timer (Pattern D7 family).
- **Converted 4 of the 6 blocked sites** (plumbing swap, semantics byte-for-byte): `recordStockPurchase` (`['stock_purchases','canteen_items']`), `createCanteenSale` (`['canteen_sales','canteen_items','customers','wallet_transactions']` — wallet debit stays an INSERT ledger row, NOT a soft-delete), `updateSessionItem` (`['session_items','canteen_items']`), `createBackEntry` (`['sessions','game_tables','canteen_items','session_items']`; the `db.settings` read — settings is NOT a synced table — is HOISTED before the batch, safe because rounding is DB-static config, not part of the atomic overlap/stock guarantee).
- **Deferred 2 sites → #124 (NEW, P2):** `deleteSessionItem` does a genuine hard `db.sessionItems.delete(id)` with no soft-delete model, and every session_items reader (`useLiveData`×2, `Home`, `Summary`, `queries.ts:788`) reads raw without a `deletedAt` filter. Syncing it needs a soft-delete model + reader filters = a SEMANTICS change, out of scope for a plumbing chunk. `restoreSessionItem` (its Undo inverse) stays raw too — converting only one half of the delete/undo pair creates asymmetric sync. Both tracked as one coherent unit on #124.
- **Build gate:** `npm run build` clean per chunk; `npx tsc --noEmit -p tsconfig.app.json` diffed per-file vs pre-change baseline — ZERO new errors (`queries.ts` 3→2: the old `createBackEntry` `db.transaction` overload TS2554 resolved by conversion; `syncWrappers.ts`/`syncTableMap.ts` zero). One transient new error (SessionItem `id?` optional vs `SyncedRow.id: string`) caught by the gate and fixed with a typed `sessionItemRow` binding — no `any`, no `@ts-ignore`.
- **clubkeeper-reviewer (Opus) verdict: APPROVE, 0 blocking violations.** Confirmed atomicity, no-split, no-nest, tables-list completeness (each covers every synced read+write), wallet append-only INSERT, epoch-ms LWW, byte-for-byte semantics. Independently verified the original `createCanteenSale` touched exactly the 4 declared tables (no stray `stock_purchases`).
- **RUNTIME PROOF COMPLETE (Claude-in-Chrome, localhost:5173, owner-driven real UI, 7 Jul 2026):** Baseline all target tables = 0 rows for club `87501f04…`, outbox 0. Owner drove a real Quick Sale (Coke×2 = ₹40, split ₹20 cash + ₹20 wallet from customer "Aditya") + a Restock (Coke +5, ₹60 piggy). Result in prod Supabase — `canteen_sales` `4a4eeece` Coke×2 ₹40; `wallet_transactions` `6e789d20` **debit ₹20, balance_after 77, reference_id = the sale id** (debit correctly linked + atomic with the sale); `customers` Aditya `wallet_balance 77.00` == the ledger `balance_after` == local Dexie 77; `stock_purchases` `a46bcd8f` qty 5 ₹60 piggy; `canteen_items` Coke `stock_qty 11` (sale −2 then restock +5) local==remote, `updated_at` LWW round-trip 1783380115144 (ms) ↔ `.144+00` (ISO) confirming S17. Realtime channels self-healed mid-test and echoed every op back as an applied INSERT/UPDATE. Outbox drained to 0, zero stuck rows. `updateSessionItem`/`createBackEntry` share the identical `syncedBatch` update+insert machinery proven here.
- **Files affected:** `src/db/syncWrappers.ts`, `src/db/queries.ts`. Skill: `changelog.md`, `ripple_effects.md` (Sync section + createBackEntry/updateSessionItem/recordStockPurchase bullets), `SKILL.md` (Current State Sync entry + Pending #122 delete).

---

## 4 Jul 2026 — Phase C Chunk 7 Group A: queries.ts wrapper cutover, 9 of 17 sites (refs #122, #123) — commit 8ff1e6d

- **Converted to sync wrappers** (`syncedCreate`/`syncedUpdate`/`syncedSoftDelete`): `addTable`, `updateTable`, `deleteTable` (game_tables) + `addCanteenItem`, `updateCanteenItem`, `softDeleteCanteenItem`, `bulkSetCanteenItemPeakPrices` (2 sites), `decrementCanteenItemStock` (canteen_items). Every converted call awaited; wrappers stamp `updatedAt` (S17); table names from `syncTableMap.ts`.
- **BLOCKER FOUND → #122 (P1):** the wrapper API cannot express a multi-table atomic op mixing INSERT+UPDATE (`syncedCreateBatch` is create-only, Pattern D7 forbids calling wrappers inside an outer tx, splitting breaks the power-cut guarantee). 8 of the 17 Group A sites are exactly that shape and were LEFT RAW: `updateSessionItem`/`deleteSessionItem`/`restoreSessionItem` (canteenItems+sessionItems), `createBackEntry` (canteenItems+sessions+sessionItems), `createCanteenSale` (canteenSales+canteenItems+customers+walletTransactions), `recordStockPurchase` (stockPurchases+canteenItems). The plan's assumption that atomic multi-table cases were create-only (§6.2) is wrong — a mixed-op `syncedBatch` is required before these AND most of Group B can convert. Proposed design on the issue.
- **Semantics notes:** `deleteTable` hard→sync-soft-delete (`deletedAt` tombstone; throws on missing id) — zero callers verified. `decrementCanteenItemStock` lost single-tx read-check-write — zero callers verified. `bulkSetCanteenItemPeakPrices` lost cross-row atomicity (per-row wrapper txs; rows independent) and merges `peakPrice: undefined` instead of key-strip — all 4 consumers gate on `typeof === 'number'` so behavior-identical; mapper sends explicit `peak_price: NULL` so clears sync. Stale `id: number` → `string` in its signature + `BulkPeakPriceModal` annotation (fixes 2 pre-existing #118 baseline tsc errors). Partial-failure toast UX → #123 (P2).
- **Build gate:** `npm run build` clean; `npx tsc --noEmit -p tsconfig.app.json` diffed line-number-agnostically vs pre-change baseline — ZERO new errors, 2 fixed.
- **clubkeeper-reviewer (Opus) verdict: APPROVE, 0 violations.** Independently traced all converted-function callers (none inside a tx), confirmed zero-caller claims, confirmed peakPrice consumer equivalence.
- **RUNTIME PROOF (Claude-in-Chrome, localhost:5173, 4 Jul 2026):** Canteen UI add "TEST C7 Sync Item" ₹15 → edit ₹18 → delete (disable). Supabase `canteen_items` row `2803122f…`: landed with price 18.00, `updated_at` advanced on each step, `is_active=false` after disable, `deleted_at` correctly NULL (business disable ≠ sync tombstone). `/__dev/test-outbox` force-drain: `outboxRemaining: 0`. Atomic-batch runtime proof N/A — those sites are the #122-blocked ones, unchanged. Incidental: direct-URL loads of private routes bounce to `/tables` before dbReady (pre-existing, documented in Settings.tsx dev-tools comment) — in-app navigation used instead.
- **Files affected:** `src/db/queries.ts`, `src/components/BulkPeakPriceModal.tsx`. Skill: `changelog.md`, `ripple_effects.md` (Sync section), `SKILL.md` (Current State + Pending).

---

## 3 Jul 2026 — Phase C Chunk 5.4: polling fallback for SyncReader (§7.4)

- **Per-channel-group down-tracking:** `channelDownSince: Map<groupKey, firstFailureMs>` records the FIRST `CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED` per §7.2 group (idempotent — repeated errors on an already-down group do NOT push the timestamp forward, so a flapping channel doesn't perpetually defer the grace period).
- **30s grace, then 60s polling:** a group still down 30s after its first failure arms the shared poll loop (`POLL_GRACE_MS` / `POLL_INTERVAL_MS`). One `setInterval` covers ALL currently-down groups' tables (not one interval per group) — each tick re-reads `channelDownSince` against `CHANNEL_GROUPS` and calls the EXISTING `requestPull(table)` doorbell. No new apply/cursor-reset path — the serialized job queue + cursor pull already proven in Chunk 5.3 IS the polling primitive.
- **Stops on reconnect:** a group's `SUBSCRIBED` clears it from `channelDownSince`; the poll interval self-clears when the map empties. `teardownRealtime()` (called from both `stop()` and `subscribeRealtime`'s re-subscribe path) clears grace timers, the down-map, and the poll interval unconditionally.
- **Race found + fixed during clubkeeper-reviewer (Opus) pre-commit review (3 rounds, final verdict APPROVE):** supabase-js's `removeChannel()` is ASYNC and `supabase.channel(topic)` returns the SAME object for a topic not yet fully removed — so `subscribeRealtime`'s teardown-before-register (same generation; hit by TOKEN_REFRESHED-deferred retries and StrictMode re-mounts) could let the OLD channel's deferred `CLOSED` event re-arm `channelDownSince` for a group that's actually reconnecting cleanly. Two intermediate fixes (boolean `tearingDown` flag, then `channels.includes(channel)` identity check) were both defeated by the same async-removal + object-reuse behavior. Final fix: `teardownRealtime()` now returns `Promise.all(removals)`; `subscribeRealtime` is `async` and `await`s it before registering replacements, guaranteeing `supabase.channel()` gets a genuinely fresh object. `initialPull` awaits `subscribeRealtime` with a post-await generation guard. `stop()` stays synchronous (React cleanup contract) and void-dispatches `teardownRealtime()` with a `.catch` — safe because `stop()`'s generation bump (before teardown) already neutralizes any late channel callback via the existing `myGen` guard.
- **RUNTIME PROOF COMPLETE (Claude-in-Chrome, localhost:5173, 3 Jul 2026):** `supabase.realtime.disconnect()` from console → all 4 channel groups CHANNEL_ERROR/CLOSED → 30s grace fired exactly on schedule ("still down after 30s grace — starting poll fallback") → 60s poll ticks requested pulls for all down-group tables → an SQL `UPDATE` on `customers` (a `commerce`-group table) landed via the second poll tick (`fetched 1, applied 1`) → `supabase.realtime.connect()` → all 4 groups re-SUBSCRIBED → "poll fallback stopped" logged immediately, zero further ticks observed. No orphan timer, no #119-style duplicate pulls. Session incidentally re-hit the live #120 GoTrue lock jam mid-session (stray tab from an earlier session holding the lock) — owner closed the stray tab, app recovered via the existing A11 degraded-boot path with zero code changes needed, confirming A11 and 5.4 compose cleanly.
- **Build gate:** `npm run build` clean; `npx tsc --noEmit -p tsconfig.app.json` shows zero new errors from `syncReader.ts` against the #118 pre-existing baseline.
- **Files affected:** `src/db/syncReader.ts` only — internal to the SyncReader singleton, no new files, no boot-effect changes (Pattern A10 unaffected).

---

## 3 Jul 2026 — #120 fix: boot survives stranded GoTrue navigator lock (Pattern A11, NEW) — commit 7b69c11, pending owner verification

- **Root cause of the ETERNAL hang found (library layer, documented on #120):** auth-js 2.106.1 has built-in steal-recovery with a 5000ms `lockAcquireTimeout` default — but supabase-js's `_initSupabaseAuthClient` forwards our unset option as an explicit `undefined` own-property, which `Object.assign({}, DEFAULT_OPTIONS, options)` lets clobber the default. `navigatorLock(name, undefined, fn)` → `undefined > 0` false → no abort timer → infinite wait. Every default-configured supabase-js 2.106.1 app is exposed.
- **Design decision (mandated comparison, steal rejected):** (a) custom `auth.lock` wrapper unblocks every auth call but any timeout action (throw / run-unlocked / steal) either breaks all REST reads or risks concurrent refresh-token rotation against a healthy slow holder → family revocation → signed out everywhere. (b) boot-scoped `Promise.race` + lock-free READ-ONLY fallback cannot race anything (queued client machinery stays the only token writer). Shipped (b). No steal anywhere; `lockAcquireTimeout` deliberately NOT set (would re-enable library steal — owner decision required).
- **Implementation:** `authStore.initialize` races `getSession()` vs 8s; timeout → `authLockBlocked: true` + `navigator.locks.query()` diagnostic → if stored session fresh (≥60s runway): boot from it, profile+subscription via plain-fetch PostgREST (`src/lib/authBootFallback.ts`, NEW), toast "Another ClubKeeper tab is blocking sign-in — running from your last saved session", pending `getSession()` kept as the recovery signal (resolution clears flag + success toast; INITIAL_SESSION re-runs the normal path per A1). Expired/no stored session → wait as before + amber hint in RequireAccess spinner. Shared `mapProfileRow`/`mapSubscriptionRow` extracted so refreshProfile and the fallback can never drift. StrictMode `degradedBootStarted` dedup guard, reset in signOut.
- **clubkeeper-reviewer (Opus) verdict: APPROVE, 0 violations.** Both concerns fixed pre-commit: StrictMode duplicate degraded boot/toast (module guard) + recovery `.catch` leaving `authLockBlocked` stuck if getSession rejects post-degraded-boot.
- **Build gate:** `npm run build` clean per chunk; `npx tsc --noEmit -p tsconfig.app.json` diffed vs #118 baseline (125 errors captured pre-change) — diff EMPTY.
- **RUNTIME PROOF COMPLETE (Claude-in-Chrome, localhost:5173, same day):**
  - Bonus validation against the REAL #120 zombie jam (still live in the owner's browser at session start): boot detected it ("GoTrue lock IS held by another context (#120 jam confirmed)"), stored token expired → amber hint over spinner (previously: silent eternal Loading); when the zombie freed at 07:54:37 the queued getSession resolved → "lock freed, clearing #120 banner" → normal boot completed in place.
  - Clean boot, no jam: `initialize start → getSession result → done → loading=false` all same-second, twice (old-code control boot identical) — zero regression.
  - Deliberate strand (`navigator.locks.request(name, () => new Promise(()=>{}))` in tab A): tab B fully usable at ~8.5s — Tables rendered, toast visible, SyncReader completed a 9-table pull + 4 realtime channels SUBSCRIBED while jammed (S16 lock-free plane re-proven).
  - StrictMode dedup proven live: second racer logged the skip, exactly ONE degraded boot.
  - Negative proof for the no-steal rule: a manual DevTools steal broke a healthy holder's in-flight getSession (`AbortError: Lock broken by another request with the 'steal' option`) — handled gracefully by the A5 catch/finally, and exactly the failure class the shipped design avoids.
- **NEW issue #121 (pre-existing, found during proof):** supabaseSync's `accessToken` getter hits the authStore TDZ at module init ("Failed to set initial Realtime auth token" warning on every cold load) — supabase-js 2.106.1 invokes the getter synchronously in the constructor mid-import-cycle. Cosmetic today (supabaseSync has no realtime); verified present on stashed pre-#120 code.
- **Files affected:** `src/store/authStore.ts`, `src/lib/authBootFallback.ts` (NEW), `src/components/RequireAccess.tsx`. Skill: `bug_patterns.md` (Pattern A11), `ripple_effects.md` (Auth & Access Guard), `SKILL.md` (Pending + Current State), `bug_archive.md` (#120 update, #121 pointer).

---

## 3 Jul 2026 — Phase C Chunk 5.3: READ-path direct-apply LWW handler (refs #112, #116) — commit 6a8d2f9

- **Realtime handlers upgraded from doorbell-only to direct-apply (§7.3):** an INSERT/UPDATE `postgres_changes` event now applies `payload.new` straight to Dexie through the full machinery — outbox-guard (pending local write wins; drain + server trigger arbitrate) → numeric epoch-ms LWW compare (Pattern S17; remote wire ISO `Date.parse`d, missing local `updatedAt` compares as 0 mirroring the server trigger's NULL semantics) → §7.3 tie-break (equal ms yields to remote; NOTE: our push mapper never sends `updated_by` so the server column is always NULL and the "same-user" branch is currently unreachable — self-echoes at equal ms do one idempotent re-put; if push ever populates `updated_by`, re-verify) → `fromSupabaseRow` (fail-loud) → `put` → monotonic cursor advance.
- **Cursor-advance safety rules:** only forward (numeric compare of parsed ts), and NEVER from a null cursor — null means the table's epoch pull hasn't recorded history yet; seeding it from one event would truncate the initial pull into silent data loss.
- **Doorbell kept as fallback** for events the direct path can't safely apply: DELETE (payload carries only the PK; app never hard-deletes synced rows) and malformed/unparseable payloads → `requestPull(table)`. Direct apply also FIXES a 5.2b gap: a stale-stamped row (offline edit pushed late, `updated_at` behind our cursor) was invisible to the doorbell's cursor pull; the direct path applies it regardless of cursor position.
- **Queue refactor:** `pendingPulls: Set` → serialized FIFO `jobQueue: ReaderJob[]` (`pull` jobs deduped via `queuedPullTables` Set; `apply` jobs one per event). ONE worker (`pullWorkerActive` latch, no await between check-and-set) processes both kinds — an apply can never race a pull on `settings.pullCursors`. `stop()` clears the queue (apply jobs for a signed-out user never touch the next user's Dexie). `initialPull` enqueues without kicking so its own `await runPullWorker` keeps the row-count log.
- **#116 proof plumbing (DEV-gated, permanent — repeatable instead of the issue's temp-edit-and-revert plan):** `localStorage.__force_no_claim__ === '1'` in `getOwnerClubIdFromJwt` throws `NoUserClubIdClaimError` (checked BEFORE the cache so a cached clubId can't mask it); `window.__supabase` bound in `src/lib/supabase.ts` for console `refreshSession()`. Both behind `import.meta.env.DEV`.
- **TestSyncReader LWW conflict-test buttons:** "bump TEST LWW +1h" (raw `db.gameTables.update` — intentionally NOT `syncedUpdate`, no outbox row, testing LWW not the guard; logs ready-to-paste SQL for the stale/newer/cleanup steps) + "clean TEST LWW (local)".
- **clubkeeper-reviewer (Opus) verdict: APPROVE, 0 violations.** Concern acted on: tie-break doc-comment rewritten to state actual semantics (equal-ms always yields to remote today). Confirmed: no cursor race (single-thread latch), S15 generation guard after every await in applyEvent, D7 clean, DEV surfaces dead-code-eliminated in prod.
- **Build gate:** `npm run build` clean per chunk; `npx tsc --noEmit -p tsconfig.app.json` diffed against the #118 baseline (152 error lines captured pre-change) — diff EMPTY, zero new errors.
- **RUNTIME PROOF COMPLETE (same day, Claude-in-Chrome + Supabase SQL, second Chrome profile 'Sugeet9291@'):**
  - **INSERT direct-apply:** SQL insert of `TEST LWW` game_table → `realtime game_tables/INSERT <id> — applied` <2s; Dexie row all-camelCase, `updatedAt` numeric epoch ms, zero snake_case keys.
  - **Stale remote skipped:** local `updatedAt` bumped +1h via the new DEV button, then SQL update with `updated_at = now()` → `skipped (local 1783022255096 newer than remote 1783018667723)`; local name untouched.
  - **Newer remote applied:** SQL update with `now() + 2h` → `applied (remote 1783025895965)`, Dexie row replaced AND `pullCursors.game_tables` advanced to exactly that event's `(ts, id)` — monotonic cursor advance proven.
  - **DELETE doorbell fallback:** 3 cleanup deletes each logged `realtime <table>/DELETE — direct apply unsafe, doorbell fallback`.
  - **5.2b residual CLEARED:** seeded `canteen_sales` + `session_items` rows arrived via direct-apply; dumps show `items` real array, `paymentBreakdown` real object (`{cash:40,upi:0,wallet:0}` inferred from `payment_method`), all keys camelCase, `addedAt`/`updatedAt` numbers. Leftover `TEST 52B` local Dexie rows also deleted. All server-side TEST rows cleaned (0/0/0 verified).
  - **#116 proof CAPTURED (owner close pending):** toggle → reload → exactly ONE deferral warn; toggle cleared → refreshSession → exactly ONE `TOKEN_REFRESHED — retrying initialPull` + full re-subscribe + `initialPull complete`, and a second TOKEN_REFRESHED did NOT re-fire the retry (one-shot listener proven). Full capture pasted on #116.
- **Two NEW issues found during proof:** **#119** (P2) duplicate realtime event delivery — StrictMode-raced teardown leaks a server-side pg_changes subscription, every event handled twice until reload; correctness-safe (idempotent applies) but 2× cost. **#120** (P1) app never boots when a zombie tab strands the GoTrue navigator lock — `getSession()` in `authStore.initialize` queues forever, eternal "Loading…"; observed live twice; sync data plane kept working through it (Pattern S16 lock-free validated in anger). Workaround: `navigator.locks.request(name,{steal:true},...)` from DevTools.
- **Files affected:** `src/db/syncReader.ts`, `src/db/syncClubId.ts`, `src/lib/supabase.ts`, `src/pages/__dev__/TestSyncReader.tsx`. Skill: `ripple_effects.md` (Sync section), `SKILL.md` (Current State sync entry + Pending), `bug_archive.md` (#119/#120 pointers).

---

## 2 Jul 2026 — Phase C Chunk 5.2b OWNER-VERIFIED + migrations applied + #117 closed (refs #112)

- **Owner runtime capture (same day as landing):** all 4 realtime channels SUBSCRIBED (`operations`/`catalog`/`commerce`/`scheduling`); targeted SQL update on `customers` caught by the doorbell within 2s (`pull customers — page 1: fetched 1, applied 1, outbox-dropped 0`); pulled `game_tables` row (`TEST 52B Pool`) rendering from Dexie on `/tables` — proves that mapper's TRANSFORM end-to-end.
- **Both migrations applied + verified on prod by owner:** `20260628_lww_guard.sql` (lww_% trigger query returns full suite) and `20260702_sync_client_fields.sql` (columns verified against live schema). Pending lines deleted.
- **#117 CLOSED by owner** ("close #117"), `gh issue close` run with verification comment. bug_archive pointer added (BUG-S17).
- **Residual (new narrowed Pending line):** the `/__dev/test-sync-reader` shape DUMP for `canteen_sales` (items array / paymentBreakdown object / no snake_case keys) and `session_items` was not part of the pasted capture — confirm incidentally during Chunk 5.3 testing. #116 broken-hook TOKEN_REFRESHED proof remains pending (the capture did not include the `__force_no_claim__` toggle test).
- **Cleanup:** 4 seeded `TEST 52B` rows deleted from Supabase (verified 1/1/1/1). Local Dexie copies may persist on the dev browser — console snippet to remove:
  ```js
  const ids = ['fab82788-8ae7-4a6d-be7e-96c1ee5a16c2','b858f6c6-3d02-44c3-8d8a-9ba312eadb51','c6008db1-bd6a-41de-94f7-e6ab8bbbc028','89b270fb-71e1-4a07-9aad-957be149510e']
  // run in DevTools on localhost:5173 while signed in:
  // ids[0]=customer, ids[1]=canteenSale, ids[2]=gameTable, ids[3]=sessionItem
  ```
  (delete via Application → IndexedDB → ClubKeeperDB_&lt;userId&gt;, or the tables' own delete UIs; `TEST 52B` prefix identifies them.)

---

## 2 Jul 2026 — Phase C Chunk 5.2b: realtime doorbell + serialized pull queue + reviewer fixes (refs #112, #117)

- **SyncReader realtime integration (Pattern S22, NEW):** 4 grouped channels per §7.2 (`club:<id>:operations|catalog|commerce|scheduling`) on the MAIN `supabase` client (supabaseSync cannot drive realtime — throwing `.auth` Proxy, Pattern S16). Subscribe inside `initialPull` after the club_id claim resolves; teardown-before-register; teardown + queue-clear + clubId-drop in `stop()`. Handlers are DOORBELLS — `requestPull(table)` re-runs the proven cursor pull; no direct `payload.new` apply (owner decision 2 Jul 2026; direct-apply LWW = Chunk 5.3). `CHANNEL_ERROR`/`TIMED_OUT` logged only — polling fallback is Chunk 5.4.
- **Serialized pull queue:** insertion-ordered `pendingPulls` Set + single `runPullWorker` latch + S15 generation guards. Initial pull and doorbell events share ONE worker so two pulls of the same table can never race the per-table cursor; the Set dedupes event bursts.
- **Per-table cursor column (`cursorColumnFor`):** `created_at` for `wallet_transactions` (append-only — NO updated_at column; the shipped 5.2 query would have 400'd on it once the table was mapped), `updated_at` for the other 8.
- **NEW migration `supabase/migrations/20260702_sync_client_fields.sql`** (hand-apply, idempotent): `sessions.config` jsonb, `bookings.config` jsonb, `canteen_items.stock_enabled` boolean, `wallet_transactions.balance_type/coin_delta/rupee_equivalent` + `reference_id` uuid→text. Verification query in the file footer.
- **NEW DEV page `/__dev/test-sync-reader`** (`src/pages/__dev__/TestSyncReader.tsx` + App.tsx route): reset cursors → force pull → dump synced-table Dexie row shapes; the one-tap surface for the Pending mapper-TRANSFORM runtime proof.
- **clubkeeper-reviewer (Opus) verdict on the full session diff: REQUEST_CHANGES → all items fixed:** (1) dead `optStr` helper removed (tsc app-config `noUnusedLocals`); (2) mojibake em-dashes in TestOutbox.tsx repaired (introduced by a PowerShell regex pass this session — root-caused to `Get-Content`/`Set-Content` encoding mismatch, avoid for non-ASCII files); (3) stale `{ deleted_at }` comments in `types/index.ts` + `syncWrappers.ts` corrected to `{ deletedAt }`; (4) NEW fail-loud guard — `pushOne` soft_delete on `wallet_transactions` throws (append-only; would otherwise 400 into a silent dead-letter). Reviewer confirmed: round-trips preserve all mapped fields, no concurrent-worker path, no doorbell leak across stop(), no duplicate channels on deferred retry, no residual snake_case Dexie writes.
- **Issue #118 opened (found during review):** `npm run build`'s `tsc` step is a NO-OP — root tsconfig is solution-style (`files: []` + references) and bare `tsc` without `-b` typechecks nothing. ~15 pre-existing errors accumulated in tsconfig.app.json (some look like real post-v20 string/number comparison bugs). NOT fixed this session (scope discipline) — needs its own triage session.
- **Files affected:** `src/db/syncReader.ts`, `src/db/syncRunner.ts`, `src/db/syncReadMapper.ts`, `src/types/index.ts`, `src/db/syncWrappers.ts`, `src/App.tsx`, `src/pages/__dev__/TestSyncReader.tsx` (NEW), `src/pages/__dev__/TestOutbox.tsx`, `supabase/migrations/20260702_sync_client_fields.sql` (NEW). Skill: `ripple_effects.md` (Sync section), `bug_patterns.md` (Patterns S17 + S22 added).

---

## 2 Jul 2026 — Phase C Chunk 5.2b: all 9 synced tables mapped bidirectionally (refs #112)

- **7 new mapper PAIRS** (read in `syncReadMapper.ts` + write in `syncPayloadMapper.ts`, added together per the no-one-way-sync rule): `game_tables`, `sessions`, `session_items`, `canteen_items`, `wallet_transactions`, `stock_purchases`, `bookings`. `npm run build` ran clean after EACH table pair.
- **Contract on every read mapper:** all `*At` fields numeric epoch ms; raw `updated_at`/`deleted_at` never persisted (camelCase epoch-ms `updatedAt`/`deletedAt` only, per #117); jsonb columns arrive as parsed objects (PostgREST) — a string there throws (`optJsonObject`), so nested `items`/`paymentBreakdown`/`tableMoves`/`rateCard` can never land as JSON strings.
- **Key shape decisions (documented in mapper comments):**
  - `game_tables.config` jsonb carries `ratePerFrame`/`rateCard`/`toleranceMinutes`/`rateCardBilling`; `is_active` = `!outOfService`; config always sent in full so clearing a rate card propagates.
  - `sessions.config` jsonb (NEW column, migration 20260702) carries the 14 Dexie-local load-bearing fields (rate snapshots, billingMode, player info, alarm fields, tableMoves, isBackEntry, paymentInProgress). Read mapper THROWS on a config-less row. `status` stored verbatim (`running`, not the DDL comment's `active`). `customer_id`/`canteen_charge`/`total_charge` stay NULL by design.
  - `session_items`: clean 1:1; `addedAt`↔`created_at`.
  - `canteen_items`: NEW `stock_enabled` column (migration 20260702) — `stock_qty` alone can't represent `currentStock: null`; `peak_price` sent as explicit NULL when unset so clearing propagates.
  - `wallet_transactions`: append-only — insert-only mapper, no LWW metadata, and the pull cursor uses `created_at` (table has no `updated_at`). `kind` = Dexie `type` verbatim; amount keeps always-positive convention. Coin fields (`balance_type`/`coin_delta`/`rupee_equivalent`) are NEW columns (migration 20260702); `reference_id` widened uuid→text by the same migration.
  - `stock_purchases`: `source`↔`payment_method` (validated `'piggy'|'other'`); `name_snapshot` pushed as `''` (no Dexie field).
  - `bookings.config` jsonb (migration 20260702) carries `gameType`/`tierPrice`/`durationMin`/`consumedSessionId`; `intent_id = id` (Booking.id IS the intent uuid); `source='player_hub'` constant; `playerName` null↔`''`.
- New read-mapper helpers: `reqBool`, `optStr`, `reqEnum` (closed-union fail-loud), `optJsonObject`, `reqArray`, `nullableIsoToMs`, `parseBreakdown`.

---

## 2 Jul 2026 — Phase C Chunk 5.2b pre-work: LWW metadata format switch to epoch-ms camelCase (refs #117, #112)

- **Bug found during 5.2b grounding (#117):** Dexie-side LWW metadata was stored as raw snake_case ISO strings (`updated_at`/`deleted_at`), stamped by `syncedUpdate`/`syncedSoftDelete` and persisted by the customers + canteen_sales read mappers. The documented Chunk 5.3 plan compared these AS STRINGS — but locally-stamped `new Date().toISOString()` produces `"...Z"` while PostgREST returns `"...+00:00"`; lexicographic comparison across those formats is wrong at shared-prefix boundaries (`"Z"` sorts above any digit). A peer's newer edit could be silently discarded once 5.3 shipped. Also conflicted with the SKILL.md Pending mapper contract (epoch-ms camelCase). Owner decision (in-session, 2 Jul 2026): **contract wins**.
- **Fix:** all LWW metadata on Dexie rows is now camelCase EPOCH MS — `updatedAt?: number`, `deletedAt?: number | null`, declared on all 8 mutable synced interfaces (`WalletTransaction` excluded — append-only, has neither). ISO conversion happens ONLY at the wire boundary: `syncPayloadMapper` (`msToIso` on push), `syncReadMapper` (`isoToMs` on pull), `SyncRunner.pushOne` soft-delete branch (payload now `{ deletedAt: ms }` → converted to ISO for the targeted UPDATE). `SyncedRow` interface updated. TestOutbox stamps + soft-delete assertions updated to numeric.
- **Files affected:** `src/db/syncWrappers.ts`, `src/db/syncRunner.ts`, `src/db/syncPayloadMapper.ts`, `src/db/syncReadMapper.ts`, `src/types/index.ts`, `src/types/customer.ts`, `src/types/booking.ts`, `src/pages/__dev__/TestOutbox.tsx`.

---

## 1 Jul 2026 — Phase C Chunk 5.0 / 5.1 / 5.2 pre-commit: SyncReader skeleton + LWW guard + Pattern A10 (refs #112)

- Bundled record for three commits: `79892c8` (Chunk 5.0 — SyncReader skeleton + supabaseSync data-plane promotion), `4d5f927` (Chunk 5.1 — server-side LWW guard migration), `fb18b17` (Chunk 5.2 pre-commit — typed no-claim error + defer/retry + stable-key boot deps).
- **Chunk 5.0 (79892c8):** SyncReader singleton at `src/db/syncReader.ts` — cursor-driven initial pull across all 9 synced tables, `.eq('club_id', ownerClubId).gt('updated_at', cursor).order('updated_at').limit(BATCH)`, per-table cursor persisted in `settings.pullCursors` (`src/db/syncPullCursors.ts`). `supabaseSync` promoted from write-only to full owner data-plane (reads + writes) — reasoning in the file header: "route the entire owner data plane through the lock-free client and stop reasoning about WHEN the lock might or might not bite" (same failure mode class as Chunk 4.3). Reader mount at `<SyncReaderBoot />` in `App.tsx` shell; gated on `dbReady + session + !playerHub`.
- **Chunk 5.1 (4d5f927):** New migration `supabase/migrations/20260628_lww_guard.sql` — server-side last-write-wins triggers on 8 of 9 synced tables. `wallet_transactions` intentionally excluded (append-only ledger — no update-in-place, so no LWW conflict class exists). Guard is a `BEFORE UPDATE` trigger comparing incoming `updated_at` vs stored `updated_at`; older wins are silently dropped. Prevents the drain's unconditional `upsert(onConflict: 'id')` from stomping a peer's newer edit when a stale offline write reconnects. Pending prod-apply — see SKILL.md Pending list.
- **Chunk 5.2 pre-commit (fb18b17):** Three defects fixed BEFORE the reader is exercised in anger.
  - `NoUserClubIdClaimError` class in `src/db/syncClubId.ts` — typed error thrown when JWT lacks `user_club_id`. Reader catches via `instanceof` so guidance text is decoupled from deferral logic (no substring matching).
  - `SyncReader.deferForRefresh` — TOKEN_REFRESHED listener with teardown-before-register at BOTH the top of the function AND inside the fire handler. Guarantees at most ONE listener alive per SyncReader instance regardless of refresh cycles against a permanently-broken claim hook. `capturedGen` closure vs `this.readerGeneration` closes the stop-between-register-and-fire window. `hasLoggedClaimGuidance` latch → guidance logs once per instance, reset in `stop()`.
  - `initialPull` catch: ONLY `NoUserClubIdClaimError` defers. Every other error logs+returns with NO retry loop.
  - **Pattern A10** (NEW) — three app-shell boot effects (`SyncRunnerBoot`, `ExpirySweepRunner` in `src/App.tsx`, `SyncReaderBoot` in `src/components/SyncReaderBoot.tsx`) switched from `[session]` object dep to `[userId]` primitive dep. Root cause: `authStore` fires two `set({ session })` calls within ~100 ms on cold boot (initialize's `getSession()` result + supabase-js's `INITIAL_SESSION` event); both carry identical `session.user.id` but different object references, so React's `useEffect` dep-diff double-fires. `TopupRealtimeBridge` and `BookingRealtimeBridge` are the reference-correct pattern. DEV StrictMode adds a third fire, all absorbed by the primitive dep.
- **Runtime verification (Chrome-extension dev capture, browser-only — prod cold-boot and broken-hook toggle deferred to the runtime toggle):** `[syncReader] start` and `[syncReader] initialPull complete` each fire EXACTLY ONCE despite `[authStore] initialize start` firing twice under DEV StrictMode. Pattern A10 boot-effect invariant proven at runtime. `initialPull complete in 928ms — 0 rows across 2 mapped table(s), 7 unmapped skipped` — matches Chunk 5.2 design (only `customers` + `canteen_sales` wired; other 7 THROW-as-unmapped and are skipped until 5.2b). IndexedDB inspection: 76 customers, 5 gameTables, `settings.pullCursors` present with cursor for customers — Chunk 5.2 cursor persistence confirmed.
- **Reviewer verdict:** clubkeeper-reviewer on Opus, 8/8 invariants APPROVE. Listener stack invariant, generation guard, typed error discipline, boot-effect deps, DIAG cleanup, hard rules, guidance-latch reset, and `npm run build` all pass. Two MINOR non-blocking flags: verbose Dexie Proxy cast at `syncReader.ts:350` (legitimate workaround), and page-scoped effects at `Wallet.tsx:74` / `Bookings.tsx:110` still on `[session]` (out of scope, tracked as #113).
- **Follow-up issues opened:** #113 (A10 sweep for Wallet + Bookings page-scoped effects), #114 (supabaseSync accessToken TDZ warning at cold boot — pre-existing since Chunk 4.3, non-fatal), #115 (authStore.initialize double-fires under DEV StrictMode — cosmetic).
- **Deferred runtime verification:** broken-hook TOKEN_REFRESHED single-fire proof was NOT exercised at runtime — static reviewer coverage only. Defensive path; no runtime exercise until a customer's claim hook is actually broken.
- **Files affected:** `src/App.tsx`, `src/components/SyncReaderBoot.tsx`, `src/db/syncClubId.ts`, `src/db/syncReader.ts` (5.0 base + 5.2 fix), `src/db/syncPullCursors.ts` (5.0), `src/db/syncReadMapper.ts` (NEW, 5.0), `src/types/index.ts` (5.0), `supabase/migrations/20260628_lww_guard.sql` (NEW, 5.1). Skill: `bug_patterns.md` (Pattern A10 added).

---

## 27 Jun 2026 — Phase C Chunk 4.3: dedicated supabaseSync client (fixes deadlock; refs #111)

- `fix(sync): Chunk 4.3 — dedicated supabaseSync client + lock-free clubId + distinct public storageKey + per-row watchdog + generation guard + sign-out cleanup (refs #111)`
- **Triggered by:** owner E2E Round 3 after Chunk 4.2. Every Force drain returned PASS but `outboxRemaining` stayed > 0, `attempts: 0`, `lastError: null`, zero network requests. Distinct from #110 (which was Pattern S14 — camelCase mapper, already fixed).
- **Root cause (single):** supabase-js v2 GoTrueClient acquires a `navigator.locks` lock keyed off `storageKey` (`lock:${storageKey}`) on every `auth.getSession()` call. `SupabaseClient._getAccessToken` (line 555 of SupabaseClient.ts) calls `this.auth.getSession()` internally to attach the Bearer header on EVERY PostgREST request. Our owner client and `supabasePublic` shared the same default storageKey → shared the same lock. Under React.StrictMode dev double-mount, an orphaned drain's auth call held the lock and never released it; every subsequent push hung at the same lock acquisition forever.
- **First-attempt fix was INSUFFICIENT** (recorded as lesson in Pattern S16): patching only OUR own `getOwnerClubIdFromJwt` to be lock-free + giving `supabasePublic` a distinct storageKey did NOT cure the hang — supabase-js itself was still re-acquiring the OWNER client's lock on every `.from(...).upsert(...)`. The Supabase warning `Multiple GoTrueClient instances detected in the same browser context` was the canary; fixing only userspace lock acquisitions cannot dislodge a library-level lock.
- **Real cure — dedicated REST client:**
  - NEW `src/lib/supabaseSync.ts` — REST-only client configured with `accessToken: async () => readAccessTokenLockFree()`. supabase-js's `createClient` (lines 316-323 of SupabaseClient.ts) routes Bearer retrieval through OUR lock-free function when `accessToken` is set, replacing the GoTrueClient with a throwing Proxy. No `getSession()` call anywhere in the drain path = no lock acquisition.
  - Constraints (enforced by file header + ripple_effects three-client rule): WRITE-ONLY, used ONLY by `src/db/syncRunner.ts`, no `.auth`, no realtime, no reads. The accessToken getter must stay lock-free.
- **Defense in depth (kept):**
  - `src/db/syncClubId.ts` — `getOwnerClubIdFromJwt` already lock-free (reads in-memory authStore session → synchronous localStorage fallback). `readAccessTokenLockFree` now exported for supabaseSync's accessToken getter.
  - `src/lib/supabasePublic.ts` — distinct `storageKey: 'sb-clubkeeper-public'`. Two clients = two locks. Silences the multi-GoTrueClient warning. Reinforces Pattern A7's #83 fix.
  - `src/db/syncRunner.ts` — per-pushOne 15s watchdog (NOT per-batch — per-batch fires mid-50-row backlog on 3G and stacks concurrent drains); `drainGeneration` counter bumped in start()/stop() so orphans bail after each post-await guard.
  - `src/store/authStore.ts` — sign-out now calls `syncRunner.stop()` + `_resetClubIdCache()` + `_resetClubSyncSentinel()` BEFORE `closeDb()`. Order matters: bump generation first so no orphan touches a closing DB.
  - `src/hooks/useLiveData.ts` — exposes `_resetClubSyncSentinel`. Also resolves the open Pending item `_clubSyncDone never-resets-on-sign-out`.
- **Files affected:** `src/lib/supabaseSync.ts` (NEW), `src/lib/supabasePublic.ts`, `src/db/syncRunner.ts`, `src/db/syncClubId.ts`, `src/store/authStore.ts`, `src/hooks/useLiveData.ts`.
- **Verification (owner E2E, all 5 paths passed before commit):**
  1. Watchdog dormancy: single-row drain `outboxRemaining: 0`, `pushOne DONE ms: 236`. NO watchdog timeout.
  2. 30s heartbeat: queued row drained without manual Force drain, `pushOne DONE ms: 1033`.
  3. Player Hub: `/c/sugeet` + `/poster/sugeet` load within 1s with new storageKey.
  4. Sign-out / sign-in: clean drain after re-auth, `outboxRemaining: 0`.
  5. 50-row backlog: all 50 rows landed, every `pushOne DONE` between 162–475ms, zero duplicates in Supabase (MCP-verified: `count: 50, unique_ids: 50`).
- New Patterns S15 (watchdog + generation guard under StrictMode singleton) and S16 (supabase-js library-level lock + `accessToken` escape hatch + 3-client rule) added to `bug_patterns.md`. Pattern A7 (#83) gets a forward-reference to S16.
- Issue #111 filed with full corrected RCA; owner closes after verification.

---

## 26 Jun 2026 — Phase C Chunk 4.2: TestOutbox uses real UUIDs (fixes Round 2 E2E blocker)

- `fix(sync): Chunk 4.2 — TestOutbox uses real UUIDs, name-prefix for test marker (relates #110)` (pending commit)
- **Triggered by:** owner E2E Round 2 after Chunk 4.1 landed. Every smoke push now failed with `invalid input syntax for type uuid: "_test_<uuid>"`. Supabase `customers.id` (and every synced table's `id`) is `uuid` — it rejects the `_test_` prefix string before RLS runs, masking the (working) Chunk 4.1 mapper fix.
- **Owner decision:** real `crypto.randomUUID()` for ids; keep test-marker on the `name` field (every test row already starts with `"TEST "`). Cleanup filters by `name LIKE 'TEST %'`.
- **Single file changed:** `src/pages/__dev__/TestOutbox.tsx`. `TEST_PREFIX = '_test_'` constant deleted; replaced with `TEST_NAME_PREFIX = 'TEST '`. All 5 id-generating sites now use bare `crypto.randomUUID()`. `clearOutbox()` and `cleanup()` filter customers by `name.startsWith('TEST ')` and canteen_sales by `items[0].name.startsWith('TEST ')`. Page subtitle updated.
- No SyncRunner / mapper / wrapper / Dexie-schema changes.
- Skipped reviewer agent per Rule J (single-file mechanical edit, intermediate work doesn't matter).
- Build clean. **Owner re-E2E pending** — Chunk 4 / 4.1 / 4.2 collectively stay "SHIPPED pending owner E2E" until verified.

---

## 26 Jun 2026 — Phase C Chunk 4.1: payload mapper + club_id stamp (fixes Chunk 4 E2E failure)

- `fix(sync): camelCase Dexie row → snake_case Supabase payload mapper + JWT club_id stamp` (pending commit)
- **Triggered by:** owner E2E of Chunk 4 — every `_test_` customer push dead-lettered with `"Could not find the 'createdAt' column of 'customers' in the schema cache"`. 9 rows stuck at attempts=10, zero rows in Supabase. New Pattern S14 (issue #110).
- **Root cause:** Chunk 4's `pushOne` sent raw Dexie rows (camelCase, e.g. `createdAt`, `walletBalance`, `lastVisitAt`) to `supabase.from(table).upsert(...)`. Supabase columns are snake_case.
- **Fix — three files, no schema changes:**
  - NEW `src/db/syncPayloadMapper.ts` — per-table strict allowlist. Maps Dexie camelCase → Supabase snake_case, drops Dexie-only fields (`_migrationSeq`, `walkInCode`, `framesPlayed`, etc.), converts epoch ms → ISO strings. `customers` and `canteen_sales` fully mapped (cover all TestOutbox smoke buttons). The other 7 tables throw "not yet mapped" — Chunk 7 wires them deliberately as queries.ts mutation sites cut over.
  - NEW `src/db/syncClubId.ts` — reads `user_club_id` claim from the access_token (the claim we patched in #109 / Pattern A9). Cached per token. Throws if claim is absent → row dead-letters with clear "sign out and back in" message.
  - `src/db/syncRunner.ts` — `drainOnce` calls `getOwnerClubIdFromJwt()` once per batch (cached); `pushOne` calls `toSupabaseRow(table, row, clubId)` before `.upsert`.
- **TestOutbox additions:**
  - New "Clear outbox (DEV)" button — wipes `_outbox` + any `_test_*` data rows so the post-fix re-test starts from zero. Does NOT touch Supabase.
- New Pattern S14 (issue #110) added to `bug_patterns.md` documenting the trap + the strict-allowlist rule.
- Build clean. **Owner re-E2E pending** — Chunk 4 stays "SHIPPED pending owner E2E" until this fix verifies.

---

## 26 Jun 2026 — Phase C Chunk 4: SyncRunner drain engine (real Supabase push)

- `feat(sync): Phase C Chunk 4 — SyncRunner drain engine` (pending commit)
- Replaces the Chunk 3 `scheduleDrain()` no-op stub with a real engine that pushes outbox rows to Supabase.
- New file: `src/db/syncRunner.ts` (~210 LOC). Exports `syncRunner` singleton + `scheduleDrain` forwarder.
- `start()` registers `window 'online'` listener + 30s heartbeat. `stop()` tears them down. Owned by new `<SyncRunnerBoot />` in `src/App.tsx`, gated on `dbReady + session + !isPlayerHubRoute` (mirrors `ExpirySweepRunner` pattern).
- `scheduleDrain()` guards: not draining, online, started, `db.name !== 'ClubKeeperDB__pending'` (Pattern A1).
- `drainOnce()` reads up to 50 non-stuck rows in seq order via streaming `.each()` with sentinel-throw break (NOT `.filter().limit()` — that pattern starves live rows once 50+ dead-letter rows accumulate; reviewer flagged, fixed). Pattern D7: tx closed before any `await supabase...`.
- `pushOne()`: `insert`/`update` → `supabase.from(table).upsert(payload, { onConflict: 'id', ignoreDuplicates: false })`; `soft_delete` → `.update({ deleted_at, updated_at: deleted_at }).eq('id', rowId)`. Setting `updated_at = deleted_at` is deliberate so the Chunk 5 cursor pull picks up the deletion.
- **Dead-letter:** when `attempts + 1 >= 10`, row flips `stuck: true` and runner does `continue` (skip-and-continue per owner choice). Other rows keep draining. Transient failures `throw` to trigger exponential backoff (1s → 60s).
- **Large-backlog continuation:** if a drain pass returns a full BATCH_SIZE, runner immediately reschedules — a 500-row queue no longer waits 30s/batch.
- Types: `OutboxRow.stuck?: boolean` added in `src/types/index.ts`.
- `src/db/scheduleDrain.ts` now a one-line re-export from syncRunner so wrappers' import path is unchanged.
- `src/pages/__dev__/TestOutbox.tsx` extended with 3 buttons: "Force drain now", "Show dead-letter", "RLS-fail test" (seeds row with `club_id: '00000000-...'`, kicks drain, asserts `attempts>0 + lastError`). Container fixed `max-w-5xl` → `max-w-[1400px]` (Critical Rule 13).
- Reviewer (clubkeeper-reviewer agent) returned REQUEST_CHANGES with 2 blockers + 4 concerns; all blockers fixed, all 4 concerns either fixed (large-backlog, sleep-removal) or documented inline (void-dispatch comment, soft_delete updated_at intent).
- Build clean. **Pending owner E2E verification** before declaring chunk 4 verified.

---

## 26 Jun 2026 — Project agents + skill integration (when to delegate vs main-thread)

- `chore(agents): three project agents (explorer, reviewer, skill-auditor)` (9783db3)
- `docs(skill): document agent usage rules + Rule J + CLAUDE.md pointer`
- Three Sonnet-default helper agents added under `.claude/agents/`:
  - `clubkeeper-explorer` (Read/Grep/Glob, read-only) — "where is X called", reference-file fact lookups. Returns `file:line` citations.
  - `clubkeeper-reviewer` (Read/Grep/Glob/Bash) — pre-commit diff review against Critical Rules 1–15 + bug patterns + ripple_effects. `VERDICT + violations`; no auto-fix.
  - `clubkeeper-skill-auditor` (Read/Grep/Glob/Bash) — Phase 4 close gate: Rule B/E/G + memory-link + CLAUDE.md drift checks.
- Decision rule (from `SubAgent.txt` on owner's desktop): "Does the intermediate work matter? YES → main thread; NO → subagent." Forbidden anti-patterns (debug, test-runner, sequential pipeline, expert persona, auto-fix) explicitly called out in SKILL.md `## Project Agents` section.
- Skill updates so main-thread Opus trusts and uses agents correctly:
  - SKILL.md new `## Project Agents` section between Response Style and Current State — loads early in every session.
  - SKILL.md routing table row added pointing future sessions at the section.
  - SKILL.md new **Rule J** (mandatory delegation reasoning before any `Agent()` call + forbidden/required delegations list).
  - CLAUDE.md root-level summary added so the rule is visible even before SKILL.md loads.
- All Sonnet 4.6 default — Opus on subagents burns tokens fast for scoped lookups; Haiku rejected by owner ("too basic, don't want more bugs").
- No code changes; no migration changes.

---

## 26 Jun 2026 — BUG-S13 (#109): JWT custom-claims still missing despite hook patch — RLS-on-users_meta at mint time

- `fix(auth): supabase_auth_admin RLS policy on users_meta so JWT hook can read at mint time (closes #109 — pending owner verification)`
- After #108 (hook field-ref bug, closed) was patched, the hook stopped throwing — but the JWT still issued with no `user_club_id` / `user_role` claims, blocking Phase C Chunks 4–7 (every Supabase upsert would RLS-403).
- **Root cause:** The hook is `SECURITY INVOKER`, so its `SELECT FROM users_meta` runs as `supabase_auth_admin`. At token-mint time `auth.uid()` is NULL (the JWT being minted doesn't exist yet), so the existing `users_meta_select_self` policy (`user_id = auth.uid()`) matched zero rows. Hook hit `if not found then return event;` and silently emitted the bare JWT. No log warnings because no exception fired.
- **The trap that fooled the prior diagnosis:** A direct in-editor `SELECT add_user_meta_to_jwt(...)` call runs as `postgres`, which bypasses RLS, and returned the correct claims. Made the function look fine. The only diagnosis that holds up is decoding a freshly-minted JWT at jwt.io.
- **Fix — two layers, both required**, patched into `supabase/migrations/20260625_phase_c_sync_tables.sql`:
  - `GRANT SELECT ON public.users_meta TO supabase_auth_admin;` (table-level)
  - `CREATE POLICY users_meta_auth_admin_read ... TO supabase_auth_admin USING (true);` (row-level, scoped to that role only — does NOT widen anon/authenticated)
- Both applied live in production by owner; verified end-to-end by decoding a fresh JWT after sign-out/in — both `user_club_id` (`87501f04-...`) and `user_role` (`owner`) present with `iat` post-policy-creation.
- Skill updates: `sync_architecture_v2.md` §4.5 now documents the auth.uid()=NULL-at-mint gotcha and prescribes the two-layer fix for any future hook. New `bug_patterns.md` Pattern A9 — "Custom Access Token Hook reading a table with RLS must be granted BOTH table-SELECT and an auth-admin-scoped policy."
- **Chunk 4–7 unblocked.** SyncRunner can now ship — every Supabase upsert authenticated as the owner will pass RLS.
- **Stale row noted, not cleaned this session:** `users_meta` row for the old UUID `06533a78-...` (`sugeetjadhav7@gmail.com`) is orphaned (no matching `auth.users` row). Harmless; deferred to a separate one-line `DELETE` paste-block to avoid bundling unrelated changes into the #109 fix.

---

## 25 Jun 2026 — Phase C Chunk 3: sync wrappers (Dexie-only, no Supabase yet)

- `feat(sync): Phase C Chunk 3 — syncedCreate/Update/SoftDelete wrappers`
- **New files:**
  - `src/db/syncTableMap.ts` — single source of truth for snake_case (Supabase wire format) ↔ camelCase (Dexie table key) mapping. `dexieTableFor(syncTable)` + reverse + `SYNC_TABLES_PULL_ORDER`. Every Phase C consumer (wrappers, runner, reader) goes through here.
  - `src/db/scheduleDrain.ts` — stub for Chunk 4. Logs once in DEV. Lets wrappers compile + smoke-test without coupling to a runner.
  - `src/db/syncWrappers.ts` — 4 functions: `syncedCreate`, `syncedUpdate`, `syncedSoftDelete`, `syncedCreateBatch`. Each opens a Dexie `rw` tx over (data table + `_outbox`), writes both rows atomically, then calls `scheduleDrain()` after commit. Generic over `SyncedRow extends { id: string }`. Top-of-file Pattern D7 warning: never call from inside another `db.transaction()`.
  - `src/pages/__dev__/TestOutbox.tsx` — DEV-only smoke-test page at `/__dev/test-outbox`. Four buttons exercise each wrapper; output dumps data row + outbox row(s) with PASS/FAIL gate. `_test_` id prefix isolates from production data. "Clean test rows" purges.
- **App.tsx:** `/__dev/test-outbox` route added under `import.meta.env.DEV` block. Production bundle unchanged (Vite tree-shakes the test page).
- **Pattern enforcement:** all 4 wrappers route through `dexieTableFor()` — direct camelCase string access is forbidden. The outbox `payload` is the FULL merged row (not just the patch on update), so SyncRunner can do a clean upsert in Chunk 4.
- **NOT done in this chunk** (deferred to Chunk 4+ per the prompt):
  - `scheduleDrain()` is a stub — no actual drain runs.
  - No queries.ts call sites have been migrated yet (Chunk 7 cutover).
  - No code outside the test page calls the wrappers yet — they're standalone.
- `npm run build` clean (0 TS errors). Production bundle 1056.16 KB (unchanged from Chunks 1-2).

**Blocking note for Chunk 4:** JWT custom-claims (`user_club_id` + `user_role`) still missing from production tokens despite #108 patch. Tracked as **#109 BUG-S13**. Chunk 4 (SyncRunner — actually hits Supabase) cannot ship until #109 is resolved, because every push will RLS-403. Chunk 3 wrappers are Dexie-only so this session was safe to ship.

---

## 25 Jun 2026 — BUG-S12 (#108): JWT hook field-ref bug, sign-in bricked

- `86d45d3` — `fix(auth): JWT custom-claims hook must use FOUND, not nonexistent record field (closes #108)`
- `public.add_user_meta_to_jwt` referenced `meta.user_id` in an `IF` guard but `user_id` was NOT in the `SELECT INTO meta` list (only `club_id, role, active` were). PL/pgSQL raised `record "meta" has no field "user_id"` on every invocation. Supabase Auth treats any hook exception as fatal token-issue, silently rejects the session, app bounces back to sign-in screen.
- Fix: use `FOUND` auto-set var; wrap body in `EXCEPTION WHEN OTHERS THEN RAISE WARNING + RETURN event` so any future hook bug degrades gracefully (sign-in succeeds without sync claims, client renders NoClubScreen) rather than bricking auth.
- Migration file in repo updated to match the `CREATE OR REPLACE` that Sugeet pasted into Dashboard SQL Editor.
- Verified by owner. Closed.

---

## 25 Jun 2026 — Phase C Chunks 1 + 2: owner auth hook + DDL (manual deploy pending)

**Chunk 1 — `feat(auth): Phase C Chunk 1 — Supabase owner sign-in + useCurrentUser`**

- `src/lib/auth.ts` (NEW) — `useCurrentUser()` returns `{ user, clubId, status: 'loading'|'signed_in'|'signed_out'|'no_club' }` over `useAuthStore` + `getOwnerClub`. Re-exports `signInWithGoogle` / `signOut`.
- `src/components/NoClubScreen.tsx` (NEW) — fallback for status='no_club'.
- `src/App.tsx` — `/auth/login` alias to `<Signup />`; added to `PUBLIC_PATHS`.
- Existing supabase client + authStore reused — no duplicate clients. Staff login + role gates explicitly Phase D.
- NoClubScreen exported but NOT auto-gated in `RequireAccess` — gating all private routes on a clubs row would block existing offline-only users. Chunk 5 (initial pull) is the right place for that gate.

**Chunk 2 — `feat(sync): Phase C Chunk 2 — DDL migration file (manual deploy required)`**

- `supabase/migrations/20260625_phase_c_sync_tables.sql` (NEW) — 9 sync tables per §4.2 with v3.2 amendment (`session_items` drops invented `canteen_item_id` column), all indexes per §4.2, `users_meta` table (Phase-D-permissive RLS — service-role only for INSERT/UPDATE for now), `add_user_meta_to_jwt` PL/pgSQL function for §4.5 JWT custom claims, `clubs.sync_enabled` + `sync_disabled_reason` + `sync_disabled_at` kill-switch columns, `clubs.owner_id` add-if-missing guard. RLS per Appendix B owner-only (`(auth.jwt() ->> 'user_role') = 'owner'`). Realtime publication grants for all 9 sync tables with `REPLICA IDENTITY FULL`. All DDL idempotent.
- **NOT auto-deployed.** Sugeet manually pastes into Supabase Dashboard → SQL Editor, configures the Custom Access Token Hook, INSERTs his own `users_meta` row, then signs out + in to refresh JWT. Returns `PHASE_C_DDL_DEPLOYED` token to unblock Chunk 3.
- Migration deviates from v2 §4.1 in two places (intentional, captured in v3.2 amendment): (a) `clubs.owner_id` not `owner_user_id` — matches production. (b) `session_items` has no `canteen_item_id` column — Dexie SessionItem never had that field, snapshots are authoritative.

---

## 25 Jun 2026 — Phase C Chunk 0: Step 2 audit fixups

- `fix(types): Phase C Chunk 0 — Step 2 audit fixups (booking types, _migrationSeq, SyncTableName, §4.2 amend)`
- **Why:** Phase C ramp-up surfaced 5 leftovers from the Step 2 audit. Shipping them as a standalone chunk before any sync engine code so the Chunk 1+ work doesn't compound on stale types.
- **What shipped:**
  - `src/types/booking.ts` — `Booking.tableId` and `Booking.consumedSessionId` narrowed `number` → `string` (post-v20 UUIDs).
  - `src/types/index.ts` — `_migrationSeq?: number` added to `GameTable`, `Session`, `SessionItem`, `CanteenItem` (§10.4 resumable upload). New `SyncTableName` union exported in **snake_case Supabase format** (`'game_tables' | 'sessions' | ... | 'bookings'`) so `SyncRunner.pushOne` can pass directly to `supabase.from(table)` without a hot-path conversion. `OutboxRow.table` retyped from raw `string` → `SyncTableName`.
  - `src/db/database.ts` — `.upgrade()` callback's bookings `.modify()` now remaps `consumedSessionId` legacy numerics through `idMaps.sessions` too. Previously only `tableId` was remapped, which would have left consumed-booking → session links pointing at stale stringified numbers post-upgrade.
  - `references/sync_architecture_v2.md` — v3.2 amendment block added at top. §4.2 `session_items` DDL drops the invented `canteen_item_id UUID NOT NULL` column (Dexie SessionItem never carried that field — denormalised snapshot model). Notes that production uses `clubs.owner_id` (not `owner_user_id` as v2 §4.1 said).
- **Decisions captured this chunk:** snake_case for `SyncTableName` (Sugeet's call — fewer drain-loop conversions). Production schema column name is `clubs.owner_id`; v2 doc was wrong.
- `npm run build` clean (0 TS errors).

---

## 24 Jun 2026 — Phase B step 2: v20 .upgrade() UUID migration complete

- `ee40cda` — feat(db): Phase B step 2 — v20 .upgrade() UUID migration + collapse number|string unions
- **What shipped:**
  - `src/db/database.ts` — `.upgrade()` callback added to `this.version(20)`. Atomic 3-phase migration: (1) build `Map<number, UUID>` for all 4 tables; (2) `clear()+add()` rewrites each table with new UUID ids + `_migrationSeq` counter; sessions phase handles nested `tableMoves[].fromTableId/.toTableId` (§5.6 landmine 2c); (3) `.modify()` rewrites FK fields in `canteenSales.items[].canteenItemId`, `stockPurchases.canteenItemId`, `bookings.tableId`. If anything throws, Dexie rolls back to v19 cleanly. `Table<>` generics narrowed from `number | string` to `string` for the 4 migrated tables.
  - `src/types/index.ts` — all `number | string` transitional types collapsed to `string`: `GameTable.id`, `Session.id`/`tableId`, `SessionItem.id`/`sessionId`, `CanteenItem.id`, `TableMove.fromTableId`/`toTableId`, `CanteenSale.items[].canteenItemId`, `StockPurchase.canteenItemId`.
  - `src/db/queries.ts` — dual-accept guards removed from `confirmPaymentAndStop` + `recordSessionPaymentBreakdown` (now validate `string uuid.length===36` only). All 13+ `number | string` widened signatures narrowed to `string`. `addOrIncrementSessionItem` + `createBackEntry` return type `Promise<string>`. `BackEntryInput.tableId`, `CanteenSaleLineInput.canteenItemId`, `recordStockPurchase` input narrowed. `Map<number,...>` → `Map<string,...>` internal types. `canteenItemId` validation: integer-check → uuid-string-check.
  - `src/pages/StartSession.tsx` + `SessionDetail.tsx` — dual-accept route param parsers removed (Pattern R5 cleanup). `tid`/`sid` now straight string from `useParams`; `tidValid`/`sidValid` check `length === 36`.
  - `src/pages/QuickSale.tsx` — `CartLine.canteenItemId`, `Map` key, `decrementLine`/`removeLine` param narrowed to `string`.
  - `src/pages/Piggy.tsx` — `itemNameById` + `RestockList` prop narrowed to `Map<string, string>`.
- **Three landmines handled** per §5.6: (2a) `addOrIncrementSessionItem` increment branch returns `existingRow.id` (already a string); (2b) `StockPurchase.canteenItemId` + `CanteenSale.items[].canteenItemId` narrowed to `string`; (2c) `tableMoves[]` nested FK remap in upgrade callback.
- **No pre-v20 backup** — owner explicitly waived (solo dev, zero paying users on destructive path).
- `npm run build` clean — zero TS errors after all changes.

---

## 24 Jun 2026 — BUG-B1: route param + add() ripple from v20 schema flip (#107)

- `8e4619c` — fix(routing): dual-accept route params for UUID-keyed Dexie rows (closes #107 — pending owner verification).
- `986ace0` — fix(db): caller-supplied UUIDs at all add() sites for 4 UUID-flipped tables (closes #107 followup).
- **Why two commits:** the first fix unblocked the route boundary (`Number("uuid")` → NaN crash on every table tap). Owner then tried Start Timer and hit the next layer — `db.sessions.add(...)` with no `id` field. v20 schema is `'id, ...'` (no `++`), so caller MUST supply id. Both fixed.
- **Files changed:**
  - `src/pages/StartSession.tsx`, `src/pages/SessionDetail.tsx` — dual-accept route param parser at boundary (`Number()` only when round-trips as `String(n) === raw`; else UUID string). Removed 4 stale `Number(session.id)` re-coercions in SessionDetail action handlers.
  - `src/db/queries.ts` — widened 13 function signatures from `number` → `number | string` (`getActiveSessionForTable`, `getLinkableBookingsForTable`, `getUpcomingBookingsForTable`, `acknowledgeNotify`, `snoozeNotify`, `updateSessionNotify`, `pauseSession`, `resumeSession`, `pauseForPayment`, `confirmPaymentAndStop`, `recordSessionPaymentBreakdown`, `linkBookingToSession`, `addOrIncrementSessionItem`). `addTable`, `addCanteenItem`, `addSessionItem`, `startSession` return type narrowed to `Promise<string>`. `createBackEntry` widened to `Promise<number | string>`. All 8 `.add()` sites on the 4 UUID-flipped tables now pre-generate `crypto.randomUUID()`.
  - `src/components/AddItemBottomSheet.tsx` — freeform `db.sessionItems.add` now passes `id: crypto.randomUUID()`.
- **Two new patterns logged:** Pattern D12 (Dexie `.add()` on plain `id` schema needs caller-supplied key) and Pattern R5 (route-param `Number()` coercion is a UUID landmine).
- **Step 2 implication:** this commit effectively pulled the "switch `add()` sites to UUIDs" item from Step 2 forward to Step 1.5. Step 2 still owes the `.upgrade()` callback to rewrite pre-existing numeric-id rows. Pre-existing rows currently coexist with new UUID rows because the runtime guards + widened signatures dual-accept both.
- `npm run build` green after each commit.

---

## 24 Jun 2026 — v20 schema declared, polyfill installed, hazards fixed (Phase B step 1)

- `feat(db): declare v20 schema + UUID polyfill + transitional id type widening (Phase B step 1)`
- `src/db/database.ts` — Dexie v20 declared (no `.upgrade()` yet — Step 2). 4 tables (`gameTables`, `sessions`, `sessionItems`, `canteenItems`) schema strings flipped from `++id` to `id`. All 10 stores declared. `_outbox` table added (`++seq, table, op, rowId, createdAt`) for Phase C sync queue (unused until Phase C). `Table<>` generic types widened to `number | string` on the 4 migrated tables (transitional). `OutboxRow` type imported from `src/types/index.ts`.
- `src/types/index.ts` — `GameTable.id`, `Session.id`, `SessionItem.id`, `CanteenItem.id` widened to `number | string | undefined` (transitional — Step 2 narrows to `string`). `OutboxRow` interface added (Phase C sync queue schema).
- `src/db/queries.ts` — `CURRENT_SCHEMA_VERSION` bumped 19→20. `ClubKeeperBackupV20` added as primary backup interface; `ClubKeeperBackupV19/V18/V17/V16` aliased to it. `getAllDataForExport` return type updated to `ClubKeeperBackupV20`. Dual-accept transitional guard in `confirmPaymentAndStop` (line ~301) and `recordSessionPaymentBreakdown` (line ~1235) — both now accept numeric v19 ids AND UUID v20 strings. `TODO(phase-b-step-2)` comments added to all 5 `add()` call sites on the 4 migrated tables. `resetEverything` extended to clear `_outbox` (Pattern D10).
- `src/db/seed.ts` — `seedIfEmpty()` pre-assigns UUIDs to sample tables via `.map(t => ({ ...t, id: crypto.randomUUID() }))` — required for v20 where `id` schema no longer auto-generates; also forward-safe on v19 since `++id` accepts caller-supplied ids.
- `src/main.tsx` — `crypto.randomUUID` polyfill installed at boot (before DEV imports) for iOS Safari < 15.4. Fixes latent bug already present in 4 lib files (`coinExpiry`, `nudge`, `streak`, `walkInCode`). One `// @ts-expect-error` used as allowed.
- `npm run build` passes after each chunk (5/5). Zero TS errors. No behavior change for existing v19 users — schema bump is a no-op without `.upgrade()`.
- **Two hazards found vs. one documented:** `recordSessionPaymentBreakdown` also had the `typeof sessionId !== 'number'` guard (line ~1235, not just line 301). Both fixed.
- **Pattern D10 applied:** `_outbox` added to `resetEverything` store list + clear call immediately upon declaring the table.

---

## 22 Jun 2026 — Per-club booking hours + per-30-min-slot advance (#106) [R4, S11, U10, T1, P2]

- `feat(booking): per-club hours + per-slot advance (closes #106 — pending owner verification)`. Two linked changes shipped together so the migration + UI + RPC contract move as one atom.
- `supabase/migrations/20260622_booking_hours_and_per_slot_advance.sql` (NEW, ⚠ pending manual run) — clubs gains `booking_open_minutes`, `booking_close_minutes`, `booking_advance_per_slot int default 50` (CHECK 0–2000) + `booking_hours_valid` CHECK constraint. `get_club_public_info` dropped+recreated with 3 new OUT params. `submit_booking_intent` dropped+recreated to (a) reject `hours_not_set`, (b) recompute server-side advance and raise `advance_mismatch` on disagreement, (c) raise `outside_hours` for non-overnight clubs only.
- `src/types/index.ts` — `ClubSettings` adds 3 new optional fields. `bookingAdvanceAmount` marked `@deprecated 22 Jun 2026`.
- `src/types/playerHub.ts` — `ClubPublicInfo` extended with `bookingOpenMinutes / bookingCloseMinutes (number | null)` + `bookingAdvancePerSlot`. `bookingAdvanceAmount` marked `@deprecated`.
- `src/db/database.ts` — Dexie v19 (additive only, no `.upgrade()`, schema string identical to v18).
- `src/db/queries.ts` — `CURRENT_SCHEMA_VERSION = 19`. New `ClubKeeperBackupV19` interface; V18/V17/V16 aliased to it for back-compat.
- `src/db/seed.ts` — `bookingAdvancePerSlot: 50` default; open/close intentionally undefined so owner must explicitly set them.
- `src/lib/validation.ts` — adds `isValidBookingHours`, `canEnableBookings`, `minutesSinceMidnightLocal`.
- `src/lib/playerHubApi.ts` — `syncBookingConfigBySlug` signature now takes a `BookingConfigPatch`; routes through `mirrorToSupabaseBySlug` (Pattern S11). `getClubPublicInfo` mapper extended with `?? null / ?? 50` defaults (pre-migration safe). `submitBookingIntent` error map widened for `hours_not_set | outside_hours | advance_mismatch`.
- `src/pages/PlayerHubSettings.tsx` — booking card rebuilt: Opens-at / Closes-at 30-min-step selects, Accept Bookings toggle gated on `canEnableBookings`, "Advance per 30 mins" replaces "Advance per booking" input. All four save sites use `useSaveIndicator()` + `<SaveIndicator>` (Pattern U10). Read side respects Pattern R4 — open/close read directly off `settings`, hook only drives write path.
- `src/pages/player/BookingScreen.tsx` — `buildTimeOptions` now settings-driven; new `not_configured` PageState (NO hardcoded fallback — that was the #106 regression vector). Overnight slots tagged "Late-night" inline. Advance computed as `ceil(durationMin / 30) * bookingAdvancePerSlot`. Summary shows breakdown line. `advance_mismatch` surfaces as inline "Pricing changed. Please retry."
- `.claude/skills/clubkeeper/references/ripple_effects.md` — "## Advance Booking" section gets a new "Files in scope (P2 — shipped 22 Jun 2026, closes #106)" block + P2 invariants (no-hardcoded-fallback, server-side recompute, non-overnight-only outside_hours, deprecated `bookingAdvanceAmount` is frozen). Schema & Migrations section bumped to v19.
- `.claude/skills/clubkeeper/SKILL.md` — Current State entry for Advance booking overwritten (#106 added). Pending migration line added. Dexie current bumped to v19.
- `npm run check:settings` + `npm run build` both pass locally before commit.

---

## 21 Jun 2026 — Player Hub slug input validation gate (#105)

- `1ee1372` — fix(player-hub): slug input validation gate (Pattern R4 + fail-open availability).
- `src/pages/PlayerHubSettings.tsx` — debounced slug-validation effect now clears `slugError` synchronously the moment `validateSlug` passes, and resets both `slugError` and `checking` on empty input. Previously the sync-pass branch left a stale "Must be at least 3 characters" error in place, and an empty-input early-return leaked prior state — the Save gate ANDs `slugError` + `checking`, so Save stayed permanently disabled even when the typed value was fine. `isSlugAvailable` is now raced against a 5s fail-open timeout so a hung owner-client query (auth lock, offline) can no longer strand `checking=true` forever; the server's unique constraint on `clubs.slug` remains the authoritative dedup. Local `cancelled` flag prevents stale-closure setState on effect re-runs.
- `94b3e3b` — `bug_patterns.md` adds **Pattern F8 — Validation effect must clear stale error on the pass branch**. Rule: synchronously clear the error in the sync-pass branch, reset state on empty input, race availability checks with a fail-open timeout, cancel via a local flag. `ripple_effects.md` Player Hub section gains the slug-modal validation invariant alongside the existing two-client rule. Confirmed by owner.

---

## 21 Jun 2026 — upsertClub writes slug on update path (#104)

- `68bc9a9` — fix(player-hub): upsertClub now writes slug on update path [Pattern X].
- `src/lib/playerHubApi.ts` — `upsertClub` now spreads a shared `clubFields` object into both the insert and update branches. Previously the update branch silently omitted `slug`, turning the column write-once: re-running slug setup left `clubs.slug` stale, `/c/<new-slug>` 404'd, and every downstream `mirrorToSupabaseBySlug` call matched zero rows silently. Fix is single-source-of-truth payload; only `owner_id` (insert) and `updated_at` (update) live outside the shared object. Confirmed by owner.
- `bug_patterns.md` — new **Pattern X — Upsert payload drift between insert and update branches**. Rule: any upsert MUST build a shared payload object covering every caller-owned column and spread it into both branches; branch-specific fields stay in their branch with a comment if they intentionally differ.
- `ripple_effects.md` — Player Hub section gains the upsert payload-sync invariant alongside the existing P2 anti-pattern.

---

## 20 Jun 2026 — Settings drift prevention layer (#97 enforcement)

Follow-up to the architectural fix below — the hook was the cure; this commit makes the bug class structurally unreintroducible.

- `b18220f` — chore(settings): lock in useDexieSetting as the only path for ClubSettings reads.
- `scripts/check-settings-pattern.mjs` — new line-by-line scanner of `src/**/*.{ts,tsx}` flagging `useState(settings?.X)` / `useState(settings.X)`. Skips `useDexieSetting.ts` and any line carrying `// allow-settings-useState: <reason>`. Exit 1 with file:line + snippet on hit.
- `package.json` — `check:settings` script + `prebuild` hook so `npm run build` fails fast on regressions. Verified by scratch-line test: exit 1 with snippet, exit 0 once removed.
- `architecture.md` — new "Settings reads — `useDexieSetting` is mandatory" section with the three allowed shapes (toggle / select / typing buffer) and an explicit don't-do list.
- `checklists/new_settings_field.md` — new mandatory pre-write checklist; SKILL.md routing table cites it.
- **SKILL.md** — **Critical Rule 15** added: any ClubSettings field touch requires filling the checklist.
- **bug_patterns.md** Pattern R4 — gains an Enforcement section listing the lint, the checklist, and the `// allow-settings-useState:` escape hatch. The coins `coinRedemptionModes` initializer in `PlayerHubSettings.tsx` is the single existing escape-hatch site (atomic multi-field save with `handleSaveRates`); reformatted to one line + annotated. No behavior change.

Issue #97 closed by owner after verifying toggle persistence, Dexie row alignment, and `npm run build` running the guard.

---

## 20 Jun 2026 — Settings drift class eliminated (#97 architectural fix)

Re-opened #97 after the read-side patch (`61d4c9f`, Pattern R3) was deemed surface-level — three sources of truth (local `useState`, Dexie via `useLiveQuery`, Supabase via `getOwnerClub()`) raced on every settings field, guaranteeing the bug would recur on each new toggle.

- New `src/hooks/useDexieSetting.ts` — single-field read/write hook over `useSettings()` + `updateSettings()`. Dexie-authoritative; Supabase mirroring stays in the caller because different fields mirror through different RPCs (some Supabase-first by design).
- `src/pages/PlayerHubSettings.tsx` — refactored `acceptsTopups`, `acceptsBookings`, and the `bookingAdvanceAmount` typing buffer to use the hook. Deleted the two `useState` mirrors, the three sync `useEffect`s, the `topupsLoaded`/`bookingsLoaded` flags, and the `getOwnerClub()` backfill effect. Optimistic-revert dropped from the toggle handlers — the hook's `useLiveQuery` reflects Dexie's true state on every render. Coins fields intentionally left untouched (atomic multi-field saves + seeding logic in `handleToggleCoins`/`handleSaveRates`; the per-field hook would split the atomic write).
- Grep across `src/` for `useState(settings?` and `useState(...settings.` returned **zero hits**, so no follow-up audit issue needed.
- Skill: **Pattern R4** added to `bug_patterns.md` (Dexie & Offline state section, generalises Pattern R3 from one symptom to the bug class). Settings entry in `ripple_effects.md` updated to require `useDexieSetting` for any new ClubSettings field. **Critical Rule 14** added to `SKILL.md`.

---

## 20 Jun 2026 — Settings cleanup pass (Issues #95, #96, #98, #99, #101, #102)

Eight Settings-related issues filed (#95–#102). Six fixed in one PR; #97 (BUG-S3 Accept Bookings desync) and #100 (BUG-S6 time rounding) closed with "cannot reproduce" investigations — current code already implements the patterns the issues cite.

**Commits (in order):**
- `fa24b9c` — fix(settings): UPI placeholder uses `example@upi` (closes #95). One-line privacy fix.
- `4da92b6` — fix(settings): currency one-liner (closes #98). Disabled input replaced with compact read-only text.
- `531b3a6` — feat(settings): SaveIndicator for UPI + Club Name (closes #96, #102). New `src/components/SaveIndicator.tsx` + `useSaveIndicator()` hook. State machine: idle → saving → saved (1.5s auto-reset) → idle, OR → error. Introduces **Pattern U10**.
- `675486f` — refactor(supabase): all clubs-row mirrors go through `mirrorToSupabaseBySlug`. New `src/lib/mirrorToSupabase.ts`. Refactored `syncCoinConfig`, `syncTablesJsonBySlug`, `syncBookingConfigBySlug`, `updateClubNameRemote` (signature changed: now takes slug), `updateAcceptsTopups` (same). Promotes Pattern P2 from descriptive to prescriptive via **Pattern S11**.
- `079dc35` — feat(settings): dedicated Canteen section (closes #99). New collapsible inserted between Tables and Alerts. Holds low-stock (moved from Club Info) + peak-pricing (moved from its own top-level section). Updated `decisions_active.md` lines 59 + 73 in place per Rule G.
- `8962127` — fix(home): hide outOfService tables by default (closes #101). Opt-in "Show N disabled" toggle at bottom of /tables grid. Filter pills + counts operate on visible set.
- `aca99f6` — skill self-update: Patterns U10 + S11 added to `bug_patterns.md`. SaveIndicator + mirrorToSupabase entries added to `ripple_effects.md`. Rule H added to `SKILL.md`.
- `61d4c9f` — fix(player-hub): toggles re-sync from Dexie on every settings change (closes #97). Read-side bug — `useState(settings?.X)` never resynced when Dexie's useLiveQuery resolved late, and the mount-effect clobbered local state with Supabase on every remount. Introduced **Pattern R3** (local useState mirrors must have a re-sync useEffect).

**Investigations (no code change, comments posted on the issues):**
- #97 (BUG-S3 Accept Bookings toggle desync) — toggle is in `PlayerHubSettings.tsx:472`, already Supabase-first via `syncBookingConfigBySlug`, mount-effect hydration in place. Cannot reproduce. Issue stays open pending DevTools network log from owner.
- #100 (BUG-S6 Time rounding not applied) — `stopSession` + `confirmPaymentAndStop` + `pauseForPayment` all call `applyRounding(rawElapsedMs, settings.rounding)` and persist `roundedDurationMs`. Rate-card carve-out is intentional and documented. Field name is `settings.rounding`, not `settings.timeRounding`. Cannot reproduce. Issue stays open pending repro on a per-minute table.

**New patterns introduced:**
- **U10** — Save actions must show visible state (SaveIndicator).
- **S11** — All Dexie↔Supabase clubs-row mirrors go through `mirrorToSupabaseBySlug()`.

**New rule:** Rule H — Settings.tsx pre-flight is mandatory (added to `SKILL.md`).

**Decisions updated:** `decisions_active.md` line 59 (low-stock UI location → Canteen section), line 73 (Settings ordering rewritten).

---

## 20 Jun 2026 — #93 Summary Quick Sale aggregation fix (Pattern T9)

Money tiles on `/summary` already included walk-in Quick Sale revenue (Phase 1 wiring), but four analytical surfaces silently dropped it:
1. **Top Canteen Items** — items only sold via Quick Sale never appeared in the top-3 ranking.
2. **Hourly Heatmap** — hours where only Quick Sales happened showed flat bars.
3. **Top Tables** — walk-in revenue was orphaned (it isn't bound to a table).
4. **Yesterday / Last Week / 7d-avg deltas** — historical totals excluded past walk-ins, so deltas were self-consistent but understated. **Load-bearing piece** — once fixed, historical day totals retroactively grow on first deploy.

Fix landed in one commit (per spec — piecemeal would cause delta jumps).

**`src/lib/summaryMath.ts`** — three signature changes, all backward-compatible via `canteenSales: CanteenSale[] = []`:
- `bucketByHour(sessions, itemsBySessionId, canteenSales=[])` — walk-in revenue buckets to `new Date(sale.createdAt).getHours()`. No `sessionCount` bump (walk-ins are not table sessions).
- `rankTables(sessions, itemsBySessionId, tables, canteenSales=[])` — synthesises a single row when `walkInRevenue > 0`: `{ tableId: WALKIN_TABLE_ID, tableName: 'Walk-in Canteen', revenue, sessionCount: canteenSales.length, totalDurationMs: 0 }`. Joins the existing sort.
- `topCanteenItems(items, canteenSales, limit)` — refactored to a single `addLine(name, qty, price)` helper that both feeds call. Same `normalizeName`-keyed merge, so a "Coke" sold once via session and twice via Quick Sale ranks as one entry with qty=3.
- New exported sentinel `WALKIN_TABLE_ID = -1`. Real `GameTable.id` is positive auto-increment, so the sentinel cannot collide.

**`src/pages/Summary.tsx`** — four wiring changes:
- `dateRevenues` Map gains a `walkInRevenue` field per date — loaded inside the same per-date `useLiveQuery` via `db.canteenSales.where('createdAt').between(...)`.
- `getDateTotal` and `trailing7Avg` both add `walkInRevenue` to the existing `sessionsRevenue + itemsRevenue` sum.
- The three aggregation calls (`bucketByHour`, `rankTables`, `topCanteenItems`) now pass `canteenSalesForDate`. Pattern T4 invariant preserved — these calls still live in render body (no `useMemo` wrapping), Quick Sale data flows in via the existing `useLiveQuery`.
- Hourly heatmap empty-state guard widened: `!detailSessions.length && canteenSalesForDate.length === 0`. Without this, a day with only Quick Sales would show flat zeros even though sales happened.

**`src/pages/summary/TopTablesList.tsx`** — detect `WALKIN_TABLE_ID` and render a "QS" accent pill in place of the medal, "N sales" label instead of "sess · avg". Walk-in row keeps its real rank — if it out-earns Pool 1, it shows above Pool 1 with the QS pill in slot 1.

**Pattern T9** added to `bug_patterns.md` — codifies "every Summary aggregation must take ALL revenue streams as explicit args." Includes the synthetic-row + load-bearing-delta caveats, and the grep that catches future regressions.

**Owner-facing flag:** yesterday / last-week / 7d-avg deltas will recompute on first deploy. Days that had walk-in sales now show their full total. This is the bug being fixed.

Build clean at 1034.89 kB (+0.72 kB). Commit: pending below.

---

## 20 Jun 2026 — #92 Configurable low-stock threshold

Owner-controllable cutoff for the "Low stock" badge. Old behaviour was hardcoded `qty <= 5` (with a stray `qty < 5` in one place). Customers with high-volume inventory wanted 10–20; small clubs wanted 3.

Found on entry: `ClubSettings.lowStockThreshold?` already on the type, already in `DEFAULT_SETTINGS`, and `getLowStockThreshold()` (`?? 5` fallback) already wired into `Canteen.tsx`, `Summary.tsx`, and `AddItemBottomSheet.tsx`. The only missing piece was the Settings UI. So #92 became a thin UI + comparator-normalisation commit, not a full data wiring.

**`src/pages/Settings.tsx`** — added a numeric `<input type="number" min={1} max={999}>` to the Club Info section, between UPI and Time Rounding. Label: "Low stock alert at" with helper "Canteen items at or below this quantity show a 'Low stock' badge." `lowStockDraft` is a string for typing UX; `handleLowStockBlur` parses, clamps to 1–999, reverts to current value on bad parse, and only calls `updateSettings` when the value actually changed. Toast confirms. No HTML `<form>`. Auto-persist on blur matches the project's pattern.

**`src/pages/Canteen.tsx`** — `StatsRow` filter changed `currentStock < threshold` → `currentStock <= threshold`. Pre-#92 the helper had `<=` but the page filter had `<` — silent off-by-one that meant items at the exact threshold were never counted as "low" in the stats line.

**`src/components/AddItemBottomSheet.tsx`** — crossing-into-low toast trigger normalised from `oldStock >= t && newStock < t` to `oldStock > t && newStock <= t`. Matches the new semantics ("at or below = low") so the toast fires exactly when the badge first appears.

**Schema:** unchanged. Rides Dexie v18 as an additive optional field. No new backup interface alias.

**Test plan:** new club with no value set → falls back to 5 (existing behaviour). Owner sets 10 → items at qty=10 now show low-stock badge AND the stats line counter increments. Owner types `0` → clamps to 1 on blur. Types `9999` → clamps to 999. Types `abc` → reverts to previous. Toast fires once when stock decrements *across* the new threshold.

Build clean at 1034.17 kB (+1.36 kB over previous). Commit: pending below.

---

## 20 Jun 2026 — Crypto hardening: constant-time HMAC compare on Razorpay webhook (#94 — a2f122a)

External drive-by PR #80 from @dewhush flagged that `api/razorpay-webhook.ts` was comparing the computed HMAC against the `x-razorpay-signature` header with a plain `!==`. JS string equality short-circuits on first byte mismatch, so the comparison ran in non-constant time → theoretical timing side-channel.

PR was closed without merging — repo is public and the file handles payments, so accepting an unverified outside patch was too risky (the PR body also contained a crypto donation address, a known drive-by pattern). Applied the equivalent fix ourselves:

**`api/razorpay-webhook.ts`** — added `timingSafeEqual` to the `crypto` import. After computing `expectedSig`, decode both sides into equal-length hex `Buffer`s and compare with `timingSafeEqual`. Length-mismatch path still returns 401 the same way (`timingSafeEqual` throws on length mismatch, so the length check has to come first). Same external behaviour, no API change, no migration needed.

Build clean. Issue #94 opened to track. PR #80 closed with a polite thank-you comment explaining the public-repo policy.

**Decision captured:** for any future external PR touching `api/*` (payments/auth surface), default is *thank, close, re-implement ourselves*. The suggestion may be valid; merging the patch is the risk.

---

## 19 Jun 2026 — Peak Hour Pricing Phase 4: bulk-edit modal + onboarding banner (#68) — pending SHA

Final slice of #68. Feature is now end-to-end and #68 ready to close pending owner verification.

**`src/db/queries.ts`** — NEW `bulkSetCanteenItemPeakPrices(patches)`. Single Dexie tx over `db.canteenItems`. Validates each non-undefined price as integer 1–9999 BEFORE opening the tx (cleaner abort path). Uses `db.canteenItems.put()` not `.update()` — `.update(id, { peakPrice: undefined })` would leave the key untouched (Dexie semantics: undefined = "don't change"), but `put()` rewrites the whole row. To clear a peak price we destructure the row, drop the `peakPrice` key, and put the rest. So rows with no peak price are literally indistinguishable from rows that never had one (matters for backup/export round-trip).

**`src/components/BulkPeakPriceModal.tsx`** — NEW. Shared `<Modal>` (so it inherits desktop centered-dialog behaviour). Three-column grid `[name | regular ₹ | peak ₹ input]` with a sticky header row. Body scrolls inside `max-h-[55vh]`. Draft state is a `Map<id, string>` re-initialised from current `peakPrice` every time the modal opens. Empty input = clear. Validation runs on Save; bad rows mark their input red + show a tiny error under it but don't block saving the valid rows… wait — they DO block. Save aborts if any row is invalid. Owner has to fix or clear bad rows first. Only changed rows are sent to `bulkSetCanteenItemPeakPrices` (diffs against `item.peakPrice`). Toast: "Updated peak prices on N items" / "No changes to save" / error message on throw.

**`src/pages/Canteen.tsx`** — three additions:
1. **Permanent "Bulk peak prices" pill button** in the page header row, right-aligned with `ml-auto`. Visible only when `peakCfg.enabled` AND items exist. Sits next to the active-window pill when both are showing.
2. **One-time onboarding banner** below the header. Trigger condition: `peakCfg.enabled === true` AND items exist AND `localStorage('ck_peak_onboarding_seen') !== '1'`. Amber-tinted `bg-paused/10 border-paused/30` (reuses existing token, same as the Peak header pill — no new design colors). Two CTAs: **"Open bulk editor"** (dismisses + opens modal) and **"Not now"** (just dismisses). Also a small X close button in the top-right of the banner. Dismissal is per-browser by design (matches the project's existing install-banner convention). State is initialised once at mount via `useState(() => localStorage.getItem(...))`; banner doesn't re-render based on a live query, so toggling peak OFF then ON does NOT revive a previously-dismissed banner — exactly the "one-time hint" semantics we want.
3. **Mounted `<BulkPeakPriceModal>`** below `CanteenItemFormModal`.

**Decisions captured during build:**
- **localStorage flag vs Dexie boolean** — chose localStorage. Owner doesn't need cross-device persistence for a one-time hint; the existing `pwa-install-banner-dismissed` pattern in the codebase uses the same convention.
- **Banner trigger: "first time toggle is ON + items exist" vs "until all items have peak prices"** — chose first-time only. The "nag until set" version would annoy clubs that intentionally only price *some* items at peak (the issue spec explicitly supports per-item opt-in via empty `peakPrice`). One-time hint, then the permanent button is right there.
- **Quick Add row in AddItemBottomSheet stays NOT peak-aware** — decision from Phase 3 carries over. Quick Add is a "use the price you just used" surface.
- **Peak pricing scope is canteen-only** — no session/rate-card flow ever sees this. Confirmed during Phase 3, restated here because Phase 4 closes the feature: there is no "peak hour table rate" follow-up implied.

**Edge cases verified in code:**
- Owner toggles peak ON → banner shows. Clicks "Open bulk editor" → modal opens, banner gone forever on this browser.
- Owner toggles peak ON → dismisses with X → toggles peak OFF → toggles peak ON again. Banner does NOT come back (localStorage flag persists).
- Owner has 0 canteen items, toggles peak ON. Banner does NOT show (gated on `items.length > 0`). Permanent button also hidden.
- Owner opens bulk editor with empty input on every row → "No changes to save" toast, modal closes.
- Owner enters a non-integer or out-of-range value → row turns red, error pill appears, Save blocked until fixed.
- Owner clears an input (empty string) → peak price for that row is wiped on save (`put()` without the key).
- Bulk save while peak is currently active → Canteen page card emphasis updates live via the existing 60s tick once Dexie change propagates.

Build clean (1032.81 kB, +6.16 kB over Phase 3). #68 feature-complete pending owner verification.

---

## 19 Jun 2026 — Peak Hour Pricing Phase 3: AddItem + QuickSale chips (#68) — pending SHA

Third slice of #68. POS surfaces now follow peak pricing — owner sees the peak ₹ + a `PEAK` tag on the chip during the window, and the session item / canteen sale is created at the peak price.

**`src/components/AddItemBottomSheet.tsx`** — `useSettings` subscription + `getPeakConfig` + a 60s tick that only registers when the sheet is open AND `peakPricingEnabled` (no overhead the rest of the time). `handleCanteenChipTap` now calls `getEffectivePrice(ci, peakNow, peakCfg)` instead of using `ci.defaultPrice` directly — same stock-decrement path, same transaction, just the captured price changes. Chip UI: when peak is active AND item has a `peakPrice`, the inline ₹ amount turns amber bold and a small `PEAK` pill appears next to it (matches the Canteen card amber accent — reuses `bg-paused/15 text-paused`). Out-of-stock state takes priority over peak styling. **Decision (owner-confirmed):** Quick Add chips (recent-items row) are NOT peak-aware — they keep their "use the price you just used" semantics. Only the master canteen list reflects peak. Manual freeform entry is also unchanged — owner types the price they want.

**`src/pages/QuickSale.tsx`** — same pattern: `getPeakConfig(settings)`, 60s tick gated on `peakCfg.enabled`. `addToCart` resolves `effectivePrice = getEffectivePrice(item, peakNow, peakCfg)` at tap time. **Cart line price is captured at first tap** — subsequent quantity bumps use the already-stored `existing.price`, so a cart built at 5:59 AM during peak doesn't flip back to regular when the clock crosses 6:00 AM mid-checkout. This matches what the owner saw on screen when they tapped Add — the captured price wins. `ItemCard` gains two props (`peakActive`, `effectivePrice`) so it doesn't recompute peak per render; main component decides once per tick. Card shows amber ₹ + `PEAK` pill when active. Cart row, sticky subtotal, and `PaymentSplitSheet` all read the cart's captured `price * quantity` — no further wiring needed because the entire downstream flow was already price-from-cart.

**What did NOT change (and intentionally so):**
- `createCanteenSale` and `runCanteenAddTransaction` — they take a `price` argument; we just pass a different value. Stock decrement, atomic tx, and the `paymentBreakdown` invariants are untouched.
- `PaymentSplitSheet` — sees the new total, no peak awareness needed.
- Session tier billing (`Session.rateSnapshot`) — peak pricing is canteen-only by design (#68 scope locks this in).
- The Quick Add chip row in `AddItemBottomSheet` and the manual freeform form — kept as last-used / owner-typed.

**Edge cases that work in code:**
- Peak toggle OFF → no chip styling, no PEAK tag, no tick, no price change. Identical to pre-#68 POS.
- Peak ON + item has no `peakPrice` → chip shows `defaultPrice`, no PEAK tag (just like before).
- Peak ON + inside window + item has `peakPrice` → chip shows peak ₹ + PEAK tag, line written at peak ₹.
- Peak ON + currently equals end-minute (`cur === e`) → counts as outside (helpers do `cur < e`), chip flips back to regular without a refresh.
- Cart built inside window then window ends → cart lines keep captured peak price (intentional — what owner confirmed on screen wins).
- Stock-tracked + out-of-stock → disabled state and copy unchanged, peak styling suppressed.

Phase 4 (bulk-edit modal + first-time onboarding banner) is the last remaining slice. #68 stays open.

Build clean (1026.65 kB, +1.29 kB over Phase 2). #68 still open.

---

## 19 Jun 2026 — Peak Hour Pricing Phase 2: Canteen card + form field (#68) — pending SHA

Second slice of #68. Adds the per-item Peak price input and the active-window UI on the Canteen page. Phase 3 (AddItem/QuickSale chips with `PEAK` tag) and Phase 4 (bulk-edit modal + onboarding banner) still pending — #68 stays open.

**`src/lib/peakPricing.ts`** — NEW. Exports `PeakConfig` interface, `getPeakConfig(settings)` (reads from `ClubSettings` with the v18 defaults — 22:00 → 06:00), `isInPeakWindow(now, cfg)` (cross-midnight aware; equals-start counts as inside, equals-end counts as outside), `getEffectivePrice(item, now, cfg)` (returns `peakPrice` only when peak active AND item has a positive `peakPrice`, else `defaultPrice`), `formatPeakWindow(cfg)` and `formatPeakEnd(cfg)` (12-hr AM/PM formatters). Returns `false` immediately when `cfg.enabled === false`, so callers can pass the helpers unconditionally without branching.

**`src/db/queries.ts`** — `addCanteenItem` previously whitelisted fields in its `.add()` call; added a conditional spread so `peakPrice` (when present) is persisted on creation. `updateCanteenItem` already passes `Partial<CanteenItem>` through, so no change there.

**`src/components/CanteenItemFormModal.tsx`** — added `peakPrice` state + validation + UI. Field is rendered **only when** `ClubSettings.peakPricingEnabled === true` (subscribed via `useLiveQuery(getSettings)`). Validation: empty input is allowed and means "no peak price for this item"; non-empty must be an integer 1–9999. Regular price label switches to "Regular price (₹)" when peak is on, "Price (₹)" otherwise. On save: `peakNum = peakPricingEnabled && peakPrice.trim() !== '' ? Number(peakPrice) : undefined`. Edit-mode patches `peakPrice` only when value differs from `item.peakPrice`. **Toggling peak OFF in Settings does NOT clear stored `peakPrice` values on existing items** — owner may toggle back on later; the stored value is just suppressed visually until peak is re-enabled.

**`src/pages/Canteen.tsx`** — three additions: (1) `PriceBlock` sub-component renders the stacked two-price layout per the agreed UI plan — outside peak (or item has no `peakPrice`) → single regular price line as before; inside peak → big amber `peakPrice` on top, small "Regular ₹X" beneath; outside peak with `peakPrice` set → regular price as before but tiny "Peak ₹X" hint underneath. (2) Header pill — when `peakActive`, renders `Peak · until 6:00 AM` to the right of the `Canteen` title using `bg-paused/15 text-paused` (reuses the existing amber `paused` token rather than adding a new design token — matches the "no new colors beyond a single amber accent" rule in the issue). (3) `useEffect` 60-second tick — only registered when `peakCfg.enabled`; sets `now` to `new Date()` so the header pill auto-disappears at window end and card emphasis swaps as the window opens/closes. No tick runs at all when peak pricing is off, so the OFF path stays zero-overhead.

**Edge cases verified in code:**
- Toggle OFF anywhere → no UI change on Canteen page (no pill, no second price line, no tick interval), no field in the form modal.
- Toggle ON + item has no `peakPrice` → regular price line as before, no second line, no PEAK hint.
- Toggle ON + inside cross-midnight window (e.g. 02:30 with 22:00→06:00) → header pill shows `until 6:00 AM`, items with `peakPrice` show peak as primary.
- Toggle ON + exactly equals start → counts as inside (`cur >= s`).
- Toggle ON + exactly equals end → counts as outside (`cur < e`).
- Pricing helpers do NOT mutate session/sale flows — Phase 3 (AddItem chip + QuickSale chip) is where peak price becomes the suggested default in checkout. Until Phase 3 ships, the per-item card shows the right price but POS still uses `defaultPrice`.

Build clean (1025.36 kB, mild bundle delta from added helpers). #68 stays open.

---

## 19 Jun 2026 — Peak Hour Pricing Phase 1: schema + Settings UI (#68) — pending SHA

First slice of #68 (FEAT-CANTEEN-PEAK). Foundation only — no Canteen UI yet, no AddItem chip changes, no bulk-edit modal. Owner explicitly wanted phased delivery so he can verify each piece on device before the next ships.

**Framing locked in design (carried into all future UI):** the feature is presented as neutral **time-based pricing** (the Uber/Swiggy/BookMyShow model). Never tied in UI copy to any specific product category. Justification text: *"Some items cost more during these hours due to higher demand and staffing."*

**`src/types/index.ts`** — added `CanteenItem.peakPrice?: number` (optional, undefined = item never uses peak pricing) and five optional `ClubSettings` fields: `peakPricingEnabled?: boolean` (master switch, undefined/false = off), `peakStartHour?: number` (0-23, default 22), `peakStartMinute?: number` (0-59, default 0), `peakEndHour?: number` (0-23, default 6), `peakEndMinute?: number` (0-59, default 0). Minute granularity included so owners can pick e.g. 22:30 → 03:15.

**`src/db/database.ts`** — bumped to **Dexie v18**. Additive only — no `.upgrade()` callback needed, no index changes (schema string identical to v17). All v18 fields are optional; legacy rows read undefined and fall back to the defaults at read time.

**`src/db/queries.ts`** — `CURRENT_SCHEMA_VERSION` bumped to 18. New `ClubKeeperBackupV18` interface; `ClubKeeperBackupV17` + `ClubKeeperBackupV16` aliased to it for forward compatibility (structural typing — V18 is a superset of V17 because no field shapes changed). `getAllDataForExport()` return type updated to `Promise<ClubKeeperBackupV18>`. **Import/export wiring needed zero further changes** — `importEverythingFromFile` calls `bulkAdd()` which preserves whatever optional fields are present in the JSON; `getAllDataForExport` dumps full table contents. Round-trip self-test counts rows only, not fields, so no edits there either. **Pattern D10 ripple is minimal for purely-additive optional fields** — only schema version bump + backup interface needed updating.

**`src/components/PeakWindowBottomSheet.tsx`** — NEW component. Standard bottom-sheet (matches `RestockSheet` / `PaymentBottomSheet` style — `fixed bottom-0`, slide-up, dim scrim). Start time + End time pickers: each is a pair of `<select>` dropdowns for hour (0-23 displayed as 12-hr AM/PM) and minute (5-minute steps). Live preview block shows `10:00 PM → 06:00 AM` + duration + a "crosses midnight" tag when the window wraps. Save button disabled when start equals end. Stays a bottom-sheet on all viewports per the canonical exclusion list (small picker sheets don't promote to centered desktop dialog).

**`src/pages/Settings.tsx`** — new collapsible section card `id="peak-pricing"`, slotted between Piggy (4.5) and Player Hub (4.6). Layout matches the **Compact** option from the agreed UI plan: toggle row at top + inline read-only row showing `Peak hours · 10:00 PM → 06:00 AM [Edit]`. Tapping `[Edit]` opens the bottom-sheet. The inline row + helper text only render when the toggle is ON — so a club that never enables peak pricing sees just the bare toggle, matching the "if OFF then UI is identical to today" principle. New `IconPeakPricing` (clock-with-hand glyph, 20×20, stroke-2, currentColor — same convention as other section icons). New `formatPeakTime12()` helper (kept local to Settings; promoted to `src/lib/peakPricing.ts` in Phase 2 when more callers appear).

**Phase 2 / 3 / 4 (deferred — separate commits):**
- Phase 2: `lib/peakPricing.ts` (`isInPeakWindow`, `getEffectivePrice`), per-item Peak price field in `CanteenItemFormModal`, two-price stacked layout on Canteen item cards, active-window header pill.
- Phase 3: `AddItemBottomSheet` + `QuickSale` TOD-aware chips with `PEAK` tag.
- Phase 4: bulk-edit modal + first-time onboarding banner.

Build clean. #68 stays open.

---

## 19 Jun 2026 — Desktop responsiveness Phase 2.5: QuickSale + PaymentSplitSheet (#91) — pending SHA

Owner ran `/quick-sale` on his laptop after Phase 2 and reported the page was still broken — items stretched edge-to-edge with the qty stepper floating ~1900px from the item name (screenshot 341), and `PaymentSplitSheet` opened as an edge-to-edge full-screen sheet with the cash/UPI/wallet `−` and `+` buttons pinned to far sides (screenshot 342). QuickSale wasn't touched in Phase 2; PaymentSplitSheet is its own bottom-sheet (not the shared `<Modal>`) so it didn't inherit the Phase 2 desktop-dialog cap. This phase patches both.

**`src/pages/QuickSale.tsx`** — added an inner `<div className="w-full max-w-[1400px] mx-auto">` wrapper around header, items grid, cart, and empty-cart hint. The page's outer `<div className="bg-bg min-h-screen flex flex-col">` is preserved so the body still owns full-height + scrim coverage. **Items grid** went from `space-y-2` to `space-y-2 md:space-y-0 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-2`. **Cart strip** got the same treatment so cart rows stack 1 col on mobile and 2/3 col on desktop (`space-y-2 md:space-y-0 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-2`). **Sticky bottom bar** — the `fixed bottom-0 left-0 right-0` band still spans the full viewport (visual weight + scrim across the bottom), but its **inner content** is wrapped in `<div className="w-full max-w-[1400px] mx-auto px-5">` so Subtotal + Continue button align with the items list above instead of being pinned to the screen edges. `px-5` removed from the outer band and moved inside the cap to keep the band edge-to-edge.

**`src/components/PaymentSplitSheet.tsx`** — sheet at line 169 (main payment sheet) and line 477 (inner customer-link picker) both gained the same `md:` desktop-dialog class set used by shared `<Modal>` in Phase 2: `md:bottom-auto md:left-1/2 md:top-1/2 md:right-auto md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-3xl md:border`. Main sheet caps at `md:w-[min(560px,calc(100vw-2rem))] md:max-h-[85vh]`; customer-link picker caps at `md:w-[min(520px,calc(100vw-2rem))] md:max-h-[75vh]` (slightly narrower because it's a focused pick action). Mobile (<768px) unchanged — both still slide up from `bottom-0` as bottom sheets. The earlier Shared UI invariant in ripple_effects.md ("PaymentBottomSheet, PaymentSplitSheet, RestockSheet keep their bottom-sheet behaviour on every viewport") needed amending — **PaymentSplitSheet now follows the centered-dialog rule on desktop** while keeping bottom-sheet on mobile. RestockSheet and PaymentBottomSheet are not updated in this phase.

**Decision note carried in skill:** the items/cart grid breakpoint cascade (`md:grid-cols-2 lg:grid-cols-3`) is now used by **four** pages — Tables, Canteen, Bookings, QuickSale. Treat this as the de-facto card-grid pattern for #91 going forward (Settings + Wallet topup will likely use the same).

Build clean (1071.29 kB, +0.71 kB over Phase 2). #91 stays open.

---

## 19 Jun 2026 — Desktop responsiveness Phase 2: Canteen + shared Modal width cap + Bookings (#91) — commit 793dde0

Second batch of #91. Three coordinated changes:

**1. `src/pages/Canteen.tsx`** — content wrapped in `max-w-[1400px] mx-auto px-5` (the outer wrapper replaces the page's old `<div className="px-5">`; `px-5` stays so card padding doesn't shift on mobile). Item list grid is now `space-y-3 md:space-y-0 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-3` (1/2/3 cols across mobile/tablet/laptop) — same breakpoint pattern as Tables. FAB and `<CanteenItemFormModal>` / `<RestockSheet>` / delete-confirm `<Modal>` all stay OUTSIDE the wrapper so they viewport-anchor on desktop. `RestockSheet` is its own component (not the shared `<Modal>`), so the cap below does NOT apply to it.

**2. `src/components/Modal.tsx`** — shared `<Modal>` no longer renders as a full-width bottom sheet on desktop. On mobile (<768px) the layout is unchanged (`fixed bottom-0 left-0 right-0`, slide-up-from-bottom feel). At `md:` and up, it becomes a centered dialog: `md:bottom-auto md:left-1/2 md:top-1/2 md:right-auto md:-translate-x-1/2 md:-translate-y-1/2 md:w-[min(560px,calc(100vw-2rem))] md:rounded-3xl md:border md:max-h-[85vh]`. **This affects every `<Modal>` consumer in the app at once** — Canteen Add/delete-confirm, TableFormModal, SessionDetail (stop confirm, edit start, edit notify, move table), Settings (clear/reset/cancel-subscription/clean-names), Home orphaned-sessions, BackEntryModal, etc. Bottom-sheet components that DON'T use the shared `<Modal>` (`RestockSheet`, `PaymentSplitSheet`, `PaymentBottomSheet`) keep their bottom-sheet behavior on every viewport — they own their own translateY/positioning and are explicitly excluded per ripple_effects.md Shared UI section.

**3. `src/pages/Bookings.tsx`** — container went from `max-w-md mx-auto px-4` (448px hard cap → "phone column on a laptop", per screenshot 340) to `max-w-[1400px] mx-auto px-4`. The agenda block was a single `flex flex-col gap-4` stack; it's now `flex flex-col gap-4 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-4` so the 7-day window fits in 3 rows × 3 cols (3+3+1) on laptop instead of stacking forever. PendingBookingsModal stays outside the wrapper (and benefits from the shared-Modal desktop cap above).

**Why bundled as one commit:** the shared-Modal change is what makes the Canteen Add modal feel right on desktop — fixing Canteen page alone wouldn't have closed the loop. Bookings was the same fundamental bug (an explicit `max-w-md` hard cap), so worth shipping together while the desktop-responsiveness model is fresh.

**Sizing rule stays locked from Phase 1:**
- Container `max-w-[1400px] mx-auto`
- Item/agenda grid `md:grid-cols-2 lg:grid-cols-3`
- FAB + modals always OUTSIDE the centered wrapper

**Remaining under #91:**
- Settings (`/settings`) — collapsible-section layout, likely the trickiest (full-width form fields for a 7-digit UPI ID look absurd on desktop)
- Wallet topup success screen — 3 stretched buttons per screenshot 334

Build clean (1070.58 kB, +0.05 kB over Phase 1). #91 stays open until owner verifies Phase 1 + Phase 2 on real device (laptop + phone) AND the remaining 2 pages ship.

---

## 18 Jun 2026 — Desktop / laptop responsiveness, Phase 1: Tables page (#91) — commit f50942a

First page of the desktop-responsiveness initiative. Driven by paying-customer feedback that on a 1920px laptop screen, ClubKeeper looked like a mobile layout stretched edge-to-edge — table rows spanning full width, "FREE" pills floating ~1500px from the table name, two Settings entry points on Tables (top-right gear AND bottom-nav). All five reported pages (Tables, Bookings, Settings, Wallet topup success, Canteen + canteen-add modal) tracked under one parent issue #91; this commit ships Phase 1 only.

**Changes (Tables / Home only):**
- `src/components/TopBar.tsx` — removed the top-right Settings gear (old lines 103-117). Right cluster on Tables was crowded: 3 icons + Quick Sale pill on a 360px screen. Settings is now reachable ONLY via the bottom-nav Settings tab. **Hard rule going forward (recorded in ripple_effects.md):** do not re-add a gear to TopBar.
- `src/pages/Home.tsx` — wrapped install banner, orphaned banner, TopBar / SummaryStrip / FilterPills, `SubscriptionStatusBanner`, and the table grid in `<div className="max-w-[1400px] mx-auto">`. Mobile (<768px) is untouched — the wrapper is wider than the viewport so layout is identical. On laptop (≥1024px), content fills ~1400px centered with ~260px black on each side of a 1920px screen (down from ~900px each side at the v1 `max-w-5xl` width that Sugeet rejected).
- Table grid is now responsive via Tailwind breakpoints: `space-y-3 md:space-y-0 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-3`. 1 col mobile / 2 col tablet / 3 col laptop. `TableCard` is width-agnostic — no card-side changes needed.
- FAB stays OUTSIDE the wrapper so it anchors to viewport, not container right edge. If it were inside, on desktop it would float in the middle of the screen where the container ends.

**Sizing decision history (locked in #91):**
- v1: `max-w-5xl` (1024px) — Sugeet rejected: "most of the space is empty". On a 1920px screen this left ~900px of black on each side, still feeling like a "centered phone column".
- v2 (shipped): `max-w-[1400px]` + 3-col grid. ~70% screen usage on laptop. Sugeet approved.
- Rejected alternatives offered but not picked: full-width 4-col grid (risk of tiny cards depending on count), left sidebar nav (bigger structural change — BottomNav would have to hide on desktop).

**Remaining pages (Phase 2 onward, tracked under #91):**
- Bookings (`/bookings`) — most-broken on desktop per owner ("phone window centered on laptop")
- Settings (`/settings`)
- Wallet topup success screen
- Canteen (`/canteen`) + Add canteen item modal

Build clean (1013.84 kB, +2.7 kB). #91 stays open until owner verifies all 5 pages on his laptop AND on phone (mobile regression check). Phase 1 commit message: `ui(tables): desktop responsiveness — remove duplicate gear + 3-col grid (#91 — partial, pending owner verification)`.

---

## 18 Jun 2026 — Three-bug bundle: pending modal loading state + booked slot UI + ship P1e-2 to prod (#88, #89, #90) — commit bc49c59

- **#88** PendingTopupsModal + PendingBookingsModal now show a spinner ("Loading pending…") whenever `intents.length === 0 && pendingCount > 0`. Eliminates the window where toast-View → modal-tap showed a misleading "No pending" empty state while the page's `[dbReady, session]` effect was still fetching `pendingIntents`. Owner perceived this as "modal not clickable" because tapping the pill again was a no-op (modal was already open over an empty list).
- **#90** Booked slot visibility in `/c/<slug>/book`. New migration `supabase/migrations/20260619_booked_slots_rpc.sql` (⚠ pending manual run) — anon-readable `get_booked_slots(slug, table_id, day_start, day_end)` returning overlapping pending+confirmed windows. New `getBookedSlots()` in `playerHubApi.ts` with pre-migration fallback (returns []). BookingScreen.tsx fetches on (table, date) selection; time-step disables overlapping 30-min slots with "Booked" caption; duration-step caps to next booked start with "Overlaps next booking" badge + empty-cap fallback message.
- **#89** Local-only diff (P1e-2 + a few P1e-1 follow-ups) had never been pushed; production was running P1e-1 and lacked booking realtime UPDATE handler / cancel reconcile path. This commit bundles everything so a single Vercel deploy fixes prod.

⚠ Migrations still pending manual run: `20260618_booking_cancel.sql`, `20260619_booked_slots_rpc.sql`.

Build: 1014.31 kB (+2 kB).

---

## 18 Jun 2026 — Phase 1 advance booking — P1e-2: Player cancel + no-show sweep (#84)

Cancellation half shipped — completes Phase 1 of #84 modulo owner verification. **New SQL migration** `supabase/migrations/20260618_booking_cancel.sql` (⚠ pending manual run) — single SECURITY DEFINER RPC `cancel_booking_intent(p_intent_id, p_player_phone)`. Authorization is by phone match (player has no Supabase auth) — phone mismatch surfaces as `not_found` (don't leak which check failed). Server-side window check: `now() < slot_start − interval '2 hours'` else `raise exception 'too_late'`. Status guard: must be `'confirmed'` else `'invalid_status'`. Anon + authenticated execute granted; no separate Vercel function (mirrors confirm/reject pattern). **playerHubApi:** `cancelBookingIntent({intentId, playerPhone})` via `supabasePublic` + `withTimeout(8000)`; typed errors `not_found | invalid_status | too_late` mapped at the call boundary. **BookingScreen.tsx player cancel:** new `cancelling` + `cancelled` PageStates. `canCancel` derived = `slotStartMs !== null && now < slotStart − 2h`; Cancel button visible only when true. On click: optimistic state → call RPC → success transitions to `cancelled` screen ("Your advance of ₹X has been refunded to your wallet at the club"). `too_late` race surfaces inline as "Too late to cancel — please contact the club directly" (Pattern F7, no toast). Inside the 2h cutoff the button is replaced with a static "Cancellation closes 2 hours before slot. Contact the club to cancel late." line. Cancelled screen exposes "Back" to `/c/<slug>`. **realtimeBookings.ts:** UPDATE listener now surfaces a `BookingUpdateEvent {intentId, oldStatus, newStatus}` to the consumer in addition to decrementing the pending count. Single channel re-used (no second channel for cancel events). **BookingRealtimeBridge.tsx:** new `handleUpdate` callback. When `oldStatus === 'confirmed' && newStatus === 'cancelled'` → fires `reconcileCancelledBooking(intentId)` and (unless owner is on `/bookings`) shows a toast "Booking cancelled — advance refunded to wallet" with Review action → `/bookings`. **queries.ts:** `reconcileCancelledBooking(bookingId)` — single flat tx (Pattern D7) that (a) marks Dexie `booking.status = 'cancelled'`, (b) lookup-or-creates customer by `playerPhone` (mirrors `linkBookingToSession` behavior), (c) writes `WalletTransaction(type='credit', referenceType='booking_advance', referenceId=bookingId)` for the full `advanceAmount` and bumps `customer.walletBalance`. **Idempotent under realtime replay:** if booking is already `'cancelled'` AND a credit row with this `referenceId` + `referenceType='booking_advance'` already exists, the function early-exits. Booking row missing from Dexie (e.g. cancel arrived before confirm hydrated locally) → silent noop, never throws. **No-show auto-expire:** `applyNoShowSweep(now)` in queries.ts scans `db.bookings.where('status').equals('confirmed')`, filters in JS for `consumedSessionId === undefined && slotEnd + 30 min < now`, marks each `'no_show'` in a single flat tx. **No wallet credit** — advance forfeit per skill cancellation-window policy (player who books and ghosts loses the deposit; club retains it as agreed). Returns count. **App.tsx ExpirySweepRunner extended:** after `applyExpirySweep()`, also calls `applyNoShowSweep()` — same gates (`dbReady + session + subscriptionLoaded + !isPlayerHubRoute`), same 4h cadence (piggybacks on the same `lastExpirySweep` sessionStorage anchor). Console logs `[booking] marked N no-show booking(s)` when > 0.

Build clean (1011.61 kB, +4.47 kB vs P1e-1). Phase 1 of #84 is **code-complete**; #84 stays open until Sugeet verifies all of P1c/P1d/P1e-1/P1e-2 end-to-end on device.

---

## 17 Jun 2026 — Phase 1 advance booking — P1e-1: Session linkage + prepaid advance (#84)

Owner-side session linkage + advance-as-prepaid wired. **`linkBookingToSession(bookingId, sessionId)`** in `queries.ts` — single flat tx (Pattern D7) marks `booking.status = 'consumed'` + sets `consumedSessionId`, AND lookup-or-creates the customer by `playerPhone` so PaymentSplitSheet can attach them. Throws `BookingAlreadyConsumedError` on race. **`creditBookingAdvanceRemainder({customerId, amount, bookingId})`** — flat tx that bumps `customer.walletBalance` + writes a `WalletTransaction(type='credit', referenceType='booking_advance', referenceId=bookingId)`. Used by SessionDetail at payment confirm. **`getLinkableBookingsForTable(tableId, now, ±30min)`** + **`getUpcomingBookingsForTable(tableId, now, +90min)`** — both use the `[tableId+slotStart]` compound index for cheap range scans. **New WalletReferenceType `'booking_advance'`** (additive — same pattern as 'coin_expiry' etc.). **StartSession.tsx:** on mount, queries both linkable + upcoming bookings. If any linkable → modal opens automatically ("Booking found for this table") with Link / Skip per-row. Linked booking shows as accent pill above the form with player + slot details; staff can Unlink. Walk-in conflict banner (paused color) renders when `!linkedBooking && upcomingBookings.length > 0` — warn-only, never blocks. On Submit, after `startSession` returns the new id, `linkBookingToSession` runs in the same step; `BookingAlreadyConsumedError` is swallowed with a console warn (session still navigates — never strand the staff). **PaymentSplitSheet.tsx:** new optional prop `prepaidAdvance?: number`. When > 0: header shows "Collect ₹X" instead of "Total ₹X" + subline "Total ₹Y − advance ₹Z" with "+₹W to wallet" line when advance > total. `collectionTarget = max(0, total − prepaidAdvance)` drives the canConfirm boolean and quick-fill chips. **SessionDetail.tsx:** `useLiveQuery` over `db.bookings.where('status').equals('consumed').filter(b.consumedSessionId === sid)` (Pattern T4 — DB-static deps) exposes `linkedBooking`. An effect auto-links the matching customer by phone (so wallet + name pre-fill before the sheet opens). At confirm time: if a linked booking is present + customer linked, the **entire `prepaidAdvance` is credited to the customer's wallet first** (one ledger row, `referenceType='booking_advance'`), then `breakdown.wallet` is bumped by `consumed = min(grandTotal, prepaidAdvance)` before calling `confirmPaymentAndStop`. Net effect: surplus stays in wallet; consumed portion flows through the standard wallet leg → existing P1 invariant `cash+upi+wallet === grandTotal` continues to hold (zero changes to `recordSessionPaymentBreakdown` or `confirmPaymentAndStop`).

Build clean (1007.14 kB, +5.86 kB vs P1d). Deferred to P1e-2 (next session): player cancel button + `cancel_booking_intent` RPC migration + no-show auto-expire sweep + cancellation refund.

---

## 17 Jun 2026 — Phase 1 advance booking — P1d: Owner inbox + badge + /bookings (#84)

Owner-side surfaces live. **New components:** `BookingRealtimeBridge.tsx` (clone of `TopupRealtimeBridge` — channel `booking_intents_{clubId}` + same Pattern A6/A7/A8 guards; **also gated on `club.acceptsBookings`** so we don't burn a realtime slot for clubs that haven't opted in; mounts in `App.tsx` alongside `TopupRealtimeBridge`), `PendingBookingsModal.tsx` (clone of `PendingTopupsModal` — per-row Confirm/Reject buttons). **Confirm path:** `confirmBookingIntent` (Supabase first per D-2026-06-11 / Pattern R2, returns server ISO timestamp) → `db.bookings.add(booking)` with `id = intent.id` carried verbatim, idempotency via Dexie ConstraintError swallow on retry, `confirmedAt` uses the SAME ISO from Supabase (no clock-skew drift). **Reject path:** Supabase-only status update, nothing written to Dexie (hybrid postbox boundary held). **New page `/bookings`** (`src/pages/Bookings.tsx`) — private route behind `RequireAccess`. Per-day agenda for the next 7 days, each day a card with all bookings sorted by `slotStart`. Pattern T4 compliant — `useLiveQuery` on `db.bookings.where('slotStart').between(windowStart, windowEnd)` is DB-static (no `Date.now()` in deps); status badges (`Upcoming` / `Now` / `Played` / `Missed` / `Cancelled`) computed in render body from current `Date.now()`. Pending count pill in the header opens `PendingBookingsModal`. Empty-state when `acceptsBookings=false` points to settings. **TopBar second badge:** new "calendar" icon between online dot and canteen, gated on `settings.slug && settings.acceptsBookings`, sky-400 dot when `usePendingBookingCount > 0` (vs the amber dot on the wallet icon — visually distinct). **PlayerHubSettings.tsx:** new "Accept bookings" toggle (Supabase-first via `syncBookingConfigBySlug`, mirrors topup pattern) + "Advance per booking" numeric input (0–10000, onBlur commits Supabase+Dexie in that order, inline `setError` on invalid input — Pattern F7). On mount the single `getOwnerClub()` call now hydrates both topups AND bookings state (one round-trip serves both, guarded by separate `topupsLoaded`/`bookingsLoaded` flags). Local Dexie mirror lazily backfills `acceptsBookings`/`bookingAdvanceAmount` if undefined locally but defined remotely. **App.tsx:** `<BookingRealtimeBridge />` mounted at the app shell next to `<TopupRealtimeBridge />`; `/bookings` route registered. Build clean (1001.28 kB, +16 kB vs P1c). No session linkage / no cancellation yet — that's P1e.

---

## 17 Jun 2026 — Phase 1 advance booking — P1c: Player BookingScreen (#84)

Player-facing booking flow shipped. **New route** `/c/:clubSlug/book` (`src/pages/player/BookingScreen.tsx`) registered in `App.tsx` under the existing `/c/` public-route prefix (no AuthInitializer / Bridge skip changes needed — covered by `startsWith('/c/')`). **PlayerScan CTA:** "📅 Book a table" button rendered below the topup submit, gated on `clubInfo.acceptsBookings === true` AND at least one mirrored table has `typeof t.id === 'number'` (defensive read — without ids the booking flow is unsafe). **Wizard:** 6-step state machine (`gameType → table → date → time → duration → summary`), back-navigable. Times in 30-min steps within `[8:00, 24:00)` window (no club-hours feature added — sane defaults; revisit if customers request club hours). For TODAY, past steps hidden via `ms > Date.now()` filter; for future days, full window. Durations come from `t.rateCard` tier minutes when present, fallback `[30,60,90,120]` priced off `ratePerHour` (`round(ratePerHour * min / 60)`). Tier price + advance shown explicitly. Phone validation matches topup (`/^[6-9]\d{9}$/`). **Submit:** `submitBookingIntent` → typed error mapping (`slot_in_past` / `slot_taken` → return to time step with inline `errorMsg`; `rate_limited` → phone-field inline). **Payment UX:** verbatim clone of PlayerScan — UPI deep-link button + collapsible `<UpiQrCard>` for second-device scan + 8s delay before "I've paid" enables + 3s poll of `getBookingIntentStatus` + 10-min hard expire. UPI note prefix is `BOOK-` (vs `CK-` on topup) so owner can distinguish. **Confirmation screen:** table, full date, start–end time, duration, advance paid, reference code, name + masked phone — labelled "Show this to staff when you arrive." `rejected` → "Sorry, the club couldn't confirm this slot." `expired` → Try again resets to summary step.

**Self-heal — one-shot `tables_json` re-mirror (Part A):** `PlayerHubSettings.tsx` mount-effect, when `settings.slug` exists, fires `getAllTables() → syncTablesJsonBySlug(slug, tables)` once per session (guarded by `sessionStorage` key `ck_tables_json_id_backfill_v17_<slug>`). Phase 0 mirrored `tables_json` rows WITHOUT a per-table `id` — P1b added the field, P1c needs it for the player BookingScreen round-trip. Without this self-heal, existing clubs would have to manually re-save every table. Console log `[backfill] re-mirrored tables_json with ids` confirms the run. Idempotent UPDATE (slug-targeted, Pattern P2). On player side, `BookingScreen` skips tables missing `id` with `console.warn('[booking] N table(s) skipped — missing id ...')`; if ZERO tables have ids → "Booking is being set up. Check back shortly." Time math uses Unix ms throughout (Pattern T1); ISO conversion only at the Supabase RPC boundary (timestamptz column). Build clean (985.08 kB, +22 kB vs P1b). No owner UI yet — that's P1d. NO session linkage or cancellation yet — that's P1e.

---

## 17 Jun 2026 — Phase 1 advance booking — P1b: Dexie v17 + API layer + realtime + inbox (#84)

Owner-side scaffolding for advance booking — no UI yet, no user-visible change. **Dexie v17:** new `bookings` store `'id, tableId, slotStart, status, [tableId+slotStart]'` (additive, no `.upgrade()`). New `Booking` interface in `src/types/booking.ts` — `id` is the carried-over Supabase intent UUID, `slotStart/slotEnd` are Unix ms (Pattern T1), status union is `'confirmed'|'consumed'|'no_show'|'cancelled'` — NO `pending` (lives only in Supabase). `ClubSettings` gains optional `acceptsBookings?` + `bookingAdvanceAmount?`. **Export/Import:** `CURRENT_SCHEMA_VERSION = 17`, new `ClubKeeperBackupV17` (V16 kept as alias for back-compat), `getAllDataForExport` includes `bookings`, `importEverythingFromFile` adds bookings to the clear+bulkAdd loop and to `ImportSuccess.counts` (Settings success overlay updated), pre-v17 backups import cleanly (bookings defaults to `[]`). `resetEverything` and round-trip self-test (`importExportRoundTrip.ts`) extended with bookings (Pattern D10). **playerHubApi:** `getClubPublicInfo` + `getOwnerClub` now return `acceptsBookings + bookingAdvanceAmount` with safe defaults (`false`/`100`) for pre-migration RPC versions; `submitBookingIntent` / `getBookingIntentStatus` (public, `supabasePublic`, `withTimeout`); `getPendingBookings` / `confirmBookingIntent` (returns the ISO `confirmed_at` so the Dexie row uses the SAME timestamp as Supabase, avoiding clock skew) / `rejectBookingIntent` (owner, RLS-scoped, per D-2026-06-11); `syncBookingConfigBySlug` (fire-and-forget, slug-targeted — Pattern P2, with `.select('id')` + warn-on-empty). `syncTablesJsonBySlug` now includes `id` in the public projection so player BookingScreen can round-trip the table identifier back via `submit_booking_intent`. `PublicTableInfo.id?` added as optional (back-compat with rows mirrored pre-booking). **Realtime + inbox:** `src/lib/realtimeBookings.ts` (clones `realtimeTopups.ts` for `booking_intents_{clubId}` channel + 5s→30s polling fallback) — **FIXES the known fallback-timer leak**: cancels both the init `setTimeout` and any running `setInterval` the moment channel reports `SUBSCRIBED`. `src/store/bookingInbox.ts` (Zustand clone of `topupInbox.ts` — `pendingCount`, modal open/close, `usePendingBookingCount` selector). Build clean (963.27 kB, +0.30 kB). No UI surface yet — P1c/P1d will wire it.

---

## 17 Jun 2026 — Phase 1 advance booking — P1a: Supabase migration (#84)

`supabase/migrations/20260617_booking_intents.sql` written (⚠ pending manual run). Phase 1 of issue #84 begins: player advance booking on `/c/<slug>`. Hybrid architecture — Supabase `booking_intents` is a transient postbox (<=24h, lazy cleanup inside `submit_booking_intent`); owner's Dexie `bookings` store (v17, coming P1b) is the permanent record. Mirrors the topup_intents pattern exactly. `clubs` row extended with `accepts_bookings boolean default false` + `booking_advance_amount int default 100` (range 0–10000). `get_club_public_info` RPC dropped+recreated to expose both new fields (drop required — `CREATE OR REPLACE` can't change OUT params). Two new SECURITY DEFINER RPCs: `submit_booking_intent` (anon → validated → conflict-checked → lazy-cleanup → insert; raises `club_not_found | bookings_disabled | slot_in_past | slot_taken | rate_limited`) and `get_booking_intent_status` (player polls). RLS mirrors `topup_intents_owner_select|update`. Realtime publication + `replica identity full` added for `booking_intents` (Pattern S6). No app code changed in P1a.

---

## 16 Jun 2026 — Supabase keep-alive GitHub Action

Added `.github/workflows/supabase-keepalive.yml` — daily cron (06:00 UTC / ~11:30 IST) pings the Supabase REST endpoint with the anon key so the free-tier project never trips the 7-day inactivity pause that would dead-end the live topup/pricing QR at `app.handbookhq.in/c/<slug>`.

---

## 16 Jun 2026 — Phase 0 shipped to production (#84)

Pushed 83359b0 + bffac35 to `main`; Vercel auto-deployed to app.handbookhq.in. Owner verified on localhost first — pricing card renders correctly on `/c/star-club` with tables grouped by game type, all rates showing. Production verified after PWA service-worker refresh.

**Lesson (new Workflow/Deploy pattern):** During the Phase 0 follow-up I spent a full diagnostic round chasing a "tables_json stays []" bug that wasn't actually a bug — `bffac35` had never been pushed, so production was running the pre-fix code while localhost ran the fix. Localhost and prod share the same Supabase project, so the prod DB looked broken even though the code was correct. New Pattern W1 in bug_patterns.md captures this. Rule: before debugging a "feature works locally but not on prod" report, FIRST confirm (a) the commit is pushed, (b) Vercel deploy finished, (c) the PWA service worker on the production tab has updated to the new bundle hash.

---

## 16 Jun 2026 — Fix: tables_json mirror never landed (Phase 0 follow-up, #84)

**Bug:** Post-Phase-0 ship, `clubs.tables_json` stayed `[]` on every club row even after the owner edited and saved tables. Migration was applied, `accepts_pricing_display` and `coin_tiers_json` populated correctly, so RLS + columns were fine — `syncCoinConfig` (which targets by slug) worked; my new `syncTablesJson` did not.

**Root cause:** The mirror call went `Dexie write → getOwnerClub() → .eq('id', club.id)`. `getOwnerClub` does `.from('clubs').select(...).maybeSingle()` with no filter and relies on RLS. Any transient null-return (auth refresh window, brief session loss, RLS deny) made `mirrorTablesToSupabase` exit early on `if (!club) return` — the catch swallowed even that signal. The `.eq('id', clubId)` path also adds an extra round-trip + one more silent failure surface compared to the proven `syncCoinConfig` pattern. New Pattern P2 (Player-Hub).

**Fix:**
- `src/lib/playerHubApi.ts` — renamed `syncTablesJson(clubId, tables)` → `syncTablesJsonBySlug(slug, tables)`. Targets by slug, matching `syncCoinConfig` exactly. Adds `.select('id')` and a `data.length === 0` warning so a future RLS / slug-mismatch silently matching 0 rows surfaces in DevTools instead of staying invisible.
- `src/components/TableFormModal.tsx` — `mirrorTablesToSupabase` no longer calls `getOwnerClub`. Reads `settings.slug` from Dexie → calls `syncTablesJsonBySlug(slug, allTables)` directly. `console.warn` on every early-exit branch so the "swallowed and ignored" failure mode is gone.

Build clean (962.13 kB, +0.30 kB).

Closes #84 — pending owner verification (round 2).

---

## 16 Jun 2026 — Pricing visibility on Player Hub (Phase 0, #84)

**Feature:** Players scanning `/c/<slug>` can now tap "View pricing" to see every active table's rates before they walk in or top up. Pure read feature. No new Dexie schema, no new Supabase tables.

**Migration (run manually):** `supabase/migrations/20260616_pricing_visibility.sql`
- `alter table public.clubs add column tables_json jsonb default '[]'::jsonb`
- `alter table public.clubs add column accepts_pricing_display boolean default true`
- Drops + recreates `get_club_public_info(p_slug text)` to return `(club_name, upi_id, accepts_topups, coins_enabled, coin_tiers_json, tables_json, accepts_pricing_display)`. All existing fields preserved. SECURITY DEFINER. Anon access via the existing RPC grant — no direct table grant needed.

**Code:**
- `src/types/playerHub.ts` — new `PublicTableInfo` interface (name, gameType, ratePerHour, ratePerFrame?, rateCard?, toleranceMinutes?, rateCardBilling?). `ClubPublicInfo` extended with `tablesJson` + `acceptsPricingDisplay`.
- `src/lib/playerHubApi.ts` — `getClubPublicInfo` reads new RPC fields with safe fallbacks (`?? []` / `?? true`) so the page does not crash on a club row predating the migration. `syncTablesJson(clubId, tables)` fire-and-forget owner-side write — projects only public-safe fields, filters `outOfService`, swallows errors. Mirrors `syncCoinConfig` pattern (Decision D-PlayerHub-1).
- `src/components/TableFormModal.tsx` — new `mirrorTablesToSupabase()` helper. Called after every Dexie write in `handleSave`, `handleDisable`, `handleEnable`. Skipped silently when `settings.slug` is absent (Player Hub not set up).
- `src/pages/player/PlayerScan.tsx` — new `PricingCard` + `PricingRow` components. Collapsible (default closed), grouped by gameType. RateCard tables show tier grid (`30 min ₹70 · 60 min ₹100 · …`) + `N min grace at every tier`. Non-rateCard tables show `₹X/hr` (and `₹Y/frame` when present). Hidden entirely when `tablesJson` is empty OR `acceptsPricingDisplay === false` — no empty state shown to players. Dark theme tokens only (`bg-bg-card`, `border-border`, `text-text`, `text-text-dim`, `text-text-faint`). Touch target ≥44px.

**Build clean** (961.83 kB, +2.96 kB).

**Pending:** Run `20260616_pricing_visibility.sql` manually in the Supabase SQL editor. Until then, the RPC returns only the old 5 columns; PlayerScan still works (safe fallback hides the card), but no owner sync mirrors to Supabase even if owners are saving tables.

Closes #84 — pending owner verification.

---

## 15 Jun 2026 — Fix: Player confirmation screen shows correct welcome-bonus coin total (#87, Option 1)

**Bug:** New-customer first top-up of ₹1000 — owner side credited 200 coins (150 tier + 50 welcome) correctly, but the player's phone showed '+150 ClubCoins credited' — welcome bonus missing from display only. Pattern P1.

**Fix (server-authoritative — Option 1 on the issue):**
- `supabase/migrations/20260615_topup_intents_coins_credited.sql` — adds nullable `coins_credited int` column to `public.topup_intents`. Drops + recreates `get_topup_intent_status(uuid)` to return `(status, reject_reason, coins_credited)` — Postgres can't change OUT parameters via CREATE OR REPLACE. Applied via `mcp__supabase__apply_migration`. Anon grant preserved.
- `src/lib/playerHubApi.ts` — `getTopupIntentStatus` return type extended with `coinsCredited: number | null`.
- `src/components/PendingTopupsModal.tsx` `handleConfirm` — captures `{coinsEarned, welcomeCoinsEarned}` from `recordTopupWithCoins`, sums to `coinsCredited`, includes it in the same Supabase UPDATE that flips status to `confirmed`. Null in the idempotency 'already credited' branch (player already saw original confirmation).
- `src/pages/player/PlayerScan.tsx` — polling effect captures `result.coinsCredited` into new `confirmedCoins` state. Confirmed-screen render uses `confirmedCoins ?? coinsEarnedForTopup(...)` — server value when present, local tier-only fallback for legacy intents confirmed before this fix.
- Form-screen preview chip rephrased as a lower bound: 'earn at least N ClubCoins on this top-up' + subtitle '+ welcome bonus if this is your first top-up here'. Player browser can't know if it's first (no access to owner-side `Customer.firstTopupAt`), so we stop lying instead of overpromising.

Build clean (958.60 kB, +0.38 kB).

Closes #87 — pending owner verification.

---

---

## 15 Jun 2026 — Fix: Enable Supabase realtime publication + replica identity (#85)

**Bug:** Even after the TopupRealtimeBridge fix, owners still got no live notification on new top-ups. Hard refresh was required. Reported during E2E test.

**Root cause:** Supabase realtime only delivers `postgres_changes` events for tables that are members of the `supabase_realtime` publication. Confirmed via MCP that the publication was empty — `topup_intents` was never added. Additionally, REPLICA IDENTITY was default (`'d'`) on both `topup_intents` and `clubs`, so UPDATE events only carried the primary key in `payload.old` — breaking the bridge's `oldStatus === 'pending' && newStatus !== 'pending'` decrement guard. New Pattern S6.

**Fix:**
- `supabase/migrations/20260615_enable_realtime.sql` (NEW) — adds both tables to the publication + sets REPLICA IDENTITY FULL. Applied to production via `mcp__supabase__apply_migration`.
- Verified: `pg_publication_tables` now lists both. `pg_class.relreplident = 'f'` on both.

No code change required — the bridge was correct all along; the DB just wasn't broadcasting.

Closes #85 — pending owner verification.

---

## 15 Jun 2026 — Fix: PendingTopupsModal 'Confirm received' stuck on 'Loading…' for new players (#86)

**Bug:** When a top-up came from a phone not yet in Dexie `customers`, the Confirm row's button showed 'Loading…' forever and was disabled. Existing-customer top-ups worked fine. Owner couldn't accept new-player top-ups at all.

**Root cause:** `src/components/PendingTopupsModal.tsx` used `useLiveQuery(...).first()` to detect "is this a new customer". Dexie's `.first()` returns `Customer | undefined`. It never returns `null`. The code comment claimed `null === loaded + not found` but that's never true. For new phones, the live query stayed `undefined` forever (loading semantics conflated with not-found semantics) → `customerLoaded` stuck at `false` → button frozen. New Pattern D11.

**Fix:**
- Replaced `useLiveQuery` with a one-shot `useEffect` + explicit `useState<'loading' | 'new' | 'existing'>`. Inside the effect, Dexie's `undefined` resolves to `'new'` immediately.
- Removed the `customerLoaded` gate from the Confirm button. The button enables on mount. `handleConfirm` does its own authoritative find-or-create — no need to wait.
- Welcome-bonus chip preview now reads `lookupState === 'new'` (truthy three-state check, never false-positive on loading).

Build clean (958.22 kB, +0.11 kB).

Closes #86 — pending owner verification.

---

## 15 Jun 2026 — Fix: Owner gets realtime top-up notification anywhere in app (#83 follow-up)

**Bug:** After the original `/c/<slug>` hang was fixed, end-to-end test caught a second bug: when the player tapped "I've paid", the owner only saw the pending badge update if they were sitting on `/wallet`. Anywhere else (Home, Summary, History, Settings) — silent. Refresh needed.

**Root cause:** `subscribeToTopupIntents()` was only called from `Wallet.tsx`'s mount effect. Navigating away unmounted the effect, which called `unsubscribeTopupIntents()`. No channel = no realtime = no badge updates anywhere except `/wallet`. New Pattern A8.

**Fix:**
- `src/components/TopupRealtimeBridge.tsx` (NEW) — mount-once at the app shell (inside `BrowserRouter`, alongside `AuthInitializer` / `ExpirySweepRunner`). Keeps the `topup_intents_<clubId>` channel open for the entire authenticated session. Gated on `dbReady && session && subscriptionLoaded && !isPlayerHubPath(pathname)`. Per-user `activeUserIdRef` (same fix-pattern as `_clubSyncDoneForUser`) so a second user signing in on the same tab gets their own channel. INSERT callback fires a "New top-up: {name} — ₹{amount} [Review]" toast unless the owner is already on `/wallet`. Pathname is read via ref inside the callback, NOT via effect deps, so navigation doesn't churn the channel.
- `src/lib/realtimeTopups.ts` — `subscribeToTopupIntents(clubId, onInsert?)` now accepts an optional callback receiving typed `TopupInsertEvent { intentId, playerName, playerMobile, amount }`. Exported.
- `src/pages/Wallet.tsx` — dropped `subscribeToTopupIntents` / `unsubscribeTopupIntents` calls + import. Wallet now just consumes `pendingCount` from Zustand like TopBar already does. The `pendingCount → reload intent list` effect is kept unchanged.

Skill paired updates: new Pattern A8, ripple_effects bridge entry, architecture.md owner-side step 3 rewritten.

Build clean (958.11 kB, +1.09 kB).

Closes #83 follow-up — pending owner verification.

---

## 15 Jun 2026 — Fix: PlayerScan no longer hangs on "Loading club info…" (#83)

**Bug:** Opening `/c/<slug>` in a second tab while the owner was signed in in the first tab left PlayerScan stuck on the spinner forever. Hard-refreshing the owner tab "fixed" the slug tab but then broke the owner tab on next load — classic ping-pong.

**Root cause:** Single `supabase` singleton was used for both owner auth flows and public Player Hub anon RPCs. supabase-js holds an internal auth lock while a session refresh / `onAuthStateChange` re-fire is in progress. Anon RPCs from the other tab queued behind that lock and never resolved. The 8s `AbortController` in PlayerScan was a no-op because the call was stuck inside supabase-js's queue, not in `fetch`. New Pattern A7.

**Fix (three layers):**
- `src/lib/supabasePublic.ts` (NEW) — anon-only client with `persistSession/autoRefreshToken/detectSessionInUrl` all `false`. Cannot share an auth lock because it has no auth.
- `src/lib/playerHubApi.ts` — three public RPC wrappers (`getClubPublicInfo`, `submitTopupIntent`, `getTopupIntentStatus`) routed to `supabasePublic`. Owner-side functions in the same file unchanged.
- `src/App.tsx` — new `isPlayerHubRoute()` helper. `AuthInitializer` and `ExpirySweepRunner` skip when the URL starts with `/c/` or `/poster/`. Player Hub public pages never boot owner auth.
- Defensive `withTimeout(rpcPromise, 8000, label)` wraps every public RPC — any future queue hang surfaces as `<label>_timeout` Error instead of an infinite spinner.

Build clean (957.02 kB index). Closes #83 — pending owner verification.

---

## 15 Jun 2026 — UX: QuickSale UPI screen layout now matches SessionDetail (#82)

QuickSale's post-payment UPI QR screen had its amount in the upper-left corner with a `Quick Sale · UPI Payment` kicker, while SessionDetail's post-stop UPI screen uses a centered "Collect UPI payment" chip header and puts the amount UNDER the QR. Two flows, same screen, inconsistent layout.

QuickSale now mirrors SessionDetail exactly:
- Centered chip header: ✓ icon + "Collect UPI payment" + "Quick Sale" subtitle
- Amount block under the QR: `text-3xl font-mono font-bold tabular-nums` + "UPI portion — scan to pay" caption
- No-UPI-ID fallback: card with `bg-bg-card border border-border rounded-2xl p-8` (was bare centered text)
- Done button class aligned to SessionDetail's (`active:scale-[0.98] transition-transform`)

Single-file diff: `src/pages/QuickSale.tsx` UPI branch (lines ~128-176). `<UpiQrCard>` itself untouched. Build clean.

Closes #82 — pending owner verification.

---

## 15 Jun 2026 — Fix: Reset everything now clears all 9 Dexie stores (#81)

**Bug:** Settings → Reset everything left 6 of 9 Dexie stores untouched. Canteen items, customers, wallet transactions, session items, canteen sales, and stock purchases all survived. Sugeet reported it after seeing the canteen stock list still populated post-reset.

**Root cause:** `resetEverything()` in `src/db/queries.ts` only called `.clear()` on `gameTables`, `sessions`, and `settings`. Same drift class as #78 (export was also missing 6 stores). New Dexie versions (v3, v5, v8, v13) added stores but this function was never updated.

**Fix:**
- `resetEverything()` now clears all 9 stores inside a single `db.transaction('rw', [all 9], …)`. Partial wipe rolls back atomically.
- New exported `ActiveSessionsPresentError` class — thrown BEFORE opening the tx if any session is running/paused. Mirrors the import-everything guard.
- `seedIfEmpty()` runs AFTER the tx commits so its inserts aren't rolled back by tx-internal throws.
- `Settings.tsx` `handleReset` catches `ActiveSessionsPresentError` → toast "Stop all active sessions before resetting." Any other throw → generic "Reset failed" toast.

**Ripple file updated:** `ripple_effects.md` now documents the 3-way single-source-of-truth invariant — `resetEverything()` / `getAllDataForExport()` / `importEverythingFromFile()` MUST share the same 9-store list. Added a new "If you change `resetEverything()`" section. Updated the "If you add a new Dexie table" checklist to also bump `resetEverything()`.

Build clean. Pending owner verification.

Closes #81 — pending owner verification.

---

## 14 Jun 2026 — Phase C: Import/Export round-trip self-test (#79)

**New file:** `src/lib/__devTools__/importExportRoundTrip.ts` — `runImportExportRoundTrip(): Promise<RoundTripResult>`.

What it does (in order):
1. Refuses to run if any session has `status !== 'completed'` (same guard as the production importer).
2. Snapshots 11 measures: row counts for all 9 stores + `walletBalanceTotal` (sum across customers) + `piggyCurrent` (from `getPiggyBalance()`).
3. Calls `getAllDataForExport()` → `JSON.stringify` → wraps in a `new File(...)`.
4. Runs `importEverythingFromFile()` on that file — wipes + restores the current Dexie DB inside one atomic tx.
5. Re-snapshots and `console.assert`s every measure matches. Logs `[round-trip] PASS` in green or `[round-trip] FAIL` with mismatches in red.

Mounted on `window.runImportExportRoundTrip` ONLY when `import.meta.env.DEV === true` — `main.tsx` adds the dynamic import behind the DEV gate, Vite tree-shakes it out of production. Verified: production bundle stayed at 954.91 kB (no growth from Phase B), confirming the dev tool is excluded.

Why this matters: protects against silent format drift between export and import. Any time we change either side without updating the other, this self-test fails immediately. Sugeet runs it once locally before each release.

Phase C of #79. Build clean. Pending owner verification (full round-trip on real data).

---

## 14 Jun 2026 — Phase B: Import Everything UI (#79)

**`src/pages/Settings.tsx` Data & Backup section:**
- New "Import everything" action row directly below "Export everything", with an upload icon mirroring the export download icon. Subtitle: "Restore from a backup file. Replaces all current data."
- Hidden `<input type="file" accept="application/json,.json">` triggered programmatically via `useRef`. Trigger reset (`e.target.value = ''`) on each pick so re-selecting the same file still fires `onChange`.
- Pre-confirm destructive modal: "Replace all current data?" — body warns "This cannot be undone." Two buttons: Cancel (neutral) / "Yes, replace everything" (busy-red, mirrors the Reset everything style). Both `disabled` while `importing===true`.
- Success overlay: full-viewport `fixed inset-0 z-50 bg-bg flex-col` (Pattern U8). Centered green check + "Backup restored" headline + a 9-row breakdown card (Tables / Sessions / Session items / Customers / Wallet balance ₹ / Canteen items / Canteen sales / Stock purchases / Wallet transactions). Pinned "Done" button in shrink-0 footer with `safe-area-inset-bottom`. Done calls `window.location.assign('/tables')` — hard navigation forces every `useLiveQuery` to remount and re-fetch against the restored DB.
- Error handling: all 7 `ImportFailureReason` codes mapped to human-readable toast copy via module-level `importErrorMessage()` helper. No partial paths — every failure path resets `pendingImportFile` to null and closes the confirm modal.
- New `<ImportCountRow>` sub-component (file-local) keeps the success overlay JSX tidy.
- New `<IconUpload>` (16px, mirrors the existing `<IconData>` download arrow) and `<IconCheck>` (56px, used in success overlay) icons.

**Pattern notes:**
- File input uses `className="hidden"` — `type="file"` triggered via `ref.click()` is universally supported across browsers. (Pattern U9's opacity-0 overlay rule is specifically for `type="date"` Chrome quirks; file inputs don't have the same activation issue when triggered programmatically.)
- Modal pattern follows existing Settings modals (Modal component with grid-cols-2 footer buttons).

Phase B of #79. Build clean (954.91 kB bundle, +8.4 KB). Pending owner verification.

---

## 14 Jun 2026 — Phase A: Import Everything core logic (#79)

**New file:** `src/lib/importEverything.ts` — `importEverythingFromFile(file: File): Promise<ImportResult>`.

- Atomic restore: ONE `db.transaction('rw', [all 9 stores], …)` that clears every store then bulkAdds the file's rows. Any throw rolls back the whole tx (no partial imports — ever).
- Failure-reason union: `parse_error | not_clubkeeper_file | legacy_incomplete_format | schema_too_new | active_sessions_present | empty_file | transaction_failed`.
- `legacy_incomplete_format` specifically detects the pre-#78 3-table format (`tables + sessions + settings` with no `schemaVersion`) — gives users a useful "this backup was made before the fix" message instead of silently re-introducing data-loss.
- Pre-check refuses import if ANY current-DB session has `status !== 'completed'` (importing over a running timer would corrupt elapsed math — Pattern T1).
- Forward-compat gate: rejects `schemaVersion > CURRENT_SCHEMA_VERSION`.
- IDs (`id`, `tableId`, `sessionId`, `customerId`) preserved verbatim via `bulkAdd` — FK links survive.
- No `any` types. No HTML `<form>`. Strict TS.

**DEV-only console hook** in `src/main.tsx`: behind `import.meta.env.DEV`, dynamic-imports the helper and exposes `window.__importEverythingFromFile` so Sugeet can verify by hand before Phase B wires the UI. Stripped from production bundle automatically.

**No UI yet** — Phase B will add the Settings button + confirm modal + success overlay.

**Paired skill update:** `ripple_effects.md` new section "Import Everything" — rules for the file-format contract + checklist for adding a new Dexie table.

Phase A of #79. Build clean. Pending owner verification.

---

## 14 Jun 2026 — Phase A0: Fix Export (#78 — P0 data-loss bug)

**Issue:** Export Everything was silently writing only 3 of 9 Dexie tables. Wallet customers, canteen items/sales, walletTransactions, sessionItems, stockPurchases all dropped on export. Lossy backups for the entire app lifetime up to today.

**Fix in `src/db/queries.ts`:**
- `getAllDataForExport()` now returns all 9 stores: `tables, sessions, sessionItems, settings, customers, walletTransactions, canteenItems, canteenSales, stockPurchases`.
- Added top-level `schemaVersion: 16` (mirrors Dexie version) and `exportedAt: Date.now()`.
- Strict return type: new exported interface `ClubKeeperBackupV16`.
- New exported constant `CURRENT_SCHEMA_VERSION = 16` — sole source of truth, must bump alongside Dexie version.

**Why this is the foundation for #79 (Import):** Import contract reads exactly this shape. Old 3-table backups will be rejected by Import with a useful "legacy_incomplete_format" error — they were never lossless, so silent acceptance would hide the data loss further.

**Paired skill update:** `data_model.md` "Data Export Format" section replaced (v2 stub → v16 reality + forward-compat rules + ripple checklist for new tables).

Phase A0 of #79 — Import follows. Build clean. Pending Sugeet verification.

---

## 14 Jun 2026 — Remove legacy pre-record QR: #77 (commit 72d9edb)

- Deleted `paymentScreenOpen` state + pre-record QR overlay block (~200 lines) from `src/pages/SessionDetail.tsx`
- `handleConfirmStop`: after `pauseForPayment()`, opens `PaymentSplitSheet` directly (zero-total auto-confirms)
- Auto-resume `useEffect` (Case 1 + Case 2): opens split sheet directly — no intermediate screen
- `PaymentSplitSheet` + `CoinRedemptionPill` moved to main render tree, gated by `splitSheetOpen`
- Post-confirm screen (`confirmedBreakdown`) unchanged from #76
- Stop flow: End Session → PaymentSplitSheet → Confirm → conditional UPI QR or "Payment recorded ✓"

---

## 14 Jun 2026 — Payment fixes: #75+#76 (commit 4b0cf3f)

- **#75 (Dexie tx missing objectStore):** `confirmPaymentAndStop` tx was missing `db.settings` from its table list — reads `db.settings.get(1)` inside the callback for rounding. Added `db.settings` to `db.transaction('rw', ...)` list. One-line fix in `src/db/queries.ts`.
- **#76 (UPI QR wrong amount / shows when UPI=0):** Replaced `postConfirmUpiAmount` state with `confirmedBreakdown`. Post-confirm screen now: `upi > 0` → QR for UPI portion only; `upi === 0` → "Payment recorded ✓" card. Added `setPaymentScreenOpen(false)` on all confirm paths. Both changes in `src/pages/SessionDetail.tsx`.

---

## 14 Jun 2026 — Bug sprint: #73+#74 pause-first stop flow (commit 69cd1b4)

- `src/types/index.ts`: Added `Session.paymentInProgress?: boolean` — true while session is paused waiting for staff to confirm payment.
- `src/db/queries.ts`: Added three atomic functions:
  - `pauseForPayment(sessionId)` — pauses session + sets `paymentInProgress=true`; returns `{ billableMs, grandTotal }` for confirm preview
  - `confirmPaymentAndStop(sessionId, breakdown, customerId?)` — single tx: validates `paymentInProgress`, writes `endedAt + status='completed' + amount + paymentBreakdown + paymentInProgress=false`; inlines wallet debit (Pattern D7)
  - `cancelPaymentAndResume(sessionId)` — clears `paymentInProgress`, restores `status='running'`
- `src/pages/SessionDetail.tsx`: Full rewrite of stop flow — `handleConfirmStop` → `pauseForPayment`; new `handleCancelPayment`; PaymentSplitSheet `onCancel` conditionally resumes session; auto-resume `useEffect` extended with Case 1 (paused+paymentInProgress); post-confirm UPI QR state; `isActive` guard updated.
- `src/components/TableCard.tsx`: Paused card shows "Paying…" badge (accent, pulsing dot) when `session.paymentInProgress === true`.
- **Pattern P4 updated:** stop flow is now pause-first; completed sessions always have `paymentBreakdown`; legacy "stopped-but-unrecorded" handled by Case 2 of auto-resume effect.
- **ripple_effects.md:** New section "If you change the stop-session flow".
- **test_status.md:** Section O added (5 scenarios).

---

## 14 Jun 2026 — Loose notes (relocated from file tail during 8 Jul 2026 ordering repair)

14 Jun 2026 — SKILL.md: tightened bug-tracking rules. Issues now created BEFORE code, closed ONLY after Sugeet's explicit verification (Rule F).
14 Jun 2026 — fix #69 (2b83dd1): QuickSale now shows UPI QR overlay for the UPI split amount after a successful sale. `UpiQrCard` now has 3 consumers — ripple_effects.md updated. Bug sprint issues #68–74 created and logged in bug_archive.md.
14 Jun 2026 — fix #72 (6be8ed0): Table Move now rejects moves across incompatible rate-card configs (billing mode / tier array / tolerance). MoveTableList mirrors same checks client-side. ripple_effects.md updated with full 6-rule compatibility spec.
14 Jun 2026 — fix #70 (9f7e2aa + 41a7bb1): All Summary widgets now tick live. Two-commit fix: (1) removed useMemo from rankTables + bucketByHour; (2) removed useMemo from runningRevenueToday — the real cause of Day's earnings + Avg session freeze. Pattern T4 addendum: useMemo hides getElapsedMs from tick just like useLiveQuery does.

## 9 Jun 2026 — Back Entries Phase 2: Canteen items in back entry

- Extended `createBackEntry` with `items?: BackEntryItemInput[]` (`{ name, price, quantity }`).
- All writes — session row, sessionItems, and canteen stock decrements — happen inside ONE flat `db.transaction('rw', db.sessions, db.gameTables, db.settings, db.canteenItems, db.sessionItems, ...)` (Pattern D7). Zero calls to `addSessionItem`, `addOrIncrementSessionItem`, or `decrementCanteenItemStock` from inside the tx.
- Stock aggregation: first pass builds `stockNeeded: Map<canteenItemId, totalQty>` across all draft items (prevents bypass via multiple small rows for the same item). Second pass checks sufficiency — throws `InsufficientStockError(available, itemName)` if any item would push stock negative (tx rolls back entirely). Third pass decrements and inserts sessionItems with `addedAt: input.endedAt - order * 1000` (anchors inside session window).
- `BackEntryModal` extended: canteen chips with out-of-stock dimming, draft items list with +/− stepper and × remove, collapsible manual form (`+ Add other item`), price-mismatch inline warning (Pattern F7). `mergeDraftItem(name, price, quantity)` merges chip taps and manual adds by `(normalizeName, price)` locally — DB write only on save.
- Preview block extended: Table Amt / Items row (only when items present) / Grand Total, separated by border.
- `InsufficientStockError` caught inline in save handler — no toast (Pattern F7). `BackEntryOverlapError` also caught inline.
- No new Dexie version bump — `sessionItems` and `canteenItems` already in v12 schema.

**Files touched:** `src/db/queries.ts` (BackEntryItemInput, extended BackEntryInput, createBackEntry rewrite), `src/components/BackEntryModal.tsx` (full rewrite for Phase 2).

---

## 9 Jun 2026 — Back Entries Phase 1 (Log Past Session)

- **Dexie v12:** Additive — adds optional `isBackEntry?: boolean` to `Session`. No new index. No `.upgrade()`. Legacy rows read `undefined` (falsy).
- **`src/types/index.ts`:** `isBackEntry?: boolean` added to `Session` interface.
- **`src/db/queries.ts`:** `BackEntryOverlapError` custom error class (has `conflictingSession: Session` payload). `BackEntryInput` interface. `createBackEntry()` — flat single tx. Overlap check covers both active (`running`/`paused`) and completed sessions for the same table in the same time window. Rate card snapshots captured from table if present (Pattern T7 — set all three together or not at all). `per_frame` not supported in v1 (skip tables without `ratePerHour`).
- **`src/lib/validation.ts`:** `validateBackEntry()` — reuses `validatePlayerName` + `validateNote`, checks duration 1 min–24 hr, future-time guard.
- **`src/components/BackEntryModal.tsx`:** New component. Date + start/end time native inputs (plain visible, matching History.tsx — no opacity-0 overlay). Player name + count + note. Preview block: Duration / Table Amt. `BackEntryOverlapError` caught inline with conflicting session detail. Footer via `<Modal footer={...}>` (Pattern M4).
- **`src/pages/History.tsx`:** `"+ Log past session"` button in header. `<BackEntryModal>` mounted at page level. `onSaved(dateISO)` snaps both `fromStr` and `toStr` to saved date so new row immediately visible. `Logged` badge in `SessionRow` time row for `session.isBackEntry === true`.

**Files touched:** `src/types/index.ts`, `src/db/database.ts`, `src/db/queries.ts`, `src/lib/validation.ts`, `src/components/BackEntryModal.tsx` (new), `src/pages/History.tsx`.

---

## 9 Jun 2026 — Rate card + tolerance + pro-rated billing (Customer #2 unblock)

**Shipped same-day to close Customer #2 (Ball Bender):**

- `RateTier { minutes, price }` type. `GameTable.rateCard?: RateTier[]`, `GameTable.toleranceMinutes?: number`, `GameTable.rateCardBilling?: 'minimum' | 'prorated'` (all optional). `Session` gains parallel snapshot fields: `rateCardSnapshot`, `toleranceMinutesSnapshot`, `rateCardBillingSnapshot` (captured at session start, immutable per Pattern T3).
- `src/lib/money.ts`: legacy `priceForElapsed` renamed to `priceForElapsedMinimum`. New `priceForElapsedProrated` implements pre-tier-1 pro-rating, tier plateaus during tolerance window, linear climbs between tiers, and post-last-tier extrapolation at `last.price/last.minutes` per minute. `calculateAmount` dispatches by snapshot: per_frame → frame count; rate card present → mode-based dispatch; else → legacy linear. Rounding setting ignored for both rate card modes.
- `TableFormModal`: collapsible Tiered Pricing section with labeled tier grid (Minutes / Price columns), `+ Add Tier`, Tolerance input, "standard preset (30 / 60 / 90 min)" button (3-tier default), and Pro-rated / Minimum charge segmented toggle with descriptive helper text.
- `Modal` component restructured for mobile: outer `max-h-[92vh] flex flex-col`, scroll container `flex-1 overflow-y-auto overscroll-contain`, footer `shrink-0` with safe-area padding. Action buttons always visible.
- Settings rounding: dim hint shown when any table has a rate card configured ("Rounding is ignored on tables with a rate card").
- Pool 1 seed includes 6-tier Ball Bender values as demo data. All UI labels are generic — no club name leaks.
- Dexie v10 (rate card fields) then v11 (billing mode field). Both additive, no `.upgrade()` blocks.

**Tested all 14 acceptance values across both modes (0/1/5/15/29/30/35/40/41/50/59/60/65/70/71/80/100 min).** Pro-rated and Minimum charge each produce expected values within ±₹1. Live session display updates smoothly via existing `useTick()` + Pattern T4 dispatch.

**Files touched:** `src/types/index.ts`, `src/lib/money.ts`, `src/lib/validation.ts`, `src/lib/summaryMath.ts`, `src/db/database.ts`, `src/db/queries.ts`, `src/db/seed.ts`, `src/components/TableFormModal.tsx`, `src/components/Modal.tsx`, `src/pages/Settings.tsx`, `src/pages/Home.tsx`, `src/pages/SessionDetail.tsx`, `src/pages/Summary.tsx`, `src/pages/History.tsx`.

**Business:** Customer #2 (Ball Bender) closed same day. See `business_context.md`.

---

## 8 Jun 2026 — Summary dashboard rebuild + calendar icon date picker fix

**What shipped:**
- `src/lib/summaryMath.ts` (NEW): pure aggregation helpers — `computeDelta`, `bucketByHour`, `rankTables`, `topCanteenItems`, `computeTotalRevenue`. No Dexie imports.
- `src/pages/summary/RevenueDeltas.tsx` (NEW): yesterday / last week / 7d avg delta chips.
- `src/pages/summary/RevenueSplitBar.tsx` (NEW): tables vs canteen split bar with two tiles.
- `src/pages/summary/HourlyHeatmap.tsx` (NEW): hourly bar chart, tappable rows, tooltip strip, peak hour labelled.
- `src/pages/summary/TopTablesList.tsx` (NEW): medal-ranked top tables with revenue + avg duration.
- `src/pages/summary/LowStockStrip.tsx` (NEW): yellow strip linking to /canteen, only visible when count > 0.
- `src/pages/summary/TopCanteenItems.tsx` (NEW): dot-separated top canteen items with qty.
- `src/pages/Summary.tsx` (REBUILT): end-of-day dashboard. Pattern T4 compliant. Date navigation via compact 44×44 calendar icon in header. Heatmap collapsible (default collapsed). Sessions list at bottom.
- `src/pages/History.tsx` (minor): added `cursor-pointer` to both date inputs.

**Date picker pattern established (Pattern U9):**
After 5 failed attempts with various approaches (`showPicker()`, clipped/sr-only hidden inputs, label-only forwarding), the correct cross-browser pattern is: a `relative` sized container; `<label>` with `absolute inset-0` as the visual element; `<input type="date">` with `absolute inset-0 w-full h-full opacity-0` on top in DOM order. The input is real-sized so Chrome treats it as user-visible. Direct clicks hit the input (on top); label is accessibility backup. See Pattern U9 in bug_patterns.md.

**Files touched:**
- `src/lib/summaryMath.ts` — new
- `src/pages/summary/RevenueDeltas.tsx` — new
- `src/pages/summary/RevenueSplitBar.tsx` — new
- `src/pages/summary/HourlyHeatmap.tsx` — new
- `src/pages/summary/TopTablesList.tsx` — new
- `src/pages/summary/LowStockStrip.tsx` — new
- `src/pages/summary/TopCanteenItems.tsx` — new
- `src/pages/Summary.tsx` — rebuilt
- `src/pages/History.tsx` — cursor-pointer on date inputs

---

## 7 Jun 2026 — Canteen management (full Phase 1) + auth race fix

**What shipped:**
- Dexie v8: `canteenItems` table (`++id, name, isActive, sortOrder`). New `CanteenItem` type. `lowStockThreshold: 5` default on `ClubSettings`.
- 6 query functions in `queries.ts`: `getCanteenItems` (uses `.filter()` not `.where().equals(1)` — boolean index quirk), `addCanteenItem`, `updateCanteenItem`, `softDeleteCanteenItem`, `decrementCanteenItemStock`, `getLowStockThreshold`.
- `src/lib/validation.ts`: `validateCanteenItemName()` (1–50 chars, alphanumeric + common punctuation).
- Canteen page (`/canteen`): header + stats row + item list with StockPill badges (out of stock / low stock / in stock / no tracking). Add/edit via `CanteenItemFormModal`. Soft-delete with confirm modal. FAB always rendered. All states (loading skeleton / empty / populated) handled without page restructure.
- `CanteenItemFormModal.tsx`: name, price, track stock toggle, current stock field (conditional). ADD and EDIT modes.
- `App.tsx`: `/canteen` route inside `<RequireAccess>`.
- `TopBar.tsx`: cart icon button (w-9 h-9) navigates to `/canteen`. Now has 4 right-side elements (online dot, canteen, wallet, gear).
- `AddItemBottomSheet.tsx`: canteen master-list chips (horizontally scrollable, out-of-stock chips disabled/greyed); qty stepper (−/N/+) with stock-max clamping; single flat `db.transaction('rw', db.canteenItems, db.sessionItems, ...)` with inlined stock logic for atomic stock decrement + session item add; low-stock / out-of-stock toast after commit.

**Bugs fixed:**
1. **Dexie boolean index quirk:** `.where('isActive').equals(1)` never matches boolean `true`. Fixed to `.filter(item => item.isActive === true)`. See Pattern D (new: boolean index rule).
2. **Nested transaction crash (Pattern D7):** Calling `decrementCanteenItemStock` (which has its own `db.transaction()`) from inside an outer transaction caused the inner tx to commit early, leaving the outer broken. Stock decremented but session item was never written. Fixed by inlining the stock logic into the single outer transaction — `decrementCanteenItemStock` kept for standalone use.
3. **Auth race condition — `/canteen` redirected to `/tables` on hard refresh (Pattern A6):** Between `loading=false` and `refreshProfile()` resolving, `subscription===null` was misread as `no_subscription` → redirect to `/subscribe` → Subscribe.tsx bounced active user to `/tables`. Fixed via `subscriptionLoaded: boolean` flag in authStore + new `'subscription_loading'` reason in `useAccessGuard` + spinner in `RequireAccess`.

**Files touched:**
- `src/types/index.ts` — `CanteenItem` interface + `lowStockThreshold` on `ClubSettings`
- `src/db/database.ts` — v8 schema + `canteenItems!: Table<CanteenItem, number>`
- `src/db/seed.ts` — `lowStockThreshold: 5` in `DEFAULT_SETTINGS`
- `src/db/queries.ts` — 6 new canteen functions
- `src/lib/validation.ts` — `validateCanteenItemName()`
- `src/pages/Canteen.tsx` — new page
- `src/components/CanteenItemFormModal.tsx` — new component
- `src/components/AddItemBottomSheet.tsx` — chips + stepper + atomic tx
- `src/components/TopBar.tsx` — canteen icon
- `src/components/RequireAccess.tsx` — `subscription_loading` spinner
- `src/hooks/useAccessGuard.ts` — `subscription_loading` reason + `subscriptionLoaded` gate
- `src/store/authStore.ts` — `subscriptionLoaded` flag
- `src/App.tsx` — `/canteen` route

---

## 5 Jun 2026 — SubscriptionStatusBanner two-state trialing split + ConfirmationScreen date fix

**Problem:** After completing the ₹5 UPI mandate (Razorpay `subscription.authenticated`), the banner on `/tables` still showed "7-day free trial — N days left · Manage →" — identical to before payment. Root cause: `subscription.authenticated` webhook writes `status='trialing'` (unchanged) and never touches `trial_ends_at`. Banner had no way to distinguish "pure trial" from "mandate registered, waiting for first charge."

**Fix:** Split the `trialing` branch of `SubscriptionStatusBanner` into two sub-states using `razorpaySubscriptionId` presence:
- `!razorpaySubscriptionId` → existing "Free trial: N days left · Manage →" strip (unchanged)
- `razorpaySubscriptionId` present → new "Subscribed ✓ — ₹599 will be charged on {d MMM} · View →" strip. "View →" sets `sessionStorage('ck_settings_section', 'subscription')` then navigates to `/settings`, auto-opening the Subscription section.

**Also fixed:** `trialEndDate` in `ConfirmationScreen` was always `format(addDays(new Date(), 7), 'MMM d')` — today+7 from Subscribe page render time, not the actual stored `trial_ends_at`. Fixed in `Subscribe.tsx` to read `subscription.trialEndsAt` from authStore, with `addDays(new Date(), 7)` as fallback. Note: `ConfirmationScreen.tsx` receives `trialEndDate` as a prop but its current body doesn't display it prominently; fix is forward-compatible for when that copy is updated.

**Files touched:**
- `src/components/SubscriptionStatusBanner.tsx` — added `razorpaySubscriptionId` to destructure; trialing branch split into two renders
- `src/pages/Subscribe.tsx` — `trialEndDate` now reads `subscription.trialEndsAt` first

**No changes to:** `useAccessGuard.ts`, webhook, `create-subscription.ts`, `SubscriptionStatus` type, `AuthCallback`, or any other strips (past_due, active+cancelling).

---

## Phase 3 Commit 2 — ₹10 live plan + start_at 3-scenario math (BUG-026)

**Date:** 4 Jun 2026
**Commit message:** `phase-3-commit-2: ₹10 live plan + start_at 3-scenario math (BUG-026)`

### Files changed
- `src/lib/razorpayPlans.ts` — added `'test'` to `Tier` union; `LIVE_PLANS` gains `test_monthly: 'plan_Sx0LfhJGzccBHQ'`; exported `isLiveMode`; `PlanMap` is now `Partial<Record<...>>` so `'test'` tier can be absent from TEST_PLANS
- `api/_shared/plans.ts` — same mirror changes: `'test'` tier, `LIVE_PLANS` gains `test_monthly`, `Partial` map
- `api/create-subscription.ts` — 3-scenario `start_at` logic reading Supabase before Razorpay create; conditional `trial_ends_at` write; scenario logged + stored in Razorpay notes; added `'test'` to `VALID_TIERS`; response now includes `startAt` and `scenario` fields
- `src/pages/Subscribe.tsx` — `PlanId` type extended to include `'test'` and `'pro'`; `MONTHLY_PRICES`/`ANNUAL_PRICES` maps include all 4 tiers; added `visiblePlanIds` gating logic (Sugeet email + LIVE mode check); passes `visiblePlanIds` prop to `<PlanSelection>`
- `src/components/subscribe/PlanSelection.tsx` — `VISIBLE_PLAN_IDS` removed from module scope; now receives `visiblePlanIds: readonly PlanId[]` as prop; `PLANS` renamed `ALL_PLANS`; `'test'` tier entry added (₹10/month, 2-feature list)
- `src/components/subscribe/PlanCard.tsx` — `id` union extended to include `'test'`; LIVE TEST badge rendered for `id === 'test'`

### Business impact
- BUG-026 fixed: expired-trial users now charged immediately on subscribe (no more free trial extension)
- Mid-trial early-subscribe honors remaining trial days correctly (no overlap, no double charge)
- ₹10 LIVE test plan visible only to `sugeetjadhav@gmail.com` in LIVE mode — allows cheap end-to-end billing validation without touching real customer plans

### What's now testable
- Sign in as Sugeet on LIVE mode → Subscribe page shows ₹10 "Test ₹10 / month" card with 🔴 badge
- Subscribe with ₹10 → Razorpay charges real ₹10 immediately if trial expired, or defers to trial end if mid-trial
- Scenario (`new` / `mid_trial` / `expired`) visible in Razorpay dashboard under subscription notes

---

## 3 Jun 2026 — Fix: cancel subscription fails during trial (BUG-025)

`api/cancel-subscription.ts` always called `cancel(id, 1)` (cancel at cycle end). Razorpay rejects this with 400 when no billing cycle has started yet (`authenticated` state during trial). Added fallback: catch that specific 400, retry with `cancel(id, 0)` (immediate), update Supabase `status='cancelled', cancel_at_period_end=false`, return `{ cancelled: true, immediate: true }`. Normal active-subscription cancel path unchanged. See Pattern S7.

**Files touched:** `api/cancel-subscription.ts`

---

## 3 Jun 2026 — Fix /subscribe headline duplication (Phase 1.5 visual bug)

The `expired` and `early` headline blocks from Phase 1.5 were rendering above the old "Welcome, {Name} 👋" block from `PlanSelection` — two headlines visible at once in both states.

**Root cause:** The `welcome` headline lived only inside `PlanSelection` (gated by `!hideWelcome`). The Phase 1.5 work added the `expired`/`early` blocks directly in `Subscribe.tsx` above `<PlanSelection>`, but the `welcome` block in `PlanSelection` was still rendering because `hideWelcome` evaluated to `false` for the welcome state. The three branches were split across two files, not mutually exclusive in one place.

**Fix:** Moved the `welcome` headline block into `Subscribe.tsx` alongside the other two, so all three branches (`expired` / `early` / `welcome`) live in one place and are mutually exclusive via `headlineState.kind`. `PlanSelection` now always receives `hideWelcome={true}` — it never renders its own welcome header anymore. The `early` sub-line also received date polish: "Your plan starts on {d MMM} — no overlap, no double charge." using `format(subscription.trialEndsAt, 'd MMM')` with a null-guard fallback.

**Rule:** Headline branches must all live in the same parent component, gated by a single discriminated union. Never split headline variants across a parent and a child — the child's unconditional (or weakly-gated) block will leak into sibling states.

**Files touched:** `src/pages/Subscribe.tsx` (welcome branch added, `hideWelcome` always true).

---

## 2 Jun 2026 — Cardless trial Phase 1.5: three-branch Subscribe headline + trial strip routing

Three-entry-path headline on `/subscribe`. Each path now shows distinct copy:
- `trial_expired` — "Your free trial has ended / Subscribe to keep using ClubKeeper for your club."
- `subscribe_early` — "Subscribe early to lock in ₹599/month / You have N days left in your trial. Your plan starts when the trial ends — no overlap, no double charge."
- `welcome` (default) — existing PlanSelection welcome copy unchanged

**Files touched:**
- `src/pages/Subscribe.tsx` — `HeadlineState` discriminated union (`expired | early | welcome`), `useMemo` to derive from `location.state.reason` + live subscription. Auth guard updated: trialing users with active trial are only bounced if `locationReason` is unset. `LocationState` typed inline.
- `src/components/SubscriptionStatusBanner.tsx` — "Manage →" now navigates to `/subscribe` with `state: { reason: 'subscribe_early' }` (was `/settings`).
- `src/components/RequireAccess.tsx` — already passes `state: { reason: 'trial_expired' }` ✓
- `src/pages/AuthCallback.tsx` — already passes `state: { reason: 'trial_expired' }` for expired trial ✓

**Fallback on refresh:** `headline` `useMemo` derives from live subscription state when `locationReason` is absent — browser refresh on `/subscribe` still shows correct headline.

---

## 2 Jun 2026 — Cardless 7-day trial (Phase 1): Postgres trigger + client routing

New signups get `status='trialing'` + `trial_ends_at = now()+7d` from Postgres trigger (no card required). Razorpay only entered when owner taps Subscribe or trial expires.

**SQL migration:** `supabase/migrations/20260602_cardless_trial.sql` — replaces `handle_new_user()` to insert trialing status; backfills existing `status='none'` rows.

**Files touched:**
- `src/hooks/useAccessGuard.ts` — renamed `needs_subscription`→`no_subscription`, `trial_ended`→`trial_expired`; `cancelled`/`expired` merged into `no_subscription`
- `src/components/RequireAccess.tsx` — `trial_expired` navigated imperatively with state; other reasons use `<Navigate>`
- `src/pages/AuthCallback.tsx` — full status-aware routing including trialing + expired-trial path
- `src/pages/Subscribe.tsx` — auth guard skips trialing-user bounce for expired trial; reads `location.state.reason`
- `src/types/index.ts` — `trialEndsAt` and `'trialing'` already present, no change
- `src/store/authStore.ts` — `trial_ends_at → trialEndsAt` already mapped, no change

---

## 1 Jun 2026 — Alarm Phase 2 (snooze math, bell icon, edit-on-running)

Three real-world bugs from Sugeet's test scenarios fixed:
1. **Snooze math drifted forward** by user reaction time → now anchors to original `notifyAtMs` (Pattern T6).
2. **No visibility that alarm was armed** → added passive bell icon (lime, `w-4 h-4`, pulsing on running) on table card when notify is armed and unacknowledged.
3. **Couldn't add/edit/cancel alarm mid-session** → added `⏰ Alarm at <time> · Edit` pill on SessionDetail, opens Modal with `NOTIFY_PRESETS` chips + Custom. "None" clears alarm.

Also: refactored `NOTIFY_PRESETS` into `src/lib/notifyPresets.ts` (single source of truth for StartSession + SessionDetail). Added `updateSessionNotify()` to `queries.ts`.

---

## 1 Jun 2026 — Alarm volume + loop + iOS audio unlock (Pattern T5)

Fixed alarm sound quality: gain 0.3 → 1.0, tone duration 200ms → 500ms with attack/decay envelope, replaced 2-fire pattern with 3-sec loop capped at 60 sec. Extracted to `src/lib/alarm.ts` (eliminates `Settings.tsx` duplication). Added silent iOS audio unlock via global `pointerdown` listener in `App.tsx`. Test alert button plays single-beep preview (`playBeepOnce`), not full loop.

---

## 1 Jun 2026 — Custom domain live: app.handbookhq.in

Primary production URL is now `app.handbookhq.in` (Cloudflare DNS → Vercel). Old `clubkeeper.vercel.app` still resolves as backup. No code changed; this is a Vercel + DNS config change only. Future share links, marketing material, and customer-facing references should use the custom domain.

---

## ——— Early history (May 2026) — entries below this divider run OLDEST-FIRST and are frozen ———

## Prompts 0–8 — Foundations and polish

- **Prompts 0–6:** Project setup, data layer, all 4 main screens, Add/Edit Table modal, PWA install support.
- **Prompt 7:** Bug fixes — toggle alignment, date picker editable, time rounding plumbed, "Delete → Disable" rename.
- **Prompt 8:** Validation & overflow fixes — 50-char player name, special-char filter, "disable running table" guard.

---

## Prompt 9 (21 May 2026) — Supabase auth foundation

**Shipped:**
- `@supabase/supabase-js` installed
- `.env.local` with Supabase URL + anon key (gitignored, never commit)
- `.gitignore`: added `.env.local` + `.env*.local`
- `src/lib/supabase.ts`: client with `persistSession`, `autoRefreshToken`, `detectSessionInUrl`
- `src/store/authStore.ts`: Zustand store — session, user, profile, subscription, loading; `initialize()`, `signInWithGoogle()`, `signOut()`, `refreshProfile()`
- `src/hooks/useAccessGuard.ts`: typed guard returns `{ canAccess, reason }` for all subscription states
- `src/components/RequireAccess.tsx`: Outlet-pattern route guard; redirects to `/signup` or `/subscribe`
- `src/pages/Landing.tsx`, `Signup.tsx`, `Subscribe.tsx`: placeholders
- `src/pages/AuthCallback.tsx`: real OAuth callback — reads loading+subscription, routes to `/subscribe` or `/tables`
- `src/App.tsx`: split into public routes (`/, /signup, /subscribe, /auth/callback`) and private routes (`/tables, /start/:id, …`); AuthInitializer calls `initialize()` on mount; BottomNav hidden on public paths
- `src/components/BottomNav.tsx`: Tables tab `/` → `/tables`
- `src/pages/SessionDetail.tsx` + `Settings.tsx`: all `navigate('/')` → `navigate('/tables')`
- `src/pages/Settings.tsx`: Sign Out button
- `src/types/index.ts`: added `UserProfile`, `SubscriptionStatus`, `PlanTier`, `Subscription`
- `src/vite-env.d.ts`: typed env vars for Supabase + Razorpay

**Manual SQL run in Supabase dashboard (approved by Sugeet):**
- `public.profiles` table + RLS (view/update own row)
- `public.subscriptions` table + RLS (view own row)
- `handle_new_user()` trigger: auto-creates profile + subscription row on every signup

---

## Prompt 10 — Landing page

**Shipped (`src/pages/Landing.tsx` + `src/components/landing/*`):**
- `Landing.tsx`: orchestrator — outer radial glow bg, 390px device column, sticky top bar (logo + Sign in → `/signup`), sections in order
- `Eyebrow.tsx`: shared eyebrow label (18px line + mono uppercase text)
- `HeroSection.tsx`: headline, live hero timer (useTick + useRef, offset 1h24m36s), app mockup with 3 table cards (Free/Running/Paused), primary CTA button
- `PainPointSection.tsx`: 3 pain cards with emoji icons
- `ROICalculator.tsx`: interactive — `forgetCount × ratePerHour × 30 = monthly loss`; `monthly/599 = ROI multiplier`; Indian format via `toLocaleString('en-IN')`
- `HowItWorks.tsx`: 3 numbered steps (01/02/03 in accent mono)
- `PricingSection.tsx`: Starter / Standard (featured with glow + badge) / Pro (disabled), trial pill, trial banner
- `ComparisonTable.tsx`: overflow-x-auto scrollable, sticky left column
- `FAQ.tsx`: 6 items, `openIndex: number | null`, max-height CSS transition, `+` rotates to `×` when open
- `FinalCTA.tsx`: accent green CTA block with corner glow
- `Footer.tsx`: logo, nav links, Made in Pune

---

## Prompt 11 — Signup state machine + Google sign-in

**Shipped:**
- `src/pages/Signup.tsx`: state machine (`form | loading | transition | error`)
  - Effect 1: detects `?error=` in URL → `error` state on mount
  - Effect 2: redirects authenticated users — no sub → `transition`, has sub → `/tables`
  - `isOAuthInFlight` ref prevents double-tap; `handleRetry` uses 50ms tick
- `src/components/GoogleSigninButton.tsx`: reusable — white bg, Google multi-color logo SVG, spinner swap on loading
- `src/components/signup/SigninForm.tsx`: full page layout — back chevron → `/`, hero, Google button, legal, 3 trust rows, spacer, Sign in outline button, footer. Renders `SigninError` when `hasError`
- `src/components/signup/PostSigninTransition.tsx`: "Almost there!" screen — accent check circle, trial pills, "Add Payment Method →" → `/subscribe`, "Why card?" max-height expandable, signed-in-as account line (reads `profile.email` or `user.email`)
- `src/components/signup/SigninError.tsx`: fixed bottom toast (busy/red), `!` icon, Retry button

**Auth flow after this prompt:**
`/signup` → Google OAuth → `/auth/callback` → if no sub: `/subscribe`, else: `/tables`

---

## Prompt 12 (21 May 2026) — Subscribe UI (fake payment)

**Shipped (`src/pages/Subscribe.tsx` + `src/components/subscribe/*`):**
- `Subscribe.tsx`: orchestrator — auth guard, state (billing, plan, sheetOpen, paying, backWarning), fake 1.4s payment simulation, ProgressStep component inline, avatar initial from profile
- `BillingToggle.tsx`: Monthly/Annual toggle, "save 2 mo" badge, accent glow on active
- `PlanCard.tsx`: all 3 plans — select-tick for Starter, featured glow + badge for Standard, disabled + Coming soon for Pro. Annual shows per-month + savings line
- `PlanSelection.tsx`: welcome + toggle + 3 cards + ROI note. `pb-40` clears sticky bar
- `StickyCheckout.tsx`: flex-shrink-0 sticky bottom bar, gradient+blur bg, plan+price summary, CTA
- `PaymentBottomSheet.tsx`: `translateY` slide-up sheet, accordion methods (UPI default open), GPay/PhonePe/Paytm/BHIM grid, UPI input, paying spinner, Razorpay branding
- `ConfirmationScreen.tsx`: full-page on simulated success — check circle, "Trial started!", email, Continue → `/tables`

**Known limitation added:** IndexedDB data is browser-local and shared across all users on the same browser. No user-scoping yet. Will be addressed when cloud sync is added.

---

## Prompt 13 (23 May 2026) — Real Razorpay + Supabase webhook

**Shipped:**
- `api/create-subscription.ts`: Vercel serverless — authenticates JWT, creates Razorpay subscription, writes `status='trialing'` + `trial_ends_at` to Supabase via service role
- `api/razorpay-webhook.ts`: Vercel serverless — HMAC signature-verified, maps all 6 subscription events to Supabase status updates
- `api/cancel-subscription.ts`: Vercel serverless — authenticates JWT, cancels subscription at cycle end, sets `cancel_at_period_end=true`
- `src/lib/razorpayPlans.ts`: single source of truth for 6 Razorpay plan IDs
- `src/types/index.ts`: added `RazorpayCheckoutOptions`, `RazorpayResponse`, `RazorpayInstance`, `Window.Razorpay` global
- `src/pages/Subscribe.tsx`: replaced fake setTimeout with real Razorpay Checkout; `payError` state; scroll-bleed `useEffect`; imports `supabase` directly for `getSession()`
- `src/components/subscribe/PaymentBottomSheet.tsx`: added `payError` prop + inline red error display; `overscroll-contain` on scrollable panel
- `src/pages/Settings.tsx`: new Subscription section (plan/status/next-charge/cancel/change-plan); cancel modal; `handleCancelSubscription()` calls `/api/cancel-subscription`
- `src/components/SubscriptionStatusBanner.tsx`: trialing/past_due/cancelling banners with Indian rupee formatting
- `src/pages/Home.tsx`: renders `<SubscriptionStatusBanner />` above tables grid
- `index.html`: added Razorpay `checkout.js` `<script>` in `<head>`
- `razorpay` + `@vercel/node` packages installed

---

## 24 May 2026 — 16-bug sprint (commit `5587be6`)

Phase 1–3.5 bug fixes, all in one commit, pushed to main, Vercel auto-deployed. Each bug has its own entry in `bug_archive.md` and the recurring pattern is captured in `bug_patterns.md`.

**Fixed:** BUG-001 (FAQ a11y), BUG-002 (authStore double-fire), BUG-003 (PaymentSheet a11y), BUG-004 (Home FAB → inline modal), BUG-005 (FilterPills 44px), BUG-006 (TopBar gear 44px), BUG-007 (StartSession back/chips 44px), BUG-008 (player name maxLength), BUG-009 (handleStop route), BUG-010 (SessionDetail 44px), BUG-011 (Indian formatting in rows), BUG-012 (Modal escape + scrim z-index), BUG-013 (Settings status='none' card), BUG-015 (Google OAuth account picker), BUG-016 (PaymentBottomSheet escape paths), BUG-017 (handlePayNow timeout + error handling).

**Also shipped:** Playwright suite — 8 spec files × 3 viewports.

---

## 25 May 2026 — Razorpay + Auth bug session (4 commits)

**Context:** First real end-to-end payment attempt on production (clubkeeper.vercel.app) surfaced two live bugs.

**Commits shipped:**
1. `7ad20b1` — `diag: surface real Razorpay error in create-subscription` — patched catch block to log `JSON.stringify(err)` and return `{ message, code, razorpayStatus }` (was returning generic `{ error: '...' }`)
2. *(plan-IDs fix)* — `fix: replace razorpay plan IDs to match active account` — recreated all 6 plans in the correct Razorpay account; replaced IDs in `src/lib/razorpayPlans.ts`
3. `b99388b` — `diag: log AuthCallback + authStore lifecycle to find hang` — added `try/finally` to `initialize()` (loading=false now guaranteed); added diagnostic console logs; added `user` to AuthCallback useEffect deps; aligned server error response shape to `{ message }`

**Bugs fixed:**
- **BUG-018** — Razorpay 400: plan IDs were from a different account than the active key
- **BUG-019** — Server returned `{ error }` but frontend read `.message` — real error description was silently swallowed
- **BUG-020** — Auth hang: `initialize()` had no `try/finally` on `loading=false`; a `refreshProfile()` throw left loading=true forever

**Verified end-to-end on production:**
- ✅ Google OAuth → `/auth/callback` → `/subscribe` (new user flow)
- ✅ Subscribe page → Start Free Trial → Razorpay Checkout opens → payment completes → free trial subscription created in Razorpay (TEST mode)
- ✅ `/api/create-subscription` returns 200 with `subscriptionId` + `shortUrl`

**New patterns added:** S5 extended (key+plan account matching + curl verification), S6 (API response shape contract), A5 (try/finally on loading flags).

---

## Manual setup steps — status

### ✅ Done
- Supabase tables + RLS + `handle_new_user()` trigger
- `.env.local` populated (Supabase URL + anon key)
- GitHub repo at `github.com/Sugeet21/clubkeeper`
- Vercel auto-deploy from main
- Razorpay plan IDs created in dashboard (TEST mode)

### ⏳ Pending (historical snapshot — CORRECTED 7 Jul 2026: LIVE mode + E2E payment test are DONE)
- ~~**Razorpay LIVE mode switch** (needs KYC first)~~ — DONE: LIVE mode in production since 24 Jun 2026, auto-pay collecting ₹599.
- ~~**End-to-end payment test on deployed Vercel**~~ — DONE (25 May TEST-mode E2E; LIVE billing validated via ₹10 test plan, 4 Jun).
- **Razorpay webhook config** — still tracked in SKILL.md Pending (Dashboard webhook URL + `RAZORPAY_WEBHOOK_SECRET` in Vercel env → redeploy; events: `subscription.authenticated/.activated/.charged/.halted/.cancelled/.completed`, `payment.failed`).

---

## 27 May 2026 — Session Items (POS) + UPI QR + Stop-Session improvements (commit `3c0ca58`)

### Build Prompt 1 — Session Items (POS)
**Shipped:**
- `src/types/index.ts`: `SessionItem` interface; `ClubSettings.upiId?: string`
- `src/db/database.ts`: Dexie v3 (`sessionItems: '++id, sessionId, addedAt'`); v4 documents `upiId` field
- `src/lib/validation.ts`: `validateItemName()` (unicode regex, 1-50 chars); `validateUpiId()` (format `handle@provider`, optional)
- `src/lib/money.ts`: `calculateItemsTotal(items: SessionItem[]): number`
- `src/db/queries.ts`: `addSessionItem`, `updateSessionItem`, `deleteSessionItem`, `restoreSessionItem`; `RecentItem` interface + `getRecentItems(limit=8)` (last 30 days, sorted by useCount)
- `src/hooks/useLiveData.ts`: `useSessionItems(sessionId)`, `SessionWithItems` type, `useSessionsInRange(startMs, endMs)`, `useRecentItems(limit=8)`
- `src/components/AddItemBottomSheet.tsx`: full POS bottom sheet — add/edit/delete items, Undo toast, Pattern M1+M2, 44px touch targets, no maxLength, recent-items chips
- `src/components/ToastContainer.tsx`: renders `actionLabel` Undo button (`z-[60]`); `toastStore` extended with `actionLabel?/onAction?/durationMs?`
- `src/pages/SessionDetail.tsx`: bill split card (Table time + Items + Grand Total); rounding preview before stop; post-stop payment screen with QR
- `src/pages/Home.tsx`: Today total includes items
- `src/pages/Summary.tsx`: full rewrite — `useSessionsInRange`, row amounts include items, CSV has `Table Amount/Items/Total` columns
- `src/pages/History.tsx`: full rewrite — `useSessionsInRange`, day subtotals include items, same CSV format

### Build Prompt 2 — Items v2 + UPI QR + fixes
**Shipped on top of Build Prompt 1:**
- `src/components/PaymentQR.tsx`: new component using `qrcode` npm package — generates UPI deeplink QR as data URL; white bg; loading skeleton; error fallback
- `src/pages/Settings.tsx`: UPI ID field in Club Info section (optional, `validateUpiId` on blur, Save button); rounding-change warning modal if active sessions exist
- `src/pages/SessionDetail.tsx`: post-stop payment screen shows `PaymentQR` if `settings.upiId` set, otherwise plain amount card; "Done — back to tables" button
- AddItemBottomSheet: recent-items chips visible above name input; placeholder changed from "Cigarette" → "Cold drink, Chips, Water bottle"
- Summary + History: fixed row amounts to include items (were showing table-time only)
- Stop confirm: shows rounded time + items + grand total preview before confirming stop

**npm package added:** `qrcode` + `@types/qrcode`

---

## 27 May 2026 — Per-user IndexedDB scoping (LIMIT-001 band-aid)

**What shipped:**
- `src/db/database.ts`: converted from fixed singleton (`ClubKeeperDB`) to a lazy, re-openable holder. Database name is now `ClubKeeperDB_<userId>` (Supabase UUID). Exports: `initDbForUser(userId)`, `closeDb()`, `isDbReadyForUser(userId)`, `getDbName(userId)`. `db` export is a `Proxy` that forwards all property accesses to the current live instance — all 30+ consumers keep `import { db }` unchanged.
- `src/store/authStore.ts`: added `dbReady: boolean` to state. After `getSession()` / `onAuthStateChange` confirms a user, calls `initDbForUser(userId)` + `seedIfEmpty()` then sets `dbReady: true`. On sign-out, calls `closeDb()` + sets `dbReady: false`. `initDbForUser` is idempotent (no-ops if same DB is already open — Pattern A1 safe).
- `src/hooks/useAccessGuard.ts`: added `'db_loading'` guard reason — blocks private routes while `dbReady === false` but auth `loading === false`.
- `src/components/RequireAccess.tsx`: treats `'db_loading'` same as `'loading'` — shows spinner, prevents any Dexie query hitting placeholder DB.
- `src/main.tsx`: removed `seedIfEmpty()` call (was module-load time, before any user is authenticated).

**Result:** Two Gmail accounts on same browser now see isolated data. Account A creates "Pool A" → Account B signs in → sees only seed data. Account A signs back in → "Pool A" still there.

**Not addressed:** cross-device sync (still per-browser-origin). Old `ClubKeeperDB` (no suffix) left on disk for future migration.

---

## 27 May 2026 — Settings redesign + Payment QR viewport fix (Build Prompt 3)

**Settings redesigned with collapsible sections + plain-English copy:**
- `src/pages/Settings.tsx`: full rewrite. Flat 6-section scroll replaced with collapsible section cards. Single `openSection: string` state — only one open at a time. "Club Info" open by default. Section order: Club Info, Tables, Subscription, Data & Backup, About, Account.
- `SettingsSection` component (inline): icon + title + optional badge + chevron. `grid-rows-[1fr/0fr]` animation, no JS lib.
- Subscription section header shows live status badge (Trialing/Active/Inactive/Subscribe) when collapsed.
- Tables section header shows live non-disabled table count.
- Account section shows logged-in email from `authStore.user.email`.
- All existing actions preserved: UPI ID save, Time Rounding (with active-session warning modal), Add Table, Edit Table, Disable Table, Export, Clear sessions, Tidy player names, Reset, Sign out, Subscribe/Change/Cancel.
- Copy updated to plain English — "Export everything", "Clear all sessions", "Tidy player names", "Reset everything".
- `openSection` persisted in `sessionStorage` (UI flag; survives tab navigation, doesn't persist across tabs/devices).

**Payment/QR screen converted to fixed-viewport no-scroll layout:**
- `src/pages/SessionDetail.tsx`: payment screen now uses `fixed inset-0 flex-col` with `flex-1` middle zone. QR sized `min(72vw, 280px)`. "Done" button always pinned at bottom. Bottom nav not shown (screen is `fixed inset-0`, sits above layout).
- Header compact: accent "Session ended" tag + single summary line `Table · Xm · Player` (player omitted if null).
- Duration label: `<1 min` / `12 min` / `1h 12m`.
- No-UPI path: plain amount card, no QR, "Done" still pinned.

---

## 29 May 2026 — V1-LAUNCH plan filter (display-only)

**What shipped:**
- `src/components/subscribe/PlanSelection.tsx`: added `VISIBLE_PLAN_IDS = ['standard']` filter constant. `visiblePlans` derived via `.filter()` before `.map()` — PLANS array (all 3 entries) left fully intact. `BillingToggle` commented out (import also commented) since only monthly is shown. Welcome copy updated from "Pick a plan" to "Start your 7-day free trial".
- `src/components/landing/PricingSection.tsx`: Starter and Pro cards hidden (replaced with `{/* hidden for V1-LAUNCH */}` comments). Only Standard ₹599 featured card renders. Footer tagline updated to "7-day free trial · cancel anytime before day 8." Removed now-unused `STARTER_FEATURES`, `PRO_FEATURES`, `Circle` declarations to prevent TS errors.

**What was NOT changed (by design):**
- `src/lib/razorpayPlans.ts` — all 6 plan IDs intact (Pattern S5 preserved)
- `api/create-subscription.ts`, `api/razorpay-webhook.ts` — no serverless changes
- `PlanId` TypeScript type union — unchanged
- `Subscribe.tsx` — `selectedPlan` already defaulted to `'standard'`; no change needed

**Revert path:** Remove `VISIBLE_PLAN_IDS` filter + `visiblePlans` variable from PlanSelection.tsx, uncomment `BillingToggle`, restore Starter/Pro cards + their data in PricingSection.tsx.

**Build:** ✅ Zero TS errors. `razorpayPlans.ts` git diff = empty.

---

## 30 May 2026 — Wallet / Prepaid Credit (Phase 1)

**What shipped:**

**New types:**
- `src/types/customer.ts` — `Customer` interface (id UUID, phone, name, walkInCode, walletBalance integer rupees, createdAt, lastVisitAt)
- `src/types/walletTransaction.ts` — `WalletTransaction` interface + `WalletTransactionType`, `WalletPaymentMode`, `WalletReferenceType` union types

**DB migration — Dexie v5 (additive only, no `.upgrade()`):**
- `src/db/database.ts`: `customers: 'id, phone, walkInCode, lastVisitAt'` + `walletTransactions: 'id, customerId, createdAt, [customerId+createdAt]'`
- `src/types/index.ts`: `ClubSettings.walkInCounter?: number` added

**Store:**
- `src/store/customerStore.ts` — Zustand store with CRUD, search, topUp, applyManualAdjustment, getTransactionHistory. Phone uniqueness enforced in store layer (not Dexie index). Atomic Dexie transactions for balance + transaction row. `DuplicatePhoneError` custom class with `existingCustomer` payload.

**Lib utilities:**
- `src/lib/walkInCode.ts` — `createWalkInCustomer()`: increments `settings.walkInCounter` + inserts customer in one `db.transaction('rw', settings, customers)` block — crash-safe
- `src/lib/whatsapp.ts` — `buildWhatsAppReceiptUrl()`: builds URL-encoded WhatsApp receipt link

**Pages (4 new):**
- `src/pages/Wallet.tsx` → `/wallet` — search + recent list, live query, "+ New" button
- `src/pages/WalletNewCustomer.tsx` → `/wallet/new` — phone (+91 prefix) or walk-in mode; duplicate phone blocked with toast + profile link
- `src/pages/WalletTopup.tsx` → `/wallet/topup/:customerId` — amount/bonus chips, 3 payment modes, live summary card, inline success screen with WhatsApp receipt link
- `src/pages/CustomerProfile.tsx` → `/customer/:customerId` — live balance, transaction history (compound index), Add Credit + Adjust buttons, inline modals

**Components (4 new):**
- `src/components/wallet/CustomerListRow.tsx` — avatar circle, name+phone-suffix disambiguation, balance in accent, relative date
- `src/components/wallet/TransactionRow.tsx` — icon (↑ free / ↓ busy / ⚙ paused), expandable notes + WhatsApp receipt link
- `src/components/wallet/ManualAdjustmentModal.tsx` — credit/debit toggle, amount, mandatory notes (min 3 chars), Pattern M1+M2, debit > balance blocked
- `src/components/wallet/EditPhoneModal.tsx` — promote walk-in to phone customer (clears walkInCode), duplicate check, Pattern M1+M2

**Wiring:**
- `src/App.tsx` — 4 new routes under `<RequireAccess>`: `/wallet`, `/wallet/new`, `/wallet/topup/:customerId`, `/customer/:customerId`
- `src/components/TopBar.tsx` — wallet icon button added between online dot and gear (`w-9 h-9`, right side); accepts optional `onWalletPress` prop

**Build:** ✅ Zero TS errors. `npm run build` passes.

**Phase 2 (not built):** Session-end "Pay from Wallet" deduction. Data model is ready — `WalletTransaction.referenceType: 'session'` + `referenceId: sessionId` is the pattern.
**Phase 3 (not built):** Refund UI. Pattern: new debit transaction, `referenceType: 'refund'`, mandatory notes.

---

## 30 May 2026 — Wallet Phase 1 Polish (3 fixes + correction)

**Fix 1 — Duplicate phone error overlap on `/wallet/new`:**
- `src/pages/WalletNewCustomer.tsx`: added `phoneErrorCustomerId` state. On `DuplicatePhoneError`, no longer shows a toast — instead renders an inline row below the phone input: error text (left) + "View profile →" button (right). Input border switches to `border-busy` via Tailwind class (was inline `style`). Header stays clean: back button + title only.

**Fix 2 — Manual adjustment rows showing plain number without ₹ or sign:**
- `src/store/customerStore.ts`: `applyManualAdjustment` now writes `type: 'credit'` or `type: 'debit'` (the parameter value), not the hardcoded `'adjustment'`. `referenceType: 'manual'` carries the category.
- `src/components/wallet/TransactionRow.tsx`: added `isDebit` derived boolean; `signedAmount` and `amountColor` branch on `isCredit`/`isDebit`; legacy `'adjustment'` type rows fall through to `₹amount` (no sign, paused color) as a safety net.
- `src/db/database.ts` + `src/types/index.ts`: **Dexie v6** with `.upgrade()` backfill — finds all rows where `type === 'adjustment'`, infers direction by comparing `balanceAfter` to preceding row's `balanceAfter` (or 0 for first row), writes `type: 'credit'/'debit'` + `referenceType: 'manual'`. Sets `settings.legacyAdjustmentsBackfilled = true` as audit flag. Runs exactly once on v5→v6 upgrade.

**Fix 3 — UPI QR component extraction + WalletTopup QR:**
- `src/components/UpiQrCard.tsx` (NEW): shared wrapper around `PaymentQR` — `bg-white rounded-2xl p-3 aspect-square`, `width: min(72vw, 280px)`. Props: `amount`, `upiId`, `payeeName`, `transactionNote`. No store access.
- `src/pages/SessionDetail.tsx`: replaced inline white-card + `<PaymentQR>` with `<UpiQrCard>`.
- `src/pages/WalletTopup.tsx`: replaced inline block with `<UpiQrCard>`. Label changed to "Show this QR to the customer". No-upiId hint: "Set UPI ID in Settings to show QR". Cash/Card: no QR block.

**Build:** ✅ Zero TS errors. `npm run build` passes.

---

## 30 May 2026 — Wallet Phase 1.5: display name helper + EditCustomerModal

**What shipped:**

**New helper — `src/lib/customerDisplay.ts`:**
- `customerDisplayName(c)` — "Rahul" / "Customer" (unnamed+phone) / "Walk-in" (no phone no name). Never conflates anonymous vs unnamed-but-contactable.
- `phoneTail(c)` — " ·4523" or "" for disambiguation
- `customerFullLabel(c)` — list-view label: "Rahul ·4523" / "Customer ·7474" / "Walk-in #WALK-001" / "Walk-in"
- `formattedPhone(c)` — "+91 99219 67474" or null

**Bug fix — "Walk-in" label for customers who have a phone:**
Every inline `customer.name ?? customer.walkInCode ?? 'Customer'` chain replaced with `customerDisplayName(c)` or `customerFullLabel(c)`. Files: `CustomerListRow.tsx`, `CustomerProfile.tsx`, `WalletTopup.tsx`, `whatsapp.ts`.

**New modal — `src/components/wallet/EditCustomerModal.tsx`** (replaces `EditPhoneModal.tsx`):
- Name field (optional, max 40 chars) + phone field (optional, 10 digits)
- Duplicate phone check + inline "View profile →" error (Pattern F7)
- Save disabled if: nothing changed, phone partially entered, would leave customer with neither name/phone AND no walkInCode
- `updateCustomer(id, {name, phone})` — new store method, single Dexie write with phone uniqueness check

**Store update — `customerStore.ts`:**
- Added `updateCustomer(customerId, {name, phone})` — atomically updates both fields + `lastVisitAt` in one Dexie call. Phone duplicate check included.

**CustomerProfile.tsx — expanded tap target:**
- Entire name+phone header block is now a `<button>` that opens `EditCustomerModal`
- Pencil icon stays visible as affordance; tapping name OR phone OR pencil all work
- Import updated from `EditPhoneModal` → `EditCustomerModal`

**whatsapp.ts — signature change:**
- `buildWhatsAppReceiptUrl` now takes `{ customer: Customer, ... }` instead of `{ phone, customerName, ... }`
- Uses `customerDisplayName(c)` for greeting — no more hardcoded `customerName ?? 'Customer'`
- WalletTopup.tsx call site updated to pass `customer: updatedCustomer`

**Build:** ✅ Zero TS errors.

---

## 31 May 2026 — Per-session alarm / notification feature (Dexie v7)

**What shipped:**

**DB migration — Dexie v7 (additive, no `.upgrade()`):**
- `src/db/database.ts`: v7 block — same store strings as v6. Optional fields `notifyAtMs` and `notifyAcknowledgedAt` on sessions default to `undefined` on existing rows (= no alarm).

**Type updates:**
- `src/types/index.ts`: `Session.notifyAtMs?: number | null`, `Session.notifyAcknowledgedAt?: number | null`, `ClubSettings.alarmSoundEnabled?: boolean`, `ClubSettings.alarmVibrationEnabled?: boolean`

**Queries — `src/db/queries.ts`:**
- `startSession()` now accepts optional `notifyAfterMs` param. Writes `notifyAtMs = startedAt + notifyAfterMs` (absolute, not relative). `startedAt` is captured once and used for both fields.
- `acknowledgeNotify(sessionId)` — writes `notifyAcknowledgedAt: Date.now()`
- `snoozeNotify(sessionId, snoozeMs)` — writes `notifyAtMs: Date.now() + snoozeMs`, clears `notifyAcknowledgedAt`

**New hook — `src/hooks/useSessionAlarm.ts`:**
- Returns the first `status === 'running'` session whose `notifyAtMs` has passed and is unacknowledged. Calls `useTick()` for 1s re-renders. Pattern T1 + T4 compliant.

**New component — `src/components/SessionAlarmModal.tsx`:**
- Fullscreen `fixed inset-0 z-50` overlay (Pattern U8). Two-tone Web Audio beep + vibration on mount and again after 30s. No backdrop/ESC dismiss. "Stop session" navigates to session detail. "Snooze" shows preset chips (5/10/15 min) + custom minutes input. Players: Walk-in label for unnamed sessions.

**Home.tsx updated:**
- Imports `useSessionAlarm`, `acknowledgeNotify`, `snoozeNotify`, `SessionAlarmModal`
- `alarmSession = useSessionAlarm(activeSessions)` in render body (Pattern T4)
- Alarm modal rendered when `alarmSession !== null`. Stop handler calls `acknowledgeNotify` then navigates to `/session/:id`.

**StartSession.tsx updated:**
- "Notify me at" field: chip row [None] [30 min] [1 hr] [1.5 hr] [2 hr] [Custom]. Default: None. Custom expands a number input (1–600 min). 44px touch targets. Passes `notifyAfterMs` to `startSession()`.

**Settings.tsx updated:**
- New "Alerts" section between Tables and Subscription. Two toggles: Alarm sound + Vibration (bound to Dexie settings, NOT localStorage). "Test alert" button plays beep + vibrates inline. New `IconAlerts` SVG. `Toggle` component imported.

**References updated:** `data_model.md` (v7 schema table + Session fields + ClubSettings fields), `ripple_effects.md` (alarm files added to Session change list), `decisions_active.md` (alarm pattern + updated Settings section order).

**Build:** ✅ Zero TS errors.

---

## 13 Jun 2026 — Auth fixes (commit e7b0522)

- `authStore.signOut()`: `window.location.href = '/'` hard nav after clearing state. Also resets `loading` + `subscriptionLoaded` flags.
- `supabase.ts`: `storage` option added then removed by linter — session persistence relies on Supabase default.
- `Settings.tsx handleSaveClubName`: fires `updateClubNameRemote()` (new fn, `playerHubApi.ts`) after Dexie write — fire-and-forget Supabase sync with error toast (S1 fix).
- `PlayerHubSettings.tsx handleToggleTopups`: Supabase-first write, Dexie only on success — eliminates permanent desync (S4 fix).
- `AuthCallback.tsx`: 20s safety timeout — toast + navigate to `/` if Supabase hangs.

---

## 12 Jun 2026 — Deploy fix: SPA rewrite + favicon/PWA icons

**Root cause found:** `vercel.json` was missing entirely. Vercel was treating every deep route as a file lookup and returning HTTP 404. The Workbox `navigateFallback: 'index.html'` only works once the service worker is active — useless on first load in incognito or fresh device.

**Changes shipped (commit 9d474b0):**
- `vercel.json` created at project root with catch-all SPA rewrite (excludes `/api/*`)
- `public/favicon.ico`, `public/favicon-16x16.png`, `public/favicon-32x32.png`, `public/apple-touch-icon.png` added
- `public/pwa-192x192.png`, `public/pwa-512x512.png` added (were missing — referenced in vite.config.ts manifest but files did not exist in `public/`)
- `public/logo_master.svg` added
- `index.html` `<head>` updated with `<link rel="icon">` and `<link rel="apple-touch-icon">` tags

**Unblocked by this fix:** Player QR URL (`/c/<slug>`), Poster route (`/poster/<slug>`), Google OAuth callback (`/auth/callback`), all other deep-link routes.

**Files touched:** `vercel.json` (new), `index.html`, `public/` (7 new files)

---

## 10–11 Jun 2026 — Player Hub + ClubCoins + Engagement (commit 969076a)

### Player Hub (Dexie v14)
- Supabase migrations: `20260610_player_hub.sql` (clubs + topup_intents + RPCs) + `20260610_clubcoins.sql` (coins_enabled + coin_tiers_json columns).
- `src/lib/playerHubApi.ts`: full API layer — `getClubPublicInfo`, `submitTopupIntent`, `getTopupIntentStatus`, `getOwnerClub`, `upsertClub`, `updateAcceptsTopups`, `getPendingTopups`, `confirmTopupIntent`, `rejectTopupIntent`, `syncCoinConfig`.
- `src/lib/realtimeTopups.ts` (NEW): Supabase realtime channel `topup_intents_{clubId}` + 5s/30s polling fallback.
- `src/store/topupInbox.ts` (NEW): Zustand store — `pendingCount, modalOpen, usePendingTopupCount`.
- `src/lib/slug.ts` (NEW): `generateSlug`, `validateSlug`, `isSlugAvailable`.
- `src/pages/player/PlayerScan.tsx` (NEW): public `/c/:clubSlug` — form → UPI QR → poll → confirm/reject/expired states.
- `src/pages/player/PlayerScanLayout.tsx` (NEW): minimal public layout.
- `src/pages/Poster.tsx` (NEW): `/poster/:slug` — A4 QR poster, auto-triggers `window.print()`.
- `src/components/PendingTopupsModal.tsx` (NEW): per-row confirm/reject state machine.
- `src/pages/PlayerHubSettings.tsx`: slug setup modal, accept-topups toggle (Supabase-first), coin config editor, engagement config.
- `src/hooks/useLiveData.ts`: `useSyncClubFromSupabase()` added — one-way Supabase→Dexie sync on mount.
- `src/App.tsx`: routes `/c/:clubSlug` + `/poster/:slug` added; `ExpirySweepRunner` added.

### ClubCoins (Dexie v15)
- `src/lib/coins.ts` (NEW): `DEFAULT_COIN_CONFIG`, `coinsEarnedForTopup`, `resolveCoinConfig`, `coinsToRupees`, `coinsToMinutes`, `maxRedeemableCoins`, `formatCoins`.
- `src/components/CoinTiersEditor.tsx` (NEW).
- `src/components/CoinRedemptionPill.tsx` (NEW) — wired into `SessionDetail.tsx:697`.
- `Customer.coinBalance?` · `WalletTransaction.balanceType?/coinDelta?/rupeeEquivalent?`.
- `WalletReferenceType` extended with `coin_redemption`.
- `recordTopupWithCoins` added to `queries.ts` — atomic wallet + coin credit + welcome bonus one-shot.

### Engagement (Dexie v16)
- `src/lib/streak.ts` (NEW): `checkAndAwardStreak` — called from `SessionDetail.tsx:750,801`.
- `src/lib/coinExpiry.ts` (NEW): FIFO lot accounting, `applyExpirySweep` — called every 4h from `ExpirySweepRunner`.
- `src/lib/nudge.ts` (NEW): `renderNudgeTemplate`, `buildWhatsAppLink`, `logNudgeSent`.
- `src/lib/dormancy.ts` (NEW): `getDormantCustomers`.
- `src/components/BringBackList.tsx` (NEW).
- `src/components/NudgeTemplateEditor.tsx` (NEW).
- `src/components/EngagementConfigCard.tsx` (NEW).
- `Customer.firstTopupAt?/lastStreakBonusAt?/expiryAppliedAt?` · `ClubSettings` engagement fields.
- `WalletReferenceType` extended with `coin_expiry, welcome_bonus, streak_bonus, engagement_log`.
- All features **off by default** — master boolean switches.

---

## 10 Jun 2026 — Split payments + Walk-in Quick Sale + PAYMENT MODE + Piggy (Dexie v13)

**Commit:** `576c07c feat(money): split payments + walk-in canteen sale + piggy bank`
**Branch:** `main` (local; not pushed)
**Files:** 17 changed, +2614 / −50.

### Schema (Phase 1)
- Dexie v13 with `.upgrade()` backfill.
- `Session.paymentBreakdown?: { cash, upi, wallet }` — backfilled for completed sessions as `{cash: amount, upi: 0, wallet: 0}` (⚠ items-revenue gap documented).
- New tables `canteenSales` (`id, createdAt, customerId`) and `stockPurchases` (`id, createdAt, canteenItemId, source`).
- `ClubSettings.piggyOpeningBalance?` + `piggyStartedAt?`. Initialised to `0` and `Date.now()` only if absent (no overwrite of owner-set values).
- `WalletReferenceType` adds `'canteen_sale'`.

### Split payment at session stop (Phase 2)
- `src/components/PaymentSplitSheet.tsx` — shared 3-stepper sheet (cash/UPI/wallet) with quick-fill chips, single `canConfirm` boolean for status line + button state + button styling. Inline customer-link picker for wallet payments.
- `recordSessionPaymentBreakdown` — atomic session + wallet + walletTransaction write. Grand total computed inside the tx as `session.amount + Σ(sessionItems)`.
- SessionDetail: existing UPI QR screen preserved (ADDENDUM-1). New "Record payment" button opens the sheet. ADDENDUM-4: "Skip for now" removed; auto-resume on re-mount. ADDENDUM-5: zero-amount sessions auto-write `{0,0,0}`.
- Fixed in-flight: P1 `session.amount` vs `grandTotal` bug; P2 status-line / button-state drift; P3 route-param coercion.

### Walk-in Quick Sale (Phase 3)
- `src/pages/QuickSale.tsx` at `/quick-sale` — tappable item cards, cart, sticky bottom bar, reuses PaymentSplitSheet.
- "+ Quick Sale" pill on TopBar's date subtitle row (right-aligned in row 2 of restructured TopBar).
- `createCanteenSale` — atomic stock aggregation + decrement + wallet debit + CanteenSale insert (Pattern D7).
- Summary canteen tile + headline include walk-in revenue.

### Summary PAYMENT MODE strip (Phase 4)
- `src/pages/summary/PaymentModeStrip.tsx` — three tiles (CASH=accent, UPI=text-dim, WALLET=paused) + 6px split bar between Tables-vs-Canteen and the heatmap.
- Aggregates across stopped sessions + canteen sales for the viewed date. Excludes running sessions with "Excludes N running session(s)" caveat (Pattern T4 preserved on headline).
- Largest-remainder percent rounding so tiles sum to exactly 100. Section hidden when total is zero.

### Piggy bank + Restock (Phase 5)
- `getPiggyBalance()` derives live: `opening + Σ cash(sessions/sales/wallet-credits) − Σ piggy-restocks`, scoped to `piggyStartedAt`. Returns negative as-is; UI clamps to ≥ 0 + warning.
- `recordStockPurchase()` — atomic StockPurchase insert + currentStock increment (when stockEnabled).
- `src/components/RestockSheet.tsx` — bottom sheet on each canteen item card. Piggy chip disabled when `cost > piggy`.
- `src/pages/summary/CashFlowStrip.tsx` — PIGGY + STOCK BOUGHT TODAY tiles between PAYMENT MODE and the heatmap.
- `src/pages/Piggy.tsx` at `/piggy` — current balance, opening-balance editor, cash collected by week, restocks split by source.
- Settings "Piggy (cash float)" section between Subscription and Data & Backup.

### Business impact
- Ball Bender can split a bill across cash + UPI + wallet at session end and at walk-in canteen sales.
- Daily PAYMENT MODE breakdown on Summary for ledger reconciliation.
- Piggy bank tracks the till's cash float without an extra ledger table — derived from existing rows + `piggyStartedAt` window.

### Known gaps (deferred)
- Pre-v13 sessions' items revenue not included in `paymentBreakdown.cash` (the upgrade used `session.amount` alone). PAYMENT MODE tile understates cash for historic dates. Piggy unaffected (cuts off at migration time). Fix only when Ball Bender notices.
- No CSV export columns for paymentBreakdown yet.
- No edit/refund flow for paymentBreakdown in v1.

### What's now testable
- Stop a session → Record payment → split cash + UPI + wallet → DB has `paymentBreakdown` set, customer wallet debited atomically.
- Tap + Quick Sale on Home → cart items → pay → CanteenSale row + stock decrement + (optional) wallet debit all atomic.
- Summary PAYMENT MODE strip aggregates today's payment splits across both sessions and canteen sales.
- Settings → Piggy → Set opening balance → Summary PIGGY tile reflects it. Restock from /canteen with source=Piggy → piggy drops by cost; source=Other → unchanged.

---

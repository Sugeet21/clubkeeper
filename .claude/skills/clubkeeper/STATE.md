# STATE — what is true right now

**Last verified: 11 Jul 2026 (CLI session, D6 tail — staff-write RLS fix migration APPLIED by owner; #130/#131 E2E-verified fixed, awaiting owner close; #132/#133 filed from verification).**
Rules for this file: OVERWRITE in place, never append (Rule G lives here). One line per module. No commit SHAs, no build sizes, no dates inside status lines — history belongs in `references/history/changelog.md` + `git log`. Pending entries are deleted the moment they resolve. **claude.ai sessions:** if the stamp above is more than ~7 days old, say so to Sugeet and trust GitHub/his answers over this file.

## Current focus

Phase D (staff login, tracking issue #128) — D0–D6 done (plan `references/phase_d_plan.md`; matrix amended: staff keep back-entry creation, staff can create customers; `20260710` migration APPLIED; staff admin endpoints + client role state + staff sign-in + RPC gate + claim-gated seed + staff Account card + operations role gates + commerce role gates (Canteen/CustomerProfile/Piggy, Pattern A12) all shipped; `20260710_phase_d6_staff_write_rls_fix` APPLIED — staff commerce writes E2E-verified, #130/#131 fixed and awaiting owner close). **Verification found #132 (P1: staff RLS exclusion list misses `reference_type='manual'` — real adjustment shape passes RLS, UI gate is the only barrier; needs a one-line follow-up migration + affects the D9 forbidden-write proof) and #133 (P2: `created_by` NULL on all wallet_transactions rows — no server-side attribution; wants `default auth.uid()`).** Next chunk: D7 (routes/nav/Summary role gates, before D9). **D9 blocker: #129 — pre-Phase-C rows (incl. ALL of game_tables) were never backfilled to Supabase; needs its own chunk before D9.** Phase D code reaches prod on next push to `main`. Phase C tail: #125/#126 verification outstanding. Immediate P1: #127 (player booking broken post-v20, migration held by owner).

## Module status (one line each — overwrite in place)

- **Sync (Phase C)** — Write path (outbox + SyncRunner on lock-free `supabaseSync`) + read path (SyncReader: serialized queue, direct-apply LWW on epoch-ms, 4 realtime channel groups, 30s-grace/60s polling fallback) LIVE across all 9 tables; write-site cutover 100% (#122/#126/#124 — incl. session-item soft-delete + `!deletedAt` filters on every session_items reader), runtime-proven (delete/undo/ghost-pull rounds, outbox 0); #125/#126 pending owner verification. Contract: `ripple_effects.md` §Sync + Patterns S14–S24.
- **Auth + cardless trial** — Supabase Google OAuth (`select_account`), 7-day cardless trial via Postgres trigger (staff excluded via `ck_role` marker), `subscriptionLoaded` race guard, stranded-lock degraded boot (Pattern A11; #120 fix pending owner verification); staff admin endpoints `api/create-staff.ts` + `api/manage-staff.ts` (D2) + client staff login (D3: `authStore.role` from the JWT claim via `useRole`, collapsed staff sign-in on Signup, staff gate on the owner's subscription via `get_club_subscription_status()` RPC, staff renew-card on Subscribe) + claim-gated demo seed and staff-only Account card in Settings (D4) + operations role gates via `RoleGuard` `<OwnerOnly>`/`<HideForStaff>` — SessionDetail edit/move, History staff = back-entry card only, Home Add-Table FAB (D5, Pattern A12) + commerce role gates — Canteen item-CRUD/restock/peak-management, CustomerProfile adjust/edit, Piggy role split; Wallet/WalletNewCustomer/WalletTopup/QuickSale deliberately ungated (D6). Gate map: `ripple_effects.md` §Roles. Staff commerce writes E2E-verified post-RLS-fix (#130/#131); ⚠ #132: staff JWT can still forge `reference_type='manual'` wallet adjustments server-side (UI gate only barrier) until a follow-up migration adds 'manual' to the exclusion list. Route/nav gates land D7.
- **Subscription (Razorpay)** — LIVE mode in production, NACH auto-debit collecting ₹599; V1-LAUNCH shows Standard Monthly only; serverless create/webhook/cancel.
- **Advance booking (#84/#106/#127)** — Owner side + per-club hours + per-30-min-slot advance shipped; player-side #127 code fix landed (table-id retyped `number`→`string` across BookingScreen/PlayerScan/playerHubApi + `PublicTableInfo.id`), pending the `20260708_booking_table_id_uuid` migration run + owner E2E of P1c–P2.
- **Player Hub + topups** — Live: slug setup, `/c/:slug` UPI topup flow with polling, realtime inbox + badge, `/poster/:slug` auto-print.
- **Pricing visibility** — Player-side collapsible pricing card, gated on `acceptsPricingDisplay` + populated `tables_json`.
- **ClubCoins** — Off by default; tiered earn on topup, configurable redemption, FIFO expiry sweep every 4h.
- **Engagement** — Welcome bonus, streak bonus, dormancy nudges, BringBackList — all off by default.
- **Wallet / prepaid credit** — Customers, ledger, top-ups, adjustments, walk-in codes, WhatsApp receipts; refund UI still pending (Phase 3).
- **Canteen + POS stock sync** — Item CRUD, stock pills, RestockSheet; all add/mutate paths sync stock atomically (D7/S24 discipline).
- **Low-stock threshold (#92)** — Owner-configurable 1–999 (default 5) in Settings → Canteen; all surfaces via `getLowStockThreshold()`.
- **Peak pricing (#68)** — Verified; all 4 phases live; canteen-only; QuickSale cart captures price at tap.
- **Quick Sale** — Walk-in canteen sales with PaymentSplitSheet; atomic sale+stock+wallet tx.
- **Split payments + Piggy** — `paymentBreakdown` mandatory capture, PAYMENT MODE + CASH FLOW strips, derived piggy balance, `/piggy` page.
- **Table Move** — Running/paused session to empty same-type same-rate table; single continuous bill.
- **Back entries** — Paper-notebook backfill with canteen items, overlap + stock checks; `per_frame` excluded.
- **Rate card + tolerance billing** — Per-table tiers + tolerance + `minimum|prorated`; snapshots at start; rounding ignored on rate-card sessions.
- **Alarm / notify-at** — Per-session wall-clock alarm; snooze anchors to ORIGINAL fire time (Pattern T6).
- **Summary dashboard** — End-of-day dashboard incl. Quick Sale in all aggregates (Pattern T9).
- **Settings** — Collapsible sections (one open); SaveIndicator on every save site (U10); clubs-row mirrors via `mirrorToSupabaseBySlug` (S11).
- **Import / Export** — Atomic full-DB export/import, `ClubKeeperBackupV21`, 7 typed failure reasons, DEV round-trip self-test.
- **Desktop responsiveness (#91)** — Verified for Tables/Canteen/Bookings/QuickSale/shared Modal/PaymentSplitSheet; Settings + Wallet-topup-success still mobile-only.
- **PWA + deployment** — Vercel auto-deploy from `main`, SPA rewrite, per-user IndexedDB `ClubKeeperDB_<userId>`, custom domain `app.handbookhq.in`.
- **Dexie schema** — **v21 current** (`CURRENT_SCHEMA_VERSION = 21`); v20 was the UUID migration; details in `references/data_model.md`.
- **Bug tracking** — GitHub issues ONLY authoritative; `history/bug_archive.md` is the offline pointer index.

## Load-bearing pending (blocks something; delete when resolved)

- **Vercel webhook config** — Razorpay Dashboard → add `/api/razorpay-webhook` URL + `RAZORPAY_WEBHOOK_SECRET` env in Vercel → redeploy. Until done, subscription status updates rely on the frontend's optimistic refresh only.
- **PWA update banner** — needs `useRegisterSW` + banner UI; without it, users on an old service worker miss new deploys without a hard refresh (root cause of recurring Pattern W1 sessions).
- **Wallet Phase 3 (refund UI)** — `referenceType: 'refund'` + mandatory notes; until built, refunds are manual adjustments.
- **PAYMENT MODE v13 backfill gap** — `paymentBreakdown.cash` understates pre-v13 sessions by items value; defer until Ball Bender notices.
- **Session persistence watch** — `storage` option was linter-removed from `createClient`; monitor for session drops in production.
- **Razorpay key rotation warning** — any rotation of `VITE_RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` requires re-verifying all 6 plan IDs (Pattern S5 curl check).
- **GST invoicing + email notifications** — next sprint.

### Supabase migration ledger (verified against prod 7 Jul 2026 via anon-RPC probe)

APPLIED: `20260602_cardless_trial` (inferred — trials work in prod; confirm on next fresh signup), `20260610_player_hub`, `20260610_clubcoins`, `20260615_enable_realtime`, `20260615_topup_intents_coins_credited`, `20260616_pricing_visibility`, `20260617_booking_intents`, `20260618_booking_cancel`, `20260619_booked_slots_rpc`, `20260622_booking_hours_and_per_slot_advance`, `20260625_phase_c_sync_tables`, `20260628_lww_guard`, `20260702_sync_client_fields`, `20260710_phase_d_staff_login` (owner-run 10 Jul; owner regression proven by fresh sign-in + outbox drain; `get_club_subscription_status()` RPC smoke green for BOTH roles in D3).
UNAPPLIED: `20260708_booking_table_id_uuid` (#127 — retypes `booking_intents.table_id` + `submit_booking_intent.p_table_id` + `get_booked_slots.p_table_id` from `int`→`text`; supersedes the old `p_table_id integer` decls in `20260617`/`20260619`). Paste-ready; awaiting owner run in Supabase SQL editor.
APPLIED (owner-run 11 Jul, policies confirmed in `pg_policies`, staff commerce E2E green): `20260710_phase_d6_staff_write_rls_fix` (#130/#131 — staff branches of `wallet_transactions_insert_own_club` + `canteen_items_insert_own_club` rewritten to the wire contract — Pattern S26). ⚠ its exclusion list has a gap: #132 (`'manual'` missing) — follow-up migration pending.
**Any NEW migration file added under `supabase/migrations/` MUST get a line here (applied or unapplied) in the same session.**

## Open issues — snapshot (GitHub is authoritative; regenerate with `node scripts/sync-state.mjs`)

Hand-notes that survive regeneration: #110/#120/#125/#126 have fixes shipped and only await Sugeet's device verification + "close #NN". #114 & #121 are duplicates — ask Sugeet to close one. #118 (vacuous tsc build gate) is the biggest regression risk in the repo and needs its own triage session. #129 (no backfill of pre-Phase-C rows) blocks Phase D D9. #115 gained an RCA comment (DEV-only StrictMode subscriptionLoaded race — visible as a /settings→/tables bounce on dev cold loads). #130/#131 are E2E-verified fixed (migration applied 11 Jul, proof comments posted) — only await Sugeet's "close #NN". #132 (P1, staff `reference_type='manual'` RLS gap) needs a one-line follow-up migration; #133 (P2, `created_by` NULL everywhere) wants `default auth.uid()`.

<!-- ISSUES:BEGIN (generated — do not hand-edit between markers) -->
**P0:** #97 Accept bookings toggle flips state after navigating away and back (Pat · #100 Time Rounding setting (15 min / 30 min) not applied on session stop (P · #103 isSlugAvailable uses owner supabase client, freezes slug setup Save bu · #110 Sync outbox dead-letters with 'Could not find camelCase column in sche.
**P1:** #56 A2 — Subscribe.tsx hardcoded 1500ms delay instead of waiting for webho · #59 A5 — authStore calls openAndSeed on every INITIAL_SESSION re-fire (ris · #61 P2 — PlayerHubSettings handleSaveSlug crashes if clubName is null · #62 W1 — Wallet.tsx has no fetch cancellation on navigate away (setState o · #63 W2 — WalletTopup.tsx UI freezes if db.customers.get() fails after topu · #65 S2 — Settings reset dialog shows stale session count (count read at re · #67 R2 — Realtime initial count never loads if first fetch throws (no erro · #112 Phase C Chunk 5 — SyncReader: initial pull + realtime + server-side LW · #120 App never boots when a zombie tab strands the GoTrue navigator lock (a · #125 customer.lastVisitAt dropped by sync mappers → pulled customers invisi · #126 ~20 customer/wallet/booking write sites OUTSIDE queries.ts still write · #127 Player booking flow broken post-v20: BookingScreen filters tables to n · #129 Pre-Phase-C rows never backfilled to Supabase: game_tables empty in pr · #130 Staff wallet top-up dead-letters: RLS kind whitelist doesn't match wir · #131 Staff canteen stock decrement dead-letters: syncRunner pushes updates · #132 staff RLS exclusion list misses reference_type='manual': staff JWT can.
**P2 / unlabelled:** #55 #57 #58 #60 #64 #66 #102 #113 #114 #115 #118 #119 #121 #123 #128 #133.
<!-- ISSUES:END -->

## Known limitations

- **LIMIT-001 (resolved):** per-user IndexedDB shipped; cross-device sync live (Phase C); write-site cutover 100% (#122/#126/#124).
- **LIMIT-002:** `/api/*` requires `vercel dev` locally; `npm run dev` returns 404 (friendly error in `handlePayNow`).
- **LIMIT-003 (superseded):** the "build sync at 3+ customer asks" threshold was overridden at 2 asks — sync is built.

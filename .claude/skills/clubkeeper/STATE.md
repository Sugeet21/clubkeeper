# STATE — what is true right now

**Last verified: 8 Jul 2026 (CLI session, live prod probe + `gh issue list`).**
Rules for this file: OVERWRITE in place, never append (Rule G lives here). One line per module. No commit SHAs, no build sizes, no dates inside status lines — history belongs in `references/history/changelog.md` + `git log`. Pending entries are deleted the moment they resolve. **claude.ai sessions:** if the stamp above is more than ~7 days old, say so to Sugeet and trust GitHub/his answers over this file.

## Current focus

Phase C sync cutover tail: Group C write sites (#126), owner verification of #122/#125, then Phase D (staff login) per `references/history/sync_architecture_v2.md` §2–3. Immediate P1: #127 (player booking broken post-v20).

## Module status (one line each — overwrite in place)

- **Sync (Phase C)** — Write path (outbox + SyncRunner on lock-free `supabaseSync`) + read path (SyncReader: serialized queue, direct-apply LWW on epoch-ms, 4 realtime channel groups, 30s-grace/60s polling fallback) LIVE across all 9 tables; `queries.ts` cutover complete through Group B incl. `syncedBatch` mixed-op wrapper; Group C (~20 sites outside queries.ts) open (#126); #122/#125 runtime-proven, pending owner verification. Contract: `ripple_effects.md` §Sync + Patterns S14–S24.
- **Auth + cardless trial** — Supabase Google OAuth (`select_account`), 7-day cardless trial via Postgres trigger, `subscriptionLoaded` race guard, stranded-lock degraded boot (Pattern A11; #120 fix pending owner verification).
- **Subscription (Razorpay)** — LIVE mode in production, NACH auto-debit collecting ₹599; V1-LAUNCH shows Standard Monthly only; serverless create/webhook/cancel.
- **Advance booking (#84/#106)** — Owner side + per-club hours + per-30-min-slot advance shipped; **player-side flow currently BROKEN by #127** (numeric-id filter vs UUID `tables_json`); owner E2E of P1c–P2 still pending.
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
- **`main` not pushed** — local `main` is several commits ahead of GitHub/Vercel (Chunk 5.4 → Group B → #125); production runs pre-Chunk-5.4 code until Sugeet pushes.

### Supabase migration ledger (verified against prod 7 Jul 2026 via anon-RPC probe)

APPLIED: `20260602_cardless_trial` (inferred — trials work in prod; confirm on next fresh signup), `20260610_player_hub`, `20260610_clubcoins`, `20260615_enable_realtime`, `20260615_topup_intents_coins_credited`, `20260616_pricing_visibility`, `20260617_booking_intents`, `20260618_booking_cancel`, `20260619_booked_slots_rpc` (⚠ `p_table_id` still `integer` — #127), `20260622_booking_hours_and_per_slot_advance`, `20260625_phase_c_sync_tables`, `20260628_lww_guard`, `20260702_sync_client_fields`.
UNAPPLIED: none known. **Any NEW migration file added under `supabase/migrations/` MUST get a line here (applied or unapplied) in the same session.**

## Open issues — snapshot (GitHub is authoritative; regenerate with `node scripts/sync-state.mjs`)

Hand-notes that survive regeneration: #110/#120/#122/#125 have fixes shipped and only await Sugeet's device verification + "close #NN". #114 & #121 are duplicates — ask Sugeet to close one. #118 (vacuous tsc build gate) is the biggest regression risk in the repo and needs its own triage session.

<!-- ISSUES:BEGIN (generated — do not hand-edit between markers) -->
**P0:** #97 Accept bookings toggle flips state after navigating away and back (Pat · #100 Time Rounding setting (15 min / 30 min) not applied on session stop (P · #103 isSlugAvailable uses owner supabase client, freezes slug setup Save bu · #110 Sync outbox dead-letters with 'Could not find camelCase column in sche.
**P1:** #56 A2 — Subscribe.tsx hardcoded 1500ms delay instead of waiting for webho · #59 A5 — authStore calls openAndSeed on every INITIAL_SESSION re-fire (ris · #61 P2 — PlayerHubSettings handleSaveSlug crashes if clubName is null · #62 W1 — Wallet.tsx has no fetch cancellation on navigate away (setState o · #63 W2 — WalletTopup.tsx UI freezes if db.customers.get() fails after topu · #65 S2 — Settings reset dialog shows stale session count (count read at re · #67 R2 — Realtime initial count never loads if first fetch throws (no erro · #112 Phase C Chunk 5 — SyncReader: initial pull + realtime + server-side LW · #120 App never boots when a zombie tab strands the GoTrue navigator lock (a · #122 syncWrappers has no mixed-op atomic batch; 8 of 17 Group A mutation si · #125 customer.lastVisitAt dropped by sync mappers → pulled customers invisi · #126 ~20 customer/wallet/booking write sites OUTSIDE queries.ts still write · #127 Player booking flow broken post-v20: BookingScreen filters tables to n.
**P2 / unlabelled:** #55 #57 #58 #60 #64 #66 #102 #113 #114 #115 #118 #119 #121 #123 #124.
<!-- ISSUES:END -->

## Known limitations

- **LIMIT-001 (largely resolved):** per-user IndexedDB shipped; cross-device sync live (Phase C) but write-site cutover incomplete (#126) — data written by non-converted sites doesn't sync yet.
- **LIMIT-002:** `/api/*` requires `vercel dev` locally; `npm run dev` returns 404 (friendly error in `handlePayNow`).
- **LIMIT-003 (superseded):** the "build sync at 3+ customer asks" threshold was overridden at 2 asks — sync is built.

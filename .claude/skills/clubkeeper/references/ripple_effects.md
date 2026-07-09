# Ripple Effects — Change Impact Map

This is the most critical reference file. Consult BEFORE making any code change.

## How to use

1. Find the feature section(s) the change touches (use Quick Index).
2. Read "Files in scope" — candidates to update.
3. Read "Invariants" — rules that MUST hold after the change.
4. Read "Cross-feature ripples" — what else might break outside this feature.
5. After the change, update the section AND bump its "Last updated" date.

## Discipline rules

- If a change isn't documented here, pause and trace before coding.
- Invariants live HERE only. Implementation patterns link to `bug_patterns.md`. Decisions link to `decisions_active.md`. Do NOT duplicate content across files — cross-link instead.
- After every change, update the relevant section's "Last updated" date.

---

## Quick Index

If you're changing... → Read sections...

| Change trigger | Section |
|---|---|
| `GameTable` interface, table CRUD, `TableFormModal` | [Tables](#tables) |
| `Session` interface, `startSession`/`stopSession`, timer, billing dispatch | [Sessions](#sessions) |
| Stop-session flow, pause-first, `pauseForPayment`/`confirmPaymentAndStop` | [Sessions](#sessions), [Payment Split & Payment Mode](#payment-split--payment-mode) |
| `priceForElapsedProrated`/`priceForElapsedMinimum`, `rateCard`, `toleranceMinutes`, `rateCardBilling`, snapshots | [Rate Card & Tolerance Billing](#rate-card--tolerance-billing) |
| `applyRounding`, rounding logic | [Sessions](#sessions) |
| `getElapsedMs`, `calculateAmount`, `Pattern T4` aggregates | [Sessions](#sessions) |
| `moveSessionToTable`, `TableMove`, compatibility checks | [Table Move](#table-move) |
| `createBackEntry`, `BackEntryModal`, overlap detection | [Back Entries](#back-entries) |
| `SessionItem`, `AddItemBottomSheet`, item add/edit/delete + stock sync | [Session Items (POS)](#session-items-pos) |
| `CanteenItem`, stock decrement, `RestockSheet`, `lowStockThreshold`, `canteenMatch.ts` | [Canteen / Stock](#canteen--stock) |
| `peakPrice`, `peakPricingEnabled`, peak window hours/minutes, `PeakWindowBottomSheet`, time-of-day chip pricing | [Peak Hour Pricing](#peak-hour-pricing) |
| `/quick-sale`, `createCanteenSale`, `CanteenSale` | [Quick Sale](#quick-sale) |
| `PaymentSplitSheet`, `recordSessionPaymentBreakdown`, `paymentBreakdown`, Summary PAYMENT MODE | [Payment Split & Payment Mode](#payment-split--payment-mode) |
| `getPiggyBalance`, `StockPurchase`, `recordStockPurchase`, `/piggy`, CASH FLOW strip | [Piggy (Cash Float)](#piggy-cash-float) |
| `UpiQrCard`, `PaymentQR`, post-stop fixed-viewport screen | [UPI QR & Payment Screen](#upi-qr--payment-screen) |
| `Customer`, `WalletTransaction`, `customerDisplay.ts`, `walkInCode.ts`, phone uniqueness | [Wallet & Customers](#wallet--customers) |
| `notifyAtMs`, `useSessionAlarm`, `SessionAlarmModal`, `alarm.ts`, `notifyPresets.ts` | [Alarm / Notify](#alarm--notify) |
| `Summary.tsx`, `summaryMath.ts`, summary sub-components, dashboard tiles | [Summary Dashboard](#summary-dashboard) |
| Tables page (`Home.tsx`), `TableCard`, `FilterPills`, `TopBar` | [Tables Page (Home)](#tables-page-home) |
| `Settings.tsx` collapsible sections, `ClubSettings`, UPI ID, rounding control | [Settings](#settings) |
| `<Modal>`, `<Toggle>`, `<ConfirmModal>`, `<BottomNav>`, theme/spacing/colors/typography | [Shared UI & Theme](#shared-ui--theme) |
| `authStore`, `useAccessGuard`, `RequireAccess`, `AuthCallback`, `subscriptionLoaded`, per-user IndexedDB, cardless trial routing | [Auth & Access Guard](#auth--access-guard) |
| Subscribe page, plan IDs, Razorpay, webhook, `api/*.ts`, Landing/ROI/Pricing | [Subscription & Funnel](#subscription--funnel) |
| New route (public or private), rename route, BottomNav, PUBLIC_PATHS | [Routing & Cross-cutting](#routing--cross-cutting) |
| `/c/:slug`, `/poster/:slug`, PlayerScan, Poster, `playerHubApi.ts`, `supabasePublic.ts`, `slug.ts`, `TopupRealtimeBridge`, three-client rule (Pattern S16) | [Player Hub](#player-hub) |
| Supabase project URL/anon key change, GitHub Actions, keep-alive ping | [Infra: Supabase Keep-Alive](#infra-supabase-keep-alive) |
| `booking_intents`, `db.bookings`, `Booking` interface, `accepts_bookings`/`booking_advance_amount`, `submit_booking_intent`, `get_booking_intent_status`, BookingScreen, PendingBookingsModal, realtimeBookings, bookingInbox, `/bookings`, session linkage | [Advance Booking](#advance-booking) |
| `tables_json`, `accepts_pricing_display`, `syncTablesJsonBySlug`, `PricingCard` | [Pricing Visibility on Player Hub](#pricing-visibility-on-player-hub) |
| `coins.ts`, `CoinRedemptionPill`, `CoinTiersEditor`, `recordTopupWithCoins`, `coins_credited` RPC | [ClubCoins](#clubcoins) |
| `streak.ts`, `coinExpiry.ts`, `dormancy.ts`, `nudge.ts`, `ExpirySweepRunner`, `BringBackList`, engagement config | [Engagement](#engagement) |
| `realtimeTopups.ts`, `topupInbox`, `PendingTopupsModal`, Supabase realtime publication | [Topup Inbox & Realtime](#topup-inbox--realtime) |
| `validation.ts` rules and validators | [Validation](#validation) |
| `getAllDataForExport`, `importEverythingFromFile`, `resetEverything`, `ClubKeeperBackupV16` | [Import / Export / Reset](#import--export--reset) |
| Dexie version bump, `.upgrade()` callbacks, new store | [Schema & Migrations](#schema--migrations) |
| `syncedCreate/Update/SoftDelete/CreateBatch`, `OutboxRow`, `SyncRunner`, `scheduleDrain`, `SyncRunnerBoot`, `_outbox` table, snake_case ↔ camelCase mapping | [Sync (Phase C — outbox + drain engine)](#sync-phase-c--outbox--drain-engine) |

---

## Schema & Migrations

Owns: Dexie version blocks, `.upgrade()` callbacks, additive-only discipline.

Files in scope:
- `src/db/database.ts` — `this.version(N).stores({...})` blocks (keep ALL prior blocks unchanged)
- `src/types/index.ts` — interface additions
- `src/db/seed.ts` — defaults for any new field

Invariants:
- Never edit an existing `this.version(N)` block. Only add new ones.
- Field-only additions don't require a new version block. New INDEX requires one.
- Additive only for existing users — avoid `.upgrade()` that mutates rows unless required, and then test the upgrade path from every prior version.
- The `ClubKeeperDB` class table declarations (e.g. `customers!: Table<...>`) must stay in sync with the latest version's store strings.
- The v6 `.upgrade()` is a one-time backfill of legacy `type:'adjustment'` wallet rows. Do NOT remove (v5 users still need it). Runs inside Dexie's own managed tx — never wrap in an outer `db.transaction()`.
- `ClubSettings.legacyAdjustmentsBackfilled?` is the v6 audit flag — read-only after migration.
- v13 `.upgrade()` items-revenue gap: `paymentBreakdown.cash` understates pre-v13 sessions (used `session.amount` alone, not grand total). Tracked, deferred.
- Renaming a table = existing users' data is gone. Use soft-delete + new-name migration instead.
- **Current version: v20 (Phase B step 2 COMPLETE, 24 Jun 2026).** v20 UUID migration fully shipped. 4 tables (`gameTables/sessions/sessionItems/canteenItems`) use `id` (caller-supplied UUID string). `.upgrade()` callback rewrites all existing numeric-id rows atomically — Phase 1 builds id maps, Phase 2 clear+add rewrites the 4 tables (sessions handles nested `tableMoves[].fromTableId/.toTableId`), Phase 3 `.modify()` rewrites FK fields in `canteenSales`, `stockPurchases`, `bookings`. `_outbox` table added for Phase C. All `number | string` transitional unions collapsed to `string` across `types/index.ts`, `queries.ts`, `StartSession.tsx`, `SessionDetail.tsx`, `QuickSale.tsx`, `Piggy.tsx`. Dual-accept guards removed from `confirmPaymentAndStop` + `recordSessionPaymentBreakdown`. Route-boundary dual-accept parsers removed (Pattern R5 cleanup). `CURRENT_SCHEMA_VERSION = 20`. `ClubKeeperBackupV20` primary; V19/V18/V17/V16 aliased. No pre-v20 auto-backup (owner waived — solo dev, zero paying users on destructive path).
- **Previous: v19 (22 Jun 2026, #106)** adds per-club operating hours + per-30-min-slot advance — `ClubSettings.bookingOpenMinutes?`, `bookingCloseMinutes?`, `bookingAdvancePerSlot?`. `bookingAdvanceAmount` retained as @deprecated for Dexie/Supabase back-compat. Additive only, no `.upgrade()`, no index changes (schema string identical to v18). v18 (19 Jun 2026) added Peak Hour Pricing optional fields — `CanteenItem.peakPrice?` and `ClubSettings.peakPricingEnabled?/peakStartHour?/peakStartMinute?/peakEndHour?/peakEndMinute?`.

Cross-feature ripples:
- → [Import / Export / Reset](#import--export--reset): adding a Dexie table requires updates in `CURRENT_SCHEMA_VERSION`, `getAllDataForExport`, `importEverythingFromFile`, AND `resetEverything` (Pattern: three-way drift causes silent data loss — see #78, #81).
- → Any feature owning the interface being extended.

See also: `bug_patterns.md` (Dexie patterns), full Dexie version history in `data_model.md` (current version lives in `STATE.md`).

Last updated: 24 Jun 2026 (v20 Phase B step 2 — .upgrade() shipped, all number|string unions collapsed, dual-accept guards removed)

---

## Sessions

Owns: `Session` interface, session lifecycle (start/pause/resume/stop), timer math, billing dispatch, rounding, stop-session pause-first flow.

Files in scope:
- `src/types/index.ts` — `Session`, `PaymentBreakdown`, `TableMove`
- `src/db/queries.ts` — `startSession`, `pauseSession`, `resumeSession`, `stopSession`, `editSessionStart`, `pauseForPayment`, `confirmPaymentAndStop`, `cancelPaymentAndResume`
- `src/lib/time.ts` — `getElapsedMs`
- `src/lib/money.ts` — `calculateAmount`, `applyRounding`
- `src/lib/summaryMath.ts` — pure aggregation called from Summary render body
- `src/pages/SessionDetail.tsx` — big timer, stop-confirm preview, bill split, edit start time, alarm pill, table-move button, payment-split flow
- `src/pages/StartSession.tsx` — alarm chips, `notifyAfterMs`
- `src/pages/Home.tsx` — `runningAmount` in render body, `todayTotals`
- `src/pages/Summary.tsx`, `src/pages/History.tsx` — aggregation + CSV
- `src/components/TableCard.tsx` — running amount chip, "Paying…" badge
- CSV export columns in Summary and History

Invariants:
- `calculateAmount(session, elapsedMs, rounding?)` dispatch order MUST remain: (1) `per_frame` → `(framesPlayed ?? 0) × rateSnapshot`; (2) `rateCardSnapshot` non-empty → prorated or minimum based on `rateCardBillingSnapshot ?? 'prorated'`, rounding IGNORED; (3) legacy linear → rounding applied, then `hours × rateSnapshot`. **Pattern T8.**
- Rate card snapshots are always captured together at `startSession` time (Pattern T7): `rateCardSnapshot`, `toleranceMinutesSnapshot`, `rateCardBillingSnapshot`.
- Rounding is final-amount only — `applyRounding` is called only in `stopSession` and in the stop-confirm preview. Both call sites must use identical inputs or preview and stored value diverge.
- Stop-session flow is PAUSE-FIRST: SessionDetail UI calls `pauseForPayment` → `PaymentSplitSheet` → `confirmPaymentAndStop`. NEVER call `stopSession()` directly from SessionDetail UI. `stopSession()` remains for back-entry and legacy programmatic stops.
- Only ONE post-Stop screen exists (#77, 14 Jun 2026) — the POST-confirm screen driven by `confirmedBreakdown.upi`. Legacy pre-record full-amount QR (`paymentScreenOpen`) is deleted. `PaymentSplitSheet` opens directly after Pause.
- `Session.paymentInProgress?: boolean` is set by `pauseForPayment`, cleared by both confirm and cancel.
- "Paying…" badge on `TableCard` requires `session.paymentInProgress === true` on the paused branch (distinct from regular "Paused").
- `Session` has NO `customerId` field. Wallet linkage = `WalletTransaction.referenceId = sessionId.toString()`.
- **Pattern T4** for any aggregate including running sessions: DB-static sums in `useLiveQuery`; running-session calc in render body via `getElapsedMs`+`calculateAmount`; combine. NEVER place the running calc inside `useLiveQuery`.
- 13 callers of `calculateAmount` — verify all after any signature change (`TableCard`, `SessionDetail`, `Home`, `Summary`, `History`, `stopSession`, `summaryMath`, plus CSV export columns).

Cross-feature ripples:
- → [Rate Card & Tolerance Billing](#rate-card--tolerance-billing) (snapshot fields, dispatch).
- → [Payment Split & Payment Mode](#payment-split--payment-mode) (pause-first flow, `paymentBreakdown`).
- → [Summary Dashboard](#summary-dashboard) (T4 aggregation, PAYMENT MODE tile excludes running).
- → [Tables Page (Home)](#tables-page-home) (`runningAmount`, `todayTotal`).
- → [Alarm / Notify](#alarm--notify) (`notifyAtMs`, snooze anchoring).
- → [Back Entries](#back-entries) (uses `stopSession`-equivalent fields + snapshots).
- → [Table Move](#table-move) (`session.tableId` is always current).

See also: `bug_patterns.md` Pattern T1/T4/T6/T7/T8/M3/P4, `decisions_active.md` (rounding model, snapshot model).

Last updated: 24 Jun 2026 (Phase B step 2 — Session.id/.tableId now string; TableMove.fromTableId/.toTableId now string; dual-accept guards removed)

---

## Rate Card & Tolerance Billing

Owns: tiered pricing model, two billing algorithms, snapshots at session start.

Files in scope:
- `src/types/index.ts` — `RateTier`, `GameTable.rateCard?`, `GameTable.toleranceMinutes?`, `GameTable.rateCardBilling?`, `Session.rateCardSnapshot?`, `Session.toleranceMinutesSnapshot?`, `Session.rateCardBillingSnapshot?`
- `src/lib/money.ts` — `priceForElapsedProrated()`, `priceForElapsedMinimum()` (renamed from `priceForElapsed`, 9 Jun 2026), `calculateAmount` dispatch
- `src/db/queries.ts` — `startSession` snapshots all three fields together
- `src/db/seed.ts` — seed tables with `rateCard` must include `rateCardBilling: 'prorated'`. Pool 1 seed: 6-tier example (30/60/90/120/150/180 → 70/100/170/200/270/300, tolerance 10, prorated). UI calls it "standard preset", never "Ball Bender".
- `src/components/TableFormModal.tsx` — collapsible Tiered Pricing section, tier rows, tolerance input, "Use standard preset" button (3-tier default), Billing Behavior toggle
- `src/lib/validation.ts` — `validateRateCard(tiers, toleranceMinutes, billingMode?)`
- Dexie: v10 added `rateCard`/`toleranceMinutes` + snapshots; v11 added `rateCardBilling` + its snapshot. Both additive.

Invariants:
- `priceForElapsedProrated(elapsedMs, tiers, toleranceMinutes)`: em ≤ 0 or no tiers → 0; em < tier1.minutes → linear ramp 0 → tier1.price; em ≤ tiers[i].minutes + tolerance → plateau at tiers[i].price; between tiers → linear interpolation; past last tier + tolerance → extrapolate at `last.price / last.minutes` per minute.
- `priceForElapsedMinimum(elapsedMs, tiers, toleranceMinutes)`: em ≤ 0 or no tiers → 0 (guard added 9 Jun 2026); `billable = ceil(em/60000)`; first tier where `billable ≤ tier.minutes + tolerance` wins; overflow past last tier → `last.price + ceil(billable − last.minutes − tolerance) × perMinRate`.
- Rounding setting is IGNORED on rate-card sessions for BOTH modes (the tier+tolerance IS the rounding).
- Existing sessions without snapshots get `undefined`, fall back to `'prorated'` via `?? 'prorated'` in `calculateAmount`.
- Validation: 1–12 tiers, ascending unique minutes, prices 1–99999, tolerance 0–60.
- Settings rounding control shows dim hint when any table has a rate card.

Cross-feature ripples:
- → [Sessions](#sessions) (`calculateAmount` dispatch, snapshot capture).
- → [Table Move](#table-move) (compatibility check uses all six fields including rate card tiers, mode, tolerance — fix #72).
- → [Tables](#tables) (TableFormModal Tiered Pricing UI, validation).

See also: `bug_patterns.md` Pattern T7 (snapshot together), Pattern T8 (dispatch order).

Last updated: 14 Jun 2026

---

## Tables

Owns: `GameTable` interface, table CRUD, `TableFormModal`, `TableCard`, seed data.

Files in scope:
- `src/types/index.ts` — `GameTable` interface (source of truth)
- `src/db/database.ts` — schema if new INDEX needed
- `src/db/queries.ts` — `addTable`, `updateTable`, all readers
- `src/db/seed.ts` — seed data must include all required fields
- `src/pages/Settings.tsx` — table list display inside Tables collapsible section
- `src/components/TableFormModal.tsx` — add/edit form (3 call sites: Settings Add, Settings Edit, Home FAB). Props: `{ open, onClose, table?, existingTables }`. ADD mode = no `table` prop. `existingTables` always receives the full current array (for duplicate-name check).
- `src/components/TableCard.tsx` — Home card with 4 visual states (Free, Busy, Paused, Out of Service)
- `src/pages/StartSession.tsx`, `src/pages/SessionDetail.tsx` — consume table fields

Invariants:
- `<TableCard>` visual regression: 4 states must be verified on every change.
- `TableFormModal` is shared between ADD and EDIT — any prop addition updates all 3 call sites.
- Removing a field requires a Dexie version bump + upgrade function.
- Export format includes tables — new shape must be verified.

Cross-feature ripples:
- → [Schema & Migrations](#schema--migrations) (any field change).
- → [Rate Card & Tolerance Billing](#rate-card--tolerance-billing) (TableFormModal Tiered Pricing).
- → [Pricing Visibility on Player Hub](#pricing-visibility-on-player-hub) (TableFormModal mirrors `tables_json` after Dexie write).
- → [Sessions](#sessions) (rate snapshots read from table at `startSession`).

Last updated: 16 Jun 2026

---

## Table Move

Owns: moving a running/paused session to another empty table of the same shape.

Files in scope:
- `src/types/index.ts` — `TableMove { fromTableId, toTableId, movedAt }`; `Session.tableMoves?: TableMove[]`
- `src/db/database.ts` — v9 (additive, no index)
- `src/db/queries.ts` — `moveSessionToTable(sessionId, toTableId)`; `IncompatibleTableError`, `TableOccupiedError`
- `src/pages/SessionDetail.tsx` — `MoveTableModal`, `MoveTableList` (mirrors compatibility filter), `MoveIcon`, move button, Table Journey row
- `src/pages/History.tsx` — `↻ N tables` subtitle in `SessionRow` when `tableMoves.length > 0`
- `src/pages/Home.tsx` — NO change. `sessionMap` keys on `s.tableId`; live query re-fires automatically.

Invariants:
- `session.tableId` always points to the CURRENT (latest) table after any moves. `tableMoves` records the journey. Existing queries that filter by `tableId` continue working.
- Single `db.transaction('rw', db.sessions, db.gameTables)` in `moveSessionToTable`.
- Validation: status running/paused; dest exists + not outOfService; gameType matches; rate matches per billing mode; dest not occupied.
- **Compatibility (six fields — fix #72, 14 Jun 2026):** (1) gameType equal; (2) per_hour → ratePerHour equal; (3) per_frame → ratePerFrame equal; (4) deep-equal rate card tier array if either has one; (5) `(srcTable.rateCardBilling ?? 'prorated')` equal; (6) `(srcTable.toleranceMinutes ?? 10)` equal when either has rate card.
- `MoveTableList` (UI filter) and `moveSessionToTable` (server check) MUST stay in sync — same six checks.
- `IncompatibleTableError`/`TableOccupiedError` are caught for inline error display (Pattern F7). Never show a toast for these.
- Subtitle rule: when `session.rateCardSnapshot?.length` is truthy, show "Same rate card" instead of "Same rate (₹X/hr)".
- Scope exclusions: no cross-game-type moves, no per-segment billing, no undo, no swap of two running sessions.
- "Move table" button hidden for completed sessions.

Cross-feature ripples:
- → [Sessions](#sessions) (writes `tableId` + `tableMoves`).
- → [Rate Card & Tolerance Billing](#rate-card--tolerance-billing) (compatibility uses rate card fields).
- → [Tables Page (Home)](#tables-page-home) (live re-fire, no code change).

See also: `bug_patterns.md` Pattern F7 (inline error vs toast).

Last updated: 14 Jun 2026

---

## Back Entries

Owns: retroactively logging a completed session from a paper notebook.

Files in scope:
- `src/types/index.ts` — `Session.isBackEntry?: boolean`
- `src/db/database.ts` — v12 (additive, no index)
- `src/db/queries.ts` — `createBackEntry`, `BackEntryInput`, `BackEntryItemInput`, `BackEntryOverlapError` (`.conflictingSession: Session`), `InsufficientStockError(available, itemName)`
- `src/lib/validation.ts` — `validateBackEntry` (reuses `validatePlayerName`, `validateNote`)
- `src/components/BackEntryModal.tsx` — Phase 1 + Phase 2 UI; canteen chips with out-of-stock dimming, draft items list with +/− stepper + × remove, collapsible manual form, price-mismatch inline warning, extended preview (Duration / Table Amt / Items / Grand Total)
- `src/pages/History.tsx` — entry button + modal mount + `Logged` badge on `session.isBackEntry`

Invariants:
- `createBackEntry` runs one atomic `syncedBatch(['sessions','game_tables','canteen_items','session_items'])` (#122, commit b1407e3). The `db.settings` read is HOISTED before the batch (settings is NOT a synced table so it can't ride the tables list; rounding is DB-static config, not part of the atomic overlap/stock guarantee). **Pattern D7** — ALL stock logic inlined inside the callback; never call `decrementCanteenItemStock`, `addSessionItem`, or `addOrIncrementSessionItem` from inside it; never nest `syncedBatch` in an outer `db.transaction()`.
- Overlap check covers active AND completed sessions for the same table.
- Rate card snapshots captured together (Pattern T7). `per_frame` tables EXCLUDED — hide in the back-entry table selector.
- Stock aggregation: aggregate `(canteenItemId → totalQty)` across ALL draft items before checking sufficiency — prevents bypass via multiple small rows. `InsufficientStockError` thrown on insufficient stock; full tx rollback.
- Items written with `addedAt: input.endedAt - order * 1000` (anchored inside session window) — NOT `Date.now()`.
- `BackEntryOverlapError` constructor: `(conflictingSession: Session)` — has `.conflictingSession` payload.
- `InsufficientStockError` constructor signature: `(available: number, itemName: string)` — order matters; match exactly.
- Both errors caught inline (Pattern F7); no toast.
- `onSaved(dateISO)` snaps History date range to saved date.

Cross-feature ripples:
- → [Sessions](#sessions) (writes a completed session; uses snapshot fields).
- → [Canteen / Stock](#canteen--stock) (stock decrement inlined, Pattern D7).
- → [Session Items (POS)](#session-items-pos) (item rows written with anchored `addedAt`).

See also: `bug_patterns.md` Pattern D7, Pattern F7, Pattern T7.

Last updated: 9 Jun 2026

---

## Session Items (POS)

Owns: per-session add/edit/delete of snacks/drinks; merge-on-add; bill split; CSV columns.

Files in scope:
- `src/types/index.ts` — `SessionItem` interface
- `src/db/database.ts` — v3 added `sessionItems: '++id, sessionId, addedAt'`
- `src/db/queries.ts` — `addSessionItem`, `addOrIncrementSessionItem` (NEW, sessionItems-only tx — do NOT call from inside an outer tx, Pattern D7), `updateSessionItem`, `deleteSessionItem`, `restoreSessionItem` (returns `Promise<void>`); `InsufficientStockError` (exported)
- `src/hooks/useLiveData.ts` — `useSessionItems`
- `src/lib/money.ts` — `calculateItemsTotal`
- `src/lib/canteenMatch.ts` — `normalizeName`, `findMatchingCanteenItem`, `findMatchingCanteenItemForRow`
- `src/components/AddItemBottomSheet.tsx` — all add/edit/delete UI (4 add paths: canteen chip, quick-add chip, manual matched, manual freeform)
- `src/pages/SessionDetail.tsx` — bill split section, grandTotal, sheet mount
- `src/pages/Home.tsx`, `src/pages/Summary.tsx`, `src/pages/History.tsx` — `todayTotals`, `itemsTotalForDate`, `itemsBySessionId`, CSV columns

Invariants:
- Pattern D7: stock logic in `updateSessionItem`/`deleteSessionItem`/`restoreSessionItem` is INLINED via `findMatchingCanteenItemForRow`. All three run one atomic `syncedBatch(['session_items','canteen_items'])` (#122 for update; #124 for delete/restore). Zero calls to `decrementCanteenItemStock` or `addOrIncrementSessionItem` from inside any outer tx / batch callback. All remain safe to call standalone.
- **Session items are SOFT-deleted (#124).** `deleteSessionItem` = restock + `b.softDelete('session_items')`; the row stays in Dexie with `deletedAt` set. `restoreSessionItem` (Undo) clears the tombstone on the SAME row id via `b.update(..., { deletedAt: null })` — NEVER a fresh-UUID insert (peers would keep the tombstone AND gain a duplicate). The un-delete rides op 'update' because the `soft_delete` push op can only SET `deleted_at`; the `session_items` payload mapper emits an EXPLICIT `deleted_at: null` for it (`undefined` still omits the column). Both are idempotent on `existing.deletedAt` — a double-delete cannot double-restock, a double-undo cannot double-decrement.
- **EVERY `session_items` reader MUST filter `!row.deletedAt`** — a missed filter makes a peer's soft-deleted item ghost into bills/summaries/matching. Filtered sites: queries.ts `pauseForPayment`/`confirmPaymentAndStop`/`recordSessionPaymentBreakdown` (bill totals), `addOrIncrementSessionItem` match, `getRecentItems`; `useLiveData` `useSessionsInRange`+`useSessionItems`; `Home` today-totals; `Summary` dateRevenues+currentDateItems; `AddItemBottomSheet` canteen-add match (the two match filters also prevent a new add from incrementing an INVISIBLE tombstoned row). Raw BY DESIGN: export/import (backup round-trips tombstones), database.ts v20 migration, `updateSessionItem`'s id-targeted get, dev round-trip tool. Any NEW session_items read follows this rule.
- `addOrIncrementSessionItem` merges into existing row by `(sessionId, normalizeName(name), exactPrice)`. Pre-existing distinct rows are NOT auto-merged — only NEW adds merge. qty cap 99.
- Three canteen-matched add paths INLINE merge logic inside their outer tx. Freeform path calls `addOrIncrementSessionItem` standalone.
- Stock can never go negative. qty-up edit or Undo restore that would do so throws `InsufficientStockError`, rolling back both writes.
- Edit modal shows inline error via `setError` (Pattern F7). Undo callback uses toast (justified exception — no inline surface after dismiss).
- `grandTotal` in SessionDetail = `currentSessionAmount + itemsTotal`.
- History CSV has 3 columns: `Table Amount`, `Items`, `Total`.
- toastStore extended with `actionLabel`/`onAction`/`durationMs` for Undo — existing callers (string `show()`) still work.
- Known limitation: freeform rows (no canteen match) never touch stock in any path.

Cross-feature ripples:
- → [Canteen / Stock](#canteen--stock) (stock sync, `canteenMatch.ts`, Pattern D7).
- → [Sessions](#sessions) (`grandTotal` flows into payment split, CSV).
- → [Summary Dashboard](#summary-dashboard) / [Tables Page (Home)](#tables-page-home) (items totals in aggregates).

See also: `bug_patterns.md` Pattern D7, Pattern F7, Pattern S24.

Last updated: 9 Jul 2026

---

## Canteen / Stock

Owns: canteen item master list, stock decrement/restock, low-stock UI, item matching.

Files in scope:
- `src/types/index.ts` — `CanteenItem { id, name, defaultPrice, stockEnabled, currentStock, isActive, createdAt, sortOrder, peakPrice? }`; `ClubSettings.lowStockThreshold?`, `ClubSettings.peakPricingEnabled?/peakStartHour?/peakStartMinute?/peakEndHour?/peakEndMinute?`
- `src/db/database.ts` — v8 adds `canteenItems: '++id, name, isActive, sortOrder'`
- `src/db/queries.ts` — `getCanteenItems(includeInactive)`, `addCanteenItem`, `updateCanteenItem`, `softDeleteCanteenItem`, `decrementCanteenItemStock` (standalone-only — see Pattern D7), `getLowStockThreshold` (implemented #92, with `?? 5` fallback, clamps 1–999)
- `src/pages/Settings.tsx` — the **Canteen section** hosts the numeric `lowStockThreshold` input (#92; moved from Club Info to Canteen on 20 Jun per BUG-S5/#99 — canteen-domain settings co-located). Auto-persists on blur via `handleLowStockBlur` — clamps to 1–999, reverts to current on bad parse.
- `src/db/seed.ts` — `DEFAULT_SETTINGS.lowStockThreshold` (default 5)
- `src/lib/canteenMatch.ts` — `normalizeName` (trim+lowercase+collapse spaces), `findMatchingCanteenItem(name, price, items)`, `findCanteenItemByName(name, items)`. No Dexie imports.
- `src/pages/Canteen.tsx` — list with StockPill, FAB, soft-delete confirm, opens `RestockSheet` from each item card, `StatsRow`
- `src/components/CanteenItemFormModal.tsx` — add/edit form
- `src/components/RestockSheet.tsx` — qty/cost/source/notes; mounted on each item card
- `src/components/AddItemBottomSheet.tsx` — canteen chips, qty stepper stock-max clamp, inline stock decrement tx

Invariants:
- **Boolean filter quirk:** `getCanteenItems` uses `.filter(item => item.isActive === true)` NOT `.where('isActive').equals(1)`. Dexie boolean index quirk — `.equals(1)` never matches `true`. Use `.filter()` for boolean fields even if the field is in the index schema string.
- **Pattern D7 (nested-tx rule):** `decrementCanteenItemStock` has its own internal `db.transaction`. Calling it inside an outer tx causes the inner to commit early; outer throws "Transaction has already completed or failed." → silent partial write (stock decrements, session item not added).
  - In `AddItemBottomSheet.handleSubmit`, stock logic is INLINED inside a single flat outer tx.
  - `decrementCanteenItemStock` remains safe to call standalone.
- All three add paths (canteen chip, quick-add chip, manual matched) run through `findMatchingCanteenItem` and use the SAME inline atomic tx (`runCanteenAddTransaction`).
- Quick Add chips filtered to canteen-matched recent items ONLY.
- Manual form collapsed behind `+ Add other item` button.
- Price mismatch on manual submit shows inline warning (Pattern F7), not toast. "Use ₹X" auto-confirms.
- Locked decision: no auto-save freeform to canteen master list (would let staff typos pollute).
- `RestockSheet`: Piggy chip DISABLED when `cost > piggyBalance`. If user had Piggy selected and cost rose past piggy, `effectiveSource` snaps to Other on confirm. `stockEnabled=false` caveat shown.
- Stock can only grow via restock. `recordStockPurchase` runs one atomic `syncedBatch(['stock_purchases','canteen_items'])` (#122, b1407e3): insert StockPurchase + (if `stockEnabled=true`) `currentStock += qty`.
- **Low-stock threshold (#92, 20 Jun 2026):** all surfaces compute via `getLowStockThreshold()` (Canteen `StatsRow`, `LowStockStrip` count in `Summary.tsx`, `AddItemBottomSheet.fireStockToastIfNeeded` crossing toast). Comparison normalized to `currentStock <= threshold` everywhere (was a mix of `<` and `<=` pre-#92 — see commit). Crossing-into-low rule is `oldStock > t && newStock <= t`. Owner edits in Settings → Club Info → "Low stock alert at" — auto-persists on blur. No Dexie bump (rides v18 as additive optional).
- **Desktop layout (#91 Phase 2, 19 Jun 2026):** `Canteen.tsx` content is wrapped in `<div className="max-w-[1400px] mx-auto px-5">` (the wrapper REPLACES the page's old `<div className="px-5">`; `px-5` stays so card padding doesn't shift on mobile). Item list grid is `space-y-3 md:space-y-0 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-3`. FAB and modals (`CanteenItemFormModal`, `RestockSheet`, delete-confirm) live OUTSIDE the wrapper — never move them inside, they'd anchor to the container right edge instead of the viewport on desktop. **`CanteenItemFormModal` is a shared `<Modal>`** so it inherits the desktop centered-dialog cap from Shared UI. **`RestockSheet` is its own component** — it stays a bottom-sheet on every viewport.

Cross-feature ripples:
- → [Session Items (POS)](#session-items-pos) (Pattern D7, stock sync on edit/delete/undo).
- → [Back Entries](#back-entries) (Phase 2 items: aggregate stock check, Pattern D7).
- → [Quick Sale](#quick-sale) (`createCanteenSale` aggregates qty per item; Pattern D7).
- → [Piggy (Cash Float)](#piggy-cash-float) (`recordStockPurchase`, source=piggy enforcement).
- → [Shared UI & Theme](#shared-ui--theme) (`CanteenItemFormModal` is a `<Modal>` consumer — desktop cap applies).
- → [Tables Page (Home)](#tables-page-home) (same `max-w-[1400px]` + grid + FAB-outside pattern under #91).

See also: `bug_patterns.md` Pattern D7 (nested tx), Pattern F7 (inline error vs toast), `decisions_active.md` (no auto-save freeform).

Last updated: 20 Jun 2026 (#92 — configurable low-stock threshold)

---

## Peak Hour Pricing

Owns: time-of-day pricing for canteen items (#68). Framing locked as neutral time-based pricing — never tied in UI copy to specific product categories. **ALL FOUR PHASES SHIPPED 19 Jun 2026** (P1 schema+Settings aee59da; P2 Canteen card+form d2995fe; P3 AddItem/QuickSale chips b3bf4ce; P4 BulkPeakPriceModal+onboarding 00453da). Verified by owner.

Files in scope:
- `src/types/index.ts` — `CanteenItem.peakPrice?` (optional, undefined = no peak price for this item); `ClubSettings.peakPricingEnabled?` (master toggle, undefined/false = off), `peakStartHour?` (0-23, default 22), `peakStartMinute?` (0-59, default 0), `peakEndHour?` (0-23, default 6), `peakEndMinute?` (0-59, default 0)
- `src/db/database.ts` — v18 adds peak fields; additive only, no `.upgrade()` block, no new indexes, schema string identical to v17
- `src/db/queries.ts` — `CURRENT_SCHEMA_VERSION = 18`; new `ClubKeeperBackupV18` interface; `ClubKeeperBackupV17`/`V16` aliased to V18 (structural superset); `getAllDataForExport()` return type updated. Import/export wiring unchanged — purely additive optional fields flow through `bulkAdd` automatically.
- `src/components/PeakWindowBottomSheet.tsx` — bottom-sheet picker. Start + End time as paired `<select>` dropdowns (hour 0-23 displayed 12-hr AM/PM; minute in 5-min steps). Live preview with duration and "crosses midnight" tag. Save disabled when start === end. Stays a bottom-sheet on every viewport (per canonical exclusion list — small picker sheets don't promote to desktop centered dialog).
- `src/pages/Settings.tsx` — new collapsible section `id="peak-pricing"`, slotted between Piggy (4.5) and Player Hub (4.6). **Compact layout** — toggle row + inline read-only row showing `Peak hours · 10:00 PM → 06:00 AM [Edit]`. Tap `[Edit]` opens `PeakWindowBottomSheet`. Inline row + helper text render only when toggle is ON. Local `IconPeakPricing` + `formatPeakTime12()` helper (promote to `src/lib/peakPricing.ts` in Phase 2 when more callers appear). New state: `peakSheetOpen`.

Files added by later phases (ALL EXIST — shipped 19 Jun 2026):
- `src/lib/peakPricing.ts` (P2) — `PeakConfig`, `getPeakConfig(settings)`, `isInPeakWindow(now, cfg)` (cross-midnight; equals-start inside, equals-end outside), `getEffectivePrice(item, now, cfg)`, `formatPeakWindow/formatPeakEnd`. Returns false immediately when disabled — callers pass unconditionally.
- `src/pages/Canteen.tsx` (P2+P4) — `PriceBlock` stacked two-price card, `Peak · until N` header pill (60s tick gated on `peakCfg.enabled`), permanent "Bulk peak prices" pill, one-time amber onboarding banner (`localStorage('ck_peak_onboarding_seen')` — per-browser; does NOT revive on toggle-off/on).
- `src/components/CanteenItemFormModal.tsx` (P2) — Peak price field, rendered only when `peakPricingEnabled`; empty = no peak price; toggling peak OFF does NOT clear stored `peakPrice` values.
- `src/components/AddItemBottomSheet.tsx` + `src/pages/QuickSale.tsx` (P3) — chips show `getEffectivePrice` + amber `PEAK` pill during the window; QuickSale cart CAPTURES price at first tap (window edge mid-checkout keeps captured price). Quick Add chips + manual freeform intentionally NOT peak-aware.
- `src/components/BulkPeakPriceModal.tsx` (P4) — shared `<Modal>`; diff-only save via `bulkSetCanteenItemPeakPrices` (`put()` with key-drop to clear — `.update(id, {peakPrice: undefined})` would no-op). Partial-failure toast UX tracked as #123; per-row `syncedUpdate` conversion (Chunk 7 Group A) means bulk save is no longer cross-row atomic.

Cross-midnight semantics (must be preserved across all phases):
```ts
function isInPeakWindow(now, start, end) {
  const cur = now.getHours()*60 + now.getMinutes()
  const s = start.h*60 + start.m
  const e = end.h*60 + end.m
  return s > e ? (cur >= s || cur < e) : (cur >= s && cur < e)
}
```
Start inclusive, end exclusive. `s > e` means the window wraps past midnight (e.g. 22:00 → 06:00).

Invariants (apply to all phases):
- **Two principles enforced everywhere:** (1) when toggle is OFF, UI is 100% identical to today across every page — zero new elements; (2) no new icons or colours beyond a single amber/orange accent for the "Peak" pill/tag.
- **No `peakPrice` set on an item** → item never uses peak pricing, no second-line UI, no `PEAK` tag. Phase 2+ must respect this.
- Default values when peak fields are undefined: enabled=false, start=22:00, end=06:00. Centralised in `src/lib/peakPricing.ts` (`getPeakConfig`) since P2 — read fallbacks through it, never inline.
- Owner can always override the suggested price per add (existing AddItemBottomSheet/QuickSale behaviour — must not be broken when Phase 3 lands).
- Framing copy: helper text shown to owner uses *"higher demand and staffing"* as the justification. Never mention specific product categories (tobacco, alcohol, etc.) in any UI string.

Cross-feature ripples:
- → [Canteen / Stock](#canteen--stock) (CanteenItem gains optional `peakPrice` — Phase 2 will add per-item form field + two-price card layout).
- → [Schema & Migrations](#schema--migrations) (Dexie v18 — additive, all defaults at read time, no migration callback).
- → [Settings](#settings) (new collapsible section card; uses existing `SettingsSection`/`Toggle` primitives — no new section-card pattern).
- → [Import / Export / Reset](#import--export--reset) (purely additive optional fields — no changes needed to importer; round-trip self-test counts rows only).
- → [Quick Sale](#quick-sale) (Phase 3: chip shows peak price + `PEAK` tag during window).
- → [Session Items (POS)](#session-items-pos) (Phase 3: `AddItemBottomSheet` chip same treatment).

See also: `changelog.md` (19 Jun 2026 — four entries, P1–P4), GitHub #68 (full UI plan + edge cases; verified by owner), #123 (bulk-save partial-failure toast, open P2).

Last updated: 7 Jul 2026 (section corrected to shipped P1–P4 reality — was stale at "Phase 1 only" since 19 Jun)

---

## Quick Sale

Owns: walk-in canteen sale page (no session).

Files in scope:
- `src/types/index.ts` — `CanteenSale`, `CanteenSaleLineInput`
- `src/db/database.ts` — v13 `canteenSales: 'id, createdAt, customerId'`
- `src/db/queries.ts` — `createCanteenSale`, `CanteenSaleInvalidError`, `CanteenSaleStockError(itemName, available)`, `getCanteenSalesByDate`
- `src/types/walletTransaction.ts` — `WalletReferenceType` extended with `'canteen_sale'`
- `src/pages/QuickSale.tsx` — only writer (v1: no edit flow). Cart with `−`/`✕` controls, sticky Continue-to-Payment, reuses `PaymentSplitSheet`. Post-confirm UPI QR screen (fix #69, 14 Jun 2026) shows only the UPI split amount, not subtotal.
- `src/components/TopBar.tsx` — `+ Quick Sale` pill on date subtitle row (conditional on `onQuickSalePress?: () => void`)
- `src/pages/Summary.tsx` — `canteenSalesForDate` live query feeds canteen revenue tile + PAYMENT MODE + piggy cashIn

Invariants:
- **Pattern D7:** single flat `db.transaction('rw', db.canteenSales, db.canteenItems, db.customers, db.walletTransactions)`. Order inside: (1) aggregate qty per `canteenItemId` and decrement stock (throws `CanteenSaleStockError` if would go negative); (2) wallet debit + `WalletTransaction(referenceType:'canteen_sale', referenceId:saleId)` if `wallet > 0`; (3) insert `CanteenSale` LAST so any earlier throw rolls everything back.
- Out-of-stock cards `opacity-60` + tap blocked + toast.
- Out-of-scope (v1): free-text items (every line MUST match a `CanteenItem.id`), discount, edit/refund/void.
- `customerId` only persisted on `CanteenSale` when `wallet > 0`.
- **Desktop layout (#91 Phase 2.5, 19 Jun 2026):** an inner `<div className="w-full max-w-[1400px] mx-auto">` wrapper surrounds header + items + cart + empty-cart hint. Items grid is `space-y-2 md:space-y-0 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-2`. Cart strip uses the same grid pattern. The sticky bottom bar's BAND spans full viewport (`fixed bottom-0 left-0 right-0`) but its INNER content is wrapped in `<div className="w-full max-w-[1400px] mx-auto px-5">` so Subtotal + Continue button align with the items list. `px-5` moved from the band onto the inner wrapper. **FAB-outside / band-edge-to-edge / inner-content-capped** is the de-facto sticky-CTA pattern for #91 — if Settings or Wallet-topup pages need a sticky bar, mirror this.

Cross-feature ripples:
- → [Canteen / Stock](#canteen--stock) (qty aggregation + decrement).
- → [Payment Split & Payment Mode](#payment-split--payment-mode) (reuses `PaymentSplitSheet` with `total = subtotal`; PaymentSplitSheet now has its own desktop dialog cap — see that section).
- → [UPI QR & Payment Screen](#upi-qr--payment-screen) (post-confirm QR screen, fix #69).
- → [Wallet & Customers](#wallet--customers) (optional wallet debit).
- → [Summary Dashboard](#summary-dashboard) (canteen revenue tile, PAYMENT MODE, piggy cashIn, **topCanteenItems / bucketByHour / rankTables synthetic walk-in row / dateRevenues per-date** — #93, 20 Jun 2026).
- → [Tables Page (Home)](#tables-page-home) (TopBar pill from Home only; same `max-w-[1400px]` + grid pattern).

Last updated: 19 Jun 2026 (#91 Phase 2.5 — QuickSale desktop layout)

---

## Payment Split & Payment Mode

Owns: split-payment capture sheet, `paymentBreakdown` field, Summary PAYMENT MODE strip.

Files in scope:
- `src/types/index.ts` — `PaymentBreakdown { cash, upi, wallet }`, optional `Session.paymentBreakdown?`
- `src/db/database.ts` — v13 `.upgrade()` backfills (NEVER touch); items-revenue gap deferred
- `src/db/queries.ts` — `recordSessionPaymentBreakdown(sessionId, breakdown, customerId?)`, `PaymentBreakdownInvalidError`, `WalletInsufficientError`
- `src/components/PaymentSplitSheet.tsx` — shared between SessionDetail and QuickSale
- `src/pages/SessionDetail.tsx` — `handleConfirmStop` → `pauseForPayment`; `handleCancelPayment`; auto-resume `useEffect` (guards: `autoOpenHandled` + `paymentScreenOpen`); zero-total "Mark as paid" uses `confirmPaymentAndStop` directly
- `src/pages/Summary.tsx` — `paymentMode` `useMemo` (deps: `[detailSessions, canteenSalesForDate]`); legacy filter `paymentBreakdown !== undefined`
- `src/pages/summary/PaymentModeStrip.tsx` — three tiles (CASH/UPI/WALLET) + 6px split bar; `computePercents` largest-remainder rounding to exactly 100

Invariants:
- **Pattern PM2 (single canConfirm boolean — formerly cited here as "M3", which is actually the escape-paths pattern):** `canConfirm = matches && !submitting && totalIsValid` drives BOTH the status line AND Confirm `disabled` AND Confirm visual styling (NOT just `disabled:opacity-40`). Error slot REPLACES the status line; never stack.
- `cash + upi + wallet === session.amount + Σ(sessionItems.price × quantity)` — `grandTotal` computed INSIDE the tx by reading `sessionItems`. `session.amount` alone is time only; using it caused a P0 (see decisions log).
- `wallet > 0` requires `customerId`; sheet enforces in UI, queries enforce at runtime.
- Runtime guard at top of `recordSessionPaymentBreakdown` throws on non-numeric `sessionId` (defence vs route-param leakage).
- `paymentBreakdown` is set ONCE at "Record payment" confirm — NOT at `stopSession`. Between Stop and confirm, the field is `undefined`.
- PAYMENT MODE tile + piggy `cashIn` filter on `paymentBreakdown !== undefined` to exclude the transient state and legacy rows.
- ADDENDUM-4: auto-resume `useEffect` handles BOTH legacy (completed+no breakdown) AND new (paused+paymentInProgress) cases. Guards `autoOpenHandled` + `paymentScreenOpen` prevent re-fire after normal Stop. Pattern P4.
- ADDENDUM-5: `finalGrandTotal === 0` → write `{0,0,0}` directly without opening sheet; button label flips to "Mark as paid"; both manual button AND auto-open path handle this.
- "Skip for now" REMOVED (ADDENDUM-4) — payment capture is mandatory.
- `total` prop = grand total. Caller responsible: sessions = `session.amount + Σ items`; QuickSale = `subtotal`.
- Customer linking is sheet-local. No `Session.customerId`. Durable link = `WalletTransaction.referenceId`.
- **Pattern T4** for PAYMENT MODE: running sessions EXCLUDED (no breakdown yet). Headline `totalRevenue` includes them via render-body `runningRevenueToday`. PAYMENT MODE math stays in `useMemo` (not `useLiveQuery`) since source data is DB-static.
- **Desktop sheet cap (#91 Phase 2.5, 19 Jun 2026):** at `md:` and up the sheet becomes a centered dialog. Main sheet: `md:bottom-auto md:left-1/2 md:top-1/2 md:right-auto md:-translate-x-1/2 md:-translate-y-1/2 md:w-[min(560px,calc(100vw-2rem))] md:rounded-3xl md:border md:max-h-[85vh]`. Inner customer-link picker: same class set with `md:w-[min(520px,calc(100vw-2rem))] md:max-h-[75vh]`. Mobile (<768px) unchanged — both still slide up from `bottom-0` as bottom sheets. **Exception to the "PaymentBottomSheet / PaymentSplitSheet / RestockSheet keep bottom-sheet on every viewport" rule** — PaymentSplitSheet is now the only one of those three that follows the centered-dialog pattern on desktop. Documented at Shared UI & Theme.

Cross-feature ripples:
- → [Sessions](#sessions) (pause-first flow).
- → [Quick Sale](#quick-sale) (sheet reuse).
- → [Wallet & Customers](#wallet--customers) (`WalletTransaction` write on `wallet > 0`).
- → [Piggy (Cash Float)](#piggy-cash-float) (cashIn aggregation from `paymentBreakdown.cash`).
- → [Summary Dashboard](#summary-dashboard) (strip + percent rounding).
- → [Shared UI & Theme](#shared-ui--theme) (PaymentSplitSheet desktop-dialog exception documented there).

See also: `bug_patterns.md` Pattern PM1 (grand-total invariant), Pattern PM2 (single canConfirm boolean), Pattern P4, Pattern T4.

Last updated: 19 Jun 2026 (#91 Phase 2.5 — PaymentSplitSheet desktop dialog cap)

---

## Piggy (Cash Float)

Owns: derived cash-float balance, stock-purchase ledger, `/piggy` page.

Files in scope:
- `src/types/index.ts` — `StockPurchase`, `ClubSettings.piggyOpeningBalance?`, `ClubSettings.piggyStartedAt?`
- `src/db/database.ts` — v13 `stockPurchases: 'id, createdAt, canteenItemId, source'`; v13 `.upgrade()` initialises piggy (`piggyStartedAt = Date.now()`, opening 0) only if absent
- `src/db/queries.ts` — `getPiggyBalance`, `updatePiggyOpeningBalance`, `recordStockPurchase`, `StockPurchaseInvalidError`, `listStockPurchases`, `listStockPurchasesForItem`
- `src/components/RestockSheet.tsx` — only writer of `StockPurchase`
- `src/pages/Canteen.tsx` — opens RestockSheet
- `src/pages/Piggy.tsx` — balance display (clamped ≥ 0), opening + cashIn + restockOut breakdown, started-on date, "Edit opening balance" modal, cash-by-week (this/last/week-before), restocks split by source
- `src/pages/Settings.tsx` — Piggy section between Subscription and Data & Backup
- `src/pages/summary/CashFlowStrip.tsx` — PIGGY + STOCK BOUGHT TODAY tiles
- `src/pages/Summary.tsx` — `piggy` live query feeds CashFlowStrip

Invariants:
- Piggy is a **derived value** — no ledger table, no `piggy_balance` column. Single source of truth = sessions + canteenSales + walletTransactions + stockPurchases + 2 settings fields.
- Formula: `current = opening + cashIn − restockOut` where `cashIn = Σ session.paymentBreakdown.cash (completed, endedAt ≥ piggyStartedAt) + Σ canteenSale.paymentBreakdown.cash (createdAt ≥ piggyStartedAt) + Σ walletTransaction.amount (type='credit', paymentMode='cash', createdAt ≥ piggyStartedAt)`; `restockOut = Σ stockPurchase.cost (source='piggy', createdAt ≥ piggyStartedAt)`.
- Wallet top-ups paid in cash ARE part of piggy (cash is in the till). NOT part of PAYMENT MODE tile (that's revenue only).
- **Window invariant:** every cash-collected sum MUST intersect with `piggyStartedAt`. Cash-by-week in `Piggy.tsx`: `winStart = Math.max(weekStart, since)`. NEVER aggregate cash-in from before piggy was started.
- `getPiggyBalance` tolerates negative `current` (UI clamps to 0 + warning) — escape hatch, not normal path.
- `RestockSheet` Piggy chip enforcement is the ONLY guard against piggy going under ₹0.
- "STOCK BOUGHT TODAY" sums ALL restocks (any source) on the viewed date + count.

Cross-feature ripples:
- → [Canteen / Stock](#canteen--stock) (`recordStockPurchase` increments stock; Piggy chip enforcement).
- → [Payment Split & Payment Mode](#payment-split--payment-mode) (`paymentBreakdown.cash` feeds cashIn).
- → [Wallet & Customers](#wallet--customers) (cash top-ups feed cashIn).
- → [Summary Dashboard](#summary-dashboard) (CashFlowStrip tiles).
- → [Settings](#settings) (Piggy section UI).

See also: `decisions_active.md` (derived value, no ledger table).

Last updated: 10 Jun 2026

---

## UPI QR & Payment Screen

Owns: QR generation, post-stop fixed-viewport overlay, `<UpiQrCard>` sharing.

Files in scope:
- `src/components/PaymentQR.tsx` — generates `upi://pay?...` deeplink QR via `qrcode` pkg. Props: `upiId`, `payeeName`, `amount`, `transactionNote`, `size?` (INTERNAL render res, default 560, NOT displayed CSS size). Output element uses `width:100%; height:auto; display:block` (scales to parent — Pattern U7).
- `src/components/UpiQrCard.tsx` — shared card wrapper. Props: `amount`, `upiId`, `payeeName`, `transactionNote`. No store access.
- `src/pages/SessionDetail.tsx` — post-confirm payment screen, `fixed inset-0 z-50 flex-col` (z-50 covers bottom nav — Pattern U8). QR width `min(72vw, 280px)`. White card `aspect-square flex items-center justify-center p-3`. Middle `flex-1` zone. "Done" pinned in footer `shrink-0`. Padding uses `env(safe-area-inset-top/bottom)`. Captures `finalGrandTotal`+`finalRoundedMs` BEFORE `stopSession()`.
- `src/pages/WalletTopup.tsx` — inline scrollable
- `src/pages/QuickSale.tsx` — fixed-viewport, shows only UPI split amount (fix #69, 14 Jun 2026)

Invariants:
- `upiId` is OPTIONAL. If not set, payment screen shows plain amount card, no QR.
- QR encodes `upi://pay?pa=<vpa>&pn=<clubName>&am=<amount>&tn=<tableName>&cu=INR`. Amount = grand total. Pass raw integer (no zero-pad/format).
- For top-ups, amount is the **paid amount**, NEVER the credited total (bonus is owner-side ledger, never on UPI).
- "Done — back to tables" navigates to `/tables` and clears payment screen state.
- Payment screen is an overlay with NO bottom nav (`fixed inset-0` covers everything).
- Three consumers — change one, verify all three.

Cross-feature ripples:
- → [Sessions](#sessions) (post-stop flow timing — capture before `stopSession()`).
- → [Quick Sale](#quick-sale) (post-confirm UPI screen).
- → [Wallet & Customers](#wallet--customers) (top-up QR).
- → [Settings](#settings) (`upiId` field in Club Info).
- → [Validation](#validation) (`validateUpiId`).

See also: `bug_patterns.md` Pattern U7 (QR sizing), Pattern U8 (z-50 over bottom nav).

Last updated: 14 Jun 2026

---

## Wallet & Customers

Owns: customer master, wallet ledger, display helpers, walk-in codes, wallet pages.

Files in scope:
- `src/types/customer.ts` — `Customer` interface; phone format `+91XXXXXXXXXX` (12 chars)
- `src/types/walletTransaction.ts` — `WalletTransaction`, `WalletReferenceType` (incl. `'session'`, `'canteen_sale'`, `'coin_expiry'`, `'welcome_bonus'`, `'streak_bonus'`, `'engagement_log'`)
- `src/db/database.ts` — v5 adds `customers: 'id, phone, walkInCode, lastVisitAt'` + `walletTransactions: 'id, customerId, createdAt, [customerId+createdAt]'`; v6 `.upgrade()` backfill of legacy adjustment rows; v15 adds `Customer.coinBalance?` + `WalletTransaction.balanceType?/coinDelta?/rupeeEquivalent?`; v16 adds `Customer.firstTopupAt?/lastStreakBonusAt?/expiryAppliedAt?`
- `src/store/customerStore.ts` — `createCustomerWithPhone`, `updateCustomerPhone`, `topUp`, `applyManualAdjustment`, `getTransactionHistory`; `DuplicatePhoneError`
- `src/lib/walkInCode.ts` — WALK-NNN generator
- `src/lib/customerDisplay.ts` — `customerDisplayName`, `phoneTail`, `customerFullLabel`, `formattedPhone`
- `src/lib/whatsapp.ts` — `buildWhatsAppReceiptUrl(customer)`
- `src/components/wallet/CustomerListRow.tsx`, `TransactionRow.tsx`, `EditCustomerModal.tsx` (renamed from EditPhoneModal Phase 1.5)
- `src/pages/Wallet.tsx`, `WalletNewCustomer.tsx`, `WalletTopup.tsx`, `CustomerProfile.tsx`
- `src/components/TopBar.tsx` — wallet icon (right side)

Invariants:
- **Phone uniqueness is enforced in the store, NOT via a Dexie `&phone` unique index.** Multiple null phones (walk-ins) would violate unique index in some browsers. Pre-check + `DuplicatePhoneError` is the only enforcement — do NOT "fix" by adding `&phone` to the schema string.
- Phone format always `+91XXXXXXXXXX`. Display sites do `phone.slice(3)` — any format change ripples to all display sites.
- `ClubSettings.walkInCounter?` — treat undefined as 0; NOT in seed (intentional — undefined → 0 fallback; adding it to seed would reset existing counters on re-seed).
- WALK-NNN walk-in code reads `settings.walkInCounter` in the SAME tx as `customers.add()`.
- **Immutability rule:** no `updateTransaction()`. Corrections = new rows. Do NOT add an update path without a deliberate decision.
- Session debit shape: `{ type:'debit', referenceType:'session', referenceId: sessionId.toString() }`.
- `customerDisplay.ts` rule (Pattern F8): NEVER add inline `customer.name ?? ... ?? 'Customer'` chains. Always use the helper. Three-way distinction (named / unnamed-with-phone / anonymous) is canonical — do not collapse to two.
- `phoneTail` is display-only — never for identity checks or sorting.
- TopBar right side at 360px: online dot + bookings icon (conditional) + canteen + wallet — **NO gear** (removed 18 Jun 2026, #91; Critical Rule 12 — never re-add). Do NOT add another element without removing one or redesigning.
- Wallet routes are private — do NOT add to `PUBLIC_PATHS`. Wallet is NOT a BottomNav tab; accessed via TopBar icon.

Cross-feature ripples:
- → [Payment Split & Payment Mode](#payment-split--payment-mode) (wallet debit in sheet).
- → [UPI QR & Payment Screen](#upi-qr--payment-screen) (top-up QR).
- → [Piggy (Cash Float)](#piggy-cash-float) (cash top-ups feed cashIn).
- → [ClubCoins](#clubcoins) (`coinBalance`, `balanceType`, `coinDelta`).
- → [Engagement](#engagement) (welcome/streak/dormancy writes).
- → [Tables Page (Home)](#tables-page-home) (TopBar layout).

See also: `bug_patterns.md` Pattern F7 (DuplicatePhoneError inline), Pattern F8 (display helper).

Last updated: 14 Jun 2026

---

## Alarm / Notify

Owns: per-session notify-at timestamp, detection, audio loop, modal.

Files in scope:
- `src/types/index.ts` — `Session.notifyAtMs?`, `Session.notifyAcknowledgedAt?`; `ClubSettings.alarmSoundEnabled/alarmVibrationEnabled`
- `src/db/database.ts` — v7 (optional fields, no index, no `.upgrade()`)
- `src/db/queries.ts` — `snoozeNotify` (anchor-to-original — Pattern T6), `updateSessionNotify` (set/clear from now), `startSession` accepts `notifyAfterMs` and writes `notifyAtMs`
- `src/lib/alarm.ts` — `startAlarmLoop` (gain 1.0, looped, 60-sec cap — load-bearing for battery), `playBeepOnce`, `triggerVibration`, `unlockAudio` (iOS unlock)
- `src/lib/notifyPresets.ts` — 30 min / 1 hr / 1.5 hr / 2 hr / custom 1–600 min
- `src/hooks/useSessionAlarm.ts` — detection on `status === 'running'`; wall-clock `now >= notifyAtMs`
- `src/components/SessionAlarmModal.tsx` — fires when threshold met on `/tables`
- `src/components/TableCard.tsx` — bell icon when `notifyAtMs != null && !notifyAcknowledgedAt`; pulsing on running
- `src/pages/StartSession.tsx` — chips set FROM session start
- `src/pages/SessionDetail.tsx` — edit pill sets FROM NOW; opens Modal
- `src/pages/Settings.tsx` — Test alert button uses `playBeepOnce` (ONE beep, NOT the loop)
- `src/App.tsx` — global unlock listener

Invariants:
- Wall-clock semantics: pause does NOT shift `notifyAtMs`. Deliberate — matches phone alarms.
- Paused sessions are deferred (detection requires `running`); completed sessions excluded.
- Snooze anchors to original `notifyAtMs` (Pattern T6) with `Date.now()` fallback if past.
- 60-second auto-stop cap in `startAlarmLoop` is load-bearing — do not remove without explicit decision.
- `NOTIFY_PRESETS` consumed by both StartSession AND SessionDetail edit sheet — change once, both update.

Cross-feature ripples:
- → [Sessions](#sessions) (field on `Session`, written at start, detection on status).
- → [Tables](#tables) (`TableCard` bell icon).

See also: `bug_patterns.md` Pattern T5 (audio unlock), Pattern T6 (snooze anchor).

Last updated: 1 Jun 2026

---

## Summary Dashboard

Owns: end-of-day dashboard at `/summary`, pure aggregation lib, strip sub-components.

Files in scope:
- `src/pages/Summary.tsx` — header w/ compact 44×44 calendar icon, sub-component mounts, render-body Pattern T4 aggregation
- `src/lib/summaryMath.ts` — pure aggregation
- `src/pages/summary/RevenueDeltas.tsx` — yesterday/last week/7d avg delta chips
- `src/pages/summary/RevenueSplitBar.tsx` — tables vs canteen
- `src/pages/summary/PaymentModeStrip.tsx` — CASH/UPI/WALLET tiles + bar
- `src/pages/summary/CashFlowStrip.tsx` — PIGGY + STOCK BOUGHT TODAY tiles → `/piggy`
- `src/pages/summary/HourlyHeatmap.tsx` — collapsible, default collapsed, peak hour labelled
- `src/pages/summary/TopTablesList.tsx` — medal ranked
- `src/pages/summary/LowStockStrip.tsx` — → `/canteen`
- `src/pages/summary/TopCanteenItems.tsx`

Invariants:
- **Pattern T4 (mandatory for any aggregate including running sessions):**
  1. `useLiveQuery` → sum `s.amount` for completed + items (DB-static).
  2. Render body → sum `calculateAmount(getElapsedMs(s))` for `activeSessions`.
  3. Combine: `total = completedFromQuery + itemsFromQuery + runningFromRender`.
  Current correct consumers: `Home.tsx` (`todayTotal`), `Summary.tsx`.
- PAYMENT MODE strip EXCLUDES running sessions (no `paymentBreakdown` yet). Headline `totalRevenue` includes them via render-body `runningRevenueToday`.
- Largest-remainder rounding in `PaymentModeStrip.computePercents` — bar widths and tile percents read same return value.
- Date picker pattern = Pattern U9 (opacity-0 full-size overlay over a label, NOT clip/sr-only). History.tsx date inputs have `cursor-pointer`.
- CASH FLOW PIGGY tile shows `Math.max(0, current)` with "Piggy negative — check restock log" hint when `current < 0`.
- **Quick Sale aggregation (#93 / Pattern T6, 20 Jun 2026):** `topCanteenItems`, `bucketByHour`, `rankTables`, and `dateRevenues` per-date totals MUST include `CanteenSale` rows. Wiring:
  1. `bucketByHour(sessions, itemsBySessionId, canteenSales)` — walk-in revenue lands in the hour of `sale.createdAt`, no sessionCount bump.
  2. `rankTables(sessions, itemsBySessionId, tables, canteenSales)` — synthesises one row `{ tableId: WALKIN_TABLE_ID (-1), tableName: 'Walk-in Canteen', revenue, sessionCount, totalDurationMs: 0 }` when walk-in revenue > 0. `TopTablesList` detects `WALKIN_TABLE_ID` and renders a small "QS" pill in place of the medal + a "N sales" label instead of "sess · avg".
  3. `topCanteenItems(sessionItems, canteenSales, limit)` — both feeds merge into the same `normalizeName`-keyed map.
  4. `dateRevenues` Map gains a `walkInRevenue` field per date; `getDateTotal` and `trailing7Avg` add it to `sessionsRevenue + itemsRevenue`. This is the load-bearing piece — yesterday/last-week/7d-avg deltas RETROACTIVELY recompute on first deploy (correct, but visibly different — flag to owner).
  Empty-state guard in `Summary.tsx` for hourly heatmap widened: render zeros only when `detailSessions.length === 0 && canteenSalesForDate.length === 0`.

Cross-feature ripples:
- → [Sessions](#sessions) (Pattern T4 dependency).
- → [Payment Split & Payment Mode](#payment-split--payment-mode) (strip data).
- → [Piggy (Cash Float)](#piggy-cash-float) (CashFlowStrip).
- → [Canteen / Stock](#canteen--stock) (LowStockStrip).
- → [Quick Sale](#quick-sale) (4 aggregation surfaces — Pattern T6, see invariants above).

See also: `bug_patterns.md` Pattern T4 (origin: BUG-022), Pattern T6 (origin: #93), Pattern U9 (date picker).

Last updated: 20 Jun 2026 (#93 — Pattern T6 Quick Sale aggregation)

---

## Tables Page (Home)

Owns: `/tables` page, table grid, FilterPills, TopBar, today total.

Files in scope:
- `src/pages/Home.tsx` — table grid, `sessionMap`, `todayTotal` (Pattern T4), `runningAmount` in render body, FAB Add Table modal (inline since Phase 2C-1). **Content wrapped in `max-w-[1400px] mx-auto` for desktop responsiveness (18 Jun 2026, #91). FAB stays OUTSIDE the wrapper so it anchors to viewport, not container right edge.**
- `src/components/TableCard.tsx` — 4 visual states (Free, Busy, Paused, Out of Service); "Paying…" badge for `paymentInProgress`; bell icon for armed alarms
- `src/components/FilterPills.tsx` — props `pills`, `active`, `onChange`; all pills `min-h-[44px]`
- `src/components/TopBar.tsx` — two stacked rows. Row 1: "Today" heading + icon group. Row 2: date subtitle + optional `+ Quick Sale` pill. Date `<p>` is `truncate min-w-0`; pill is `shrink-0`. **Right side at 360px (18 Jun 2026, #91): online dot (6px) + bookings (w-9 h-9, conditional) + canteen (w-9 h-9) + wallet (w-9 h-9). NO gear icon — Settings is reachable ONLY via the bottom-nav Settings tab.**

Invariants:
- Touch targets: all FilterPills `min-h-[44px]` (BUG-005); icon buttons `w-9 h-9` (36px tap zone meets 44px on mobile).
- TopBar no longer contains a Settings entry (#91). Adding it back would re-introduce the duplicate-with-bottom-nav crowding that the owner explicitly removed.
- canteen → `/canteen`; wallet → `/wallet`; QuickSale pill → `/quick-sale`; bookings → `/bookings` (conditional on `settings.slug && settings.acceptsBookings`).
- Home is the only consumer of TopBar today; `onQuickSalePress` prop omitted = pill hidden.
- FAB Add Table opens inline `TableFormModal` (NOT navigate to `/settings`) — BUG-004 fix.
- **Desktop grid (#91):** `<div class="px-4 pb-6 space-y-3 md:space-y-0 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-3">` — 1 col mobile, 2 col tablet (≥768px), 3 col laptop (≥1024px). `TableCard` is width-agnostic; safe in any column width down to ~360px.
- **Desktop container (#91):** `max-w-[1400px] mx-auto` wraps install banner, orphaned banner, TopBar/SummaryStrip/FilterPills, `SubscriptionStatusBanner`, and the table grid. FAB and modals must stay OUTSIDE this wrapper (they are `fixed inset-0` / `fixed bottom-X right-Y` and need viewport anchoring).

Cross-feature ripples:
- → [Tables](#tables) (`TableCard` states, `TableFormModal` 3rd call site).
- → [Sessions](#sessions) (Pattern T4 `todayTotal`, `runningAmount`, "Paying…" badge).
- → [Alarm / Notify](#alarm--notify) (bell icon on card, `SessionAlarmModal` mount).
- → [Quick Sale](#quick-sale) (TopBar pill).
- → [Wallet & Customers](#wallet--customers) (TopBar wallet icon).
- → [Canteen / Stock](#canteen--stock) (TopBar canteen icon).
- → [Advance Booking](#advance-booking) (TopBar bookings icon, conditional).
- → [Routing & Cross-cutting](#routing--cross-cutting) (any route rename ripples here).
- → [Settings](#settings) + [Wallet & Customers](#wallet--customers) + [Canteen / Stock](#canteen--stock) + [Advance Booking](#advance-booking): if those pages adopt the same `max-w-[1400px] mx-auto` shell pattern, document the same FAB-outside-wrapper rule on each.

Last updated: 18 Jun 2026 (#91 — desktop responsiveness Phase 1)

---

## Settings

Owns: `/settings` collapsible sections, ClubSettings consumption, plumbing of new settings.

Files in scope:
- `src/pages/Settings.tsx` — `openSection: string` state (one open at a time; `''` = closed). `SettingsSection` (inline, not exported). Animation via `grid-rows-[1fr/0fr] opacity-100/0`. Sections in order: `club-info` (default open, holds name + currency one-liner + UPI + time-rounding), `tables`, `canteen` (low-stock + peak pricing — BUG-S5), `alerts`, `subscription`, `piggy`, `player-hub`, `data`, `about`, `account`. Club Name + UPI Save use `SaveIndicator` (Pattern U10).
- `src/types/index.ts` — `ClubSettings` interface
- `src/db/queries.ts` — `getSettings`, `updateSettings`
- `src/db/seed.ts` — defaults
- `src/hooks/useDexieSetting.ts` — read/write hook for any single ClubSettings field. Dexie-authoritative; caller mirrors to Supabase.
- `scripts/check-settings-pattern.mjs` — lint guard enforcing Pattern R4. Runs in `prebuild` (so `npm run build` fails fast on `useState(settings?.X)` / `useState(settings.X)`). Single allow-comment escape: `// allow-settings-useState: <reason>`. If you rename/move this script, update the `prebuild` and `check:settings` entries in `package.json`. If you add a new field shape Pattern R4 cannot express, extend the script's anti-pattern regex list rather than disabling the lint.
- `.claude/skills/clubkeeper/references/checklists/new_settings_field.md` — mandatory pre-write checklist. SKILL.md routing table cites it; Critical Rule 15 requires it filled in the PR description.
- `sessionStorage['ck_settings_section']` — UI persistence key; cleared on tab close. Safe to read/write.

Invariants:
- When adding a new setting: (1) add to `ClubSettings`; (2) add default to `seed.ts`; (3) **consume it via `useDexieSetting('field', fallback)` — never `useState(settings?.field ??)` + sync effect** (Pattern R4, #97); (4) add UI toggle/input; (5) **plumb into the action that reads it** — most bugs land here (e.g. Prompt 7 rounding); (6) if the field has a public/player-side counterpart, mirror to Supabase in the caller before/after the hook's `setValue`; (7) add test in `test_status.md`.
- Section IDs: if you rename one, `sessionStorage` becomes stale (harmless — no section auto-opens that session).
- Adding a new section: add an `id` here and a `<SettingsSection>` block.
- UPI ID save: saves `undefined` (not empty string) when cleared.
- Rounding control: warns on active sessions via modal (change only affects future stops). Shows dim hint when any table has a rate card.
- Account section shows logged-in email.

Cross-feature ripples:
- → [Sessions](#sessions) (rounding setting consumed in `stopSession`).
- → [UPI QR & Payment Screen](#upi-qr--payment-screen) (`upiId` in Club Info).
- → [Tables](#tables) (Tables section list + Add button).
- → [Auth & Access Guard](#auth--access-guard) (Subscription, Account sections).
- → [Player Hub](#player-hub) (`PlayerHubSettings` slug, Accept topups toggle).
- → [Piggy (Cash Float)](#piggy-cash-float) (Piggy section).
- → [Import / Export / Reset](#import--export--reset) (Data & Backup section).

---

## SaveIndicator (Pattern U10)

Owns: visible state machine for save actions across all Settings save sites.

Files in scope:
- `src/components/SaveIndicator.tsx` — exports `<SaveIndicator state error />` + `useSaveIndicator()` hook returning `{state, error, run(fn)}`. State machine: idle → saving → saved (1.5s auto-reset) → idle, OR idle → saving → error.

Invariants:
- Every save site (button click OR save-on-blur) MUST use `useSaveIndicator().run(async () => { ... })`. Never silently mutate Dexie/Supabase without the indicator.
- Disabled buttons use neutral grey (`disabled:bg-bg disabled:text-text-faint disabled:border disabled:border-border`), NEVER faded primary colour.
- Auto-reset timer is cleared on unmount via the hook's `useEffect` cleanup — safe in modals that close mid-save.

Consumers (must list every one):
- `src/pages/Settings.tsx` — `clubNameSave` (Club Name onBlur) + `upiSave` (UPI Save button).

Cross-feature ripples:
- → [Settings](#settings) (current consumers).
- When adding a new save site anywhere: import `SaveIndicator` + `useSaveIndicator` here, follow Pattern U10. Update this list.

---

## Supabase mirror helper (Pattern S11)

Owns: single path for all writes to the Supabase `clubs` row from owner-side code.

Files in scope:
- `src/lib/mirrorToSupabase.ts` — exports `mirrorToSupabaseBySlug(label, slug, columns)` returning typed `MirrorResult`. Auto-injects `updated_at`. Routes by `.eq('slug', slug)`, verifies with `.select('id')`, warns on zero-row matches and slug_missing.

Invariants:
- Never write `.update({...}).eq(...)` against the `clubs` table directly in feature code. Always go through the helper.
- Helper does NOT swallow errors — returns `{ok: false, reason, detail}`. Quality callers should surface the failure (toast); fire-and-forget callers may discard the result, but the warning still logs.
- `slug_missing` is treated as a non-error (skip + warn), so the helper is safe to call when the owner hasn't set up Player Hub yet.

Consumers (must list every one):
- `src/lib/playerHubApi.ts` — `syncCoinConfig`, `syncTablesJsonBySlug`, `syncBookingConfigBySlug`, `updateClubNameRemote` (slug + clubName), `updateAcceptsTopups` (slug + accepts).
- `src/pages/Settings.tsx` — calls `updateClubNameRemote(slug, name)` from Club Name onBlur via SaveIndicator.
- `src/pages/PlayerHubSettings.tsx` — calls `updateAcceptsTopups(slug, val)` from topup toggle handler.

Cross-feature ripples:
- When adding any new column on `clubs` table that needs to be mirrored from Dexie: extend whichever `playerHubApi.ts` function is closest, or add a new one that calls `mirrorToSupabaseBySlug`. Never inline a direct `.update().eq()` call.
- topup_intents / booking_intents tables are routed by `intent.id` (not slug) — those are owner-side state changes, NOT mirrors, and don't go through this helper.

See also: `decisions_active.md` (collapsible UX choice).

Last updated: 14 Jun 2026

---

## Shared UI & Theme

Owns: `<Modal>`, `<Toggle>`, `<ConfirmModal>`, `<BottomNav>`, theme tokens, typography, spacing.

Files in scope:
- `src/components/Modal.tsx` — 3-region flex layout `max-h-[92vh] flex flex-col`; title `shrink-0`, content `flex-1 overflow-y-auto overscroll-contain`, footer `shrink-0` with `safe-area-inset-bottom`. Optional `footer?: ReactNode` prop pins content outside scroll container.
- `src/components/Toggle.tsx`, `ConfirmModal.tsx`, `BottomNav.tsx`
- `tailwind.config.js` — color tokens
- `src/index.css` — font imports
- `references/design_system.md` — keep in sync

Invariants:
- **Pattern M4 ((Modal layout):** all consumers automatically inherit the scroll fix. If a modal needs pinned action buttons, pass `footer={<Buttons />}` — do NOT move buttons into `children` (they scroll off-screen on small devices).
- Modal scrim is `fixed inset-0 z-40`; sheet is `fixed bottom-0 left-0 right-0 z-50`. Independent fixed layers — do NOT nest in a shared container (scrim intercepts clicks, BUG-012).
- Modal `useEffect` with `[open]` dep sets `document.body.style.overflow = 'hidden'`; restores on close/unmount.
- Modal Escape key listener uses `[open, onClose]` dep — wrap `onClose` in `useCallback` at the call site if needed.
- **Desktop Modal cap (#91 Phase 2, 19 Jun 2026):** at `md:` and up the sheet becomes a centered dialog: `md:bottom-auto md:left-1/2 md:top-1/2 md:right-auto md:-translate-x-1/2 md:-translate-y-1/2 md:w-[min(560px,calc(100vw-2rem))] md:rounded-3xl md:border md:max-h-[85vh]`. Mobile (<768px) unchanged — still bottom-sheet. **Affects every `<Modal>` consumer at once** — verify any new modal still feels right on desktop. Bottom-sheet components that DON'T use shared `<Modal>` (`RestockSheet`, `PaymentSplitSheet`, `PaymentBottomSheet`) are NOT affected and keep their bottom-sheet behavior on every viewport — they own their own positioning.
- `PaymentBottomSheet`, `PaymentSplitSheet`, `RestockSheet` are NOT `<Modal>` (own translateY / fixed-bottom slide-up). Adding new bottom-sheet behavior? Decide upfront: shared `<Modal>` (gets the desktop centered-dialog treatment for free) OR own component. **`PaymentSplitSheet` is now an exception (Phase 2.5, #91, 19 Jun 2026): it ALSO becomes a centered dialog at `md:` and up** — same class set as shared `<Modal>` was given in Phase 2 (`md:bottom-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-3xl md:border`). Main sheet caps at `md:w-[min(560px,calc(100vw-2rem))]`, inner customer-link picker at `md:w-[min(520px,calc(100vw-2rem))]`. `PaymentBottomSheet` (Subscribe page Razorpay sheet) and `RestockSheet` remain true bottom-sheets on every viewport.
- Modal consumers: TableFormModal (passes `footer`), SessionDetail (stop confirm, edit start, edit notify, move table), Settings (clear, reset, cancel sub, clean names), Home (orphaned sessions), Canteen (soft-delete confirm + CanteenItemFormModal), BackEntryModal, PendingTopupsModal, PendingBookingsModal.
- `<BottomNav>` rendered persistently in App.tsx; all pages need `pb-24+`. Adding a tab = new Route in App.tsx.
- Tailwind v3.4 only — never v4.
- Dark theme only; palette locked.
- Mobile-first 360px target. Timer text-sizes must stay readable across a club.
- Standard horizontal padding `px-5`; card padding `p-4`.

Cross-feature ripples:
- → Many. Most modals are used by Sessions, Settings, Tables, Canteen. Verify each on `<Modal>` change.
- → [Subscription & Funnel](#subscription--funnel) (`PaymentBottomSheet` has its own escape paths — see that section).

See also: `bug_patterns.md` Pattern M4 (scroll), `references/design_system.md`, [Tables Page (Home)](#tables-page-home) and Canteen/Bookings sections for the wider desktop-responsiveness pattern (max-w-[1400px] + grid + FAB-outside).

Last updated: 9 Jun 2026

---

## Auth & Access Guard

Owns: auth store, access guard reasons, RequireAccess, AuthCallback, per-user IndexedDB lifecycle, cardless trial routing.

Files in scope:
- `src/store/authStore.ts` — `initialize`, `onAuthStateChange`, `refreshProfile`, `signOut`; state `session, user, profile, subscription, loading, dbReady, subscriptionLoaded, authLockBlocked, _lastFetchedAt`. `initialize` races `getSession()` vs 8s timeout (#120, Pattern A11) — timeout → degraded boot from stored session; shared `mapProfileRow`/`mapSubscriptionRow` are the ONLY snake→camel mapping for profile/subscription (used by refreshProfile AND the degraded path — never fork them).
- `src/lib/authBootFallback.ts` — #120 lock-free boot fallback (Pattern A11): `readStoredSessionLockFree` (full-session localStorage read, ≥60s expiry runway), `fetchProfileAndSubscriptionRows` (plain-fetch PostgREST, Pattern S1 discipline), `isAuthLockHeldByAnotherContext` (diagnostic). READ-ONLY by design — must never refresh tokens, write auth storage, or create a Supabase client.
- `src/hooks/useAccessGuard.ts` — returns typed `GuardResult`; reasons: `loading`, `db_loading`, `subscription_loading`, `not_authenticated`, `trial_expired`, `no_subscription`. Deliberately does NOT read `authLockBlocked` (UI-only flag).
- `src/components/RequireAccess.tsx` — spinner for any loading reason; redirects for `not_authenticated`, `trial_expired` (imperative + state), `no_subscription` (`<Navigate replace>`). Spinner branch shows an amber `authLockBlocked` hint (#120).
- `src/pages/AuthCallback.tsx` — routes by status: active/past_due → `/tables`; trialing-active → `/tables`; trialing-expired → `/subscribe` with state; none/cancelled/expired → `/subscribe`
- `src/App.tsx` — `AuthInitializer` calls `initialize()`. **AuthInitializer SKIPS `initialize()` on `/c/` and `/poster/` routes (#83 fix)** — Player Hub public pages must never trigger owner auth. `ExpirySweepRunner` has the same gate.
- `src/db/database.ts` — exports `initDbForUser`, `closeDb`, `isDbReadyForUser`, `getDbName`. DB name: `ClubKeeperDB_<userId>`.
- Supabase trigger `handle_new_user()` (migration `20260602_cardless_trial.sql` — ⚠ pending manual run): creates `status='trialing'` + `trial_ends_at = now()+7d`.

Invariants:
- **Per-user DB lifecycle:** ONLY `authStore` calls `initDbForUser`/`closeDb`. `_db` swap is owned by these helpers. `initDbForUser` is idempotent — safe to call on every `INITIAL_SESSION` re-fire (Pattern A1). `closeDb()` resets `_db` to a `ClubKeeperDB__pending` placeholder — never null. Public routes (Landing/Signup/AuthCallback/`/c/`/`/poster/`) do NOT query Dexie — no `dbReady` check needed.
- **`subscriptionLoaded` flag (7 Jun 2026):** `false` until `refreshProfile()` resolves, `false` again on sign-out. `useAccessGuard` returns `subscription_loading` while `!subscriptionLoaded`; RequireAccess shows spinner. Prevents `subscription===null` being misread as `no_subscription`.
- **Rule:** Any new field in `authStore` that `useAccessGuard` reads MUST get a paired `*Loaded: boolean` flag — truthiness checks aren't safe (`undefined` vs `null` look identical).
- **Rule:** Any new `reason` in `useAccessGuard` MUST be handled explicitly in `RequireAccess` (spinner or redirect). Default to spinner for loading. Never redirect on a loading reason.
- **refreshProfile dedup (BUG-002):** no-op if called within 3000ms of last fetch unless `force=true`. ALWAYS use `force=true` after a real server mutation (post-payment in Subscribe.tsx, post-cancel in Settings.tsx). Document any new forced caller. Supabase fires `INITIAL_SESSION` synchronously on `onAuthStateChange` registration — source of double-fetch.
- **`api/cancel-subscription.ts` two-mode (BUG-025):** `cancelAtCycleEnd=1` (period end) fails for `authenticated` pre-charge state. Handler tries `1` first, falls back to `0` on "no billing cycle" 400. Test BOTH paths on any cancel-logic change.
- Sign-out: `authStore.signOut()` does `window.location.href = '/'` hard nav + resets `loading` + `subscriptionLoaded` (13 Jun 2026 fix).
- AuthCallback routes carry state when redirecting to `/subscribe`.
- `useAccessGuard` reason `trialing` with active trial → `canAccess: true`; expired → `trial_expired`; active/past_due → access; none/cancelled/expired → `no_subscription`.
- **#120 boot-resilience invariants (Pattern A11):** the degraded-boot path only READS (localStorage + plain fetch) — never steal the GoTrue lock, never refresh a token outside the main client, never pass `lockAcquireTimeout` to `createClient` (re-enables library steal) without an explicit owner decision. If profile/subscription columns change, update `ProfileRow`/`SubscriptionRow` in `authBootFallback.ts` AND the shared mappers in `authStore.ts` in the same commit (the REST fallback reads `select=*` but the mappers are the contract). `authLockBlocked` is UI-only — if a future change makes `useAccessGuard` read it, the paired-`*Loaded`-flag rule applies.

Cross-feature ripples:
- → [Subscription & Funnel](#subscription--funnel) (Subscribe page headline branches read state.reason; refreshProfile callers).
- → [Player Hub](#player-hub) (#83 — public pages skip auth init).
- → [Routing & Cross-cutting](#routing--cross-cutting) (new private route ripples through subscriptionLoaded gate).
- → [Engagement](#engagement) (`ExpirySweepRunner` gated on `dbReady + session + subscriptionLoaded`).

Subscription schema column map (snake_case DB → camelCase TS): `trial_ends_at→trialEndsAt`, `current_period_start→currentPeriodStart`, `current_period_end→currentPeriodEnd`, `razorpay_customer_id→razorpayCustomerId`, `razorpay_subscription_id→razorpaySubscriptionId`, `cancel_at_period_end→cancelAtPeriodEnd`.

See also: `bug_patterns.md` Pattern A1 (init idempotency), A5 (loading finally), A6/A7/A8 (Bridge guards), A11 (#120 stranded-lock boot resilience), `decisions_active.md` (per-user DB, cardless trial).

Last updated: 3 Jul 2026 (#120 — getSession race + lock-free degraded boot, `authBootFallback.ts` added)

---

## Subscription & Funnel

Owns: Subscribe page, plan IDs, Razorpay integration, webhook, `api/*.ts` rules, Landing/ROI/Pricing.

Files in scope:
- `src/pages/Subscribe.tsx` — `headline` `useMemo` discriminated union (`expired | early | welcome`), `visiblePlanIds` computation, handlers, `MONTHLY_PRICES`/`ANNUAL_PRICES`
- `src/components/subscribe/PlanSelection.tsx` — `ALL_PLANS` array; receives `visiblePlanIds: readonly PlanId[]` prop; always receives `hideWelcome={true}` and never renders its own welcome header. `PlanId = 'starter' | 'standard' | 'pro' | 'test'`
- `src/components/subscribe/StickyCheckout.tsx` — receives `selectedPlan: PlanId | null`; renders `null` when no plan
- `src/components/subscribe/PaymentBottomSheet.tsx` — props `payError`, `onMaybeLater`, `onRetry`; ESC listener; 4 escape paths (X / ESC / backdrop / Maybe later), all guarded `!paying`
- `src/components/subscribe/ConfirmationScreen.tsx` — `screen === 'confirmed'`; navigate `replace: true`
- `src/components/SubscriptionStatusBanner.tsx` — trialing split: `!razorpaySubscriptionId` → "Free trial · Manage →" with `state.reason='subscribe_early'`; `razorpaySubscriptionId` present → "Subscribed ✓ · View →" sets `sessionStorage('ck_settings_section','subscription')` then `/settings`. past_due "Fix Now →" and cancelling "Resume →" → `/settings`.
- `src/lib/razorpayPlans.ts` — frontend plan-ID source of truth
- `api/_shared/plans.ts` — server-side mirror (uses `process.env`). `'test'` tier in LIVE_PLANS only — absent from TEST_PLANS. `PlanMap = Partial<Record<...>>`.
- `api/create-subscription.ts` — reads from `_shared/plans.ts`. `getPlanId()` throws on LIVE-only in TEST. Phase 3 Commit 2 (BUG-026): reads `trial_ends_at` from Supabase BEFORE Razorpay; three scenarios `new | mid_trial | expired`; response includes `startAt`, `scenario`.
- `api/razorpay-webhook.ts` — needs `RAZORPAY_WEBHOOK_SECRET` env in Vercel; writes `subscriptions` table (`status`, `current_period_start`, `current_period_end`, `cancel_at_period_end`, `updated_at`)
- `src/pages/Landing.tsx`, `src/components/landing/HeroSection.tsx`, `ROICalculator.tsx`, `PricingSection.tsx`, `Eyebrow.tsx`

Invariants:
- `BASE_VISIBLE_PLAN_IDS = ['standard']` in `Subscribe.tsx`. Adds `'test'` iff `isLiveMode === true` AND `user.email ∈ SUGEET_TEST_EMAILS`. This is the ONLY gating site.
- V1-LAUNCH filter: Subscribe + Landing `/pricing` show ONLY Standard Monthly (₹599). Starter/Pro hidden via filter + hidden cards in `PricingSection.tsx`. All 6 Razorpay plan IDs and `PLANS` array untouched.
- Plan ID changes: edit `src/lib/razorpayPlans.ts` AND `api/_shared/plans.ts` in the same commit. Dashboard plan must exist before app uses it. Update `PlanCard.tsx` id union and `PlanSelection ALL_PLANS`.
- ROI calculator: `forgetCount × ratePerHour × 30`; ROI divisor hardcoded to `599`. `Landing.tsx` hardcodes `₹599`. Keep in sync.
- All landing CTAs → `navigate('/signup')`.
- `PUBLIC_PATHS` in App.tsx must include `/` so BottomNav stays hidden.
- **Webhook event → status map:** `authenticated→trialing`, `activated→active+periods`, `charged→active+periods`, `halted→past_due`, `cancelled→cancelled`, `completed→expired`.
- Webhook column-name changes also ripple to `authStore.refreshProfile()` mapping AND `useAccessGuard` status reads.
- `handlePayNow`: 15-second AbortController timeout, HTTP 404 → `vercel dev` hint, payError + Retry button, "Maybe later" always available.

**`api/*.ts` rules (Vercel Node16, STRICTER than Vite):**
1. All relative imports MUST have `.js` extension. Wrong: `'../src/lib/razorpayPlans'` → Right: `'../src/lib/razorpayPlans.js'`.
2. Razorpay SDK return types are incomplete — cast to avoid void overload: `await (razorpay.subscriptions.create(...) as unknown as Promise<{ id: string; short_url: string }>)`. Or use `Awaited<ReturnType<typeof razorpay.subscriptions.create>>`.
3. NEVER import from `razorpay/dist/types/...` deep paths.
4. Run `npm run build` locally before pushing any `api/` change — Vite dev server won't catch these; `tsc` will.
5. Ripple: changing `src/lib/razorpayPlans.ts` → update `.js` import in every `api/*.ts` that imports it (currently `api/create-subscription.ts`).

Cross-feature ripples:
- → [Auth & Access Guard](#auth--access-guard) (Subscribe headline branches read `location.state.reason`; refreshProfile force=true).
- → [Routing & Cross-cutting](#routing--cross-cutting) (PUBLIC_PATHS).
- → [Settings](#settings) (subscription section state, Cancel button).
- → [Shared UI & Theme](#shared-ui--theme) (`PaymentBottomSheet` is NOT `<Modal>` — its own escape paths).

Pending payment integration ripples: feature gating by subscription state, renewal handling, refund flow, GST invoicing.

See also: `bug_patterns.md` Pattern S5 (Razorpay key rotation), Pattern S2 (BUG-016/017 escape paths).

Last updated: 14 Jun 2026

---

## Routing & Cross-cutting

Owns: route registration, public/private split, BottomNav, route renames.

Files in scope:
- `src/App.tsx` — `<Routes>`, `PUBLIC_PATHS`, `AuthInitializer`, `AppLayout`, `ExpirySweepRunner`, `TopupRealtimeBridge`
- `src/components/BottomNav.tsx`
- Every `<Link to>` / `navigate()` call site

Invariants:
- Public routes go OUTSIDE `<RequireAccess>`. Add path to `PUBLIC_PATHS` so BottomNav stays hidden.
- Renaming `/tables` ripples to: `BottomNav`, `SessionDetail` navigate calls, `Settings` navigate calls, `AuthCallback`, `Landing` "Go to App" button.
- New private route that runs Dexie queries on mount: gated automatically by `<RequireAccess>` + the `subscriptionLoaded` flag. Verify no Dexie call fires before `dbReady`.
- `AppLayout` hides BottomNav on public paths via `isPublicRoute(pathname)`. New public route → add prefix to `isPublicRoute`.
- **Route param boundary parses with dual-accept (Pattern R5).** Any param that maps to a UUID-flipped Dexie table (`gameTables`, `sessions`, `sessionItems`, `canteenItems`) MUST go through the round-trip Number check, NOT a bare `Number(useParams().X)`. The same rule applies to downstream re-coercions — if you have a loaded row, pass `row.id!` directly; do not write `Number(row.id)` anywhere. Verify with `grep "Number\(\(sessionId\|tableId\|itemId\|rawSessionId\|rawTableId\)\)"`. The 13 query-layer signatures in `queries.ts` already accept `number | string` — no widening needed at the call site.
- PWA manifest "shortcuts" require `vite.config.ts` update.
- Most-common-mistake list (kept here as cross-cutting reminder):
  1. Add Session field, forget `startSession()` — undefined on new rows.
  2. Change query, miss a caller — TS catches if signature changes.
  3. Update component, forget one of 4 visual states.
  4. Rename field, no migration — existing IndexedDB shows empty.
  5. Stricter validation w/o cleanup tool — pre-existing data blocked.
  6. Add a setting that does nothing — UI exists but action doesn't read it.
  7. Change timer math — cascades 6+ places.

Cross-feature ripples:
- → All feature sections (route additions/renames).
- → [Schema & Migrations](#schema--migrations): UUID-flipped tables require Pattern R5 at every route boundary that uses the table's id.
- → [Bug patterns](bug_patterns.md): Pattern R5 (route-param `Number()` UUID landmine), Pattern D12 (caller-supplied keys at `.add()`).

Last updated: 24 Jun 2026 (Pattern R5 added — route-param dual-accept after #107)

---

## Player Hub

Owns: public Player Hub pages (`/c/:slug`, `/poster/:slug`), owner setup, two-client rule, realtime bridge.

Files in scope:
- `src/pages/player/PlayerScan.tsx` — public scan form (name/mobile/amount → UPI deep-link + QR → 8s delay → "I've paid" → poll every 3s, 10-min expire)
- `src/pages/player/PlayerScanLayout.tsx` — layout-only
- `src/pages/Poster.tsx` — A4 QR poster, auto-`window.print()` on load
- `src/lib/playerHubApi.ts` — owner + public RPC wrappers
- `src/lib/supabasePublic.ts` (NEW — #83) — anon-only client `persistSession:false, autoRefreshToken:false, detectSessionInUrl:false`
- `src/lib/supabase.ts` — owner client
- `src/lib/slug.ts` — `generateSlug`, `validateSlug`, `isSlugAvailable`
- `src/types/playerHub.ts` — `ClubPublicInfo`, `TopupInsertEvent`
- `src/pages/PlayerHubSettings.tsx` — owner UI for slug + "Accept topups" toggle (Supabase-first since 13 Jun fix)
- `src/components/TopupRealtimeBridge.tsx` (NEW — #83 follow-up) — mounted in App.tsx
- `src/lib/realtimeTopups.ts` — channel `topup_intents_{clubId}` + 5s/30s polling fallback
- Migrations: `20260610_player_hub.sql`, `20260610_clubcoins.sql`, `20260615_enable_realtime.sql`, `20260615_topup_intents_coins_credited.sql`
- Supabase `clubs` + `topup_intents` tables

Invariants:
- **Two-client rule (#83 fix) — now THREE clients after Chunk 4.3 / #111:** Owner auth + reads use `supabase`. Public anon RPCs (`getClubPublicInfo`, `submitTopupIntent`, `getTopupIntentStatus`, etc.) use `supabasePublic` (distinct `storageKey: 'sb-clubkeeper-public'` per Pattern S16 — the three `auth: false` flags don't change the lock name). Owner-data WRITES from the sync drain use `supabaseSync` (lock-free via `accessToken` option, ONLY imported by `syncRunner.ts`). NEVER call a public RPC on the owner client — it queues behind the owner's auth lock and hangs `/c/<slug>` when the owner is logged in in another tab. New public RPCs MUST use `supabasePublic` AND be wrapped in `withTimeout(..., 8000, label)`.
- `supabasePublic.ts`: imported by `playerHubApi.ts` ONLY. NO auth code. NEVER import from owner-side modules. NEVER use for realtime subscriptions (those are owner-side).
- AuthInitializer + ExpirySweepRunner SKIP `/c/` and `/poster/` paths.
- `PlayerScan` / `Poster` are PUBLIC — no auth, no Dexie. Keep it that way.
- **TopupRealtimeBridge** keeps the channel open for the entire authenticated session — guards: `dbReady && session && subscriptionLoaded && !isPlayerHubPath(pathname)` (Pattern A6/A7/A8). Per-user `activeUserIdRef` (same pattern as `_clubSyncDoneForUser` for P3/#53) so a second user signing in on same tab gets a fresh subscription. **DO NOT include `location.pathname` in effect deps** — pathname read via `pathnameRef` inside callback to suppress toast on `/wallet`.
- Single callback per `subscribeToTopupIntents` — re-calling tears down and rebuilds. For multiple consumers, use a fan-out store, not a second `.on('postgres_changes')` (Supabase delivers duplicates).
- **Realtime publication (#85):** Tables in `supabase_realtime` publication: `topup_intents`, `clubs`. New `.on('postgres_changes', {table:'X'})` listener REQUIRES a migration adding `X` to the publication. Without it, listener subscribes silently but receives nothing. If handler reads `payload.old.<field>` beyond PK, set `replica identity full`. Pattern S6.
- **Server-authoritative coin total (#87, Pattern P1):** `topup_intents.coins_credited int null`. `get_topup_intent_status` returns `(status, reject_reason, coins_credited)`. Owner write site: `PendingTopupsModal.handleConfirm` captures `{coinsEarned, welcomeCoinsEarned}` from `recordTopupWithCoins` and writes `coins_credited = coinsEarned + welcomeCoinsEarned` in the same UPDATE that flips status. Null in idempotency 'already credited' branch and Wallet.tsx failed-sync retry. Player-side PlayerScan reads `result.coinsCredited` → `confirmedCoins`; render uses `confirmedCoins ?? coinsEarnedForTopup(amount, tiers)`. Player NEVER recomputes — adding a new owner-side coin grant requires updating BOTH `recordTopupWithCoins` return value AND `PendingTopupsModal.handleConfirm` `coinsCredited` write.
- `useLiveData._clubSyncDoneForUser` — module-level sync sentinel. Per-user-keyed (different user re-syncs automatically). Same-user re-sign-in is handled by `_resetClubSyncSentinel` called from `authStore.signOut` (Chunk 4.3, Pattern S15). Any NEW per-user module-level cache MUST be reset in the same place to avoid silent stale-state-on-re-sign-in.
- `PlayerHubSettings.tsx` heaviest import graph in app: slug.ts, playerHubApi.ts, coins.ts, realtimeTopups.ts, CoinTiersEditor, EngagementConfigCard, BringBackList, NudgeTemplateEditor.
- **Slug setup modal validation (#105, Pattern F10 — formerly cited as the duplicate "F8"):** the debounced effect at `useEffect(..., [slugDraft, settings?.slug])` must clear `slugError` synchronously on the sync-pass branch AND reset `slugError`+`checking` on empty input — bailing without reset leaks the prior error and Save stays disabled. Availability check is raced against a 5s fail-open timeout: a hung `isSlugAvailable` (owner client + auth lock, or offline) cannot strand `checking=true` forever. Server-side unique constraint on `clubs.slug` is the authoritative dedup; client timeout is just a UX guard. DO NOT switch `isSlugAvailable` to `supabasePublic` — slug uniqueness checks against the full `clubs` row set are an owner operation, not public-safe.

Cross-feature ripples:
- → [Pricing Visibility on Player Hub](#pricing-visibility-on-player-hub) (RPC extension, public-safe contract).
- → [ClubCoins](#clubcoins) (coin tiers config, server-authoritative read).
- → [Topup Inbox & Realtime](#topup-inbox--realtime) (channel + polling + store).
- → [Auth & Access Guard](#auth--access-guard) (#83 — public path skip; Bridge guards).
- → [Wallet & Customers](#wallet--customers) (`recordTopupWithCoins`, badge count).
- → [Engagement](#engagement) (welcome bonus, dormancy + nudge config).
- → [Routing & Cross-cutting](#routing--cross-cutting) (`/c/`, `/poster/` registration).

See also: `bug_patterns.md` Pattern A6/A7/A8 (Bridge guards), Pattern P1 (player doesn't recompute), Pattern P2 (Player-Hub: target mirrors by slug not id), Pattern S6 (realtime publication).

Last updated: 16 Jun 2026

---

## Pricing Visibility on Player Hub

Owns: public pricing card on `/c/:slug`, owner-side `tables_json` mirror.

Files in scope:
- Supabase: `clubs.tables_json jsonb default '[]'`, `clubs.accepts_pricing_display boolean default true`. Migration `20260616_pricing_visibility.sql` (⚠ pending). RPC `get_club_public_info(p_slug)` extended (drop+recreate — can't extend OUT params via CREATE OR REPLACE).
- `src/lib/playerHubApi.ts` — `syncTablesJsonBySlug(slug, tables: GameTable[])` (fire-and-forget; filters `outOfService`; projects only public-safe fields; targets by slug NOT id; `.select('id')` after update + console.warn on empty); `getClubPublicInfo` extension with safe fallbacks (`?? []`, `?? true`)
- `src/types/playerHub.ts` — `ClubPublicInfo.tablesJson`, `.acceptsPricingDisplay`
- `src/components/TableFormModal.tsx` — `mirrorTablesToSupabase()` helper; called fire-and-forget from `handleSave`, `handleDisable`, `handleEnable`; skips with `console.warn` when `settings.slug` absent
- `src/pages/player/PlayerScan.tsx` — local `PricingCard` (collapsible, default closed, grouped by gameType) + `PricingRow` (tier grid + tolerance, or `₹X/hr` + `₹Y/frame` for snooper)

Invariants:
- **Public-safe contract:** `tables_json` rows contain ONLY `name, gameType, ratePerHour, ratePerFrame?, rateCard?, toleranceMinutes?, rateCardBilling?`. NEVER add internal IDs, session data, owner-private flags, or anything a player shouldn't see.
- Card rendered ONLY when `clubInfo.acceptsPricingDisplay === true` AND `clubInfo.tablesJson.length > 0`. NO empty-state fallback for players.
- Public page: no Dexie, no auth.
- **Anti-pattern (Pattern P2):** Do NOT route owner-side mirror writes through `getOwnerClub() → .eq('id', club.id)`. `getOwnerClub` uses `.maybeSingle()` with no filter and can silently return null on transient auth states — mirror early-exits, catch swallows the signal. ALWAYS target by slug.
- **Upsert payload sync invariant (Pattern X, #104):** `upsertClub` in `src/lib/playerHubApi.ts` is the ONLY hand-rolled upsert against `clubs`. Insert and update branches MUST share a single `clubFields` payload object — caller-owned columns (`slug`, `club_name`, `upi_id`, `accepts_topups`) go through the spread; only branch-specific fields (`owner_id` on insert, `updated_at` on update) stay outside. Adding a new caller-owned column to one branch and not the other turns it write-once and breaks every downstream `mirrorToSupabaseBySlug` call silently.
- NEVER bypass the RPC — anon does NOT have direct table read grants.
- Pre-migration safe — fallbacks (`?? []`, `?? true`) keep `/c/<slug>` working. If you remove either fallback, you crash the page for clubs whose migration hasn't run.
- NEVER block the Dexie write on the Supabase mirror. Pattern matches `syncCoinConfig` — Dexie is authoritative.

Cross-feature ripples:
- → [Tables](#tables) (TableFormModal mirror after every Dexie write).
- → [Player Hub](#player-hub) (RPC extension, public-safe contract).
- → [Rate Card & Tolerance Billing](#rate-card--tolerance-billing) (`PricingRow` renders tiers).
- → [Import / Export / Reset](#import--export--reset) (Known drift: Import Everything replaces all tables but does NOT re-sync `tables_json`. Acceptable for v1; track.)
- **First-slug-setup gap:** Owner saving slug for the first time does NOT retroactively trigger tables mirror. Next table edit will mirror everything. Track if customer reports stale pricing.

See also: `bug_patterns.md` Pattern P2 (Player-Hub mirror target by slug), Pattern W1 (workflow/deploy migration).

Last updated: 16 Jun 2026

---

## ClubCoins

Owns: coin tiers, redemption, server-authoritative crediting.

Files in scope:
- `src/lib/coins.ts` — `coinsEarnedForTopup`, `resolveCoinConfig`, `coinsToRupees`, `coinsToMinutes`, `maxRedeemableCoins`, `formatCoins`, `DEFAULT_COIN_CONFIG` (4 tiers, minutesPerCoin=2, rupeesPerCoin=0.5, expiryDays=60, minRedemption=10)
- `src/types/index.ts` — `CoinTier`; `ClubSettings` coin fields (`coinsEnabled, coinTiers, minutesPerCoin, rupeesPerCoin, coinExpiryDays, coinMinRedemption, acceptsTopups?, coinRedemptionModes?`)
- `src/types/customer.ts` — `Customer.coinBalance?`
- `src/types/walletTransaction.ts` — `WalletTransaction.balanceType?/coinDelta?/rupeeEquivalent?`
- `src/db/database.ts` — v15 (additive), v16 adds engagement (`firstTopupAt` etc.)
- `src/db/queries.ts` — `recordTopupWithCoins` (atomic wallet+coins+welcome-bonus); `getCoinConfig`
- `src/components/CoinTiersEditor.tsx` — in PlayerHubSettings
- `src/components/CoinRedemptionPill.tsx` — wired in `SessionDetail.tsx:697` (post-stop payment flow)
- `src/pages/player/PlayerScan.tsx` — "Earn N coins" preview (lower-bound)
- `src/lib/playerHubApi.ts` — `syncCoinConfig()` (fire-and-forget mirror)

Invariants:
- **`recordTopupWithCoins` is the ONLY correct path** for crediting wallet + coins atomically. NEVER split into two DB calls.
- Welcome bonus is one-shot, gated by `firstTopupAt` guard inside the tx. Rename of `firstTopupAt` ripples to this guard.
- `DEFAULT_COIN_CONFIG` is fallback for unconfigured clubs.
- Player-side `coinsEarnedForTopup` preview is a LOWER BOUND ("earn at least N + welcome bonus if first") — player doesn't have engagement config or `firstTopupAt` access (Pattern P1).
- Server-authoritative total flows through `topup_intents.coins_credited` (see [Player Hub](#player-hub)).

Cross-feature ripples:
- → [Player Hub](#player-hub) (`coins_credited` server-authoritative read; coin config in `clubs`).
- → [Wallet & Customers](#wallet--customers) (`coinBalance`, `balanceType`, `coinDelta` fields).
- → [Engagement](#engagement) (coin expiry FIFO, welcome/streak bonus writes).
- → [Sessions](#sessions) (`CoinRedemptionPill` at line 697).

See also: `bug_patterns.md` Pattern P1.

Last updated: 11 Jun 2026

---

## Engagement

Owns: streak, coin expiry, dormancy, nudge — all OFF by default.

Files in scope:
- `src/lib/streak.ts` — `checkAndAwardStreak()`. Called in `SessionDetail.tsx:750,801` (payment confirm path)
- `src/lib/coinExpiry.ts` — FIFO lot accounting; `applyExpirySweep()` runs every 4h via `ExpirySweepRunner` in `App.tsx`. Reads `WalletTransaction` rows for lot reconstruction; writes `coin_expiry` rows.
- `src/lib/dormancy.ts` — `getDormantCustomers(thresholdDays, limit)`; filters `customers` by `lastVisitAt`
- `src/lib/nudge.ts` — `renderNudgeTemplate`, `buildWhatsAppLink`, `logNudgeSent` (writes `WalletTransaction` with `referenceType:'engagement_log'`)
- `src/components/BringBackList.tsx` — pure UI + API calls; imports dormancy + nudge + customerDisplay
- `src/components/NudgeTemplateEditor.tsx` — template vars (`{name}, {coins}, {clubName}`, etc.) sync with `renderNudgeTemplate`
- `src/components/EngagementConfigCard.tsx` — writes ClubSettings engagement fields
- `src/types/index.ts` — engagement fields: `welcomeBonusEnabled, welcomeBonusCoins, streakEnabled, streakRequiredDays, streakWindowDays, streakBonusCoins, dormancyEnabled, dormantThresholdDays, nudgeTemplate`; `Customer.firstTopupAt?/lastStreakBonusAt?/expiryAppliedAt?`
- `src/db/database.ts` — v16 (additive)

Invariants:
- All engagement features OFF by default (master switches in ClubSettings).
- `ExpirySweepRunner` gated on `dbReady + session + subscriptionLoaded` — keep consistent with other gated operations.
- `streak.ts` reads `walletTransactions` for distinct session days — if session debit `referenceType` changes, update filter.
- `coinExpiry.ts` reads `balanceType/coinDelta/referenceType` for lot reconstruction — schema changes ripple here.
- `logNudgeSent` writes `referenceType:'engagement_log'` — removing from union = TS error.

Cross-feature ripples:
- → [ClubCoins](#clubcoins) (welcome/streak bonus go through `recordTopupWithCoins`; FIFO uses coin fields).
- → [Wallet & Customers](#wallet--customers) (writes; dormancy filter on Customer schema).
- → [Sessions](#sessions) (streak called in payment confirm path — verify call sites if stop flow changes).
- → [Auth & Access Guard](#auth--access-guard) (`ExpirySweepRunner` gate).
- → [Player Hub](#player-hub) (EngagementConfigCard in PlayerHubSettings).

Last updated: 11 Jun 2026

---

## Topup Inbox & Realtime

Owns: pending topup count store, modal, realtime + polling fallback.

Files in scope:
- `src/store/topupInbox.ts` — zustand store; `pendingCount`, increment/decrement/setPendingCount, `closeModal`
- `src/lib/realtimeTopups.ts` — `subscribeToTopupIntents(clubId, onInsert?)`, polling fallback (5s/30s), `getPendingTopups`
- `src/components/PendingTopupsModal.tsx` — per-row confirm/reject state machine; imports `recordTopupWithCoins`, `getCoinConfig`, `confirmTopupIntent`, `rejectTopupIntent`; consumes `topupInbox` + `toastStore`
- `src/components/TopupRealtimeBridge.tsx` — single mount point in `App.tsx`; see [Player Hub](#player-hub) for guards
- TopBar — pending badge count (reads `usePendingTopupCount`)

Invariants:
- `pendingCount` rename ripples to TopBar badge + realtimeTopups. Pure in-memory store — no DB reads.
- Confirm path: Supabase fires FIRST, then Dexie. Not atomic across both.
- One callback per `subscribeToTopupIntents` — re-calling tears down and rebuilds.

Cross-feature ripples:
- → [Player Hub](#player-hub) (Bridge guards, two-client rule, publication migration).
- → [ClubCoins](#clubcoins) (`recordTopupWithCoins`, `coins_credited` UPDATE).
- → [Wallet & Customers](#wallet--customers) (wallet credit on confirm).

See also: `bug_patterns.md` Pattern S6 (realtime publication).

Last updated: 13 Jun 2026

---

## Validation

Owns: input validators.

Files in scope:
- `src/lib/validation.ts` — `validateTableName`, `validatePlayerName`, `validateNote`, `validateUpiId`, `validateRateCard(tiers, toleranceMinutes, billingMode?)`, `validateBackEntry`

Invariants:
- Backwards compatibility: stricter rules may make existing data fail validation — provide a cleanup tool in Settings (most-common-mistake #5).
- `validateBackEntry` reuses `validatePlayerName` + `validateNote`.

Cross-feature ripples:
- → [Tables](#tables) (`TableFormModal` table name validation; duplicate name uses `existingTables` prop).
- → [Sessions](#sessions) (`StartSession` player name + note; `getRecentPlayerNames` query filters by validation).
- → [Back Entries](#back-entries).
- → [Rate Card & Tolerance Billing](#rate-card--tolerance-billing).
- → [UPI QR & Payment Screen](#upi-qr--payment-screen) (UPI ID validation + Settings error messages).

Last updated: 9 Jun 2026

---

## Import / Export / Reset

Owns: backup file format, atomic import, atomic reset.

Files in scope:
- `src/db/queries.ts` — `getAllDataForExport()`, `ClubKeeperBackupV16` interface (single source of truth — exported), `CURRENT_SCHEMA_VERSION` constant, `resetEverything()`, `ActiveSessionsPresentError`
- `src/lib/importEverything.ts` — `importEverythingFromFile(file)`, `ImportResult` discriminated union, `ImportFailureReason` (`parse_error | not_clubkeeper_file | legacy_incomplete_format | schema_too_new | active_sessions_present | empty_file | transaction_failed`), `BackupShape` validator + `requiredArrayKeys`
- `src/pages/Settings.tsx` — Data & Backup section: export + import action rows; `importErrorMessage()` switch (must cover every reason); destructive confirm Modal; full-viewport success overlay; `<ImportCountRow>` sub-component
- `src/lib/__devTools__/importExportRoundTrip.ts` (DEV-only, tree-shaken) — `runImportExportRoundTrip()` exposed on `window`; 11 measures (9 store counts + walletBalanceTotal + piggyCurrent)
- `src/main.tsx` — DEV-only `window.__importEverythingFromFile` + `window.runImportExportRoundTrip` dynamic imports
- `references/data_model.md` — "Data Export Format (v16)" section

Invariants:
- **Three-way single source of truth:** the 9-store list MUST stay 1:1 across `getAllDataForExport()`, `importEverythingFromFile()` (tx list + clear Promise.all + bulkAdd), AND `resetEverything()` (tx list + clear Promise.all). Drift = silent data loss. #78 export missed 6/9; #81 reset missed 6/9.
- Every Dexie store appears in BOTH builder AND import clear+bulkAdd loop AND `ClubKeeperBackupV16`.
- When you bump Dexie version in `database.ts`, also bump `CURRENT_SCHEMA_VERSION` in `queries.ts` in the SAME commit.
- IDs preserved verbatim across export → import. NEVER auto-generate fresh IDs (FK links break).
- Import is atomic: single `db.transaction('rw', [all 9 stores], ...)` — `.clear()` then `.bulkAdd()`. Any throw = full rollback.
- Reset is atomic: same single flat tx. `seedIfEmpty()` runs AFTER the tx commits so its inserts aren't rolled back by tx-internal throws.
- Active-session pre-check (`status !== 'completed'`) blocks both import AND reset (`ActiveSessionsPresentError`). Importing/resetting on top of a running session would corrupt timer math (Pattern T1).
- Subscription / auth / Supabase state NEVER touched — Dexie-only.
- After import success: `window.location.assign('/tables')` — intentional hard nav. Resets module-level flags like `_clubSyncDone`. Do NOT change to SPA `navigate()`.
- File input uses `className="hidden"` — programmatic `.click()` works for `type="file"`. Do NOT migrate to Pattern U9 (date-picker quirk only).
- Adding a new `ImportFailureReason` → update `importErrorMessage()` switch in `Settings.tsx`.
- Adding a new count field → add to `ImportSuccess`, populate in reducer, render new `<ImportCountRow>`.
- Round-trip self-test: if you add a new Dexie store, ADD it to the snapshot in `importExportRoundTrip.ts` or the test passes while silently missing the new store.
- `legacy_incomplete_format` catches pre-#78 3-table backups with a useful error instead of silent re-loss.

Cross-feature ripples:
- → [Schema & Migrations](#schema--migrations) (any new store ripples to all three sites + `CURRENT_SCHEMA_VERSION`).
- → [Pricing Visibility on Player Hub](#pricing-visibility-on-player-hub) (Known drift: import replaces tables but doesn't re-sync `tables_json`).
- → [Settings](#settings) (Data & Backup UI).

See also: `bug_patterns.md` Pattern T1 (active-session pre-check), `references/data_model.md` "Data Export Format (v16)".

Last updated: 15 Jun 2026

---

## Advance Booking

Owns: player advance booking on /c/<slug>, owner confirm/reject, persisted bookings record, session-time linkage. Hybrid model — Supabase `booking_intents` is a transient postbox (<=24h, lazy-cleaned inside `submit_booking_intent`); confirmed-or-later bookings cross to owner's Dexie `bookings` store (the permanent record). Shipped across P1a–P1e-2 + P2, 17–22 Jun 2026 — phase narrative lives in history/changelog.md; owner E2E of the full player flow still pending. **#127 (player flow broken post-v20 by the numeric-id filter) is fixed in code + a paste-ready migration — see the Part A invariant below; awaiting owner migration-run + device E2E.**

Files in scope (consolidated 8 Jul 2026 — per-phase shipping narrative in history/changelog.md):
- Supabase migrations (ALL APPLIED, verified 7 Jul 2026): `20260617_booking_intents.sql` (clubs `accepts_bookings` + `booking_advance_amount`; `booking_intents` table + RLS mirroring topup_intents; `submit_booking_intent` with lazy cleanup + conflict check + rate limit; `get_booking_intent_status`; realtime publication + replica identity full), `20260618_booking_cancel.sql` (`cancel_booking_intent` phone-match RPC + status-CHECK patch), `20260619_booked_slots_rpc.sql` (anon `get_booked_slots`, 8-day cap, timing-only exposure — its `p_table_id integer` is superseded by `20260708_booking_table_id_uuid.sql`, #127), `20260622_booking_hours_and_per_slot_advance.sql` (per-club open/close minutes + per-slot advance + hours-gated submit + server-side advance recompute raising `advance_mismatch`/`outside_hours`/`hours_not_set`), `20260708_booking_table_id_uuid.sql` (UNAPPLIED — #127: retypes `booking_intents.table_id` + `submit_booking_intent.p_table_id` + `get_booked_slots.p_table_id` `int`→`text`; drop+recreate for the two functions since arg-type can't change in-place; existing rows cast losslessly via `::text`).
- `src/types/booking.ts` — `Booking` (id = the Supabase intent UUID carried verbatim; status union WITHOUT 'pending'); `src/types/index.ts` — ClubSettings booking fields (`bookingAdvanceAmount` @deprecated, frozen); `src/types/walletTransaction.ts` — `'booking_advance'` referenceType.
- `src/lib/playerHubApi.ts` — player RPCs (`submitBookingIntent`/`getBookingIntentStatus`/`cancelBookingIntent`/`getBookedSlots`) on `supabasePublic` + `withTimeout(..., 8000)`; owner ops (`getPendingBookings`, `confirmBookingIntent` returning the server ISO `confirmed_at`, `rejectBookingIntent`); `syncBookingConfigBySlug(BookingConfigPatch)` routed through `mirrorToSupabaseBySlug` (Pattern S11); `getBookedSlots` pre-migration-safe (returns [] on missing function).
- `src/lib/realtimeBookings.ts` — channel `booking_intents_{clubId}`, `onInsert` + `onUpdate` (`BookingUpdateEvent {intentId, oldStatus, newStatus}`), polling fallback that CANCELS once SUBSCRIBED (deliberately does NOT inherit realtimeTopups' #66 leak); `src/store/bookingInbox.ts` — pendingCount Zustand + `usePendingBookingCount`.
- `src/components/BookingRealtimeBridge.tsx` — app-shell bridge (Pattern A6/A7/A8/A10 guards + additionally gated on `club.acceptsBookings`); confirmed→cancelled UPDATE fires `reconcileCancelledBooking` + toast (unless owner is on /bookings).
- `src/components/PendingBookingsModal.tsx` — per-row confirm/reject state machine; confirm = Supabase FIRST → `db.bookings.add` with `id = intent.id` and ConstraintError swallowed for idempotent retry; reject = Supabase-only status flip (postbox boundary held); three render states rows/spinner/empty (Pattern M5).
- `src/pages/Bookings.tsx` — private /bookings 7-day agenda; Pattern T4 (DB-static `slotStart` window query; status badges derived from `Date.now()` in render body); pending pill opens the modal; empty state when `!acceptsBookings`.
- `src/pages/PlayerHubSettings.tsx` — Opens-at/Closes-at 30-min-step selects, Accept Bookings toggle gated on `canEnableBookings(settings)` with helper text until hours set, "Advance per 30 mins" input (0–2000, R4 typing-buffer); all four save sites via `useSaveIndicator()` (Pattern U10); all clubs-row writes via `syncBookingConfigBySlug` (Pattern S11); one-shot per-session `tables_json` id backfill (sessionStorage-keyed).
- `src/pages/player/BookingScreen.tsx` — /c/:clubSlug/book 6-step wizard (gameType → table → date → time → duration → summary); settings-driven `buildTimeOptions(date, now, openMin, closeMin)`; `not_configured` state when hours unset; booked 30-min steps disabled via `getBookedSlots` with duration capped to the next booked start; advance = `ceil(durationMin/30) × bookingAdvancePerSlot` with breakdown line; typed-error bounce-backs (`advance_mismatch` → summary "Pricing changed. Please retry.", `outside_hours` → time step, `hours_not_set` → not_configured); UPI note prefix `BOOK-`; player cancel only ≥2h before slot, inline errors (Pattern F7). `src/pages/player/PlayerScan.tsx` — "Book a table" CTA (its numeric-id gate is the stale half of #127).
- `src/pages/StartSession.tsx` — ±30-min linkable-booking auto-modal (Link / Skip per row, Unlink pill after link), 90-min walk-in conflict banner (warn-only, never blocks); `BookingAlreadyConsumedError` swallowed with console.warn on race (never strand staff).
- `src/components/PaymentSplitSheet.tsx` — optional `prepaidAdvance?: number`; when > 0, `collectionTarget = max(0, total − prepaidAdvance)` drives canConfirm + quick-fill chips; header flips "Total" → "Collect" with advance subline; `totalIsValid` widened for the all-prepaid case. `src/pages/SessionDetail.tsx` — `linkedBooking` live query (Pattern T4) + auto-link of the booking's customer by phone; at confirm the FULL advance is wallet-credited via `creditBookingAdvanceRemainder` (one ledger row, `referenceType='booking_advance'`), then `breakdown.wallet` is bumped by `min(grandTotal, advance)` → the PM1 invariant `cash+upi+wallet === grandTotal` holds with ZERO changes to `recordSessionPaymentBreakdown`/`confirmPaymentAndStop`.
- `src/db/queries.ts` — `linkBookingToSession` (marks consumed + lookup-or-creates customer by phone), `creditBookingAdvanceRemainder`, `getLinkableBookingsForTable`/`getUpcomingBookingsForTable` (`[tableId+slotStart]` compound-index range scans), `reconcileCancelledBooking` (idempotent under realtime replay), `applyNoShowSweep` (marks no_show, NO refund) — all converted to sync wrappers/`syncedBatch` in Chunk 7 Group B.
- `src/App.tsx` — bridge mount, /bookings route under RequireAccess, `ExpirySweepRunner` piggybacks `applyNoShowSweep()` on the same gates + 4h cadence; `src/components/TopBar.tsx` — conditional calendar badge between online dot and canteen (sky-400 dot when pending > 0), gated on `settings.slug && settings.acceptsBookings`.

Invariants:
- **Two-client rule (Pattern A7):** Player-side RPCs (`submitBookingIntent`, `getBookingIntentStatus`) use `supabasePublic` and `withTimeout(..., 8000, label)`. Owner-side `getPendingBookings`/confirm/reject use `supabase`.
- **Pattern P2 — slug-targeted mirror:** `syncBookingConfigBySlug` MUST `.eq('slug', settings.slug)` — never `getOwnerClub() → .eq('id', club.id)`. Add `.select('id')` and warn on empty.
- **Hybrid postbox boundary:** `pending` status lives ONLY in Supabase. Only `confirmed`/`rejected`/`expired` ever cross to Dexie, and ONLY `confirmed` writes a `db.bookings` row (via PendingBookingsModal confirm). `rejected` is status-only Supabase update; nothing to Dexie.
- **Lazy cleanup:** Each `submit_booking_intent` call deletes `non-pending AND created_at < now() - interval '24 hours'`. No cron, no Pro plan. Free-tier safe.
- **Conflict check:** `submit_booking_intent` rejects overlap with any `pending` OR `confirmed` row on same `(club_id, table_id)`. Player sees `slot_taken`.
- **Rate limit:** Max 3 pending intents per phone per club in last 10 min (mirrors topup).
- **Realtime (Pattern S6):** New `booking_intents` table added to `supabase_realtime` publication + `replica identity full` in the same migration — otherwise the bridge subscribes silently and receives nothing.
- **Fallback-timer leak FIX (vs topup):** `realtimeBookings.ts` MUST cancel its 5s→30s polling timer once channel becomes `SUBSCRIBED`. Do NOT replicate the known leak from `realtimeTopups.ts`.
- **No 'pending' in Dexie schema:** Booking status union in TS is `'confirmed'|'consumed'|'no_show'|'cancelled'`. Adding `'pending'` to Dexie is a violation of the hybrid model.
- **Booking.id === intentId:** carry the Supabase intent UUID verbatim onto the Dexie row at confirm time. Foreign-key audit trail.
- **Advance is server-config + slug-mirrored:** Single flat number per club (no per-table advance in v1). Owner edits in PlayerHubSettings → Supabase-first write → Dexie mirror → `syncBookingConfigBySlug` re-mirror on save.
- **`StartSession` lookup window: ±30 min** of `Date.now()`. Sessions outside this window do NOT auto-prompt linkage. Owner can still manually link via /bookings (deferred to v2).
- **Walk-in conflict (90-min lookahead):** Warn only, never block. Staff judgment call.
- **Cancellation window (v1, hard-coded):** Player cancel >2h before `slot_start` → status `cancelled` + advance → wallet credit. <2h → no cancel button. Auto-expire 30 min after `slot_end` if not consumed → status `no_show` + advance forfeit (no wallet credit).
- **Cancel phone-match auth (P1e-2):** Player has no Supabase JWT; `cancel_booking_intent` RPC uses `p_player_phone` match against the row's `player_phone` as the authorization check. Phone mismatch surfaces as `not_found` — do NOT leak which check failed. UI hides the Cancel button outside the 2h window so the server's `too_late` exception is only ever hit on a clock race.
- **Reconcile idempotency:** `reconcileCancelledBooking` MUST early-exit if (a) booking status is already `'cancelled'` AND (b) a `WalletTransaction` with `referenceType='booking_advance'` + `referenceId=bookingId` + `type='credit'` already exists. Realtime channels can replay an UPDATE event after a brief disconnect; double-crediting the advance is a real risk.
- **No-show forfeit:** `applyNoShowSweep` MUST NOT write a wallet credit. The advance is forfeit by policy. Only the booking row is flipped to `'no_show'`. (Contrast with cancellation, which DOES refund.)
- **Sweep gating:** No-show sweep runs only when the owner is signed in and DB ready. Don't run it from public Player Hub routes — those don't have access to the owner's per-user Dexie. ExpirySweepRunner's existing guards already cover this.
- **Migration safety (pre-run):** `getClubPublicInfo` MUST default `acceptsBookings ?? false` and `bookingAdvanceAmount ?? 100` in the TS mapper so `/c/<slug>` does not crash for clubs whose migration hasn't been applied yet.
- **Player-side defensive read (Part A) — FIXED for #127 (8 Jul 2026):** the check is now `typeof t.id === 'string' && t.id.length > 0` (Post-v20 ID law — ids are UUID **strings**, never `Number()` them; Pattern R5/D12). `PublicTableInfo.id`, `submitBookingIntent`/`getBookedSlots`/`PendingBookingRow` tableId, and `BookingScreen` `tableId` state are all `string`. The invariant's intent is preserved: filter out id-less pre-P1b rows; ALL id-less → `no_tables`, never a broken picker. Server side is retyped by migration `20260708_booking_table_id_uuid` (`booking_intents.table_id` + both RPC `p_table_id` → `text`). **Code + migration shipped together; awaiting owner run of the migration + device E2E — do NOT reintroduce a numeric id check.**
- **Time math (Pattern T1):** `slotStart` / `slotEnd` are Unix ms internally throughout BookingScreen and Dexie `bookings` rows. ISO timestamptz strings only at the Supabase RPC boundary (`submitBookingIntent` does `new Date(ms).toISOString()`). Never store ISO strings in Dexie or do clock-counter math.
- **Today's past-time filter:** `buildTimeOptions(date, now)` filters `ms > now` so any 30-min step earlier than the current moment never appears on TODAY's chip grid. Future days get the full window.
- **Booked-slot visibility (#90):** `getBookedSlots` is anon-readable but exposes ONLY `(slot_start, slot_end)` — never `player_phone`, `player_name`, or `advance_amount`. Anyone scraping the slug sees timing only. The 8-day window cap blocks bulk harvesting. Status filter is `IN ('pending','confirmed')` only — rejected/expired/cancelled rows don't block future booking.
- **Server slot_taken is still the safety net:** Booked-slot UI is a UX nicety. The server-side overlap check inside `submit_booking_intent` MUST stay — never assume the client filtered correctly (stale fetch, race with another submission, etc.).
- **Async modal state (Pattern M5):** Modals with parent-fetched lists MUST render three states (rows / loading / empty), driven by the store's `pendingCount`. The badge count is the authoritative "something is there" signal; the list array is fetch state. Conflating the two re-introduces #88.

Cross-feature ripples:
- → [Player Hub](#player-hub) — `getClubPublicInfo` RPC extended (signature change ripples to anyone reading the RPC). Two-client rule continues to apply.
- → [Pricing Visibility on Player Hub](#pricing-visibility-on-player-hub) — `tables_json` is what BookingScreen reads to enumerate tables + tier prices. If `tables_json` is empty (slug-setup gap), booking flow MUST show "ask owner to refresh table list" rather than crash.
- → [Topup Inbox & Realtime](#topup-inbox--realtime) — TopBar gains a SECOND badge; visual layout must accommodate both. `BookingRealtimeBridge` mounts alongside `TopupRealtimeBridge` in App.tsx with identical Pattern A6/A7/A8 guards.
- → [Sessions](#sessions) — StartSession gains a "Booking found" modal pre-step; stop-payment in PaymentSplitSheet deducts advance.
- → [Payment Split & Payment Mode](#payment-split--payment-mode) — `PaymentSplitSheet` now accepts a "prepaid advance" prop; if `final < advance`, surplus credits customer wallet (creating customer by phone if absent — mirrors topup confirm).
- → [Wallet & Customers](#wallet--customers) — Advance refund on >2h cancel creates a wallet credit. WalletTransaction `referenceType` may need a new value `'booking_advance'` (decide at P1e — keep additive, off-default).
- → [Settings](#settings) — `bookingAdvanceAmount` input added to PlayerHubSettings.
- → [Schema & Migrations](#schema--migrations) — Dexie bumps to v17 (additive). `getAllDataForExport()` MUST include `bookings`; `ClubKeeperBackupV16` becomes `V17`; `CURRENT_SCHEMA_VERSION = 17`; `importEverything` clear+bulkAdd loop adds the store.
- → [Import / Export / Reset](#import--export--reset) — every new Dexie store ripples here per `data_model.md` "Forward-compatibility rule".
- → [Routing & Cross-cutting](#routing--cross-cutting) — `/bookings` registered as private (behind `RequireAccess`). PUBLIC_PATHS unchanged (booking screen lives under `/c/:slug`).
- → [Auth & Access Guard](#auth--access-guard) — `BookingRealtimeBridge` gated identically to `TopupRealtimeBridge` (`dbReady && session && subscriptionLoaded && !isPlayerHubPath`).
- → [Shared UI & Theme](#shared-ui--theme) — `PendingBookingsModal` is a shared `<Modal>` consumer; desktop centered-dialog cap applies under #91 Phase 2.
- → [Tables Page (Home)](#tables-page-home) — same `max-w-[1400px]` + grid + FAB-outside pattern under #91.

**Bookings page desktop layout (#91 Phase 2, 19 Jun 2026):** `src/pages/Bookings.tsx` outer container went from `max-w-md mx-auto px-4` (448px — looked like a phone column on laptop, per screenshot 340) to `max-w-[1400px] mx-auto px-4`. Agenda day-cards container went from `flex flex-col gap-4` to `flex flex-col gap-4 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-4` so the 7-day window fits as 3×3+1 on laptop. PendingBookingsModal stays outside the wrapper. If anyone widens the 7-day window or changes the day-card structure, verify it still flows on the desktop grid.

See also: `bug_patterns.md` Pattern P2 (slug-targeted mirror), Pattern S6 (realtime publication), Pattern A6/A7/A8 (Bridge guards), Pattern P1 (player doesn't recompute owner-derived values), Pattern T4 (live-query DB-static, current-time in render), Pattern W1 (workflow/deploy validation before debugging local-vs-prod). Decisions: D-PlayerHub-1 (Supabase-first), D-2026-06-11 (client-side owner update via RLS).

Invariants (P2):
- **NO HARDCODED FALLBACK (#106 core invariant):** When `bookingOpenMinutes` or `bookingCloseMinutes` is null/undefined, the player UI MUST render `not_configured`. The old `[8:00, 24:00)` fallback was the exact regression vector — never reintroduce it for "convenience."
- **Server-side per-slot recompute is the safety net:** Client computes the advance but the RPC recomputes from `coalesce(booking_advance_per_slot, 50)` and raises `advance_mismatch` on disagreement. Player UI surfaces this as a retry, not a generic error.
- **Server outside_hours is non-overnight-only:** Clubs with `booking_close_minutes > 1440` (overnight) skip the bounds check in submit_booking_intent. This is intentional simplification for v1 — client filters the time options and the slot_in_past/slot_taken/conflict checks still hold. If overnight server validation is ever added, the timezone math must handle slots that land on calendar day N+1 from a "service day" anchored at N.
- **bookingAdvanceAmount is frozen:** No UI writes it after 22 Jun 2026; no read path reads it for new bookings. Existing rows keep their stale value as audit history. Deleting the field or column is a future-only decision (not in v19).
- **Hours selects use Pattern R4 typing-buffer for the WRITE only:** Open/close are stored as numbers in Dexie and read as `settings.bookingOpenMinutes` (undefined = not set). The hook is used purely for `setValue` because undefined cannot flow through the hook's `NonNullable` fallback gate.
- **Per-slot advance input uses Pattern R4 typing-buffer variant:** `useDexieSetting('bookingAdvancePerSlot', 50)` for the authoritative number, local string draft for the in-flight typing, blur commits via `useSaveIndicator().run(...)`.

Cross-feature ripples (P2):
- → [Settings](#settings): bookings card moves from 2 controls (toggle + flat advance) to 4 controls (open select + close select + toggle + per-slot input), all four through `<SaveIndicator>`.
- → [Player Hub](#player-hub): `getClubPublicInfo` RPC signature grows by 3 columns — TS mapper extended in `getClubPublicInfo()`, defensive `?? null / ?? 50` defaults at the boundary (pre-migration safe).
- → [Schema & Migrations](#schema--migrations): Dexie v18 → v19 (additive optional fields, no `.upgrade()`).

Last updated: 8 Jul 2026 (#127 fixed — table-id retyped `number`→`string` across code + `20260708_booking_table_id_uuid` migration; Part A invariant updated to the string check)

---

## Infra: Supabase Keep-Alive

Daily GitHub Action that pings Supabase REST so the free-tier project doesn't auto-pause after 7 days of inactivity. A paused project = dead live topup/pricing QR at `app.handbookhq.in/c/<slug>`.

Files in scope:
- `.github/workflows/supabase-keepalive.yml` — cron `0 6 * * *` (06:00 UTC / ~11:30 IST) + `workflow_dispatch`. Single curl against `/rest/v1/clubs?select=id&limit=1` with the anon key from repo secret `SUPABASE_ANON_KEY`. Fails (non-zero exit) on curl error so a broken ping pages via GitHub email.

Invariants:
- Use the **anon key** only — never the service_role key. Anon is RLS-gated and already shipped in the public client bundle.
- The Supabase project URL is hardcoded in the YAML (`vkczmgzujpidbwtzulel.supabase.co`). If the project is ever migrated → update this URL too.
- Repo secret name MUST stay `SUPABASE_ANON_KEY`. Renaming requires updating both the secret in GitHub Settings AND the `${{ secrets.* }}` reference in the YAML.
- The endpoint hit (`clubs`) must exist. If `clubs` is ever renamed/dropped (unlikely — it's the root tenant table), pick another small public-readable table.

Cross-feature ripples:
- → If anon key is rotated in Supabase: rotate `VITE_SUPABASE_ANON_KEY` in `.env.local`, Vercel env vars, AND the GitHub repo secret. Three places, all required.
- → If the Supabase project is replaced entirely (URL changes): update YAML, `.env.local`, Vercel env, AND `src/lib/supabase.ts` / `src/lib/supabasePublic.ts` env consumers.

Last updated: 16 Jun 2026

---

## Sync (Phase C — outbox + drain engine)

The multi-device sync write path. Dexie wrappers (Chunk 3) write data + outbox atomically; the SyncRunner (Chunk 4) drains outbox rows to Supabase. The runner is the only thing in the codebase that calls `supabaseSync.from(<synced-table>)` for owner-data writes (Chunk 4.3 — was `supabase.from(...)` until the navigator-lock deadlock fix forced a dedicated client; Pattern S16).

**Three-client rule (Chunk 4.3 → promoted Chunk 5.0, Pattern S16):**
- `supabase` (`src/lib/supabase.ts`) — owner AUTH + non-synced reads + ALL REALTIME (including SyncReader's 4 club channels — supabaseSync has no `.auth` and cannot drive realtime token refresh). Default storageKey.
- `supabasePublic` (`src/lib/supabasePublic.ts`) — anon player-hub RPCs only. Distinct `storageKey: 'sb-clubkeeper-public'`. Pattern A7.
- `supabaseSync` (`src/lib/supabaseSync.ts`) — owner DATA PLANE (SyncRunner writes + SyncReader pulls). Lock-free via `accessToken` option. Imported ONLY by `syncRunner.ts` + `syncReader.ts`. No `.auth` (Proxy throws), no realtime.

Files in scope:
- `src/types/index.ts` — `SyncTableName` union (9 snake_case names) + `OutboxRow` interface with `stuck?: boolean` dead-letter marker.
- `src/db/syncTableMap.ts` — snake_case ↔ camelCase mapping. Used ONLY by wrappers. `SYNC_TABLES_PULL_ORDER` reserved for Chunk 5 initial pull.
- `src/db/syncWrappers.ts` — `syncedCreate / syncedUpdate / syncedSoftDelete / syncedCreateBatch / syncedBatch`. Each opens its OWN Dexie 'rw' tx over `(dataTable(s) + _outbox)` (Pattern D7). Calls `scheduleDrain()` ONCE AFTER tx commit. Never called from inside another `db.transaction()`. `syncedBatch(tables, fn)` (#122) is the mixed INSERT+UPDATE atomic batch: opens one tx over caller-declared synced tables + `_outbox`, runs `fn(b)` inside it (caller reads `db.*` directly, emits ops via `BatchContext.insert/update/softDelete` which write data row + outbox row together), drains once. `softDelete` on `wallet_transactions` throws (append-only).
- **Wrapper call-site coverage (Chunk 7 Groups A+B+C complete, #122/#126):** ALL synced-table mutation sites go through the wrappers — `src/db/queries.ts` (Groups A+B) plus the Group C non-queries sites: `src/store/customerStore.ts` (createCustomerWithPhone/updateCustomerPhone/updateCustomerName/updateCustomer/topUp/applyManualAdjustment), `src/lib/coinExpiry.ts` (applyExpiryForCustomer), `src/lib/streak.ts` (checkAndAwardStreak), `src/lib/nudge.ts` (logNudgeSent), `src/lib/walkInCode.ts` (createWalkInCustomer — walk-in counter allocated COUNTER-FIRST in its own settings-only tx since `settings` is not a synced table; a crash between the two txs skips a code number, never duplicates one), `src/components/PendingTopupsModal.tsx` + `PendingBookingsModal.tsx` (approve-path creates; the booking ConstraintError re-tap guard survives syncedCreate's rethrow), `src/components/AddItemBottomSheet.tsx` (runCanteenAddTransaction → `syncedBatch(['canteen_items','session_items'])`). **#124 closed the last gap: deleteSessionItem/restoreSessionItem converted to the soft-delete model — write-site cutover is 100%.** Still raw BY DESIGN (non-sync domains): importEverything bulkAdd, TestOutbox dev deletes, Settings.tsx one-off, clearAllSessions/resetEverything (bulk teardown). Any NEW mutation site on a synced table MUST use a wrapper, and any NEW `session_items` reader MUST filter `!row.deletedAt` (see §Session Items).
- `src/db/scheduleDrain.ts` — one-line re-export from syncRunner. Indirection layer so future queue-coalescing drops in here without touching wrappers.
- `src/db/syncRunner.ts` — the engine. `start() / stop() / scheduleDrain() / drainOnce() / pushOne()`. Module-level `syncRunner` singleton. Per-row 15s watchdog + `drainGeneration` counter (Pattern S15).
- `src/db/syncPayloadMapper.ts` — Pattern S14. Per-table strict allowlist converting camelCase Dexie row → snake_case Supabase row. ALL 9 tables wired as of Chunk 5.2b (2 Jul 2026). Paired 1:1 with `syncReadMapper.ts` — never add to one without the other (one-way sync = silent divergence).
- `src/db/syncReadMapper.ts` — the pull-side inverse (Chunk 5.2b). ALL 9 tables. Contract (#117): every `*At` lands as camelCase epoch ms (`updatedAt`/`deletedAt` included); raw snake_case `updated_at`/`deleted_at` NEVER persist on a Dexie row; jsonb (items, paymentBreakdown, tableMoves, rateCard, config) always real objects, never JSON strings. Fail-loud helpers: `reqStr/reqNum/reqBool/reqEnum/optJsonObject/reqArray/isoToMs/parseBreakdown`.
- `src/db/syncReader.ts` — serialized job queue (Chunk 5.3: FIFO `jobQueue: ReaderJob[]` — `pull` jobs deduped via `queuedPullTables` Set, `apply` jobs one per realtime event — single `runPullWorker` latch + S15 generation guards). Per-table cursor column via `cursorColumnFor()` — `created_at` for `wallet_transactions` (append-only, NO updated_at column; ordering on it would 400), `updated_at` for the other 8. Realtime: 4 grouped channels per §7.2 (`club:<id>:operations|catalog|commerce|scheduling`) on the MAIN `supabase` client, subscribed inside `initialPull` after the club_id claim resolves (teardown-before-register, AWAITED — Pattern S23), torn down in `stop()` (Pattern S22). Handlers DIRECT-APPLY `payload.new` via `applyEvent` (§7.3): outbox-guard → numeric epoch-ms LWW compare (S17) → tie-break (equal ms yields to remote; `updated_by` is NULL from our pushes so the branch is currently always-remote) → `fromSupabaseRow` → `put` → monotonic cursor advance (only forward, NEVER from a null cursor — would truncate the epoch pull). DELETE / malformed / unparseable-ts events fall back to the doorbell `requestPull(table)`. Chunk 5.4 — §7.4 polling fallback: per-group `channelDownSince` map + 30s grace + shared 60s `setInterval` calling the SAME `requestPull` doorbell for every table in a currently-down group; stops the instant the group's channel reports SUBSCRIBED. `teardownRealtime()` returns `Promise.all(removeChannel(...))` and is AWAITED before re-registering (Pattern S23 — `supabase.channel(topic)` reuses the old object until the async removal completes; skipping the await reintroduces a false-positive down-state race).
- `src/pages/__dev__/TestSyncReader.tsx` — DEV-only `/__dev/test-sync-reader` runtime-proof page (reset cursors / force pull / dump synced-table row shapes).
- `supabase/migrations/20260702_sync_client_fields.sql` — sessions.config + bookings.config jsonb, canteen_items.stock_enabled, wallet_transactions coin columns + reference_id uuid→text. UNTIL APPLIED: read mappers THROW on sessions/bookings/canteen_items rows (fail-loud; empty tables no-op) and coin-row pushes 400.
- `src/db/syncClubId.ts` — Lock-free token reader + `user_club_id` JWT claim decoder (Pattern S16). Exports `getOwnerClubIdFromJwt`, `readAccessTokenLockFree` (used by supabaseSync's `accessToken` getter), `_resetClubIdCache` (called from authStore.signOut).
- `src/lib/supabaseSync.ts` — NEW (Chunk 4.3, Pattern S16). REST-only Supabase client for the drain. `createClient(url, key, { accessToken: async () => readAccessTokenLockFree() })`. Bypasses GoTrueClient entirely so it never acquires `lock:${storageKey}`. WRITE-ONLY, imported only by `syncRunner.ts`.
- `src/store/authStore.ts` — sign-out calls `syncRunner.stop()` + `_resetClubIdCache()` + `_resetClubSyncSentinel()` BEFORE `closeDb()` (Pattern S15).
- `src/hooks/useLiveData.ts` — exports `_resetClubSyncSentinel` for the sign-out cleanup.
- `src/App.tsx` — `<SyncRunnerBoot />` component owns the lifecycle (start on `dbReady + session + !playerHub`, stop on cleanup).
- `src/pages/__dev__/TestOutbox.tsx` — DEV-only `/__dev/test-outbox` page with smoke-test buttons.

Invariants:
- **`supabaseSync` is WRITE-ONLY for the drain — imported ONLY by `src/db/syncRunner.ts`.** Never import it from anywhere else. Never access `.auth` on it (Proxy throws). No realtime, no reads. The `accessToken` getter MUST stay lock-free (in-memory → synchronous localStorage; never `await supabase.auth.*` inside it). Violating any of these re-introduces the Pattern S16 deadlock.
- Wrappers MUST NOT be called from inside an outer `db.transaction()` — Dexie throws "Transaction is already closed" on nested 'rw' over the same stores. Create-only multi-table atomic ops use `syncedCreateBatch`; mixed INSERT+UPDATE (or read-dependent) atomic ops use `syncedBatch(tables, fn)` (#122). Callers pass DATA (a tables list + a callback that reads/emits ops), never nested wrapper calls; never nest `syncedBatch` in an outer `db.transaction()` either.
- SyncRunner.drainOnce closes its Dexie read tx BEFORE the first `await supabaseSync...` (Pattern D7). Per-row delete/update on success/failure each get their own short tx.
- SyncRunner self-heals (Pattern S15): per-pushOne 15s watchdog (NOT per-batch — per-batch stacks concurrent drains on 50-row backlogs), `drainGeneration` bumped on start()/stop() with bail guards after each post-await point in drainOnce, sign-out resets module-level caches in order (`syncRunner.stop()` → `_resetClubIdCache()` → `_resetClubSyncSentinel()` → `closeDb()`).
- SyncRunner stays quiet on the placeholder DB. `scheduleDrain()` checks `db.name === 'ClubKeeperDB__pending'` first and exits early. Without this guard, scheduleDrain from test pages / dev hot-reloads pre-auth would target the placeholder Dexie instance.
- SyncRunner stays quiet on player-hub routes (`/c/*`, `/poster/*`). SyncRunnerBoot's `isPlayerHubRoute()` check enforces this — same gate as AuthInitializer / ExpirySweepRunner.
- Dead-letter threshold = 10 attempts. When `attempts + 1 >= 10`, the row gets `stuck: true` and is SKIPPED on subsequent drains. Stuck rows are surfaced via the DEV TestOutbox "Show dead-letter" button until Chunk 6 ships a sync-indicator UI.
- drainOnce uses streaming `.each()` with a sentinel-throw break (NOT `.filter().limit()`) to avoid stuck-row starvation when ≥50 dead-letter rows accumulate.
- Backoff: 1s → 60s exponential. Resets to 1s on a successful drain pass. A drain that contains only dead-letter skips is treated as success (backoff resets).
- `pushOne` on `soft_delete` updates BOTH `deleted_at` AND `updated_at`. Required so Chunk 5's cursor-based pull (`WHERE updated_at > cursor`) sees the deletion on peer devices. `soft_delete` on `wallet_transactions` THROWS (append-only ledger — no deleted_at/updated_at columns; write a reversal row per §4.6).
- **Un-delete cannot ride `soft_delete` (#124).** The `soft_delete` op only SETs `deleted_at`. Clearing a tombstone MUST ride op `update` (full merged row with `deletedAt: null`), and the table's payload mapper MUST emit an EXPLICIT `deleted_at: null` when `row.deletedAt === null` (`undefined` still omits — S14 partial-upsert semantics). Wired for `session_items` only; any future un-delete on another table needs the same mapper treatment or the server tombstone silently survives. Pull side needs nothing: read mappers omit `deletedAt` for null and the reader applies full-row `put`/`bulkPut`, which drops the local tombstone key.
- **Soft-deleting a table's rows obligates its READERS:** every Dexie read of that table must filter `!row.deletedAt` or peers' deletes ghost into aggregates. `session_items` is the first fully-filtered table (#124, list in §Session Items) — use it as the template when any other table gains a delete path.
- **LWW metadata format (#117, 2 Jul 2026):** on Dexie rows, `updatedAt`/`deletedAt` are camelCase EPOCH MS, stamped by `syncedUpdate`/`syncedSoftDelete` and by the read mappers. ISO conversion happens ONLY at the wire boundary (payload mapper on push, read mapper on pull, pushOne soft-delete branch). NEVER string-compare ISO timestamps across sources — locally-stamped `toISOString()` ("...Z") and PostgREST ("...+00:00") formats are not lexicographically comparable. The Chunk 5.3 LWW handler compares NUMBERS.
- Realtime channels live on the MAIN `supabase` client ONLY — never on `supabaseSync` (no `.auth` → no `realtime.setAuth` driving → events silently die after ~1h token expiry). Handlers must generation-guard before enqueueing (Pattern S22).
- **Direct-apply invariants (Chunk 5.3):** every apply routes through the ONE serialized worker — never write `settings.pullCursors` outside it. Cursor advance from an apply is monotonic-forward only and NEVER from a null cursor (null = epoch pull hasn't recorded history; seeding it would truncate the initial pull = silent data loss). Outbox-guard runs BEFORE the LWW compare (pending local write always wins locally; drain + server lww_% trigger arbitrate). LWW compares NUMBERS (S17). A mapper throw inside an apply is caught per-job (queue continues, error surfaced) — same fail-loud contract as pulls.
- Idempotency: `upsert({ onConflict: 'id', ignoreDuplicates: false })` for insert/update. Safe to retry forever. Outbox can be replayed from scratch.
- TestOutbox row ids are real `crypto.randomUUID()` (Chunk 4.2 — Supabase `uuid` columns reject anything else; see Pattern S14 watch-out). Test rows are identified by a `TEST ` prefix on the `name` field (or `items[0].name` for canteen_sales). Cleanup filters by that prefix. With Chunk 4 live the rows DO reach Supabase — manual cleanup there via SQL Editor / Dashboard is the only path back.

Cross-feature ripples:
- → If a new field is added to any of the 9 Dexie row interfaces and it should sync: ADD the field to BOTH its table's mapper in `src/db/syncPayloadMapper.ts` AND `src/db/syncReadMapper.ts`. The allowlist is strict — un-mapped fields are silently DROPPED on push and stay undefined on pull (Pattern S14). If the field has no Supabase column, it rides that table's `config` jsonb (sessions/bookings/game_tables) or needs a column migration. Verify by pushing through TestOutbox and pulling through TestSyncReader.
- → If a new Dexie synced table is added: extend `SyncTableName` union in `src/types/index.ts`, both maps in `src/db/syncTableMap.ts`, the `DexieSyncTableName` union, the `SYNC_TABLES_PULL_ORDER` array, a `CHANNEL_GROUPS` slot in `syncReader.ts` (§7.2 grouping), AND mapper entries in BOTH `syncPayloadMapper.ts` and `syncReadMapper.ts` (otherwise pushOne/pull throw). If the table is append-only (no updated_at), extend `cursorColumnFor()`.
- → If the OutboxRow shape changes: bump Dexie schema (current v20) — `_outbox` index string lives in `src/db/database.ts`. Also update `buildOutboxRow` in `syncWrappers.ts` so new fields are populated on every queue.
- → If a queries.ts mutation site is converted from raw `db.X.add/put/update/delete` to a wrapper (Chunk 7): the call MUST move OUT of any surrounding `db.transaction()` block, because the wrapper opens its own tx. If atomic multi-table behavior is required AND all writes are creates, use `syncedCreateBatch`. **If the atomic op mixes INSERT+UPDATE (the common case), use `syncedBatch(tables, fn)` (#122, SHIPPED b1407e3): declare every synced table the callback reads or writes, do the reads inside the callback, emit ops via `b.insert/update/softDelete`. NEVER split a mixed op into sequential wrapper calls (breaks the power-cut guarantee) and NEVER nest `syncedBatch` in an outer `db.transaction()` (Pattern D7). Non-synced reads (e.g. `db.settings`) can't ride the tables list — hoist them before the batch only if they're not part of the atomic guarantee.**
- → Chunk 7 state: COMPLETE. Group A (8ff1e6d) game_tables + canteen_items single-table sites; #122 `syncedBatch` (b1407e3) + the 4 multi-table atomic sites (`recordStockPurchase`, `createCanteenSale`, `updateSessionItem`, `createBackEntry`); Groups B+C (#126) swept queries.ts + the ~20 non-queries sites; #124 converted the final pair (`deleteSessionItem`/`restoreSessionItem`) to the soft-delete model. Any NEW single-table mutation on a synced table MUST use a single wrapper from day one; any NEW mixed-op atomic op MUST use `syncedBatch`; any NEW delete path on a synced table MUST be a soft-delete with reader `!deletedAt` filters (§Session Items is the template).
- → If `clubs.sync_enabled` kill-switch is wired (later chunk): the check goes at the top of `SyncRunner.scheduleDrain()` (or in `SyncRunnerBoot`'s gate) — do not scatter it across wrappers.
- → If `BATCH_SIZE` is raised in `syncRunner.ts`: review the `drainOnce` streaming loop's memory footprint and the "large-backlog continuation" tail-call pattern; both currently assume bounded batch.
- → If the Supabase schema renames any of the 9 synced tables: update `SyncTableName` literal + the `SYNC_TO_DEXIE` / `DEXIE_TO_SYNC` maps. Wrappers' `syncTable` argument is a literal type — TS will fail loudly.
- → If a wrapper signature changes (e.g. `syncedCreate` gains an option): update `TestOutbox.tsx` test callers AND check Chunk 7's eventual queries.ts migration plan.
- → If a new owner-data WRITE path is added outside SyncRunner (e.g. a direct `.from(<synced-table>).upsert(...)` from queries.ts or a new admin tool): use `supabaseSync`, not `supabase`. Using `supabase` for owner writes risks re-introducing the navigator-lock deadlock under StrictMode / sign-out flips (Pattern S16). For non-synced owner reads / admin RPCs, `supabase` is still correct.
- → If a NEW Supabase client is created anywhere: it MUST have a distinct `storageKey` AND should prefer the `accessToken` escape hatch if it does owner-data REST writes (avoid spawning a new GoTrueClient unless the file genuinely needs `.auth`). See `src/lib/supabaseSync.ts` for the template.

Last updated: 7 Jul 2026 (#122 syncedBatch mixed-op atomic wrapper SHIPPED b1407e3 — 4 multi-table sites converted + runtime-proven; deleteSessionItem/restoreSessionItem deferred to #124; Group B next)

---

## App-shell boot components (Pattern A10)

Singleton-owning `<XyzBoot />` / `<XyzRunner />` components mounted at the top of `App.tsx` (or `src/components/`) that start a module-level runner or subscription on the authenticated session and tear it down on sign-out. Current members: `AuthInitializer`, `SyncRunnerBoot`, `SyncReaderBoot`, `ExpirySweepRunner`, `TopupRealtimeBridge`, `BookingRealtimeBridge`.

Files in scope:
- `src/App.tsx` — `AuthInitializer`, `SyncRunnerBoot`, `ExpirySweepRunner`, `TopupRealtimeBridge`, `BookingRealtimeBridge` mount points.
- `src/components/SyncReaderBoot.tsx` — SyncReader lifecycle owner (Chunk 5.0+).
- `src/components/TopupRealtimeBridge.tsx`, `src/components/BookingRealtimeBridge.tsx` — reference-correct examples of the userId-primitive dep pattern.

Invariants:
- **Pattern A10 — boot effects gate on stable identity (`session?.user?.id`), NEVER the raw `session` object.** `authStore.initialize()` and supabase-js's `onAuthStateChange('INITIAL_SESSION')` both fire a `set({ session })` on cold boot carrying identical `session.user.id` but different object references. Depping on the object churns the effect twice; depping on the primitive is stable. DEV StrictMode adds a third fire, also absorbed. Full RCA in `bug_patterns.md` Pattern A10.
- **Do NOT dep on `session?.access_token`.** Background token refresh (every ~50 min) would tear the singleton down and restart, killing any in-flight drain / pull. Token-refresh reactivity belongs INSIDE the singleton as a dedicated `supabase.auth.onAuthStateChange(TOKEN_REFRESHED)` listener with teardown-before-register (see `SyncReader.deferForRefresh` for the template).
- All boot effects must also `isPlayerHubRoute()`-gate — public routes (`/c/*`, `/poster/*`) never trigger owner-side machinery. Same gate as AuthInitializer.

Cross-feature ripples:
- → If a NEW app-shell boot component is added: copy the dep pattern from `TopupRealtimeBridge` or `BookingRealtimeBridge`. Extract `const userId = session?.user?.id ?? null` in the render body; dep the effect on `[dbReady, userId, ...]`. NOT `[dbReady, session, ...]`. Do NOT copy any pre-A10 code path (Wallet.tsx:74 / Bookings.tsx:110 are the surviving offenders — #113 tracks the sweep).
- → If a boot component needs to react to a token refresh (e.g. deferred initial-pull retry when a JWT claim is missing): install a `supabase.auth.onAuthStateChange('TOKEN_REFRESHED')` listener INSIDE the runner class, not in the boot effect deps. Use teardown-before-register semantics at BOTH the top of the register function AND inside the fire handler so a synchronous re-defer inside the retry's catch cannot stack listeners.
- → If `authStore` is refactored to fire fewer redundant `set({ session })` calls: Pattern A10 stops being load-bearing, but the primitive-dep discipline should stay — future auth-state churn (e.g. a new supabase-js version's event semantics) would silently re-open the bug.

Last updated: 1 Jul 2026 (Chunk 5.2 pre-commit — Pattern A10 added, three boot effects converted)

---

## How to add to this file

When you discover a new ripple effect:

1. Find the right feature section (use Quick Index).
2. Add the file path under "Files in scope" or add a new cross-feature ripple bullet.
3. Promote it to an "Invariant" only if violating it is a guaranteed bug, not a pattern preference.
4. Cross-link related sections rather than duplicating content.
5. Bump the "Last updated" date.

If no existing section fits, add a new feature section using the template. Add a corresponding entry to the Quick Index.

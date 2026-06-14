# Changelog

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

## 13 Jun 2026 — Auth fixes (commit e7b0522)

- `authStore.signOut()`: `window.location.href = '/'` hard nav after clearing state. Also resets `loading` + `subscriptionLoaded` flags.
- `supabase.ts`: `storage` option added then removed by linter — session persistence relies on Supabase default.
- `Settings.tsx handleSaveClubName`: fires `updateClubNameRemote()` (new fn, `playerHubApi.ts`) after Dexie write — fire-and-forget Supabase sync with error toast (S1 fix).
- `PlayerHubSettings.tsx handleToggleTopups`: Supabase-first write, Dexie only on success — eliminates permanent desync (S4 fix).
- `AuthCallback.tsx`: 20s safety timeout — toast + navigate to `/` if Supabase hangs.

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

Chronological record of what shipped, when, and what manual setup was done. Read only when Sugeet asks "when did we ship X" or needs to retrace a specific past step. Current state of the app lives in `SKILL.md` under "Current State Snapshot" — read that first for "where are we now?" questions.

---

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

### ⏳ Pending
- **Razorpay webhook setup:**
  1. Razorpay Dashboard → Settings → Webhooks → Add webhook URL: `https://YOUR-VERCEL-URL/api/razorpay-webhook`
  2. Generate webhook secret → add `RAZORPAY_WEBHOOK_SECRET=<secret>` to Vercel env vars
  3. Redeploy Vercel to pick up the new env var
  4. Enable events: `subscription.authenticated`, `.activated`, `.charged`, `.halted`, `.cancelled`, `.completed`, `payment.failed`
- **Razorpay LIVE mode switch** (needs KYC first)
- **End-to-end payment test on deployed Vercel**

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

## Open future work (not yet started)

- GST invoicing (Prompt 14)
- Email notifications (Prompt 14)
- One-time migration from old `ClubKeeperDB` → `ClubKeeperDB_<userId>` for users who had data before this change
- Existing offline data migration strategy when cloud sync arrives (now unblocked — Dexie is already per-user)

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

14 Jun 2026 — SKILL.md: tightened bug-tracking rules. Issues now created BEFORE code, closed ONLY after Sugeet's explicit verification (Rule F).
14 Jun 2026 — fix #69 (2b83dd1): QuickSale now shows UPI QR overlay for the UPI split amount after a successful sale. `UpiQrCard` now has 3 consumers — ripple_effects.md updated. Bug sprint issues #68–74 created and logged in bug_archive.md.
14 Jun 2026 — fix #72 (6be8ed0): Table Move now rejects moves across incompatible rate-card configs (billing mode / tier array / tolerance). MoveTableList mirrors same checks client-side. ripple_effects.md updated with full 6-rule compatibility spec.
14 Jun 2026 — fix #70 (9f7e2aa + 41a7bb1): All Summary widgets now tick live. Two-commit fix: (1) removed useMemo from rankTables + bucketByHour; (2) removed useMemo from runningRevenueToday — the real cause of Day's earnings + Avg session freeze. Pattern T4 addendum: useMemo hides getElapsedMs from tick just like useLiveQuery does.

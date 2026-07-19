# Bug Archive — Pointer Index

Bugs are tracked as GitHub Issues at:
**https://github.com/Sugeet21/clubkeeper/issues**

This file contains one-line pointers only. For the full description, root cause,
fix details, and commit SHA, use:

```
gh issue view <number>
gh issue list --state all --label bug
gh issue list --search "<keywords>" --state all
```

Format: **ID** (#issue, commit if fixed, else "open") — symptom — see GitHub

---

## 19 Jul 2026 — Phase C sync tail closed by owner (#110/#112/#120/#125/#126)

- **#110** (closed by owner 19 Jul 2026) — outbox dead-letters on camelCase column names; Pattern S14 mappers across Phase C chunks. — see GitHub
- **#112** (closed by owner 19 Jul 2026) — SyncReader tracker (initial pull + realtime + LWW + polling fallback, Chunk 5 series 6a8d2f9/14d4b3e); runtime-proven in D9. — see GitHub
- **#120** (closed by owner 19 Jul 2026, fixed 7b69c11) — boot hang on stranded GoTrue navigator lock; 8s race + lock-free degraded boot, Pattern A11. — see GitHub
- **#125** (closed by owner 19 Jul 2026, fixed 9693fe9) — lastVisitAt dropped by sync mappers → Wallet RECENT empty on pulled devices; Pattern S14 read gap. — see GitHub
- **#126** (closed by owner 19 Jul 2026, cutover series ending 11a616c) — ~20 write sites outside queries.ts wrote raw; write-site cutover now 100%. — see GitHub

## 19 Jul 2026 — reset/staff/phone quintet closed by owner

- **#153** (closed by owner 19 Jul 2026, fixed b126943) — advance→wallet stored bare 10-digit playerPhone → duplicate customer + mangled display; canonical +91 via `src/lib/phone.ts`. Pattern PH4. Residual: pre-fix players with BOTH a legacy bare row and a canonical row need manual merge. — see GitHub
- **#154** (closed by owner 19 Jul 2026, fixed 3661905 + migration `20260719_reset_club_data_rpc`) — 'Type RESET' resurrected after refresh (local-only wipe); server-first reset via owner-gated `reset_club_data()` RPC. Pattern S27. Sweep child #155 still open. — see GitHub
- **#156** (closed by owner 19 Jul 2026, fixed a4eb9aa + migration `20260719_reset_purge_removed_staff`) — reset left staff auth accounts; owner scope: purge REMOVED staff only, active stay. — see GitHub
- **#157** (closed by owner 19 Jul 2026, fixed a4eb9aa + migration `20260719_users_meta_username`) — ENH: permanent usernames in staff list + copy-login button (D8b resolved). — see GitHub
- **#158** (closed by owner 19 Jul 2026, fixed a4eb9aa) — ENH: removed staff as compact record lines. — see GitHub

## 18 Jul 2026 — #97 close + PH2 mirror sweep fallout

- **#97** (closed by owner 18 Jul 2026, fixed 7867565) — Accept-bookings toggle: original read-side flip fixed via Pattern R4/238001f (owner-verified 20 Jun); remaining write-side defect = `syncBookingConfigBySlug` swallowed the `MirrorResult` → Dexie written + "Saved" shown on mirror failure (silent owner/player desync; also explained the acceptsTopups stuck-ON asymmetry). Now throws; Dexie write aborts; SaveIndicator red. See Pattern PH2. — see GitHub
- **#142 / #143 / #144** (open, P2, SWEEP-#97) — remaining swallowed-MirrorResult sites: coins Dexie-first save / tables_json after table CRUD / v17 self-heal re-mirror. Accepted deviations pending contract decision; ledger on Pattern PH2. — see GitHub
- **#145** (open, P1) — fresh-device hydration gap: `useSyncClubFromSupabase` never backfills acceptsBookings/hours/per-slot. — see GitHub
- **#154** — CLOSED 19 Jul; see the 19 Jul section above. — see GitHub
- **#155** (open, P2, SWEEP-#154, code not started) — `clearAllSessions` same local-only wipe class + orphans session_items. — see GitHub
- **#153** (open, P1, fix committed b126943 — pending owner verification) — booking advance→wallet saved customer under bare 10-digit phone instead of canonical `+91` → duplicate customer + `formattedPhone` mangling ("varying number"). Pattern PH4. — see GitHub
- **#147** (closed by owner 19 Jul 2026, fixed 3f9fcc0, migration `20260718_booking_pending_expiry`) — ENH, booking pending-hold v2 (D-Booking-2): 10-min lazy expiry of pending holds, per-slot `status` from `get_booked_slots` (amber Pending chips), guarded `confirm_booking_intent` RPC with typed `intent_expired`/`slot_taken`. In-scope bonus fix: lazy cleanup deleted future-slot confirmed rows 24h after CREATION → silent double-book vector; cleanup now keeps rows until the slot passes. — see GitHub
- **#146** (closed by owner 18 Jul 2026, fixed 898e1e7) — player booking/topup paid a STALE UPI ID: `Settings.tsx handleSaveUpiId` wrote Dexie only — no `upi_id` update-path mirror existed (only slug-setup `upsertClub` wrote it). Fixed strict-PH2 via throwing `updateUpiIdRemote`. Missing-mirror PH2 variant; spawned the Direction-2 sweep. — see GitHub

- **#130** (closed by owner 11 Jul 2026, fixed e3a0507, migration `20260710_phase_d6_staff_write_rls_fix`) — staff wallet top-up dead-lettered: D1 RLS whitelisted the advisory DDL enum (`kind in ('topup',…)`) but the mapper sends Dexie `type` verbatim → `kind='credit'` 403. See Pattern S26. — see GitHub
- **#131** (closed by owner 11 Jul 2026, fixed e3a0507, same migration) — staff stock decrement dead-lettered: runner pushes updates as `.upsert()`, Postgres checks INSERT WITH CHECK on every upsert row, canteen_items INSERT was owner-only. See Pattern S26. — see GitHub
- **#132** (closed by owner 11 Jul 2026, fixed 958ed11, migration `20260711_staff_manual_adjustment_rls_exclusion`) — the D6 fix's exclusion list blocked `'adjustment'`/`'reversal'` (strings the app never sends) but missed `'manual'` — the real adjustment shape passed staff RLS. See Pattern S26 rule 1 (extended). — see GitHub
- **#133** (fix 860e868, migration `20260711_server_actor_stamping` applied + E2E-verified incl. forge probe, closed by owner 11 Jul 2026) — `created_by` was NULL on every synced-table row (no default/trigger, mapper never sends it) — zero server-side attribution of staff vs owner writes. Fixed with unforgeable `auth.uid()` BEFORE triggers on all 9 tables; also activates the syncReader equal-ms self-vs-peer tie-break. — see GitHub

---

## 10 Jul 2026 — Phase C write-site cutover close

- **#124** (closed by owner 10 Jul 2026, fixed 39f44c5 + ca69c55) — deleteSessionItem/restoreSessionItem hard-delete had no sync round-trip. Converted to soft-delete model: tombstone + restock in one syncedBatch; Undo clears `deletedAt` on the SAME row id via op `update` (payload mapper now emits explicit `deleted_at: null`); `!deletedAt` filters on all 11 session_items readers. Owner-verified 3-round runtime proof. See ripple_effects §Session Items + §Sync un-delete invariants. — see GitHub

---

## 3 Jul 2026 — Phase C Chunk 5.3 runtime proof

- **#116** (closed by owner 3 Jul 2026, plumbing in 6a8d2f9) — SyncReader broken-hook TOKEN_REFRESHED single-fire proof; runtime capture on the issue shows one deferral warn, exactly one retry across two refresh events, listener torn down after firing. — see GitHub
- **#119** (open, P2) — duplicate realtime event delivery after a StrictMode-raced channel teardown leaks a server-side pg_changes subscription; every event handled twice until reload. Correctness-safe (idempotent direct-apply), 2× cost. — see GitHub
- **#120** (fix committed 7b69c11 3 Jul 2026, pending owner verification, P1) — app never boots when a zombie tab strands the GoTrue navigator lock; `getSession()` queues forever (supabase-js 2.106.1 clobbers auth-js's 5000ms `lockAcquireTimeout` default with an explicit `undefined`) → eternal "Loading…". Fixed: 8s race + lock-free degraded boot, no steal. See Pattern A11. — see GitHub
- **#121** (open, cosmetic) — "Failed to set initial Realtime auth token" warning on every cold load: supabase-js 2.106.1 invokes supabaseSync's `accessToken` getter synchronously in the constructor mid-import-cycle → authStore TDZ throw (caught by the library). Pre-existing, found during the #120 proof session. No impact (supabaseSync has no realtime). — see GitHub

---

## 2 Jul 2026 — Phase C Chunk 5.2b

- **BUG-S17** (#117, fixed 43a1e4c, closed by owner 2 Jul 2026) — LWW metadata stored as raw ISO strings on Dexie rows; local `toISOString()` ("...Z") vs PostgREST ("...+00:00") formats are not string-comparable, so the planned Chunk 5.3 string-compare would silently discard newer peer edits. Fixed by contract shift to camelCase epoch-ms `updatedAt`/`deletedAt` on Dexie, ISO only at the wire. See Pattern S17. — see GitHub
- **#118** (open) — `npm run build`'s `tsc` step is a no-op (solution-style root tsconfig without `-b`); the typecheck gate is vacuous, ~15 pre-existing errors accumulated in tsconfig.app.json scope, some possibly real post-v20 bugs. Needs its own triage session. — see GitHub

---

## 24 Jun 2026 — Phase B step 1 fallout

- **BUG-B1** (#107, fixed 8e4619c + 986ace0) — Tapping any table crashed with `DataError: parameter is not a valid key`; then second crash on Start Timer with `Evaluating the object store's key path did not yield a value`. Two-layer ripple from v20 schema flip: route params still coerced via `Number()` (UUID → NaN) AND `.add()` sites still expected `++id` auto-gen. Fix dual-accepted route params at boundary + pre-generated UUIDs at all `.add()` sites for the 4 UUID-flipped tables. See Patterns D12 + R5. — see GitHub

---

## May 2026 — Initial bug sprint

- **BUG-toggle** (#1, fixed) — Out-of-Service toggle knob misaligned (hand-rolled CSS) — see GitHub
- **BUG-date-input** (#2, fixed) — Date inputs in History rendered as div, not tappable — see GitHub
- **BUG-padding** (#3, fixed) — Amount column touching screen edge (inconsistent px-4 vs px-5) — see GitHub
- **BUG-rounding** (#4, fixed) — Time Rounding setting had no effect on session billing — see GitHub
- **BUG-delete-crash** (#5, fixed) — Delete table crashed with undefined error (modal stayed open after soft-delete) — see GitHub
- **BUG-label-mislead** (#6, fixed) — Delete button label was misleading; action was actually Disable — see GitHub
- **BUG-fade-btn** (#7, fixed) — Edit pencil on disabled table faded; form had stale state — see GitHub
- **BUG-datepicker-theme** (#8, fixed) — Calendar date picker rendered in light theme on dark app — see GitHub
- **BUG-name-overflow** (#9, fixed) — Long player name overflowed everywhere; no maxLength or truncation — see GitHub
- **BUG-name-pollution** (#10, fixed) — Special characters in player name polluted suggestion chips — see GitHub
- **BUG-disable-active** (#11, fixed) — Could disable a table that had a running session — see GitHub

---

## 24 May 2026 — Accessibility + auth + navigation sprint

- **BUG-001** (#12, fixed) — FAQ accordion content readable by screen reader when collapsed — see GitHub
- **BUG-002** (#13, fixed) — authStore.refreshProfile() fired twice on every page load (INITIAL_SESSION) — see GitHub
- **BUG-003** (#14, fixed) — PaymentBottomSheet not hidden from screen readers when closed — see GitHub
- **BUG-004** (#15, fixed) — Home FAB navigated to /settings instead of opening Add Table modal — see GitHub
- **BUG-005** (#16, fixed) — FilterPills below 44px touch target — see GitHub
- **BUG-006** (#17, fixed) — TopBar settings gear button below 44px touch target — see GitHub
- **BUG-007** (#18, fixed) — StartSession back button and name chips below 44px touch target — see GitHub
- **BUG-008** (#19, fixed) — Player name input silently truncated at 50 chars with no error shown — see GitHub
- **BUG-009** (#20, fixed) — Stop session navigated to / (landing page) instead of /tables — see GitHub
- **BUG-010** (#21, fixed) — SessionDetail back button and pencil edit button below 44px — see GitHub
- **BUG-011** (#22, fixed) — Session amounts in History/Summary missing Indian number formatting — see GitHub
- **BUG-012** (#23, fixed) — Modal scrim intercepted clicks on sheet; no Escape key handler — see GitHub
- **BUG-013** (#24, fixed) — Subscription section invisible in Settings while subscription was null — see GitHub
- **BUG-015** (#25, fixed) — Google OAuth auto-selected account with no picker shown — see GitHub
- **BUG-016** (#26, fixed) — PaymentBottomSheet had no escape path (no ESC, no Maybe Later) — see GitHub
- **BUG-017** (#27, fixed) — Payment click spun forever + cryptic JSON error on local dev — see GitHub

---

## 25 May 2026 — Razorpay + auth fixes

- **BUG-018** (#28, fixed) — Razorpay 400 "ID invalid" — plan IDs from different account than active keys — see GitHub
- **BUG-019** (#29, fixed, b99388b) — Server/frontend error shape mismatch hid real Razorpay errors — see GitHub
- **BUG-020** (#30, fixed, b99388b) — Auth hung permanently on /auth/callback if refreshProfile threw — see GitHub
- **BUG-021** (#31, fixed) — Razorpay 400 "ID invalid" — TEST key used with LIVE plan IDs (mode mismatch) — see GitHub

---

## 29 May 2026 — Timer + UI polish

- **BUG-022** (#32, fixed) — Today pill on /tables frozen; running sessions not contributing live amount — see GitHub
- **BUG-023** (#33, fixed) — Payment screen QR card had uneven white borders (fluid container + fixed child) — see GitHub
- **BUG-024** (#34, fixed) — Done button on payment screen hidden behind bottom nav (missing z-50) — see GitHub

---

## 3–4 Jun 2026 — Subscription billing fixes

- **BUG-025** (#35, fixed) — Cancel subscription failed during trial ("no billing cycle" from Razorpay) — see GitHub
- **BUG-026** (#36, fixed) — Expired-trial users got a free fresh 7-day trial on every subscribe attempt — see GitHub

---

## 12 Jun 2026 — Deployment + PWA

- **B-deploy-1** (#37, fixed, 9d474b0) — All deep routes returning HTTP 404 on production (missing vercel.json) — see GitHub

---

## 7 Jun 2026 — Canteen management sprint

- **B-canteen-1** (#38, fixed) — Canteen page stuck on "Loading..." forever (useLiveQuery gating all chrome) — see GitHub
- **B-canteen-2** (#39, fixed) — Boolean index queried with integer in Dexie returned empty results — see GitHub
- **B-canteen-3** (#40, fixed) — /canteen URL silently redirected to /tables (subscription_loading race) — see GitHub
- **B-canteen-4** (#41, fixed) — Delete UX looked like a stock tracking toggle (affordance mismatch) — see GitHub
- **B-canteen-5** (#42, fixed) — Nested Dexie transaction caused silent partial write (CRITICAL money bug) — see GitHub

---

## 8 Jun 2026 — Canteen POS stock sync sprint

- **B-canteen-sprint-3** (#43, fixed) — Quick Add and manual form bypassed canteen stock decrement — see GitHub
- **B-canteen-sprint-4** (#44, fixed) — Repeated chip tap created duplicate session item rows instead of incrementing qty — see GitHub
- **B-canteen-sprint-5** (#45, fixed) — Edit/Delete/Undo session items bypassed canteen stock sync — see GitHub

---

## 10 Jun 2026 — Payment split + money invariants

- **B-payment-1** (#46, fixed) — PaymentSplitSheet breakdown mismatch (session.amount != grand total) — see GitHub
- **B-ui-quicksale-pill** (#47, fixed) — Quick Sale pill orphaned on its own row; broken at 320px — see GitHub

---

## 11 Jun 2026 — Player Hub bug sprint

- **B1/B2** (#48, fixed) — PendingTopupsModal confirm/reject called wrong endpoint + no idempotency — see GitHub
- **B3/B4/B5** (#49, fixed) — Accept Topups toggle resets on nav + pending count mismatch + no wallet badge — see GitHub
- **B6/B7/B8** (#50, fixed) — PlayerScan shows QR to player + rate input bug + double currency symbol — see GitHub

---

## 14 Jun 2026 — Bug audit fixes (commit f9e3e62)

- **T1** (#51, fixed, f9e3e62) — PendingTopupsModal Confirm enabled before useLiveQuery loads; wrong welcome bonus preview — see GitHub
- **T2** (#52, fixed, f9e3e62) — decrementPending called even when Supabase confirm fails; modal desyncs from cloud — see GitHub
- **P3** (#53, fixed, f9e3e62) — _clubSyncDone module flag never resets between users on same tab — see GitHub
- **Q2** (#54, fixed, f9e3e62) — PlayerScan polling sets state on unmounted component — see GitHub

---

## 14 Jun 2026 — Legacy pre-record QR removed (issue #77)

- **BUG-77** (#77, fixed, 72d9edb) — Legacy full-amount QR screen between End Session and Record Payment removed; stop flow now goes directly to PaymentSplitSheet — see GitHub

---

## 14 Jun 2026 — Payment fixes (issues #75–76)

- **BUG-75** (#75, fixed, 4b0cf3f) — confirmPaymentAndStop tx missing db.settings → IDBTransaction "objectStore not found" on every Confirm tap — see GitHub
- **BUG-76** (#76, fixed, 4b0cf3f) — Post-confirm QR showed grand total instead of UPI split; also showed when UPI=0 (payment screen never dismissed) — see GitHub

---

## 20 Jun 2026 — Crypto hardening + config

- **BUG-SETTINGS-DRIFT** (#97, **REOPENED — open P0 as of 7 Jul 2026**; original fix 238001f + prevention b18220f, closed by owner 20 Jun, later reopened as a recurrence of the accept-bookings toggle flip) — Settings toggles drift (PlayerHubSettings useState mirror vs Dexie). See Pattern R4 — see GitHub for current state
- **BUG-WEBHOOK-TIMING** (#94, fixed, a2f122a) — Razorpay webhook HMAC compared with non-constant-time `!==` → theoretical timing side-channel; switched to `crypto.timingSafeEqual`. Reported via external PR #80 (closed unmerged). See Pattern S10 — see GitHub
- **FEAT-CANTEEN-LOWSTOCK** (#92, shipped, 8ebffe6) — Owner-configurable low-stock threshold (1–999, default 5). Settings UI added; helper + consumers already existed. Also normalised Canteen StatsRow comparator from `<` to `<=` to match Summary (silent off-by-one) — see GitHub
- **BUG-SUMMARY-QUICKSALE** (#93, fixed, 1684b82) — Summary's 4 analytical surfaces (topCanteenItems, bucketByHour, rankTables, dateRevenues) silently dropped Quick Sale revenue while money tiles were correct. Fixed all 4 in one commit; rankTables now has a synthetic "Walk-in Canteen" row via `WALKIN_TABLE_ID=-1`. Historical deltas retroactively recompute. New Pattern T9 — see GitHub

---

## 21 Jun 2026 — Player Hub setup fixes

- **#104** (fixed, 68bc9a9) — upsertClub omitted slug on update path; Supabase clubs row stayed stale after slug re-setup. See Pattern X — see GitHub
- **#105** (fixed, 1ee1372) — Player Hub slug input false "Must be at least 3 characters" error for valid 10-char slug; Save button never enabled. See Pattern F10 (renamed from duplicate "F8", 7 Jul 2026) — see GitHub

---

## 14 Jun 2026 — Bug sprint (issues #68–74)

- **BUG-QS-UPI-QR** (#69, fixed, 2b83dd1) — QuickSale showed no UPI QR after UPI payment selected — see GitHub
- **BUG-MOVE-BILLINGMODE** (#72, fixed, 6be8ed0) — Table Move allows cross billing-mode moves (rateCardBilling / rateCard / toleranceMinutes not checked) — see GitHub
- **BUG-SUMMARY-STALE** (#70, fixed, 41a7bb1) — Day's earnings + Avg session + TopTablesList + HourlyHeatmap frozen (useMemo T4 violation on runningRevenueToday + rankTables + bucketByHour) — see GitHub
- **BUG-SUMMARY-INCONSISTENT** (#71, closed) — Audit: which Summary widgets tick live vs frozen — resolved alongside #70's useMemo fixes — see GitHub
- **BUG-STOP-PAYMENT-RACE** (#73, fixed, 69cd1b4) — Session stopped even when staff cancels payment sheet — see GitHub
- **BUG-STOP-PAUSE-FIRST** (#74, fixed, 69cd1b4) — End Session now PAUSEs first; confirmPaymentAndStop is atomic; cancel resumes session — see GitHub
- **BUG-CANTEEN-TOD** (#68, open) — Time-of-day pricing for canteen items (enhancement, design-first) — see GitHub

---

## Open — From 14 Jun 2026 Audit (issues #55–67)

- **A1** (#55, open) — Signup setTimeout double-submit race on rapid taps — see GitHub
- **A2** (#56, open) — Subscribe hardcoded 1500ms delay instead of waiting for webhook — see GitHub
- **A3** (#57, open) — AuthCallback 20s timeout bounces user even if subscription fetch is just slow — see GitHub
- **A4** (#58, open) — authStore profile fetch uses .single() with no error handling — see GitHub
- **A5** (#59, open) — authStore calls openAndSeed on every INITIAL_SESSION re-fire — see GitHub
- **P1** (#60, open) — PlayerHubSettings syncCoinConfig errors silently swallowed — see GitHub
- **P2** (#61, open) — PlayerHubSettings handleSaveSlug crashes if clubName is null — see GitHub
- **W1** (#62, open) — Wallet.tsx has no fetch cancellation on navigate away — see GitHub
- **W2** (#63, open) — WalletTopup UI freezes if db.customers.get() fails after topup — see GitHub
- **S1** (#64, open) — Settings club name sync shows toast on failure but has no retry — see GitHub
- **S2** (#65, open) — Settings reset dialog shows stale session count — see GitHub
- **R1** (#66, open) — Fallback polling not cancelled when Supabase realtime reconnects — see GitHub
- **R2** (#67, open) — Realtime initial count never loads if first fetch throws — see GitHub

---

## Patterns to Watch For

These are recurring bug classes — see `bug_patterns.md` for the full pattern catalogue with rules and code examples.

### Pattern A: Stale data after mutation
After delete/soft-delete, components re-render with the now-missing data. Always close UI BEFORE mutating, OR add null guards.

### Pattern B: Settings not wired to action
A toggle in Settings does nothing because the action code never reads the setting.

### Pattern C: Native HTML controls do not theme
Date pickers, file inputs, select dropdowns — all need explicit `color-scheme` for dark mode.

### Pattern D: Adversarial input
Always assume users will paste 10,000 chars, emoji, special chars. maxLength + validation + truncation in display.

### Pattern E: Race conditions
Two tabs open, both tap the same button. Pre-check + re-check pattern. Disable button after first tap.

### Pattern F: Timer state from counters
ANY time someone proposes setInterval to increment a number — STOP. Use timestamps and derive on render.

---

## Known Limitations (Not Bugs — By Design for Now)

### 21 May 2026 — IndexedDB data is shared across users in same browser

**Symptom:** Two different Google accounts signing in on the same browser see the same tables and session data.
**Current state:** Acceptable for v1 — product is single-user (one owner, one device).
**Fix when:** Adding cloud sync (Supabase). At that point, scope all Dexie reads/writes by userId.

---

## Open Issues / Not Yet Reproduced

(Move here when Sugeet reports something but it cannot be reproduced. Revisit later.)

(none currently)

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

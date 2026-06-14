# Test Status

Tracks which test scenarios from TEST_SCENARIOS.md have been verified vs pending.

## Last test session: 19 May 2026 (Sugeet)

## Summary

- Total sections: 12 (A-L)
- Sections fully passed: 0
- Sections fully tested: 0
- Sections in progress: 4 (A, B, C, D)
- Sections untested: 8 (E, F, G, H, I, J, K, L)

## Section A — Tables Management

| # | Test | Status | Notes |
|---|---|---|---|
| A1 | Add new table happy path | ✅ Pass | |
| A2 | Empty name validation | ✅ Pass | |
| A3 | Duplicate name | ⏳ Not tested | |
| A4 | Name too long | ⏳ Not tested | After Prompt 8 should auto-cap at 30 |
| A5 | Negative rate | ⏳ Not tested | |
| A6 | Rate of 0 | ⏳ Not tested | |
| A7 | Very large rate | ⏳ Not tested | |
| A8 | Snooker frame rate appears | ✅ Pass | |
| A9 | Pool no frame rate | ✅ Pass | |
| A10 | Edit existing table | ✅ Pass | |
| A11 | Rate snapshot on active session | ⏳ Not tested | |
| A12 | Disable table | ✅ Fixed | Button disabled + warning shown when session active; race-condition re-check + toast on confirm |
| A13 | Enable disabled table | ✅ Pass | |
| A14 | Edit disabled table | ✅ Pass | |
| A15 | Direct URL to start on disabled table | ⏳ Not tested | |

## Section B — Starting Sessions

| # | Test | Status | Notes |
|---|---|---|---|
| B1 | Minimum data | ✅ Pass | |
| B2 | Full data | ✅ Pass | |
| B3 | Recent players chips | ✅ Pass | |
| B4 | Per-frame mode | ✅ Pass | |
| B5 | Per-frame hidden for pool | ✅ Pass | |
| B6 | Race condition double-start | ⏳ Not tested | |
| B7 | Player count 0 | ⏳ Not tested | |
| B8 | Player count 999 | ⏳ Not tested | |
| B9 | 100-char player name | ✅ Fixed | maxLength=50 on input; validation regex; Start button disabled; display truncated everywhere |
| B10 | Special characters in name | ✅ Fixed | PLAYER_NAME_REGEX blocks special chars; per-keystroke error shown; invalid submit blocked |

## Section C — Live Timer Behavior

| # | Test | Status | Notes |
|---|---|---|---|
| C1 | Counts up live | ✅ Pass | |
| C2 | Survives refresh | ✅ Pass | |
| C3 | Survives tab close | ✅ Pass | |
| C4 | Survives browser quit | ⏳ Not tested | |
| C5 | Accuracy over long time | ⏳ Not tested | |
| C6 | Pause freezes | ✅ Pass | |
| C7 | Pause survives refresh | ⏳ Not tested | |
| C8 | Resume from frozen value | ✅ Pass | |
| C9 | Multiple pause/resume cycles | ⏳ Not tested | |
| C10 | Stop running session | ✅ Pass | |
| C11 | Stop paused session | ⏳ Not tested | |
| C12 | Edit start time | ✅ Pass | |
| C13 | Invalid future start time | ⏳ Not tested | |
| C14 | Edit start after completion | ⏳ Not tested | |

## Section D — Time Rounding

| # | Test | Status | Notes |
|---|---|---|---|
| D1 | No rounding | ⏳ Not tested | |
| D2 | 15min rounding short session | ✅ Pass | After Prompt 7 fix |
| D3 | 14 min → rounds to 15 | ⏳ Not tested | |
| D4 | Exactly 15 min stays at 15 | ⏳ Not tested | |
| D5 | 16 min rounds up to 30 | ⏳ Not tested | |
| D6 | 30min rounding for 5min | ⏳ Not tested | |
| D7 | Rounding doesn't affect per-frame | ⏳ Not tested | |
| D8 | History shows "(rounded)" label | ⏳ Not tested | |

## Section E — Daily Summary

All ⏳ Not tested. Next session priority.

## Section F — History

All ⏳ Not tested.

## Section G — Settings & Data

All ⏳ Not tested.

## Section H — Offline / PWA

All ⏳ Not tested.

## Section I — Multi-device / Multi-tab

All ⏳ Not tested.

## Section J — Edge Cases / Stress

All ⏳ Not tested.

## Section K — Visual / Responsive

All ⏳ Not tested.

## Section L — Error & Recovery

All ⏳ Not tested.

---

## Section O — Pause-first stop flow (#73+#74, 14 Jun 2026)

| # | Test | Status | Notes |
|---|---|---|---|
| O1 | Start session → End Session → Stop & Pay → tap Cancel → session resumes running (not stopped) | ⏳ Not tested | `cancelPaymentAndResume` must clear `paymentInProgress` and restore `status='running'` |
| O2 | Start session → End Session → Stop & Pay → enter payment amounts → Confirm → session stopped atomically with breakdown recorded | ⏳ Not tested | `confirmPaymentAndStop` must write `endedAt + status='completed' + amount + paymentBreakdown + paymentInProgress=false` in single tx |
| O3 | UPI split in stop flow → post-confirm screen shows UPI QR for UPI portion only (not grand total) | ⏳ Not tested | `postConfirmUpiAmount` state drives QR; `breakdown.upi` is the amount shown |
| O4 | Table card for session in paymentInProgress state shows "Paying…" badge (not "Paused") | ⏳ Not tested | `TableCard.tsx` paused branch conditional |
| O5 | Close tab mid-payment (session paused+paymentInProgress) → reopen session → payment sheet auto-opens | ⏳ Not tested | Case 1 of auto-resume `useEffect` |

---

## Section M — Signup Flow (added Prompt 11)

| # | Test | Status | Notes |
|---|---|---|---|
| M1 | Fresh user — Google OAuth → profile created in Supabase → redirected to /subscribe | ✅ Pass | Verified 21 May 2026 — profile + subscription rows auto-created via trigger |
| M2 | Existing user with no subscription — visit /signup → auto-redirect to /subscribe | ⏳ Not tested | Auth Effect 2 logic |
| M3 | Existing user with active subscription — visit /signup → auto-redirect to /tables | ⏳ Not tested | Auth Effect 2 logic |
| M4 | Close Google popup / abort OAuth — returns to /signup, error toast shown, Retry works | ⏳ Not tested | Requires real browser test |
| M5 | /signup?error=access_denied in URL → error toast shown on load | ✅ Verified | Checked in preview |
| M6 | Google button shows spinner after tap | ✅ Verified | Visual check in preview |
| M7 | Back chevron navigates to / (Landing) | ⏳ Not tested | |
| M8 | "Almost there!" screen shows correct signed-in email | ⏳ Not tested | PostSigninTransition |
| M9 | "Why do we need a card?" expandable opens/closes smoothly | ⏳ Not tested | |
| M10 | "Add Payment Method" on transition → navigates to /subscribe | ⏳ Not tested | |

---

## Section N — Subscribe Flow (added Prompt 12)

| # | Test | Status | Notes |
|---|---|---|---|
| N1 | Visit /subscribe without auth → redirects to /signup | ✅ Verified | Auth guard confirmed in preview |
| N2 | Visit /subscribe with active/trialing subscription → redirects to /tables | ⏳ Not tested | Needs real auth + subscription |
| N3 | Monthly/Annual toggle updates plan prices correctly | ⏳ Not tested | Annual: ₹299→₹249, ₹599→₹499/mo |
| N4 | Annual shows savings badge (₹598 saved / ₹1,198 saved) | ⏳ Not tested | |
| N5 | Tap Starter card → selected state (double border glow) | ⏳ Not tested | |
| N6 | Tap Standard (default) → already selected | ⏳ Not tested | |
| N7 | Tap Pro card → nothing happens (disabled) | ⏳ Not tested | |
| N8 | Sticky checkout bar shows correct plan name + price | ⏳ Not tested | |
| N9 | "Start Free Trial →" opens payment bottom sheet | ⏳ Not tested | |
| N10 | Payment sheet: UPI accordion is open by default | ⏳ Not tested | |
| N11 | Payment sheet: tapping other accordion closes UPI, opens new | ⏳ Not tested | |
| N12 | Tap "Start Free Trial" in sheet → spinner → confirmation screen | ⏳ Not tested | FAKE payment, 1.4s delay |
| N13 | Confirmation: shows correct email and trial end date | ⏳ Not tested | |
| N14 | "Continue to ClubKeeper →" → navigates to /tables | ⏳ Not tested | |
| N15 | Back chevron → amber warning banner (auto-hides 3.5s) | ⏳ Not tested | |

---

## Bugs Found vs Fixed

| Bug ID | Found in test | Status |
|---|---|---|
| Toggle misaligned | (visual inspection) | ✅ Fixed in Prompt 7 |
| Date inputs not editable | (interaction test) | ✅ Fixed in Prompt 7 |
| Amount column edge | (visual) | ✅ Fixed in Prompt 7 |
| Time rounding broken | D2 | ✅ Fixed in Prompt 7 |
| Delete crashes | A12 attempt | ✅ Fixed in Prompt 7 |
| "Delete" naming | UX feedback | ✅ Fixed in Prompt 7 |
| Disabled table edit pencil | A14 area | ✅ Fixed in Prompt 7 |
| Calendar theme | (visual) | ✅ Fixed in Prompt 7 |
| Running table disabled | A12 | ✅ Fixed in Prompt 8 |
| Long player name overflow | B9 | ✅ Fixed in Prompt 8 |
| Special chars in name | B10 | ✅ Fixed in Prompt 8 |
| Bad data pollutes chips | B9 follow-up | ✅ Fixed in Prompt 8 |

---

---

## Section N — Payments (Prompt 13 — Real Razorpay)

Run AFTER Vercel deploy + webhook setup.

| # | Test | Status | Notes |
|---|---|---|---|
| N1 | Happy path: fresh Google account → /subscribe → Standard Monthly → Start Free Trial → Razorpay TEST modal opens | ⬜ Pending | Use test card 4111 1111 1111 1111 |
| N2 | Happy path: payment completes → Confirmation screen shown | ⬜ Pending | |
| N3 | Happy path: Continue button → /tables loads, no redirect loop | ⬜ Pending | |
| N4 | Happy path: hard-refresh /tables → stays, no bounce | ⬜ Pending | |
| N5 | Supabase: subscriptions row has status='trialing', razorpay_subscription_id populated, trial_ends_at = today+7 | ⬜ Pending | Check Supabase dashboard |
| N6 | Webhook delivery: Razorpay dashboard shows webhook sent, HTTP 200 response | ⬜ Pending | Check Razorpay dashboard |
| N7 | Failure: dismiss Razorpay modal (close X) → back on subscribe page, no error toast, can retry | ⬜ Pending | |
| N8 | Failure: /api/create-subscription returns error → payError displayed inline in sheet | ⬜ Pending | |
| N9 | Cancel: Settings → Subscription → Cancel → confirm → Supabase cancel_at_period_end=true | ⬜ Pending | |
| N10 | Cancel: banner updates to "Cancelling on D MMM" on Home | ⬜ Pending | |
| N11 | Trial banner: trialing user sees "Free trial: N days left" banner on Home | ⬜ Pending | |
| N12 | Settings subscription section: plan name, status badge, next charge shown correctly | ⬜ Pending | |
| N13 | Scroll bleed: opening PaymentBottomSheet locks body scroll | ⬜ Pending | |

---

## Section O — Canteen Calculations (added 7 Jun 2026)

File: `tests/canteen-calculations.spec.ts` — 26 scenarios × 3 viewports = 78 spec tests.

All tests soft-pass when `.auth/user.json` is expired (matches existing convention).
Re-run after refreshing auth state via `! npx playwright test --project=setup` (headed, re-login Google).

| ID | Scenario | Status | Notes |
|---|---|---|---|
| A1 | ₹100/hr × 60min → ₹100 | ⬜ Pending auth | Pure Dexie — no UI needed |
| A2 | ₹120/hr × 30min → ₹60 | ⬜ Pending auth | |
| A3 | ₹100/hr, rounding=15min, 14min → ₹25 | ⬜ Pending auth | roundedDurationMs also asserted |
| A4 | ₹100/hr, rounding=30min, 16min → ₹50 | ⬜ Pending auth | |
| A5 | per_frame ₹50 × 3 frames → ₹150, rounding NOT applied | ⬜ Pending auth | roundedDurationMs must be undefined |
| B1 | 1× ₹20 item → itemsTotal = 20 | ⬜ Pending auth | Dexie + UI check |
| B2 | 3× ₹20 item → itemsTotal = 60 | ⬜ Pending auth | Dexie only |
| B3 | 2×₹20 + 1×₹15 → itemsTotal = 55 | ⬜ Pending auth | Dexie only |
| B4 | Edit item qty 2→5 via UI → itemsTotal recalculates | ⬜ Pending auth | UI interaction in AddItemBottomSheet |
| B5 | Delete item, Undo dismissed → itemsTotal goes down | ⬜ Pending auth | Waits out 5s undo window |
| B6 | Delete item, tap Undo → itemsTotal restored | ⬜ Pending auth | |
| C1 | stock=10, add qty 3 → stock=7 AND sessionItem row exists (D7 check) | ⬜ Pending auth | The critical D7 regression test |
| C2 | stockEnabled=false → no decrement, sessionItem added | ⬜ Pending auth | |
| C3 | stock=2, try add qty 5 → clamped/blocked, conservation verified | ⬜ Pending auth | stock+added = 2 always |
| C4 | stock=3, add qty 3 → stock=0, out-of-stock shown | ⬜ Pending auth | UI badge check |
| C5 | stock=6, add qty 2 → stock=4, low-stock toast fires after commit | ⬜ Pending auth | Toast check |
| D1 | ₹100/hr 60min + 2×₹30 → UI ₹160, Dexie ₹100 + ₹60 | ⬜ Pending auth | Both DB and UI asserted |
| D2 | rounding=15min, 14min→₹25 + ₹15 → ₹40 | ⬜ Pending auth | |
| D3 | per_frame 4×₹50 + 2×₹25 → ₹250 | ⬜ Pending auth | |
| D4 | Pause/resume — paused time excluded from billing | ⬜ Pending auth | Dexie seed with pausedTotalMs |
| D5 | Edit start time back 30min → items unchanged, grand total updates | ⬜ Pending auth | UI edit-start flow |
| E1 | Pre-stop UI == payment screen == Dexie sum (BUG-022 regression) | ⬜ Pending auth | Three-way match |
| E2 | Same as E1 with rounding=15min | ⬜ Pending auth | |
| F1 | 3 sessions + items → /summary Today = correct sum | ⬜ Pending auth | |
| F2 | /history CSV: Table Amount + Items + Total columns correct | ⬜ Pending auth | File download + parse |
| G1 | 5 active + 2 inactive → /canteen shows 5; soft-delete → 4 (D9 boolean index) | ⬜ Pending auth | The critical D9 regression test |

**To run with real auth:**
```
npx playwright test --project=setup   # headed, re-login if needed
npx playwright test canteen-calculations.spec.ts --project=mobile-360-auth --project=tablet-768-auth --project=desktop-1280-auth
```

---

## Testing Notes

**Sugeet's pattern:** Tests in section order, screenshots on failure, reports multiple bugs in one batch.

**Lesson:** Sugeet finds real bugs that AI testing misses. Always run full sections A-D after every prompt change, not just spot-checks.

**Next test priority after Prompt 13:**
1. Complete webhook setup (RAZORPAY_WEBHOOK_SECRET → Vercel env vars → re-deploy)
2. Run N1–N13 with real Google account in browser
3. Run M1–M4 (auth flow) if not done yet
4. Run A12, B9, B10 manually on device (Prompt 8 fixes)
5. Continue with section E (Daily Summary)
6. Section H (Offline/PWA) before showing to first customer

---

## Features shipped 10–13 Jun 2026 — Test Status

- **Player Hub (owner setup + slug + accept-topups toggle):** ⚠ UNTESTED in Playwright
- **PlayerScan page (`/c/:clubSlug` — public QR topup form):** ⚠ UNTESTED in Playwright
- **PendingTopupsModal (confirm/reject flow):** ⚠ UNTESTED in Playwright
- **Poster page (`/poster/:slug`):** ⚠ UNTESTED in Playwright
- **ClubCoins (earn at topup, CoinTiersEditor, CoinRedemptionPill):** ⚠ UNTESTED in Playwright
- **Engagement — streak bonus (`checkAndAwardStreak`):** ⚠ UNTESTED in Playwright
- **Engagement — coin expiry (FIFO, `applyExpirySweep`):** ⚠ UNTESTED in Playwright
- **Engagement — dormancy nudge (BringBackList + WhatsApp link):** ⚠ UNTESTED in Playwright
- **Auth fixes (13 Jun e7b0522):** ⚠ UNTESTED — hard nav sign-out, club name sync, toggle atomicity, AuthCallback timeout

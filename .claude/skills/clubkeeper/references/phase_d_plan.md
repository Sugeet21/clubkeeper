# Phase D — Staff Login: chunked build plan

**Status:** D0–D4 complete (10 Jul 2026 — migration APPLIED; D2 endpoints 24/24; D3 role state + staff sign-in + RPC gate; D4 claim-gated seed + account-switch round-trip + staff Account card, reviewer APPROVE). Tracking issue: **#128** — every Phase D commit refs it. Next: D5 (D5/D6/D7 any order, all before D9). **⚠ D9 is BLOCKED by #129** (pre-Phase-C rows never backfilled — prod `game_tables` is empty, so D9 step 2 "pull populates real tables" cannot pass; needs its own backfill chunk first). Owner workaround meanwhile: re-save each table on the primary device.
**Contract sources:** `references/history/sync_architecture_v2.md` §2 (permission matrix — LOCKED), §3 (identity model), §4.5 (JWT claims), Appendix B (RLS). Role strings LOCKED: `'owner'` / `'staff'` — never rename.
**Migration:** `supabase/migrations/20260710_phase_d_staff_login.sql` (APPLIED 10 Jul 2026 — see STATE.md ledger).
**Testing law (project memory):** SQL-editor tests run as `postgres` and bypass RLS + the access-token hook. Every RLS/hook claim in this phase is proven ONLY by a freshly-minted JWT (fresh sign-in). This is baked into every chunk's proof step below.

---

## D0 grounding findings (verified against code + prod migrations, 10 Jul 2026)

These override any older assumption in prompts or docs:

1. **The JWT hook needs NO change for staff.** `add_user_meta_to_jwt` (shipped 20260625, configured in Dashboard → Auth → Hooks) already reads `users_meta` for BOTH roles, already stamps `user_club_id` + `user_role`, and already raises on `active=false` (instant-revoke at mint time). The "hook resolves via the owner's clubs row" assumption was wrong — `users_meta` has been the lookup source since Phase C. D1 does not touch the hook.
2. **The real server gap is RLS:** every Phase C INSERT/UPDATE policy on the 9 sync tables requires `user_role='owner'`. A staff write would 403 → the staff outbox row retries to the 10-attempt dead-letter. The D1 migration rewrites these per the §2 matrix.
3. **Trial-trigger trap:** `handle_new_user()` fires on EVERY `auth.users` insert — admin-API staff creation would mint the staff account its own 7-day trial. D1 excludes staff (via `ck_role` user-metadata marker + `.ck.local` email belt-and-braces); staff access instead follows the OWNER's subscription via a new `get_club_subscription_status()` RPC (`security definer`, club resolved from the JWT claim).
4. **Seed trap:** `seedIfEmpty()` bulkAdds 5 demo gameTables into any empty per-user Dexie. A staff first sign-in (fresh DB) would get 5 ghost demo tables alongside the pulled real ones. D4 gates the demo-table seed on "JWT carries `user_club_id`" (data will come from the initial pull). This also fixes the same latent issue for an owner's second device.
5. **`wallet_transactions` had an UPDATE policy** (Phase C template artifact) despite the §4.6 append-only contract. D1 drops it.
6. **Client plumbing mostly exists:** per-user Dexie (`ClubKeeperDB_<userId>`), `initDbForUser`/`closeDb` in `authStore` sign-in/out, SyncReader initial pull keyed off the JWT claim, and a JWT decoder with `user_role` already typed (`src/db/syncClubId.ts:146`). Role state is a decode away — NO Supabase query per screen.

## Locked implementation decisions (D0)

- **Role source of truth on the client = the `user_role` JWT claim**, decoded lock-free from `session.access_token` (reuse `decodeJwtClaims` in `syncClubId.ts` — export it). Stored once in `authStore.role`; read via `useRole()`. Missing claim → treat as `'owner'` (staff ALWAYS have a `users_meta` row, so a claim-less user is a legacy/unprovisioned owner; sync is already off for them).
- **Field-level staff restrictions are app-layer** (Appendix B decision): session `started_at`/`paymentBreakdown` edits, customer name/phone edits, canteen name/price edits. RLS gates rows: staff cannot soft-delete anywhere, cannot write `game_tables`/`stock_purchases`/`canteen_items`-INSERT, cannot insert wallet `adjustment`/`refund`/`reversal` kinds.
- **Client role gates must prevent staff from ever QUEUEING an owner-only write.** RLS is defense-in-depth; an RLS 403 from the outbox is a permanent failure that dead-letters after 10 attempts. UI gate first, RLS second.
- **Serverless surface = 2 new functions:** `api/create-staff.ts` and `api/manage-staff.ts` (action: `revoke` | `reset_password`). Self-contained (no shared import → no Node16 `.js`-extension coupling); both verify the caller's JWT AND `users_meta.role='owner'` server-side.
- **Staff sign-out affordance:** staff visiting `/settings` get a minimal Account card (name, username, club name, Sign out) — nothing else. Satisfies "Settings entire page ❌" while keeping the §3 account-switch flow reachable.
- **Revoke = `users_meta.active=false` + kill refresh** (`auth.admin.updateUserById(id, { ban_duration: '87600h' })`; if the installed supabase-js exposes an admin session-invalidation call, use it additionally). Residual access = JWT TTL (≤1h), the §4.5 accepted trade-off. No un-revoke UI in v1 (re-create instead).

## Owner answers (Sugeet, 10 Jul 2026) — these AMEND the §2 matrix

1. **History: owner-only, EXCEPT "Log past session".** The past-sessions list/revenue history is owner-only, but staff MUST be able to log past sessions (back entries). This amends the §2 matrix row "Back Entries page ❌ staff" → **staff ✅ for back-entry CREATION only**. Implementation: `/history` stays reachable for staff; staff render = ONLY the "Log past session" card/CTA (BackEntryModal), NO past-session list, no revenue. No migration change needed — the draft RLS already lets staff INSERT sessions/session_items and UPDATE canteen stock, which is exactly what a back entry writes.
2. **Staff CAN create customers.** Plan default confirmed; RLS already allows it.
3. **Staff-device settings parity (DEFERRED — know the gap):** Dexie `ClubSettings` is device-local; a staff device runs on defaults (`rounding: 'none'`, default low-stock threshold, etc.). Billing-critical values mostly live on synced `game_tables` rows (rate cards, tolerance), so exposure is small — and #100 says rounding isn't applied on stop anyway. Full settings sync is deferred past Phase D; recorded in STATE as load-bearing pending. Sugeet says if any specific field must sync sooner.

---

## Chunk overview

| Chunk | What | Touches | Gate |
|---|---|---|---|
| D1 | Apply migration + owner regression proof | Supabase (owner-run) | fresh-JWT owner write path green; ledger → APPLIED |
| D2 | `api/create-staff.ts` + `api/manage-staff.ts` | api/ | build + curl 401/403/200 matrix |
| D3 | Role in auth state + staff login form + owner-subscription gate | authStore, Signup, useAccessGuard path | build + owner regression + staff sign-in works |
| D4 | Account switch + seed gate + staff Account card | authStore, seed, Settings (minimal) | build + switch round-trip on one device |
| D5 | Role gates — operations cluster (Home/Session/History) | pages + components | build + staff sees no owner-only CTAs |
| D6 | Role gates — commerce cluster (Canteen/QuickSale/Wallet/Piggy) | pages + components | build + staff wallet top-up works, adjustment absent |
| D7 | Role gates — routes/nav/Summary/Settings + staff today-card | App.tsx, BottomNav, Summary | build + staff deep-link to owner route bounces |
| D8 | Staff management screen (Settings, owner-only) | Settings.tsx (Rule H!) | build + reviewer + create/revoke round-trip |
| D9 | End-to-end runtime proof (two browser profiles) | none (proof session) | full checklist below; owner closes issues |

Sequencing: D1 → D2 → D3 → D4 are strictly ordered. D5/D6/D7 can go in any order after D4 (but do all three before D9). D8 needs D2 + D3. Every chunk: full 4-phase loop (Rule I), build per chunk, reviewer on >100-LOC diffs, skill commit paired with every src commit (Rule B), issues via the Rule F flow.

**Pattern-ID discipline:** the Phase D role-guard pattern takes a FRESH ID (S23 was consumed — sync_architecture_v2 Appendix H note). Check `bug_patterns.md` for the next free S/A number at creation time; do not pre-reserve here.

---

## D1 — Apply the Phase D migration (owner-run) + regression proof

Paste-ready prompt:

```
TASK: Phase D Chunk D1 — walk me (Sugeet) through applying supabase/migrations/20260710_phase_d_staff_login.sql and verify the OWNER write path still works. NO src/ code this session.

MANDATORY reading: .claude/skills/clubkeeper/SKILL.md + STATE.md; references/phase_d_plan.md §D1; the migration file itself; bug_patterns.md Pattern A9.

STEPS:
1. I paste the migration into Supabase Dashboard → SQL Editor and Run. You pre-brief me on what it changes (users_meta owner-read, staff RLS on 9 tables, trial-trigger staff skip, get_club_subscription_status RPC, wallet_transactions update-policy drop) and what it deliberately does NOT touch (the JWT hook + its Dashboard config).
2. CRITICAL VERIFICATION RULE: the SQL editor runs as postgres and bypasses RLS + the hook — editor SELECTs prove nothing. Proof is a FRESH sign-in only.
3. Owner regression (me, on the app, after sign-out + sign-in): decode the fresh JWT at jwt.io → user_club_id + user_role='owner' present; start/stop a session; add a canteen item to it; wallet top-up; confirm outbox drains to 0.
4. RPC smoke: from the app's console, supabase.rpc('get_club_subscription_status') with my owner session → returns my own subscription row (status 'active'/'trialing').
5. Flip the STATE.md ledger line for 20260710_phase_d_staff_login to APPLIED (same session), changelog entry, check:skill PASS, auditor gate.

DO NOT: touch the Custom Access Token Hook config; run #127's 20260708 migration (held separately); write any src/ code.
```

## D2 — Staff admin endpoints

Paste-ready prompt:

```
TASK: Phase D Chunk D2 — create api/create-staff.ts and api/manage-staff.ts (Vercel serverless, service-role admin API, owner-JWT-verified). Requires D1 applied.

MANDATORY reading: SKILL.md + STATE.md; references/phase_d_plan.md (D0 findings + locked decisions); CLAUDE.md "api/*.ts files — extra rules" (Node16: any relative import needs .js extension; run npm run build locally — Vite dev won't catch api/ errors); api/cancel-subscription.ts as the auth-verification precedent; sync_architecture_v2.md §3 (email scheme) + Appendix G (UI contract the endpoints serve).

api/create-staff.ts — POST { name }:
1. Verify caller: Bearer token → supabase.auth.getUser(token) (service-role client, same pattern as cancel-subscription.ts). Then SELECT users_meta WHERE user_id=caller: require role='owner' AND active=true. 403 otherwise. NOTE the service client bypasses RLS — the role check is THIS explicit query, don't skip it.
2. Resolve club slug: clubs row by users_meta.club_id. If slug is null (owner never set Player Hub slug), fall back to 'c' + first 8 chars of club_id.
3. Generate credentials (§3.3): email = <slugified name>.<random 4 digits>@<clubslug>.ck.local (lowercase, strip non-alphanumerics from name); password = 8 chars from an unambiguous alphanumeric charset (no 0/O/1/l/I), crypto.randomBytes-based, NEVER Math.random.
4. supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name, ck_role: 'staff' } }). The ck_role marker is what the D1 trigger keys on to SKIP the trial-subscription insert — do not omit it.
5. INSERT users_meta: { user_id, role: 'staff', club_id: <owner's>, name, active: true, created_by: <owner id> } (service role bypasses RLS by design — users_meta has no client INSERT policy).
6. On users_meta insert failure: delete the just-created auth user (compensating action) and 500 — never leave an auth user without a users_meta row (they'd mint claim-less JWTs).
7. Return { userId, email, password, name }. The password is shown ONCE client-side and never stored anywhere else.

api/manage-staff.ts — POST { action: 'revoke' | 'reset_password', staffUserId }:
1. Same owner verification as above.
2. Load target users_meta: require club_id === caller's club_id AND role='staff'. 403 otherwise (an owner can never revoke an owner, or anyone outside their club).
3. revoke: UPDATE users_meta SET active=false; then auth.admin.updateUserById(staffUserId, { ban_duration: '87600h' }) to kill refresh. If the installed supabase-js version exposes an admin sign-out/invalidate-sessions method, call it too (check node_modules types, don't guess). Residual ≤1h JWT TTL is accepted (§4.5).
4. reset_password: require target active=true; generate a new password (same generator); auth.admin.updateUserById(staffUserId, { password }); return { password } (shown once).

HARD RULES: strict TS, no any (type the admin API responses explicitly or cast via unknown); every fetch/awaitable awaited; 405 on non-POST; JSON errors with proper status codes; no Razorpay imports; secrets only from process.env (SUPABASE_SERVICE_ROLE_KEY is server-only — it must never appear in src/).

GATE: npm run build clean + npx tsc -p tsconfig.app.json diff vs #118 baseline (117 errors) — zero new. Runtime: `vercel dev`, curl matrix: no token→401, staff-token→403 (defer if no staff exists yet — note it for D9), owner-token create→200 with credentials, users_meta row visible, NO subscriptions row for the staff user (trigger skip proof), revoke→active=false.
COMMIT: feat(staff): #<issue> D2 — create-staff + manage-staff serverless endpoints (refs #<issue>). Paired skill commit (changelog + ripple_effects api section + STATE). Reviewer if >100 LOC (it will be). check:skill PASS.
```

## D3 — Role in auth state, staff login form, owner-subscription gate

Paste-ready prompt:

```
TASK: Phase D Chunk D3 — client auth: role from the JWT claim into authStore, email/password staff login alongside Google OAuth, and staff access gating on the OWNER's subscription. Requires D1 (RPC exists).

MANDATORY reading: SKILL.md + STATE.md; references/phase_d_plan.md; bug_patterns.md §Auth COMPLETE (A1–A11 — especially A5 try/finally, A6 subscriptionLoaded, A10 primitive deps) + S16 (three-client rule); src/db/syncClubId.ts (the decoder you will reuse); src/store/authStore.ts; src/hooks/useAccessGuard.ts.

1. Role state:
   - Export decodeJwtClaims from src/db/syncClubId.ts (it is module-private today). Add src/hooks/useRole.ts with a pure helper deriveRole(session): 'owner' | 'staff' | null — decode session.access_token lock-free (NEVER supabase.auth.* — Pattern S16), read user_role, missing/invalid claim on a live session → 'owner' (staff always have users_meta ⇒ always have the claim; claim-less = legacy owner).
   - authStore: add role: 'owner' | 'staff' | null. Set it at EVERY point session is set (initialize normal path, #120 degraded path, onAuthStateChange, signOut reset). useRole() reads the store — NO Supabase query, NO users_meta fetch per screen.
2. Staff login (src/pages/Signup.tsx):
   - Below the Google button: a "Staff sign-in" section (collapsed by default) with username + password inputs and a Sign in button. Button onClick ONLY — NO <form>/submit (Critical Rule 7). Await supabase.auth.signInWithPassword({ email, password }).
   - Error mapping: 'Invalid login credentials' → "Wrong username or password. Ask the owner to check or reset it."; hook rejection for active=false (surfaces as a 4xx whose message contains 'not active') → "This account has been removed by the owner."; anything else → generic + console.error.
   - Double-tap guard per Pattern A4. Google path unchanged (A2 select_account stays).
3. Staff subscription gate:
   - authStore.refreshProfile: when role==='staff', SKIP the subscriptions-table query (RLS returns nothing) and instead await supabase.rpc('get_club_subscription_status'); map the row into the existing Subscription shape (synthesize id:'club', userId:'', createdAt/updatedAt: Date.now(); razorpay fields null; plan/status/trialEndsAt/currentPeriod* from the RPC). Empty result → subscription null → useAccessGuard 'no_subscription'.
   - useAccessGuard logic UNCHANGED (it reads the synthesized object). Subscribe.tsx: when role==='staff' and access is blocked, render an info card "Ask the owner to renew ClubKeeper" instead of the Razorpay CTA (staff must never reach payment actions).
   - Keep Patterns A5 (finally owns loading) and A6 (subscriptionLoaded set on BOTH paths) intact — the staff RPC branch must set subscriptionLoaded exactly where the owner branch does.
4. The #120 degraded-boot path (authBootFallback) uses plain fetch: leave it owner-shaped; if the stored session decodes to role='staff', skip the subscription fetch and set subscription null with subscriptionLoaded true (staff degraded boot = usable app, gate re-checks on recovery).

GATE: npm run build + tsc diff vs baseline (zero new). Runtime (Claude-in-Chrome ok): owner sign-in regression (Google, role='owner' in store, app normal); staff path NOT yet testable end-to-end if no staff exists — create one via D2 curl if available, sign in on localhost, verify role='staff', RPC-backed subscription object present, app boots to /tables.
COMMIT: feat(staff): #<issue> D3 — role claim in auth state + staff email/password login + club-subscription gate (refs #<issue>). Paired skill commit. Reviewer (will exceed 100 LOC). If a new auth pattern emerges, it takes a fresh A-number.
```

## D4 — Account switch, seed gate, staff Account card

Paste-ready prompt:

```
TASK: Phase D Chunk D4 — shared-device account switch polish + kill the demo-seed trap + minimal staff Account view. Requires D3.

MANDATORY reading: SKILL.md + STATE.md; references/phase_d_plan.md (D0 finding 4); sync_architecture_v2.md §3 (account-switch flow); bug_patterns.md A10 + S22 (teardown on logout) + D6; src/db/seed.ts; src/store/authStore.ts signOut; Rule H pre-flight IF you touch Settings.tsx (you will — read T2/R4/F5/U6/U10/S11 + ripple_effects §Settings first and cite them in the commit).

1. Seed gate (src/db/seed.ts): in seedIfEmpty, skip the SAMPLE_TABLES bulkAdd when the current JWT carries a user_club_id claim (import the lock-free reader from syncClubId — never supabase.auth.*). The settings singleton is STILL seeded (device-local, Dexie queries need it). Rationale in a comment: claim ⇒ initial pull will populate real tables; seeding would create 5 local-only ghost tables (staff first sign-in AND owner-second-device both hit this).
2. Account switch: verify (and fix if broken) the §3 flow on ONE device: staff signs out (closeDb, sync teardown per current signOut) → /  → different user signs in → initDbForUser(newUserId) opens the OTHER per-user DB → initial pull fills it. Confirm signOut's teardown order still matches Pattern S15/S16 comments and that SyncReader teardown fires (S22). No design change expected — this is mostly a verification + gap-fix pass; report gaps found.
3. Staff Account card: in Settings.tsx, when role==='staff' render ONLY an Account card — display name, username (from session.user.email), club name, and a Sign out button (calls the existing authStore.signOut). None of the owner sections render (they unmount entirely, not hidden-behind-CSS). Owner view byte-identical to today.
4. 3-scenario test (Critical Rule 11): happy (owner sign-in unchanged, still seeds on TRULY fresh no-claim DB), existing-data (owner upgrade device: claim present but Dexie already has tables — seed skip harmless), edge (staff fresh DB: no demo tables, pull populates; sign out mid-pull doesn't strand a channel — S22).

GATE: build + tsc diff. Runtime: two sign-in round-trips on one browser profile (owner → staff → owner), no data bleed between the per-user DBs, no demo tables on the staff DB.
COMMIT: feat(staff): #<issue> D4 — claim-gated seed + account switch verification + staff Account card (refs #<issue>). Cite Rule H patterns in the message. Paired skill commit.
```

## D5 — Role gates: operations cluster (Home / StartSession / SessionDetail / History)

Paste-ready prompt:

```
TASK: Phase D Chunk D5 — enforce the §2 permission matrix on the operations screens. Requires D4. Owner answers of 10 Jul apply (see plan "Owner answers"): History owner-only EXCEPT staff keep back-entry creation.

MANDATORY reading: SKILL.md + STATE.md; references/phase_d_plan.md; sync_architecture_v2.md §2 (the matrix rows for sessions/back-entries) + Appendix F (useRole/OwnerOnly sketch — sketch only, the shipped useRole from D3 wins); ripple_effects.md for each touched page.

1. Build the gate primitives once (src/components/auth/RoleGuard.tsx): <OwnerOnly fallback?>{children}</OwnerOnly> + <HideForStaff> reading useRole(). Role is already in the store — render-time gates, no loading flicker for staff (role resolves with the session).
2. Matrix application (staff loses; owner byte-identical):
   - Home/tables grid + StartSession: NO gating — staff start/stop/pause/resume/add-item all allowed.
   - SessionDetail: hide for staff — edit start time, move table, delete session, edit paymentBreakdown. Keep stop/pause/add-canteen-item.
   - History (per owner answer 10 Jul, matrix AMENDED): staff render of /history = ONLY the "Log past session" card/CTA (BackEntryModal fully functional — staff make back entries); the past-session list, filters, and any revenue figures are owner-only. Do NOT route-block /history for staff (D7 keeps the tab). Back-entry writes already pass staff RLS (sessions/session_items INSERT + canteen stock UPDATE).
3. CRITICAL: a gate must remove the ACTION, not just the button — check each hidden CTA has no keyboard/route/sheet path a staff user can still reach (e.g. a bottom sheet opened by a different trigger). Grep each gated handler for other call sites.
4. Remember WHY the client gate matters (D0 finding 2): a staff-queued owner-only write dead-letters in the outbox after 10 RLS 403s. The UI gate is the primary defense.

GATE: build + tsc diff. Runtime: staff profile walk of every operations screen — forbidden CTAs absent, allowed flows work and SYNC (stop a session as staff → row lands in Supabase with the staff JWT). Owner walk — zero visual diff.
COMMIT: feat(staff): #<issue> D5 — role gates on operations screens (refs #<issue>). Paired skill commit: ripple_effects gains a §Roles entry mapping matrix-row → component gate (start it this chunk; D6/D7 extend it). New pattern (role-guard) → FRESH pattern id, not S23.
```

## D6 — Role gates: commerce cluster (Canteen / QuickSale / Wallet / CustomerProfile / Piggy)

Paste-ready prompt:

```
TASK: Phase D Chunk D6 — matrix enforcement on commerce screens. Requires D5 (RoleGuard primitives exist). Owner answer of 10 Jul applies: staff CAN create customers.

MANDATORY reading: SKILL.md + STATE.md; references/phase_d_plan.md; sync_architecture_v2.md §2 matrix rows (canteen/customers/wallet/quick-sale/piggy); ripple_effects.md §Wallet + §Canteen; bug_patterns.md PM*/P* sections for the wallet flows you touch.

Staff loses (hide via RoleGuard; owner byte-identical):
- Canteen: item create/edit (name/price), peak pricing management, RestockSheet trigger. Staff keeps: view items, sell (stock decrement rides the existing atomic sale path — RLS allows staff canteen_items UPDATE for exactly this).
- Wallet/CustomerProfile: manual adjustment CTA (RLS also blocks kind='adjustment' server-side — the D9 proof target), customer edit (name/phone), any delete. Staff keeps: customers list/detail, top-up, approve player-hub topup intents (PendingTopupsModal), walk-in codes.
- WalletNewCustomer: staff allowed (owner answer 10 Jul).
- Piggy: entire page owner-only (content gate here; route + nav in D7).
- QuickSale: NO gating (staff allowed, including PaymentSplitSheet).
Same discipline as D5: remove the ACTION not the button; grep gated handlers for alternate entry points (sheets/modals especially — RestockSheet and adjustment sheets have multiple triggers).

GATE: build + tsc diff. Runtime: staff does a wallet top-up end-to-end → wallet_transactions row lands in Supabase (kind='topup', staff JWT) + customer balance updates on the OWNER device within ~2s. Staff QuickSale with stock decrement syncs. Adjustment CTA absent for staff.
COMMIT: feat(staff): #<issue> D6 — role gates on commerce screens (refs #<issue>). Paired skill commit (extend ripple_effects §Roles).
```

## D7 — Role gates: routes, nav, Summary today-card, Settings guard

Paste-ready prompt:

```
TASK: Phase D Chunk D7 — route-level enforcement + BottomNav + the staff Summary today-only card. Requires D5+D6.

MANDATORY reading: SKILL.md + STATE.md; references/phase_d_plan.md; sync_architecture_v2.md §2 ("How today-only Summary works") + Appendix F route list; src/App.tsx routes; src/components/BottomNav.tsx; Critical Rule 12 (NO gear icon in TopBar — the staff Settings tab stays in BottomNav).

1. Route guard: <RequireOwner> wrapper (inside RequireAccess) that redirects role==='staff' to /tables. Wrap: /piggy + /wallet/... adjustment-specific routes if any exist as routes (check). NOT wrapped: /summary (today-card, below), /history (staff get the stripped log-past-session view from D5), /settings/* (staff Account card from D4) — those pages branch on role internally.
2. Summary: /summary stays reachable for staff but renders ONLY the today-card — today's total revenue, session count, canteen sales count, business-day boundary per the existing summary math. No date picker, no charts, no piggy strip, no comparisons. Full component behind role==='owner'. Reuse existing summary aggregation (Pattern T9 — Quick Sale included); do NOT fork the math.
3. BottomNav for staff: all 4 tabs STAY (Tables / Summary / History / Settings) — each owner-only page renders its staff-reduced view instead (today-card, log-past-session, Account card). No grid-cols change.
4. Deep-link test is the gate: staff pasting /piggy URLs must bounce to /tables, not flash content first (guard renders null while deciding, never the child); /summary, /history, /settings show ONLY their staff-reduced views.

GATE: build + tsc diff. Runtime: staff deep-links to every owner-only route → bounce; staff Summary shows exactly one card with today's numbers matching the owner device; owner UI byte-identical.
COMMIT: feat(staff): #<issue> D7 — route guards + staff nav + today-only Summary card (refs #<issue>). Paired skill commit (ripple_effects §Roles route table; STATE module line for staff gating).
```

## D8 — Staff management screen (Settings, owner-only)

Paste-ready prompt:

```
TASK: Phase D Chunk D8 — Settings → Staff section (owner-only): list, create (credentials shown ONCE), reset password, revoke. Requires D2 + D3. Settings.tsx edit ⇒ Rule H pre-flight is MANDATORY.

MANDATORY reading: SKILL.md + STATE.md; Rule H (read patterns T2, R4, F5, U6, U10, S11 + ripple_effects §Settings; STATE which apply BEFORE coding; cite them in the commit); references/phase_d_plan.md; sync_architecture_v2.md Appendix G (UI sketch); bug_patterns.md §Modals; api contracts from D2.

1. New collapsible "Staff" section in Settings (owner-only via RoleGuard), following the existing one-open-at-a-time section pattern.
2. List: SELECT users_meta rows for the club via the MAIN supabase client (the D1 users_meta_owner_read_club policy makes this work — owner JWT only). Show name, username(email), active badge, created date. This is a Supabase read on section-open, NOT a Dexie table — no useDexieSetting involved (Rule 14 doesn't apply to this list; it's not a ClubSettings field).
3. Add staff: modal (shared <Modal>, centers at md: per Critical Rule 13) with a single Name input + Create button (onClick, no <form>). POST /api/create-staff with the owner Bearer token (Pattern S1 fetch discipline: timeout + status check + .json() try/catch + 404 'run vercel dev' hint). On success: credentials screen — username + password + Copy button + "Save this now — the password is shown only once." Password lives in component state only; cleared on modal close; NEVER written to Dexie/localStorage/logs.
4. Row actions: Reset password (POST manage-staff action=reset_password → same show-once screen) and Remove (POST action=revoke → confirm dialog first; on success row shows Removed/inactive). Disable buttons while in flight (Pattern A4 double-tap discipline).
5. No SaveIndicator (these are server ops with explicit success screens, not settings saves) — but state that reasoning in the commit per Rule H.

GATE: build + tsc diff. Runtime (vercel dev): create a real staff user → credentials shown; users_meta row appears in list; NO subscriptions row for them (D1 trigger proof); revoke → 'not active' on their next sign-in attempt. Reviewer pass (will exceed 100 LOC).
COMMIT: feat(staff): #<issue> D8 — Settings staff management (create/reset/revoke, show-once credentials) (refs #<issue>). Cite Rule H patterns. Paired skill commit.
```

## D9 — End-to-end runtime proof (owner-run, two browser profiles)

Paste-ready prompt:

```
TASK: Phase D Chunk D9 — full staff-login runtime proof. NO code (fix-forward only if a step fails, each fix through the Rule F issue flow). Requires D1–D8. Claude-in-Chrome drives; Sugeet supplies the second browser profile.

THE LAW: every RLS/hook assertion below is proven by a FRESHLY-MINTED JWT (real sign-in). SQL-editor checks prove nothing (postgres bypasses RLS + hook) — they are allowed only for reading state AFTER a JWT-authenticated action, never as the proof itself.

CHECKLIST (in order):
1. CREATE — owner (profile A): Settings → Staff → create "Rajesh". Credentials shown once. users_meta row active=true; auth user exists; NO subscriptions row for the staff user.
2. SIGN IN — staff (browser profile B, or another device): email/password sign-in with the shown credentials. Decode the staff JWT at jwt.io: user_role='staff', user_club_id == owner's club id. App boots to /tables; initial pull populates the staff Dexie (real tables, NO demo seed tables); subscription gate passes via the owner's subscription (RPC).
3. RLS SCOPE — on B: staff sees exactly the club's data. Negative scope check: in B's console, fetch a sync table with the staff bearer and a DIFFERENT club_id filter → zero rows (claim-scoped SELECT).
4. STAFF WRITE PATH — on B: start a session, add a canteen item, stop with payment; wallet top-up on a customer. Each lands in Supabase (created_by = staff user id) and appears on A within ~2s. Staff outbox drains to 0 — this proves the D1 staff policies (a 403 here dead-letters).
5. FORBIDDEN 403 — server-side, NOT via the app UI (an outbox write would dead-letter; use direct REST): from B's console, plain fetch to /rest/v1/wallet_transactions with the staff bearer, body kind='adjustment' → expect 403 (42501). Repeat for an INSERT to game_tables → 403. Then confirm the UI never offers either action to staff anyway.
6. PERMISSION SWEEP — on B: walk the §2 matrix (as amended 10 Jul) screen by screen: SessionDetail owner CTAs absent; Canteen edit/restock/peak absent; adjustment absent; Piggy bounces; History = log-past-session card only (and a staff back entry syncs to A); Summary = single today-card matching A's numbers; Settings = Account card only.
7. REVOKE MID-SHIFT — on A: remove Rajesh. On B: within the JWT TTL the app may keep working (accepted §4.5); force the boundary — sign out on B, attempt sign-in → "account removed" error (hook raises on active=false). users_meta.active=false.
8. ACCOUNT SWITCH — on B: owner signs in on the same device (per-user DB switch, no data bleed, no ghost tables); then staff2 created fresh → sign-in works (create/reset round-trip).

CLOSE: changelog + STATE (Phase D module line overwritten, staff-login pendings resolved/deleted, plan file status flipped to SHIPPED), bug_patterns for anything new (fresh IDs), check:skill PASS, auditor gate. Issues: post SHAs, Sugeet closes (Rule F).
```

---

## Deferred (redirect scope pressure here — §14 discipline)

- Full ClubSettings sync to staff devices (open question 3 — record as pending in STATE).
- Un-revoke / re-activate UI (re-create the account instead).
- "Wipe local data on revoke" toggle (§9 accepted residual).
- Owner auto-provisioning of `users_meta` at first signup (today: manual insert / D-later; claim-less owners simply run offline-only as in Phase C).
- Partner role, per-staff permissions, staff push notifications, audit-log UI (§14 list).

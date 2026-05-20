# Decision Log

Every significant decision made about ClubKeeper, with reasoning. When Sugeet asks "why did we go with X?" — answer is here.

Format:
```
### [Date] — [Topic]
**Decision:** What was chosen  
**Considered:** Alternatives  
**Why:** Reasoning  
**Trade-offs accepted:** What we give up  
**Revisit when:** Trigger to reconsider  
```

---

### 19 May 2026 — Tech stack

**Decision:** Vite + React + TypeScript + Tailwind v3.4 + Dexie + Zustand + vite-plugin-pwa  
**Considered:** Flutter, React Native + Expo, plain HTML/JS, Next.js  
**Why:**
- Sugeet has less coding experience, needs the most beginner-friendly stack
- PWA = zero setup pain (no Android Studio, no app stores), works on Android + iPhone instantly
- Vite has fast HMR and great error messages
- Tailwind keeps styling in markup, no CSS bugs
- Dexie wraps IndexedDB cleanly for offline-first
- Free hosting on Vercel
- Same codebase deploys instantly  

**Trade-offs accepted:**
- No Play Store listing in v1
- Slightly slower than native (negligible for timer app)
- iOS PWAs have limited features (no push notifications)

**Revisit when:** First request for Play Store presence, or when iOS PWA limitations actively hurt sales.

---

### 19 May 2026 — Tailwind v3.4, not v4

**Decision:** Lock Tailwind to 3.4.x  
**Considered:** Tailwind v4  
**Why:** v4 broke PostCSS in test runs, caused build failures. v3.4 is stable and well-supported.  
**Trade-offs accepted:** Slightly older API.  
**Revisit when:** v4 ecosystem stabilizes (~6-12 months).

---

### 19 May 2026 — Offline-first with no backend

**Decision:** No backend for v1. IndexedDB via Dexie only.  
**Considered:** Firebase, Supabase, custom API  
**Why:**
- Indian clubs often have terrible WiFi
- Owner only uses one device
- Zero hosting cost
- No latency
- Ship faster  

**Trade-offs accepted:**
- No multi-device sync
- No cross-device backup
- If owner loses phone, loses data

**Revisit when:** 3+ paying customers explicitly ask for multi-device. Then add Supabase.

---

### 19 May 2026 — Soft delete only, no hard delete

**Decision:** "Disable Table" sets `outOfService:true`, never actually deletes rows  
**Considered:** Hard delete with confirmation  
**Why:** Historical sessions reference table_id. Deleting a table breaks past data. Soft delete preserves audit trail.  
**Trade-offs accepted:** DB has stale tables forever (negligible storage).  
**Revisit when:** Users complain about clutter in Settings → add "Archived" tab and filter.

---

### 19 May 2026 — Rate snapshot per session

**Decision:** Each session stores its own `rateSnapshot` at start. Editing a table's rate later does NOT change in-progress sessions.  
**Considered:** Always use current table rate  
**Why:** Owner might edit rate mid-day. Customers playing now expected the original rate. Audit trail integrity.  
**Trade-offs accepted:** Two values to track per table (current rate vs snapshot rate).  
**Revisit when:** Never — this is a hard correctness requirement.

---

### 19 May 2026 — Timer from timestamps, never counter

**Decision:** Display elapsed = `Date.now() - startedAt - pausedTotalMs`, recomputed every render  
**Considered:** `setInterval` to increment a counter in state  
**Why:** Counter approach loses state on refresh/tab close. Timestamp approach survives anything because timestamps are stored in DB.  
**Trade-offs accepted:** Slight extra computation per render (negligible).  
**Revisit when:** Never. This is a load-bearing rule.

---

### 19 May 2026 — Mobile-first, no desktop layout

**Decision:** Design for 360px width. Desktop users see same layout in centered column.  
**Considered:** Responsive desktop dashboard  
**Why:** Target user is a phone-only club owner. Desktop is bonus, not primary.  
**Trade-offs accepted:** Desktop looks "wasteful" of space.  
**Revisit when:** First request for desktop-specific dashboard, or when admin panel needs to be built.

---

### 19 May 2026 — Indian Rupee only, no currency switching

**Decision:** Currency hardcoded to `₹`  
**Considered:** Multi-currency support  
**Why:** Target market is India only. Currency switching adds complexity for zero immediate value.  
**Trade-offs accepted:** Cannot serve non-Indian markets.  
**Revisit when:** Considering international expansion (probably never for v1-v2).

---

### 19 May 2026 — Dark theme only

**Decision:** Dark theme is the only theme  
**Considered:** Light theme toggle  
**Why:** Clubs are dimly lit. Dark UI is easier on eyes and saves battery. One theme = less code, fewer bugs.  
**Trade-offs accepted:** Some users prefer light themes.  
**Revisit when:** Customer feedback strongly asks for light theme, OR when premium tier wants a "white-glove" look.

---

### 19 May 2026 — Soft validation on player name, max 50 chars

**Decision:** Player name max 50 chars, alphanumeric + basic punctuation only  
**Considered:** No limit; allow any unicode  
**Why:** 50 chars covers "Rohit + 2", "Akash & friends, table booked by Vishal" type names. Special char filter prevents XSS-style issues and broken layout from emoji/symbols.  
**Trade-offs accepted:** Cannot store emoji or special unicode names.  
**Revisit when:** Indian-language names need devanagari or similar — then expand regex.

---

### 19 May 2026 — Subscription pricing tiers

**Decision:** ₹299 / ₹599 / ₹999 monthly. ₹599 is the target tier.  
**Considered:** ₹149 / ₹399 / ₹799  
**Why:**
- ₹149 attracts customers who churn fast and complain most
- ₹599 hits the ROI math sweet spot (18x return at ₹10k/month leakage prevention)
- ₹999 leaves room for Pro features in v2  

**Trade-offs accepted:** May lose budget-conscious owners. Acceptable — they'd churn anyway.  
**Revisit when:** 3 months in — if conversion is below 5%, lower entry tier. If above 20%, raise.

---

### 19 May 2026 — Razorpay for payments

**Decision:** Razorpay for monthly auto-debit  
**Considered:** Cashfree, Stripe (India), direct UPI  
**Why:**
- Razorpay is the dominant Indian payment provider
- Best NACH auto-debit support (critical for recurring monthly)
- Free developer tier
- Sugeet (and his customers) already familiar with it

**Trade-offs accepted:** 2% transaction fee.  
**Revisit when:** Scaling and 2% feels expensive — negotiate enterprise pricing at 500+ customers.

---

### 19 May 2026 — Skill-based project memory

**Decision:** Create a project skill with multiple reference files (architecture, design, bugs, business, etc.)  
**Considered:** Single large doc; CLAUDE.md file; nothing  
**Why:** Sugeet has multiple AI sessions over months. Each session forgets prior decisions. Skill provides persistent project memory.  
**Trade-offs accepted:** Sugeet has to remember to update the skill after sessions.  
**Revisit when:** If updates aren't happening, add stronger trigger reminders in skill description.

---

## Decisions Pending (Open Questions)

### Should signup be required before using the app?

**Options:**
- **A — Try-before-signup:** Anonymous local-only use, prompt for signup before saving to cloud
- **B — Require signup upfront:** No app access until signup
- **C — Hybrid:** Free local-only forever, signup unlocks cloud + premium features

**Pending:** Sugeet to decide.

**Sugeet's lean:** Probably A or C — wants people to try first.

---

### How to bill: per-table or flat tier?

**Options:**
- Flat tier (current plan): ₹299/₹599/₹999 with table limits
- Per-table: ₹100 per table, no tiers

**Pending:** Test market response. Flat is simpler. Per-table feels more "fair" to small clubs but harder to scale revenue.

---

### When to require Razorpay setup?

**Options:**
- Day 1 of free trial
- After trial ends (e.g., day 30)
- Soft-prompt on day 25

**Pending:** Discuss when building signup flow.

---

## Decisions Rejected (Don't Reopen)

These were considered and rejected. Don't bring them back unless major context change:

- **Building native iOS/Android apps separately** — PWA covers both at 10% the effort
- **Using Firebase** — Supabase is preferred (cheaper at scale, Postgres > Firestore, fewer surprises)
- **Building a web admin dashboard for Sugeet** — overkill at <50 customers; manage via Supabase console
- **Allowing custom currencies** — India only, no need
- **Building a customer-facing booking app** — out of scope for v1, possibly v2+
- **Adding gamification (badges, streaks for staff)** — owner-focused product, not staff-focused

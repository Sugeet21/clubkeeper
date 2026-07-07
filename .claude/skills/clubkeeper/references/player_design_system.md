# Player Design System — ClubKeeper

**Scope:** Every screen a player sees. Routes under `/c/:slug/*`, `/poster/:slug`, future receipt/wallet/booking views. Anything an end-customer of the club encounters, not the owner/staff app.

> **Status (corrected 7 Jul 2026):** this system is the TARGET for the player-app visual redesign — it is NOT yet what's shipped. The live `/c/:slug` pages (PlayerScan, BookingScreen, Poster) currently use the owner app's dark theme tokens (`bg-bg-card`, `text-text`, etc. — see the Phase 0 pricing-card entry in changelog). Apply this system only when Sugeet explicitly starts the player-app reskin; until then, new player screens match the shipped dark theme for consistency.

**Philosophy:** The staff app is a tool — dark, fast, utilitarian. The player app is a *brand* — premium, trustworthy, calm. A player landing here should feel "this club is run properly, my money is safe."

---

## 1. Color Palette

### Surfaces (backgrounds)

| Token | Hex | Use |
|---|---|---|
| `--felt` | `#0a3d2a` | Primary page background — pool table felt |
| `--felt-deep` | `#062418` | Cards, modals, elevated surfaces (sit ON felt) |
| `--felt-light` | `#145a3f` | Hover states, secondary cards, input backgrounds |
| `--cushion` | `#6b3410` | Rare — pool table cushion brown, use only for decorative borders or footer |

### Text colors

| Token | Hex | Use |
|---|---|---|
| `--ball-white` | `#f8f4e8` | Primary text — body, headings |
| `--cue-cream` | `#f0e6c8` | Secondary text — descriptions, longer paragraphs |
| `--text-dim` | `rgba(240, 230, 200, 0.65)` | Tertiary — captions, timestamps, meta |
| `--text-faint` | `rgba(240, 230, 200, 0.4)` | Disabled state, watermarks |

### Accent colors

| Token | Hex | Use |
|---|---|---|
| `--cue-yellow` | `#f4c542` | Primary accent — CTAs, prices, key numbers, brand moments |
| `--chalk` | `#4a90a8` | Secondary accent — eyebrows, tags, info states |
| `--ball-red` | `#b8312a` | Errors, destructive actions, low balance warnings |
| `--ball-green` | `#2d6b3a` | Success states, paid confirmations, available slots |

### Lines & dividers

| Token | Value | Use |
|---|---|---|
| `--line` | `rgba(240, 230, 200, 0.15)` | Subtle dividers between sections |
| `--line-strong` | `rgba(240, 230, 200, 0.35)` | Card borders, input borders |
| `--line-accent` | `var(--cue-yellow)` | Active borders, focused inputs |

### Rule
Background uses radial gradient for depth — never a flat `--felt`. Always:
```css
background:
  radial-gradient(ellipse at top, rgba(20, 90, 63, 0.4), transparent 60%),
  radial-gradient(ellipse at bottom, rgba(6, 36, 24, 0.6), transparent 60%),
  var(--felt);
```

---

## 2. Typography

### Font families (load all 3 from Google Fonts)

```html
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,700;9..144,900&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
```

| Role | Family | Use |
|---|---|---|
| Display | `'Fraunces', serif` | Headlines, club name, big prices, page titles |
| Body | `'Inter', sans-serif` | Paragraphs, labels, buttons, body content |
| Mono | `'JetBrains Mono', monospace` | Numbers (amounts, times, IDs), eyebrows, meta tags |

### Type scale

| Token | Size | Weight | Line-height | Use |
|---|---|---|---|---|
| `display-xl` | `clamp(40px, 6vw, 76px)` | 900 (Fraunces) | 0.95 | Hero page title (rare) |
| `display-lg` | `clamp(32px, 5vw, 56px)` | 700 (Fraunces) | 1.0 | Section headlines |
| `display-md` | `28px` | 700 (Fraunces) | 1.1 | Card titles, modal headers |
| `display-sm` | `20px` | 700 (Fraunces) | 1.2 | Sub-section headings |
| `lede` | `20px` | 400 (Fraunces) | 1.5 | Intro paragraph under titles |
| `body-lg` | `16px` | 400 (Inter) | 1.6 | Primary body text |
| `body` | `15px` | 400 (Inter) | 1.55 | Standard body |
| `body-sm` | `13px` | 400 (Inter) | 1.5 | Secondary descriptions |
| `label` | `13px` | 500 (Inter) | 1.4 | Form labels, button text |
| `eyebrow` | `11px` | 500 (Mono) | 1.4 | UPPERCASE label, letter-spacing 0.2em |
| `caption` | `12px` | 400 (Inter) | 1.4 | Captions, helper text |
| `num-xl` | `48px` | 700 (Mono) | 1.0 | Big amount displays (top-up amount, total bill) |
| `num-lg` | `32px` | 700 (Mono) | 1.0 | Stat numbers, table prices |
| `num-md` | `20px` | 600 (Mono) | 1.0 | Inline amounts, balance |
| `num-sm` | `15px` | 500 (Mono) | 1.0 | Small amounts, list prices |

### Italics in Fraunces
Use sparingly. Reserve italic + cue-yellow for ONE emphasized word per headline. Example: `From the notebook to a *platform.*`

### Rule for numbers
**Always use Mono for amounts.** `₹1,000` in Mono is 10× more premium-feeling than in Inter. Indian numbering: `toLocaleString('en-IN')` — `₹1,00,000` not `₹100,000`.

---

## 3. Spacing & Layout

### Spacing scale
Use multiples of 4px. Standard tokens:

| Token | Value | Common use |
|---|---|---|
| `space-1` | 4px | Tight icon gaps |
| `space-2` | 8px | Between label and input |
| `space-3` | 12px | Inside small components |
| `space-4` | 16px | Standard inner padding |
| `space-5` | 24px | Card padding, gaps between items |
| `space-6` | 32px | Section internal spacing |
| `space-7` | 48px | Between major sections |
| `space-8` | 64px | Hero spacing |
| `space-9` | 80px | Top of page, bottom of page |

### Container widths

| Context | Max width | Padding |
|---|---|---|
| Mobile (default) | `100%` | `18px` horizontal |
| Tablet | `640px` | `24px` horizontal |
| Desktop | `720px` for content pages, `1100px` only for marketing | `32px` horizontal |

**Rule:** Player pages are mobile-first. 90%+ of traffic will be a phone scanning a QR code at the table. Desktop is an afterthought.

### Border radius

| Token | Value | Use |
|---|---|---|
| `radius-sm` | 2px | Tight inputs, tags |
| `radius` | 4px | Cards, buttons, default |
| `radius-md` | 8px | Modals, sheets |
| `radius-lg` | 16px | Hero cards (rare) |
| `radius-full` | 9999px | Pills, avatars, ball-style markers |

**Rule:** Lean toward small radius (2-4px). Big rounded corners feel like a Bootstrap dashboard, not a premium brand.

---

## 4. Component Primitives

### 4.1 Buttons

**Primary (CTA — top-up, pay, book):**
```css
background: var(--cue-yellow);
color: var(--felt-deep);
font-family: 'Inter';
font-weight: 600;
font-size: 15px;
padding: 14px 24px;
border-radius: 4px;
border: none;
min-height: 48px; /* touch target */
letter-spacing: 0.02em;
transition: transform 0.1s, background 0.2s;
```
Hover: `background: #ffd34d; transform: translateY(-1px)`
Active: `transform: translateY(0)`

**Secondary (alternate action):**
```css
background: transparent;
color: var(--cue-yellow);
border: 1px solid var(--cue-yellow);
/* rest same as primary */
```

**Ghost (tertiary):**
```css
background: transparent;
color: var(--ball-white);
border: 1px solid var(--line-strong);
```

**Destructive (cancel booking, refund):**
```css
background: transparent;
color: var(--ball-red);
border: 1px solid var(--ball-red);
```

**Disabled state (all variants):**
```css
opacity: 0.4;
cursor: not-allowed;
```

**Rule:** Maximum ONE primary button per screen. Multiple primaries = confused user.

### 4.2 Form Inputs

**Text input / number input:**
```css
background: var(--felt-deep);
border: 1px solid var(--line-strong);
border-radius: 4px;
padding: 14px 16px;
color: var(--ball-white);
font-family: 'Inter';
font-size: 16px; /* never below 16px on mobile - prevents iOS zoom */
min-height: 48px;
width: 100%;
```
Focus: `border-color: var(--cue-yellow); outline: none; box-shadow: 0 0 0 3px rgba(244, 197, 66, 0.15);`
Placeholder: `color: var(--text-faint);`

**Label (above input):**
```css
font-family: 'Inter';
font-size: 13px;
font-weight: 500;
color: var(--cue-cream);
margin-bottom: 8px;
display: block;
```

**Helper text (below input):**
```css
font-size: 12px;
color: var(--text-dim);
margin-top: 6px;
```

**Error state:**
```css
border-color: var(--ball-red);
/* helper text becomes red */
```

### 4.3 Cards

**Standard card (sits ON felt):**
```css
background: var(--felt-deep);
border: 1px solid var(--line);
border-radius: 4px;
padding: 24px;
```

**Elevated / featured card:**
```css
background: var(--felt-deep);
border-left: 3px solid var(--cue-yellow);
border-radius: 2px;
padding: 32px 28px;
```

**Interactive card (clickable, e.g. select a table):**
```css
/* base = standard card */
cursor: pointer;
transition: border-color 0.15s, transform 0.1s;
```
Hover: `border-color: var(--line-strong);`
Selected: `border-color: var(--cue-yellow); background: var(--felt-light);`

### 4.4 Pills / Tags / Chips

**Status pill:**
```css
display: inline-flex;
align-items: center;
gap: 6px;
padding: 4px 12px;
border-radius: 9999px;
font-family: 'JetBrains Mono';
font-size: 11px;
font-weight: 500;
letter-spacing: 0.1em;
text-transform: uppercase;
```

Color variants:
- Success: `background: rgba(45, 107, 58, 0.2); color: var(--ball-green);`
- Warning: `background: rgba(244, 197, 66, 0.15); color: var(--cue-yellow);`
- Error: `background: rgba(184, 49, 42, 0.15); color: var(--ball-red);`
- Info: `background: rgba(74, 144, 168, 0.15); color: var(--chalk);`

**Quick-select chip (₹500 / ₹1000 / ₹2000 top-up buttons):**
```css
padding: 12px 20px;
background: var(--felt-deep);
border: 1px solid var(--line-strong);
border-radius: 4px;
font-family: 'JetBrains Mono';
font-weight: 600;
color: var(--ball-white);
cursor: pointer;
```
Selected: `border-color: var(--cue-yellow); color: var(--cue-yellow); background: var(--felt-light);`

### 4.5 Modals & Bottom Sheets

**Modal (desktop):**
```css
background: var(--felt-deep);
border: 1px solid var(--line-strong);
border-radius: 8px;
padding: 32px;
max-width: 480px;
margin: auto;
/* backdrop: rgba(0,0,0,0.7) */
```

**Bottom sheet (mobile):**
```css
background: var(--felt-deep);
border-top: 2px solid var(--cue-yellow);
border-radius: 16px 16px 0 0;
padding: 24px 18px 32px;
/* slide up animation: transform translateY(100%) → 0 */
```

**Modal header:**
```css
font-family: 'Fraunces';
font-size: 24px;
font-weight: 700;
margin-bottom: 8px;
```

**Modal close button:**
Top-right, 44×44 touch target, ghost style, `×` glyph in `--text-dim`.

### 4.6 Lists

**Definition list (key-value pairs — e.g. "Tables: 5", "Open till: 11 PM"):**
```css
.def-list { display: flex; flex-direction: column; gap: 12px; }
.def-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}
.def-key {
  font-size: 13px;
  color: var(--text-dim);
}
.def-value {
  font-family: 'JetBrains Mono';
  font-size: 15px;
  font-weight: 500;
  color: var(--ball-white);
}
```

**Itemized list (e.g. transaction history):**
```css
.item-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 16px;
  padding: 16px 0;
  border-bottom: 1px solid var(--line);
}
.item-title { font-size: 15px; color: var(--ball-white); }
.item-meta { font-size: 12px; color: var(--text-dim); margin-top: 4px; }
.item-amount {
  font-family: 'JetBrains Mono';
  font-weight: 700;
  color: var(--cue-yellow); /* or --ball-green for credit, --ball-red for debit */
}
```

### 4.7 Headers & Navigation

**Page header (top of every player page):**
```css
border-top: 2px solid var(--cue-yellow);
border-bottom: 1px solid var(--line-strong);
padding: 20px 0;
display: flex;
justify-content: space-between;
align-items: baseline;
margin-bottom: 32px;
```

Left: Club name (Fraunces, 18px, weight 700)
Right: Meta info (Mono, 11px, `--text-dim`, uppercase) — e.g. "OPEN · 11 PM CLOSE"

**Section header (within a page):**
```css
display: flex;
align-items: baseline;
gap: 16px;
margin-bottom: 24px;
padding-bottom: 12px;
border-bottom: 1px solid var(--line);
```
Mark (Mono, 12px, `--cue-yellow`, uppercase) + Title (Fraunces, 22px, weight 700)

### 4.8 Numbers display (centerpiece moments)

For the big "₹1,000" top-up amount, current wallet balance, or final bill — the page's hero number:

```css
.hero-amount {
  font-family: 'JetBrains Mono';
  font-size: 48px;
  font-weight: 700;
  color: var(--cue-yellow);
  letter-spacing: -0.02em;
  line-height: 1;
  margin-bottom: 8px;
}
.hero-amount-label {
  font-family: 'Inter';
  font-size: 12px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--text-dim);
}
```

### 4.9 Empty states

When a player has no transactions, no wallet balance, no bookings:
```
[Icon or simple glyph in --text-faint]

Empty heading (Fraunces, 20px, --cue-cream)
Helper line (Inter, 14px, --text-dim, max 2 lines)

[Primary button — "Top up wallet" / "Book a table"]
```

Centered, 64px vertical padding. Empty is an invitation to act — always include the CTA.

### 4.10 Loading states

**Inline loader (button while submitting):**
Replace button text with spinning dot pattern in `--cue-yellow`. Don't change button width.

**Full-page loading:**
```
Centered:
[Pulsing yellow dot — 12px circle, opacity 0.4 → 1 → 0.4 loop]
"Loading..." (Mono, 12px, uppercase, --text-dim, letter-spacing 0.2em)
```
No spinners with arcs. Pulse, not spin — calmer.

### 4.11 Toasts & Notifications

```css
.toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--felt-deep);
  border-left: 3px solid var(--cue-yellow); /* or red/green */
  padding: 14px 20px;
  border-radius: 4px;
  font-size: 14px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.4);
  max-width: 90%;
}
```

Variants by color of left border:
- Success: `--ball-green`
- Error: `--ball-red`
- Info: `--chalk`
- Default: `--cue-yellow`

Auto-dismiss: 4 seconds. Tappable to dismiss earlier.

### 4.12 Progress indicators

**Step progress (e.g. booking: Select → Pay → Confirm):**
```css
.steps {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 32px;
}
.step-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--line-strong);
}
.step-dot.active { background: var(--cue-yellow); }
.step-dot.done { background: var(--ball-green); }
.step-line {
  flex: 1;
  height: 1px;
  background: var(--line-strong);
}
```

**Bar progress (e.g. ClubCoins earning):**
```css
.bar-track {
  height: 4px;
  background: var(--felt-deep);
  border-radius: 9999px;
  overflow: hidden;
}
.bar-fill {
  height: 100%;
  background: var(--cue-yellow);
  transition: width 0.4s ease-out;
}
```

### 4.13 QR code display

When showing UPI QR for player to scan:
```css
.qr-frame {
  background: var(--ball-white); /* QR needs WHITE bg to scan reliably */
  padding: 16px;
  border-radius: 8px;
  border: 2px solid var(--cue-yellow);
  display: inline-block;
}
```
Below QR: small `--text-dim` line "Scan with any UPI app" (Mono, 11px, uppercase).

### 4.14 Avatars & Initials

For player profile, club logo placeholders:
```css
.avatar {
  width: 48px;
  height: 48px;
  border-radius: 9999px;
  background: var(--felt-light);
  border: 1px solid var(--line-strong);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Fraunces';
  font-weight: 700;
  color: var(--cue-yellow);
  font-size: 18px;
}
```

---

## 5. Iconography

**Rule:** Minimal icons. Where used: **inline SVG, stroke `currentColor`** — same convention as the owner app (design_system.md / architecture.md: NO icon libraries; Lucide is NOT in the stack — an earlier version of this line claimed otherwise). 1.5–2px stroke.

Default icon size: 20×20px. In buttons: 16×16. In headers: 24×24.

Never use emoji as UI icons. Never use Material/Bootstrap default icon sets — too generic.

---

## 6. Motion

**Three motion rules only:**

1. **Page-load fade-in:** All page content opacity 0 → 1 over 200ms on mount. Subtle, premium.
2. **Tap response:** Buttons scale to 0.98 on press, snap back on release. 100ms.
3. **Sheet slide:** Bottom sheets transform translateY(100%) → 0 over 280ms with ease-out.

**Banned:**
- Bouncy/spring animations (feels childish)
- Auto-rotating carousels
- Parallax scroll
- Hover animations on touch devices (use `@media (hover: hover)` to gate)

**Respect:** `@media (prefers-reduced-motion: reduce)` disables all of the above.

---

## 7. Voice & Copy

### Tone
- **Direct, warm, owner-to-player.** Not corporate, not slangy.
- **Bilingual where natural.** English headings, Hindi/Marathi can sit alongside ("Top up · रिचार्ज करें") — never force.
- **Numbers > adjectives.** "Save ₹100" beats "Great deal." Always show the rupee math.

### Button copy rules
- **Active verbs:** "Top up", "Book table", "Pay ₹500" — not "Submit", "Continue", "Proceed."
- **Show the amount** on payment buttons: "Pay ₹420" not "Pay now."
- **Same word in toast as button:** Button says "Top up" → toast says "Topped up". Never "Submitted."

### Error messages
- Say what happened: "Payment didn't go through."
- Say why if you know: "UPI app didn't confirm in 30 seconds."
- Say what to do: "Try again, or check your bank app for the deduction."
- Never apologize as the system. Never use "Oops" or "Whoops."

### Empty state copy
- One-line invitation: "No top-ups yet — start with ₹500."
- Never "Nothing to show here" or "No data."

### Currency formatting
- Always `₹` (not `Rs.` or `INR` in UI)
- Indian numbering: `₹1,00,000` not `₹100,000`
- No decimals on whole rupee amounts: `₹500` not `₹500.00`
- Two decimals only when paise are real: `₹499.50`

### Time formatting
- 12-hour with am/pm lowercase: `7:30 pm` not `19:30`
- Today/Yesterday before dates: "Today, 7:30 pm" / "Yesterday, 9 pm" / "12 Jun, 7:30 pm"
- Duration: `45 min`, `1 hr 20 min` (not `01:20:00`)

---

## 8. Accessibility (non-negotiable)

- Minimum touch target: 44×44px
- Text contrast ratio ≥ 4.5:1 against background (use the WebAIM checker — `--cue-cream` on `--felt` passes, `--text-faint` does NOT for body text)
- Every input has a visible label (no placeholder-only labels)
- Focus states visible — never `outline: none` without replacement
- Form errors announced — use `aria-invalid` and `aria-describedby`
- Images have `alt` text (or `alt=""` if decorative)
- Color is never the only signal — pair with icon or text (e.g. ✓ Success, ✕ Error)

---

## 9. Mobile-first invariants

- Default design width: **360px**
- Test breakpoints: 360px, 414px, 768px, 1024px
- Never horizontal-scroll
- Sticky bottom CTAs on payment/booking pages — primary button stays visible while form scrolls
- Safe area insets on iOS: `padding-bottom: env(safe-area-inset-bottom)` on fixed bottom elements
- Forms: large inputs (`min-height: 48px`, `font-size: 16px`), one field per row on mobile

---

## 10. What NOT to do (anti-patterns)

| Don't | Why |
|---|---|
| Use bright neon colors outside `--cue-yellow` | Breaks the premium feel — felt-table aesthetic dies |
| Use multiple display fonts | One serif (Fraunces) is the personality; more is chaos |
| Use Inter for numbers | Mono is the brand signal for amounts — never break this |
| Add gradients to text | Cheap dashboard look — flat colors only |
| Use stock photography of pool tables | Feels like a template. Use generated imagery or none |
| Center-align body paragraphs | Hard to read — left-align always |
| Use `border-radius: 20px+` | Looks like a kids' app, not premium |
| Add drop shadows on every element | Reserve for modals/sheets only — flat elsewhere |
| Show developer-y jargon | "Transaction ID" → "Receipt number". "Status: pending" → "Waiting for bank" |
| Stack 3+ primary CTAs on one screen | Decision paralysis. One primary, others secondary/ghost |

---

## 11. Reference HTML

A full styled prototype ("clubkeeper-roadmap.html") was produced in a claude.ai session (Jun 2026) — it is NOT in this repo; ask Sugeet if the reference render is needed. Player screens should use the same tokens but with simpler, single-purpose layouts — never the magazine-style multi-section structure of the roadmap.

---

## 12. Update protocol

This file is the source of truth for player-facing visuals. Before adding any new component to a `/c/:slug/*` route:
1. Check if a primitive in this file already covers it.
2. If yes, use it as-is. Don't reinvent.
3. If no, propose the new primitive here FIRST (palette, type, spacing tokens), get owner sign-off, then build.
4. Add the new primitive as a new section in this file with the same structure (tokens table + CSS snippet + usage rule).

**Never let a player screen drift.** One ugly screen kills the premium feel of the other three.

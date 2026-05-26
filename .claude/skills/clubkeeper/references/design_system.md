# Design System

## Color Palette (LOCKED)

These exact hex values are in `tailwind.config.js`. Do not introduce new colors without updating both.

| Token | Hex | Use |
|---|---|---|
| `bg` | `#0a0e0c` | Main app background |
| `bg-elevated` | `#131815` | Subtle elevation (mostly unused) |
| `bg-card` | `#1a201c` | Cards, inputs, modal surfaces |
| `border` | `#2a322d` | Default borders |
| `border-bright` | `#3a443e` | Hover/focus borders |
| `text` | `#e8efe9` | Primary text |
| `text-dim` | `#8a948c` | Secondary text |
| `text-faint` | `#555f57` | Labels, captions, muted |
| `accent` | `#b8ff5a` | CTAs, active states, brand |
| `accent-dim` | `#8fd142` | Hover on accent |
| `free` | `#5dd982` | Free/available status |
| `busy` | `#ff6b4a` | Busy/running status, destructive actions |
| `paused` | `#ffb84a` | Paused status, warnings |

## Typography

```
Body / UI: Bricolage Grotesque (400, 500, 600, 700, 800)
Mono / Numbers / Timers: JetBrains Mono (400, 500, 600, 700)
```

Both loaded from Google Fonts. Mono is critical for timers — proportional fonts make digits jump.

### Type Scale

| Size | Use |
|---|---|
| `text-[10px]` mono uppercase tracking-widest text-text-faint | Labels (NAME, RATE, etc.) |
| `text-xs` (12px) | Small body, meta |
| `text-sm` (14px) | Body |
| `text-base` (16px) | Inputs |
| `text-[17px]` font-bold | Card titles |
| `text-2xl` (24px) font-bold | Page headings (h2) |
| `text-[26px]` mono font-bold | Card timers |
| `text-[64px]` mono font-bold | Big timer on session detail |

## Spacing

- Page horizontal padding: `px-5` (was px-4 in early code — px-5 is the standard now)
- Card padding: `p-4`
- Modal padding: `p-5`
- Section gaps: `gap-3` or `gap-4`
- Bottom padding for pages (to clear bottom nav): `pb-24` minimum

## Border Radius

- Buttons/cards: `rounded-2xl` (= 16px, sometimes specified as `rounded-[18px]`)
- Pills/chips: `rounded-full`
- Small badges: `rounded-md`
- Tiny dots: `rounded-full`

## Component Specs

### Buttons

| Variant | Classes |
|---|---|
| Primary | `bg-accent text-bg font-bold py-4 rounded-2xl w-full` |
| Secondary | `bg-bg-card text-text border border-border py-3 rounded-2xl` |
| Destructive | `bg-busy text-white py-3 rounded-2xl` OR (subtle) `bg-busy/12 text-busy border border-busy/30` |
| Paused/Warning | `bg-paused/12 text-paused border border-paused/30` |
| Ghost/Cancel | `bg-bg-card text-text-dim border border-border py-3 rounded-2xl` |

All buttons: `min-h-[44px]` for touch target.

### Inputs

```
className="w-full px-4 py-3.5 bg-bg-card border border-border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint"
```

Date inputs ALSO need `[color-scheme:dark]` for native picker theming.

### Status Badges

```tsx
// Free
<div className="text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 rounded-md bg-free/12 text-free">Free</div>

// Busy (with live dot)
<div className="text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 rounded-md bg-busy/15 text-busy flex items-center gap-1.5">
  <span className="w-1.5 h-1.5 rounded-full bg-busy animate-pulse" />
  Running
</div>

// Paused (no pulse)
<div className="text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 rounded-md bg-paused/15 text-paused">Paused</div>
```

### Toggle Switch (FIXED in Prompt 7)

```tsx
<button 
  role="switch"
  aria-checked={value}
  onClick={() => onChange(!value)}
  className="relative w-12 h-7 rounded-full transition-colors duration-200 py-2"
  style={{ background: value ? '#b8ff5a' : '#2a322d' }}
>
  <span 
    className="absolute w-5 h-5 rounded-full bg-white top-1 transition-transform duration-200"
    style={{ transform: value ? 'translateX(24px)' : 'translateX(4px)' }}
  />
</button>
```

### Card Statuses

| State | Background | Border |
|---|---|---|
| Free | `bg-bg-card` | `border-border` |
| Busy | `bg-gradient-to-br from-busy/8 to-bg-card` | `border-busy/30` |
| Paused | `bg-gradient-to-br from-paused/8 to-bg-card` | `border-paused/30` |
| Out of service | `bg-bg-card opacity-50` (except edit pencil!) | `border-border` |

## Animation

- All transitions: `duration-200` ease default
- Live dot pulse: `animate-pulse` (Tailwind built-in)
- Timer: NO transition — values change every second, animation would be janky

## Iconography

- Inline SVG only. No icon libraries.
- Stroke width: 2
- Color: `currentColor` (inherits from text color)
- Sizes: 16px (inline), 20px (nav/buttons), 24px (large headers)

Example back chevron:
```tsx
<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
  <path d="M15 18l-6-6 6-6"/>
</svg>
```

## Responsive Strategy

- Mobile-first. Build for 360px width.
- `sm:` (640px+) for tablet enhancements only — content centers with `max-w-md mx-auto`
- No desktop-specific layout in v1. Desktop users get the mobile layout in a centered column.

### Collapsible Section Card (Settings page)

Used in `src/pages/Settings.tsx` as the `SettingsSection` component. Added Build Prompt 3.

```tsx
function SettingsSection({ id, title, icon, badge, isOpen, onToggle, children }) {
  return (
    <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={`section-${id}`}
        className="w-full flex items-center gap-3 px-4 py-4 min-h-[56px] text-left"
      >
        <span className="text-text-dim shrink-0">{icon /* 20×20 SVG */}</span>
        <span className="flex-1 text-[15px] font-semibold text-text">{title}</span>
        {badge}
        <svg ... className={`text-text-faint shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}>
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      <div
        id={`section-${id}`}
        className={`grid transition-all duration-200 ease-out ${
          isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-4 pt-1 border-t border-border">{children}</div>
        </div>
      </div>
    </div>
  )
}
```

**Rules:**
- Only ONE section open at a time — parent holds `openSection: string`.
- Header tap target: `min-h-[56px]` (larger than standard 44px — intentional, it's the primary nav element).
- Animation: `grid-rows-[1fr/0fr]` + `opacity` — no JS animation, no height calculation.
- `openSection` persisted in `sessionStorage['ck_settings_section']` — UI flag only.
- Icons: inline SVG 20×20, stroke-2, currentColor. No icon library.

---

## Empty States

When a list is empty, show:
- Centered icon (e.g., clock for "no sessions")
- One-line description: `text-text-dim text-sm`
- Optional CTA button
- Container: `flex flex-col items-center justify-center py-12 gap-3`

## Loading States

`useLiveQuery` returns `undefined` initially. Show skeleton:
```tsx
{tables === undefined ? (
  <div className="space-y-3">
    {[1,2,3].map(i => (
      <div key={i} className="h-24 bg-bg-card border border-border rounded-2xl animate-pulse" />
    ))}
  </div>
) : (
  /* real content */
)}
```

## Currency Display

```ts
formatINR(2840) // → "₹2,840"
```

Implementation: `'₹' + n.toLocaleString('en-IN')`

Indian number format groups by 2 after the first 3 (lakhs/crores). `toLocaleString('en-IN')` handles this correctly.

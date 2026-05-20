# Bug History

Every bug found in ClubKeeper, with root cause and fix. Always check this before suggesting a code change — the bug might have been seen before.

## How to use this file

When Sugeet reports a new bug:
1. Search this file for similar symptoms first.
2. If similar pattern found → apply same fix pattern.
3. If new → fix it, then APPEND a new entry to this file.

Format for entries:
```
### [Date] — [Short title]
**Symptom:** What Sugeet saw  
**Root cause:** Technical explanation  
**Fix:** What was changed and where  
**Lesson:** What to remember to avoid this class of bug  
```

---

### 19 May 2026 — Toggle button misaligned

**Symptom:** Out-of-Service toggle in TableFormModal had knob overlapping the track, looked broken.  
**Root cause:** Built as styled checkbox with hand-rolled CSS, position math was off.  
**Fix:** Rebuilt as a `<button role="switch">` with absolute-positioned knob using `translateX`. Now a reusable `<Toggle>` component.  
**Lesson:** Don't reinvent form controls with checkboxes + CSS. Use semantic buttons with proper ARIA.

---

### 19 May 2026 — Date inputs in History not editable

**Symptom:** Tapping From/To dates did nothing.  
**Root cause:** Dates were rendered as `<div>` not `<input type="date">`.  
**Fix:** Real `<input type="date">` with `[color-scheme:dark]` for theme matching. Use YYYY-MM-DD strings, not Date objects, for state.  
**Lesson:** Use native HTML inputs when possible. They give free mobile keyboards/pickers.

---

### 19 May 2026 — Amount column touching screen edge

**Symptom:** History session amounts had no breathing room from right edge.  
**Root cause:** Container used `px-4` or no horizontal padding.  
**Fix:** Standardized all page-level horizontal padding to `px-5`.  
**Lesson:** Pick one horizontal padding value and use it everywhere. Inconsistent padding looks unprofessional.

---

### 19 May 2026 — Time Rounding setting did nothing

**Symptom:** Set rounding to 15min, stopped a session at 1 min — amount calculated as 1 min, not 15.  
**Root cause:** `applyRounding()` existed in `money.ts` but `stopSession()` never called it.  
**Fix:** In `stopSession()`, read settings, if `billingMode === 'per_hour'` and rounding !== 'none', round elapsed UP to nearest 15/30 min, use rounded value for amount. Store rounded duration in new `roundedDurationMs` field.  
**Lesson:** Settings must actually be plumbed into the action that uses them. Add a test scenario after every settings flag added.

---

### 19 May 2026 — Delete table crashes app

**Symptom:** Tapping Delete on a table → "Cannot read properties of undefined (reading 'name')".  
**Root cause:** After soft-delete, modal stayed open and tried to re-render with deleted table data.  
**Fix:** Close modal IMMEDIATELY via `setEditingTableId(null)` after the action. Add `if (!table) return null` guard at top of modal component.  
**Lesson:** Always close UI before mutating data, OR keep stale data accessible until UI is gone.

---

### 19 May 2026 — "Delete" button label was misleading

**Symptom:** Button said "Delete" but actually soft-deleted (set outOfService). Toggle let users un-delete. Confusing.  
**Root cause:** Inherited from earlier prompt that used "Delete" terminology.  
**Fix:** Renamed to "Disable Table" / "Enable Table" based on current state. Removed redundant "Out of Service" toggle. Single source of truth.  
**Lesson:** Button labels must match what they actually do. If a "Delete" doesn't actually delete, name it correctly.

---

### 19 May 2026 — Edit pencil on disabled table opens broken form

**Symptom:** Disabled tables looked fully faded including the edit pencil. Tapping pencil still worked but form had stale state.  
**Root cause:** `opacity-50` was applied to the entire row, including the action button.  
**Fix:** Apply opacity ONLY to text/info div. Pencil stays full opacity. Form button row is context-aware: shows "Enable Table" when editing a disabled table.  
**Lesson:** Don't fade clickable elements. Either disable them properly (pointer-events-none) or keep them at full opacity.

---

### 19 May 2026 — Calendar date picker had light theme

**Symptom:** Native date picker on Summary opened with white background, jarring against dark app.  
**Root cause:** No `color-scheme: dark` CSS property set.  
**Fix:** Quick fix: add `[color-scheme:dark]` Tailwind class. Better fix: replace with `react-day-picker` themed to match.  
**Lesson:** Native browser UI (date pickers, scrollbars, etc.) needs `color-scheme` for dark mode. Always add it.

---

### 19 May 2026 — Long player name overflows everywhere

**Symptom:** Sugeet tested with 100-char garbage name. Text overflowed Home cards, Session Detail, suggestion chips, and the input itself.  
**Root cause:** No maxLength on input. No truncation in display.  
**Fix:** `maxLength={50}` on input. Validation regex blocking special chars. Truncate + ellipsis in all display contexts via `truncate min-w-0 flex-1`.  
**Lesson:** Every text input needs a maxLength. Every text display needs a max-width with truncate. Plan for adversarial input.

---

### 19 May 2026 — Special characters in player name pollute suggestions

**Symptom:** Garbage characters from testing showed up in recent-players chip list, broke layout further.  
**Root cause:** `getRecentPlayerNames()` returned anything stored, no filter.  
**Fix:** Filter in two places — at query time (skip names that fail validation) and at storage time (validate before save). Also added "Clean Invalid Data" button in Settings to retroactively clean.  
**Lesson:** Validate at write AND read. If validation rules change later, old data may not match — provide a cleanup tool.

---

### 19 May 2026 — Could disable a running table

**Symptom:** User started a session on Pool 1, went to Settings, disabled Pool 1. Pool 1 disappeared from Home. The running session was now orphaned and inaccessible from the UI.  
**Root cause:** No check that the table is in use before allowing disable.  
**Fix:** In TableFormModal, check for active session before allowing disable. Disable button + warning text if blocked. Re-check on submit to handle race conditions.  
**Lesson:** Destructive/state-changing actions must check related data integrity, not just the target entity.

---

## Patterns to Watch For

These are recurring bug classes — be paranoid when these come up:

### Pattern A: Stale data after mutation
After delete/soft-delete, components re-render with the now-missing data. Always close UI BEFORE mutating, OR add null guards.

### Pattern B: Settings not wired to action
A toggle in Settings does nothing because the action code doesn't read the setting. Add a checklist when implementing new settings: where is this read?

### Pattern C: Native HTML controls don't theme
Date pickers, file inputs, select dropdowns, scrollbars — all need explicit theming. Test in actual dark mode.

### Pattern D: Adversarial input
Always assume users will paste 10,000 chars, type emoji, special chars, SQL injection. maxLength + validation + truncation in display.

### Pattern E: Race conditions
Two tabs open, both tap the same button. Or: user taps fast twice. Pre-check + re-check pattern. Or disable button after first tap.

### Pattern F: Timer state from counters
ANY time someone proposes `setInterval` to increment a number — STOP. Use timestamps and derive on render.

---

## Open Issues / Not Yet Reproduced

(Move here when Sugeet reports something but it can't be reproduced. Revisit later.)

(none currently)

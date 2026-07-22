// Generic on-screen numeric keypad, docked at the bottom of the viewport.
//
// WHY THIS EXISTS: some flows need fast numeric entry across many fields on a
// phone WITHOUT the OS keyboard covering the list (bulk restock entry, #173).
// The consuming field is `readOnly` + `inputMode="none"` so tapping it never
// summons the device keyboard; this pad drives the value instead.
//
// GENERIC ON PURPOSE — no feature-specific logic. Props only. Adopt it anywhere
// numeric entry over a visible list is wanted. Do NOT add restock/canteen logic
// here; keep that in the consuming screen.
//
// PC vs phone: NO device detection. On a phone the on-screen pad is the only
// input (the field is inputMode="none", so the OS keyboard never opens). On a
// PC the same pad works by mouse click AND by physical keyboard (digits append,
// Backspace deletes, Enter = Next) — see the useEffect below. One component,
// correct on both, without branching on device type.
//
// Blank-never-zero (#173 R2) is enforced by construction: digits APPEND to the
// string value ('' + '3' → '3', then + '0' → '30'), backspace slices one char
// ('30' → '3' → ''), and an empty value stays the empty string. The pad never
// produces '0' from an empty field and never coerces '' → 0. The consumer
// decides what an empty string means (for restock: skip the row).

import { useEffect } from 'react'
import { NUMBER_PAD_HEIGHT_PX } from '../lib/numberPadLayout'

interface NumberPadProps {
  /** Current field value as a string. '' = empty (never coerced to '0'). */
  value: string
  /** Called with the next string value on every digit / backspace. */
  onChange: (next: string) => void
  /** Optional — "Next" button. Hidden when not provided. Commit + advance is the consumer's job. */
  onNext?: () => void
  /** Optional short label shown above the value (e.g. the field being edited). */
  label?: string
  /** Max digits accepted (generic guard against absurd input). Default 5. */
  maxLength?: number
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

export function NumberPad({ value, onChange, onNext, label, maxLength = 5 }: NumberPadProps) {
  function pressDigit(d: string) {
    // APPEND — never coerce. '' + '3' = '3', not 30; '3' + '0' = '30'.
    if (value.length >= maxLength) return
    onChange(value + d)
  }

  function pressBackspace() {
    // Slice one char. '30' → '3' → '' (empty, NOT '0').
    onChange(value.slice(0, -1))
  }

  // PHYSICAL KEYBOARD support (device-agnostic). On a PC, clicking the pad
  // buttons for 30 rows is slow — so digit keys append, Backspace deletes,
  // Enter fires onNext. On a phone there's no physical keyboard, so this listens
  // to nothing and the on-screen pad is still the only input; the "no OS
  // keyboard" guarantee is intact because the field is inputMode="none" and this
  // listener lives on `document`, not the input. NO device detection needed.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't hijack typing in a REAL text field elsewhere on the page (e.g. a
      // search box, or the inline "add item" name input). The pad's own qty
      // field is inputMode="none" + readOnly so it never becomes the active
      // element here — only a genuine editable input would.
      const el = e.target as HTMLElement | null
      if (el) {
        const tag = el.tagName
        const editable =
          el.isContentEditable ||
          ((tag === 'INPUT' || tag === 'TEXTAREA') && !(el as HTMLInputElement).readOnly)
        if (editable) return
      }
      if (e.key >= '0' && e.key <= '9') {
        if (value.length < maxLength) onChange(value + e.key)
        e.preventDefault()
      } else if (e.key === 'Backspace') {
        onChange(value.slice(0, -1))
        e.preventDefault()
      } else if (e.key === 'Enter' && onNext) {
        onNext()
        e.preventDefault()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [value, maxLength, onChange, onNext])

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 bg-bg-card border-t border-border select-none"
      style={{ paddingBottom: 'max(10px, env(safe-area-inset-bottom))' }}
      role="group"
      aria-label="Number pad"
    >
      {/* Value read-out — shows what the pad is currently editing. */}
      <div className="flex items-baseline justify-between px-4 pt-3 pb-2">
        {label ? (
          <span className="text-[11px] font-mono uppercase tracking-widest text-text-faint truncate max-w-[60%]">
            {label}
          </span>
        ) : (
          <span />
        )}
        <span className="text-[26px] font-bold font-mono tabular-nums text-text min-h-[32px]">
          {/* Empty shows a faint dash so the field reads as "blank", not "0". */}
          {value === '' ? <span className="text-text-faint">—</span> : value}
        </span>
      </div>

      {/* 3×4 grid: 1-9, then [backspace][0][Next]. */}
      <div className="grid grid-cols-3 gap-1.5 px-2 pb-2">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => pressDigit(k)}
            className="min-h-[52px] rounded-xl bg-bg-elevated border border-border text-text text-[20px] font-semibold active:bg-bg transition-colors"
            aria-label={k}
          >
            {k}
          </button>
        ))}

        {/* Backspace */}
        <button
          type="button"
          onClick={pressBackspace}
          disabled={value === ''}
          className="min-h-[52px] rounded-xl bg-bg-elevated border border-border text-text-dim text-[18px] font-semibold active:bg-bg transition-colors disabled:opacity-30"
          aria-label="Backspace"
        >
          ⌫
        </button>

        {/* 0 */}
        <button
          type="button"
          onClick={() => pressDigit('0')}
          className="min-h-[52px] rounded-xl bg-bg-elevated border border-border text-text text-[20px] font-semibold active:bg-bg transition-colors"
          aria-label="0"
        >
          0
        </button>

        {/* Next — commit + advance is the consumer's responsibility (onNext). */}
        {onNext ? (
          <button
            type="button"
            onClick={onNext}
            className="min-h-[52px] rounded-xl bg-accent text-bg text-[16px] font-bold active:scale-[0.98] transition-transform"
            aria-label="Next"
          >
            Next
          </button>
        ) : (
          <div aria-hidden className="min-h-[52px]" />
        )}
      </div>
    </div>
  )
}

export { NUMBER_PAD_HEIGHT_PX }

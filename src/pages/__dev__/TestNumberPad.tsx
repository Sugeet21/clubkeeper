// DEV-ONLY harness for the generic <NumberPad> (#173 Chunk 1).
// Route: /__dev/test-number-pad  (gated by import.meta.env.DEV in App.tsx —
// never served in production). Purpose: prove on a REAL phone that
//   1. tapping a qty field NEVER opens the device keyboard (readOnly + inputMode="none"),
//   2. fields start EMPTY; typing 3 → "3" not "30"; backspace clears to empty not "0",
//   3. the pad is docked and the list above it is never covered.
// This is a throwaway test surface, not the feature. The real screen is Chunk 3.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { NumberPad, NUMBER_PAD_HEIGHT_PX } from '../../components/NumberPad'

// Deliberately near-identical / long names to also eyeball R3 wrapping later.
const ROWS = [
  'Marlbro Light',
  'marlbro Hard cig',
  'Marlboro Double btn cig',
  'Sprite',
  'Sprite-Mint',
  'Pani Bottle',
  'Choti Pani Bottle',
  'Coca-Cola',
  'Gold Flake btn cig',
  'Gold Flake Normal cig',
  'Red Bull',
  'Monster',
]

export default function TestNumberPad() {
  const navigate = useNavigate()
  const [values, setValues] = useState<Record<number, string>>({})
  const [selected, setSelected] = useState<number>(0)

  function setVal(i: number, next: string) {
    setValues((v) => ({ ...v, [i]: next }))
  }

  return (
    <div className="min-h-screen bg-bg text-text">
      <div className="px-4 pt-4 pb-2 flex items-center gap-2">
        <button onClick={() => navigate(-1)} className="text-text-dim text-sm min-h-[44px]">
          ← Back
        </button>
        <h1 className="text-[16px] font-bold">DEV — NumberPad harness</h1>
      </div>
      <p className="px-4 text-[12px] text-text-faint mb-2">
        Tap a row → type on the pad. The OS keyboard must NEVER appear. Empty shows “—”, not 0.
      </p>

      {/* List — padded at the bottom so the last row clears the docked pad (R1). */}
      <div style={{ paddingBottom: NUMBER_PAD_HEIGHT_PX }}>
        {ROWS.map((name, i) => {
          const v = values[i] ?? ''
          const isSel = i === selected
          return (
            <button
              key={i}
              type="button"
              onClick={() => setSelected(i)}
              className={
                'w-full flex items-center gap-3 px-4 py-3 border-b border-border text-left transition-colors ' +
                (isSel ? 'bg-accent/10' : 'active:bg-bg-card')
              }
            >
              <span className="text-[11px] font-mono text-text-faint w-6 shrink-0">{i + 1}</span>
              <span className="flex-1 text-[15px] leading-snug break-words">{name}</span>
              {/* The qty field: readOnly + inputMode="none" → tapping never opens the
                  OS keyboard. It only DISPLAYS the value the pad drives. */}
              <input
                readOnly
                inputMode="none"
                value={v}
                placeholder="—"
                className="w-16 text-right bg-bg border border-border rounded-lg px-2 py-1.5 text-[15px] font-mono tabular-nums text-text placeholder:text-text-faint pointer-events-none"
                aria-label={`Quantity for ${name}`}
              />
            </button>
          )
        })}
      </div>

      <NumberPad
        value={values[selected] ?? ''}
        onChange={(next) => setVal(selected, next)}
        onNext={() => setSelected((s) => Math.min(s + 1, ROWS.length - 1))}
        label={ROWS[selected]}
      />
    </div>
  )
}

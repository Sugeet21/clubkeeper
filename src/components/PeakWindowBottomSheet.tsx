import { useEffect, useState } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'

interface PeakWindowBottomSheetProps {
  open: boolean
  initialStartHour: number
  initialStartMinute: number
  initialEndHour: number
  initialEndMinute: number
  onCancel: () => void
  onSave: (input: {
    startHour: number
    startMinute: number
    endHour: number
    endMinute: number
  }) => void
}

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]

function format12(h: number, m: number): string {
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  const mm = m.toString().padStart(2, '0')
  return `${h12}:${mm} ${period}`
}

function totalMinutes(h: number, m: number): number {
  return h * 60 + m
}

export function PeakWindowBottomSheet({
  open,
  initialStartHour,
  initialStartMinute,
  initialEndHour,
  initialEndMinute,
  onCancel,
  onSave,
}: PeakWindowBottomSheetProps) {
  const [startH, setStartH] = useState(initialStartHour)
  const [startM, setStartM] = useState(initialStartMinute)
  const [endH, setEndH] = useState(initialEndHour)
  const [endM, setEndM] = useState(initialEndMinute)

  useEffect(() => {
    if (!open) return
    setStartH(initialStartHour)
    setStartM(initialStartMinute)
    setEndH(initialEndHour)
    setEndM(initialEndMinute)
  }, [open, initialStartHour, initialStartMinute, initialEndHour, initialEndMinute])

  // Lock body scroll while open (#177 — shared reference-counted lock).
  useBodyScrollLock(open)

  if (!open) return null

  const startTotal = totalMinutes(startH, startM)
  const endTotal = totalMinutes(endH, endM)
  const sameTime = startTotal === endTotal
  const crossesMidnight = startTotal > endTotal
  const durationMin = sameTime
    ? 0
    : crossesMidnight
      ? 24 * 60 - startTotal + endTotal
      : endTotal - startTotal
  const durationH = Math.floor(durationMin / 60)
  const durationM = durationMin % 60
  const canSave = !sameTime

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/60"
        onClick={onCancel}
      />
      <div
        className="fixed bottom-0 left-0 right-0 z-[70] bg-bg-card rounded-t-3xl border-t border-border max-h-[92vh] flex flex-col"
        style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
      >
        {/* Header */}
        <div className="shrink-0 px-5 pt-5 pb-3 border-b border-border">
          <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint">
            Peak hours
          </p>
          <p className="text-text text-base font-semibold mt-0.5">
            Set the time window
          </p>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-5">
          {/* Start */}
          <div>
            <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint">
              Start time
            </label>
            <div className="flex gap-2 mt-1.5">
              <select
                value={startH}
                onChange={(e) => setStartH(Number(e.target.value))}
                aria-label="Start hour"
                className="flex-1 min-h-[44px] px-3 bg-bg border border-border rounded-xl text-text text-[15px] font-mono tabular-nums focus:border-accent outline-none"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {format12(h, 0).replace(':00 ', ' ')}
                  </option>
                ))}
              </select>
              <select
                value={startM}
                onChange={(e) => setStartM(Number(e.target.value))}
                aria-label="Start minute"
                className="flex-1 min-h-[44px] px-3 bg-bg border border-border rounded-xl text-text text-[15px] font-mono tabular-nums focus:border-accent outline-none"
              >
                {MINUTES.map((m) => (
                  <option key={m} value={m}>
                    :{m.toString().padStart(2, '0')}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[12px] text-text-dim mt-1.5 font-mono tabular-nums">
              {format12(startH, startM)}
            </p>
          </div>

          {/* End */}
          <div>
            <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint">
              End time
            </label>
            <div className="flex gap-2 mt-1.5">
              <select
                value={endH}
                onChange={(e) => setEndH(Number(e.target.value))}
                aria-label="End hour"
                className="flex-1 min-h-[44px] px-3 bg-bg border border-border rounded-xl text-text text-[15px] font-mono tabular-nums focus:border-accent outline-none"
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {format12(h, 0).replace(':00 ', ' ')}
                  </option>
                ))}
              </select>
              <select
                value={endM}
                onChange={(e) => setEndM(Number(e.target.value))}
                aria-label="End minute"
                className="flex-1 min-h-[44px] px-3 bg-bg border border-border rounded-xl text-text text-[15px] font-mono tabular-nums focus:border-accent outline-none"
              >
                {MINUTES.map((m) => (
                  <option key={m} value={m}>
                    :{m.toString().padStart(2, '0')}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[12px] text-text-dim mt-1.5 font-mono tabular-nums">
              {format12(endH, endM)}
            </p>
          </div>

          {/* Preview */}
          <div className="bg-bg border border-border rounded-2xl px-4 py-3 space-y-1">
            <p className="text-[11px] text-text-faint">Peak window</p>
            <p className="text-[15px] text-text font-mono tabular-nums">
              {format12(startH, startM)} → {format12(endH, endM)}
            </p>
            {sameTime ? (
              <p className="text-[12px] text-busy">Start and end can't be the same time.</p>
            ) : (
              <p className="text-[12px] text-text-dim">
                {durationH > 0 && `${durationH}h `}
                {durationM > 0 && `${durationM}m`}
                {crossesMidnight && ' · crosses midnight'}
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-5 pt-3 border-t border-border flex flex-col gap-2">
          <button
            onClick={() =>
              onSave({ startHour: startH, startMinute: startM, endHour: endH, endMinute: endM })
            }
            disabled={!canSave}
            className={
              canSave
                ? 'w-full bg-accent text-bg font-bold py-4 rounded-2xl min-h-[48px]'
                : 'w-full bg-bg text-text-faint border border-border font-semibold py-4 rounded-2xl min-h-[48px] opacity-50 cursor-not-allowed'
            }
          >
            Save
          </button>
          <button
            onClick={onCancel}
            className="w-full bg-bg-card text-text-dim border border-border py-3 rounded-2xl min-h-[44px]"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  )
}

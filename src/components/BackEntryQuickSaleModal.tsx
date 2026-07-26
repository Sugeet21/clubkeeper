import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { Modal } from './Modal'
import { CanteenItemPicker } from './CanteenItemPicker'
import { createCanteenSale, CanteenSaleStockError, CanteenSaleInvalidError } from '../db/queries'
import { getPeakConfig } from '../lib/peakPricing'
import { businessDayOf } from '../lib/time'
import { useSettings } from '../hooks/useLiveData'
import { useDexieSetting } from '../hooks/useDexieSetting'
import { useToastStore } from '../store/toastStore'
import { db } from '../db/database'
import type { CanteenItem } from '../types'

// ─── Back-dated walk-in Quick Sale (#182) ─────────────────────────────────────
// Log a forgotten past walk-in canteen sale. Mirrors BackEntryModal (date+time
// picker) but writes a `canteenSales` row via createCanteenSale({ createdAt }),
// NOT a session. Payment is Cash + UPI only (owner decision 26 Jul) — no wallet
// debit / customer link, which keeps a retroactive backfill safe. The chosen
// date+time drives the sale's business-day bucketing (#179).

interface BackEntryQuickSaleModalProps {
  open: boolean
  onClose: () => void
  onSaved: (dateISO: string) => void
}

interface CartLine {
  item: CanteenItem
  quantity: number
  price: number // captured at add-time (defaultPrice; peak irrelevant for a past sale)
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-mono uppercase tracking-widest text-text-faint mb-1.5">
        {label}
      </label>
      {children}
    </div>
  )
}

export function BackEntryQuickSaleModal({ open, onClose, onSaved }: BackEntryQuickSaleModalProps) {
  const settings = useSettings()
  const [boundaryHour] = useDexieSetting('dayBoundaryHour', 0) // #179 (for the business-day hint)
  const showToast = useToastStore((s) => s.show)

  // Active canteen items — .filter(isActive === true), NOT .where('isActive').equals(1) (Pattern D9)
  const canteenItems = useLiveQuery(
    () => db.canteenItems.orderBy('sortOrder').filter((c) => c.isActive === true).toArray(),
    [],
    [] as CanteenItem[],
  ) ?? []

  const today = format(new Date(), 'yyyy-MM-dd')
  const nowTime = format(new Date(), 'HH:mm')

  const [dateStr, setDateStr] = useState(today)
  const [timeStr, setTimeStr] = useState(nowTime)
  // Cart keyed on canteenItemId (a walk-in sale line REQUIRES a real item id —
  // createCanteenSale rejects a non-UUID line, unlike back-entry sessions).
  const [cart, setCart] = useState<Map<string, CartLine>>(new Map())
  // Payment split — Cash + UPI only. Empty string = 0 while typing.
  const [cashStr, setCashStr] = useState('')
  const [upiStr, setUpiStr] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Peak config is inert here (usePeakPricing=false) but the shared picker needs it.
  const peakCfg = useMemo(() => getPeakConfig(settings), [settings])
  const peakNow = useMemo(() => new Date(), [])

  const currency = settings?.currency ?? '₹'

  const cartLines = useMemo(() => [...cart.values()], [cart])
  const subtotal = useMemo(
    () => cartLines.reduce((s, l) => s + l.price * l.quantity, 0),
    [cartLines],
  )

  const cash = cashStr === '' ? 0 : Number(cashStr)
  const upi = upiStr === '' ? 0 : Number(upiStr)
  const splitSum = cash + upi

  // Convert date+time strings to Unix ms (or null if incomplete).
  function toMs(date: string, time: string): number | null {
    if (!date || !time) return null
    const [y, mo, d] = date.split('-').map(Number)
    const [h, mi] = time.split(':').map(Number)
    if ([y, mo, d, h, mi].some((n) => isNaN(n))) return null
    return new Date(y, (mo as number) - 1, d as number, h as number, mi as number, 0, 0).getTime()
  }

  const createdAt = toMs(dateStr, timeStr)

  // Business-day the sale will land under (#179) — reassures the owner when the
  // boundary hour shifts a late-night sale into the previous day.
  const bizDayLabel =
    createdAt !== null ? format(businessDayOf(new Date(createdAt), boundaryHour), 'EEE, d MMM yyyy') : null

  function reset() {
    setDateStr(today)
    setTimeStr(nowTime)
    setCart(new Map())
    setCashStr('')
    setUpiStr('')
    setSaving(false)
    setError(null)
  }

  function handleClose() {
    reset()
    onClose()
  }

  function handleTap(ci: CanteenItem) {
    const outOfStock = ci.stockEnabled && (ci.currentStock ?? 0) <= 0
    if (outOfStock) return
    setCart((prev) => {
      const next = new Map(prev)
      const existing = next.get(ci.id!)
      if (existing) {
        next.set(ci.id!, { ...existing, quantity: Math.min(99, existing.quantity + 1) })
      } else {
        next.set(ci.id!, { item: ci, quantity: 1, price: ci.defaultPrice })
      }
      return next
    })
    setError(null)
  }

  function changeQty(itemId: string, delta: number) {
    setCart((prev) => {
      const next = new Map(prev)
      const line = next.get(itemId)
      if (!line) return prev
      const q = line.quantity + delta
      if (q < 1) next.delete(itemId)
      else next.set(itemId, { ...line, quantity: Math.min(99, q) })
      return next
    })
  }

  // Fill the remaining amount into whichever field the owner taps "rest".
  function fillRest(target: 'cash' | 'upi') {
    const other = target === 'cash' ? upi : cash
    const rest = Math.max(0, subtotal - other)
    if (target === 'cash') setCashStr(String(rest))
    else setUpiStr(String(rest))
    setError(null)
  }

  const canSave =
    cartLines.length > 0 &&
    createdAt !== null &&
    createdAt <= Date.now() && // #182 — max={today} blocks future dates, not a future time today
    splitSum === subtotal &&
    Number.isInteger(cash) && cash >= 0 &&
    Number.isInteger(upi) && upi >= 0 &&
    !saving

  async function handleSave() {
    setError(null)
    if (cartLines.length === 0) { setError('Add at least one item.'); return }
    if (createdAt === null) { setError('Pick a date and time.'); return }
    if (createdAt > Date.now()) { setError('A past sale cannot be in the future.'); return }
    if (splitSum !== subtotal) {
      setError(`Cash + UPI (${currency}${splitSum.toLocaleString('en-IN')}) must equal the total ${currency}${subtotal.toLocaleString('en-IN')}.`)
      return
    }
    setSaving(true)
    try {
      await createCanteenSale({
        items: cartLines.map((l) => ({
          canteenItemId: l.item.id!,
          name: l.item.name,
          price: l.price,
          quantity: l.quantity,
        })),
        paymentBreakdown: { cash, upi, wallet: 0 },
        createdAt,
      })
      showToast(`Past sale ${currency}${subtotal.toLocaleString('en-IN')} logged`, 'success')
      // #182/#179 — hand back the BUSINESS-day date (not the raw calendar date):
      // History's range is interpreted as business days, so an after-midnight
      // sale with boundaryHour>0 buckets under the previous day. Passing dateStr
      // would snap the range to a window that excludes the sale (looks failed).
      const savedBizDate = format(businessDayOf(new Date(createdAt), boundaryHour), 'yyyy-MM-dd')
      reset()
      onSaved(savedBizDate)
    } catch (e) {
      if (e instanceof CanteenSaleStockError) {
        setError(`${e.itemName}: only ${e.available} in stock`)
      } else if (e instanceof CanteenSaleInvalidError) {
        setError(e.message)
      } else {
        setError('Could not log the sale. Please try again.')
      }
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Log a past walk-in sale">
      <div className="space-y-4">
        {/* Date + time — side by side */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input
              type="date"
              value={dateStr}
              max={today}
              onChange={(e) => { if (e.target.value) { setDateStr(e.target.value); setError(null) } }}
              className="w-full px-4 py-3 bg-bg border border-border rounded-xl text-text font-mono text-[15px] focus:border-accent outline-none cursor-pointer [color-scheme:dark]"
            />
          </Field>
          <Field label="Time">
            <input
              type="time"
              value={timeStr}
              onChange={(e) => { setTimeStr(e.target.value); setError(null) }}
              className="w-full px-4 py-3 bg-bg border border-border rounded-xl text-text font-mono text-[15px] focus:border-accent outline-none cursor-pointer [color-scheme:dark]"
            />
          </Field>
        </div>

        {/* #179 — which business day this lands under (helpful when boundary > 0). */}
        {bizDayLabel && (
          <p className="text-[12px] text-text-faint -mt-1">Counts toward: {bizDayLabel}</p>
        )}

        {/* ── Items ─────────────────────────────────────────────────────────── */}
        <div>
          <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-3">Items</p>
          {canteenItems.length === 0 ? (
            <p className="text-[13px] text-text-faint">No canteen items yet. Add items in Canteen first.</p>
          ) : (
            <div className="mb-3">
              <CanteenItemPicker
                items={canteenItems}
                onSelect={handleTap}
                getBadgeCount={(ci) => cart.get(ci.id!)?.quantity ?? 0}
                peakNow={peakNow}
                peakCfg={peakCfg}
                usePeakPricing={false}
                showStock
                disabled={saving}
              />
            </div>
          )}

          {/* Cart lines with +/- steppers */}
          {cartLines.length > 0 && (
            <div className="space-y-2">
              {cartLines.map((l) => (
                <div key={l.item.id} className="flex items-center gap-2 bg-bg-card border border-border rounded-2xl px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-text truncate">{l.item.name}</p>
                    <p className="text-[11px] text-text-faint tabular-nums">
                      {currency}{l.price.toLocaleString('en-IN')} × {l.quantity} = {currency}{(l.price * l.quantity).toLocaleString('en-IN')}
                    </p>
                  </div>
                  <button
                    onClick={() => changeQty(l.item.id!, -1)}
                    disabled={saving}
                    className="min-w-[36px] min-h-[36px] flex items-center justify-center bg-bg border border-border rounded-lg text-text text-[18px] font-bold disabled:opacity-40"
                    aria-label="Decrease"
                  >
                    −
                  </button>
                  <span className="w-6 text-center text-[15px] font-bold text-text tabular-nums">{l.quantity}</span>
                  <button
                    onClick={() => changeQty(l.item.id!, 1)}
                    disabled={saving}
                    className="min-w-[36px] min-h-[36px] flex items-center justify-center bg-bg border border-border rounded-lg text-text text-[18px] font-bold disabled:opacity-40"
                    aria-label="Increase"
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Payment split (Cash + UPI only) ───────────────────────────────── */}
        {cartLines.length > 0 && (
          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Payment</p>
              <p className="text-[14px] font-bold text-text tabular-nums">Total {currency}{subtotal.toLocaleString('en-IN')}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cash">
                <div className="relative">
                  <input
                    type="number"
                    inputMode="numeric"
                    value={cashStr}
                    onChange={(e) => { setCashStr(e.target.value); setError(null) }}
                    placeholder="0"
                    className="w-full px-4 py-3 bg-bg border border-border rounded-xl text-text font-mono text-[15px] focus:border-accent outline-none"
                  />
                  <button
                    onClick={() => fillRest('cash')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-accent font-semibold px-2 py-1"
                  >
                    rest
                  </button>
                </div>
              </Field>
              <Field label="UPI">
                <div className="relative">
                  <input
                    type="number"
                    inputMode="numeric"
                    value={upiStr}
                    onChange={(e) => { setUpiStr(e.target.value); setError(null) }}
                    placeholder="0"
                    className="w-full px-4 py-3 bg-bg border border-border rounded-xl text-text font-mono text-[15px] focus:border-accent outline-none"
                  />
                  <button
                    onClick={() => fillRest('upi')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-accent font-semibold px-2 py-1"
                  >
                    rest
                  </button>
                </div>
              </Field>
            </div>
            {splitSum !== subtotal && (
              <p className="text-[12px] text-text-faint">
                Cash + UPI = {currency}{splitSum.toLocaleString('en-IN')} · needs to equal {currency}{subtotal.toLocaleString('en-IN')}
              </p>
            )}
          </div>
        )}

        {error && <p className="text-[13px] text-busy">{error}</p>}

        <button
          onClick={handleSave}
          disabled={!canSave}
          className="w-full min-h-[48px] bg-accent text-bg font-bold rounded-2xl text-[15px] active:scale-[0.99] transition-transform disabled:opacity-40"
        >
          {saving ? 'Logging…' : 'Log past sale'}
        </button>
      </div>
    </Modal>
  )
}

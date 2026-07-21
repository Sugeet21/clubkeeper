import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getCanteenItems, createCanteenSale, CanteenSaleStockError } from '../db/queries'
import { normalizeName } from '../lib/canteenMatch'
import { useToastStore } from '../store/toastStore'
import { PaymentSplitSheet } from '../components/PaymentSplitSheet'
import { UpiQrCard } from '../components/UpiQrCard'
import { useSettings } from '../hooks/useLiveData'
import { getEffectivePrice, getPeakConfig, isInPeakWindow } from '../lib/peakPricing'
import type { CanteenItem } from '../types'

interface CartLine {
  canteenItemId: string
  name: string
  price: number
  quantity: number
  stockEnabled: boolean
}

export default function QuickSale() {
  const navigate = useNavigate()
  const showToast = useToastStore((s) => s.show)
  const settings = useSettings()

  const items = useLiveQuery(() => getCanteenItems(false), [])
  // #167 — search box so a walk-in item can be found without scrolling.
  // Reuses normalizeName (Rule L). Empty query = full list.
  const [search, setSearch] = useState('')
  const filteredItems = useMemo(() => {
    if (items === undefined) return undefined
    const q = normalizeName(search)
    if (!q) return items
    return items.filter((it) => normalizeName(it.name).includes(q))
  }, [items, search])
  const [cart, setCart] = useState<Map<string, CartLine>>(new Map())
  const [paymentOpen, setPaymentOpen] = useState(false)
  // After a successful sale with upi > 0, store the UPI amount to show the QR screen.
  const [pendingUpiAmount, setPendingUpiAmount] = useState<number | null>(null)

  // Peak Hour Pricing (#68 Phase 3) — re-evaluate every 60s so chips swap
  // automatically as the window opens/closes. Cart lines locked to the price
  // captured at addToCart time — owner sees what they confirmed, even if the
  // window flips mid-checkout.
  const peakCfg = getPeakConfig(settings)
  const [peakNow, setPeakNow] = useState<Date>(() => new Date())
  useEffect(() => {
    if (!peakCfg.enabled) return
    const id = window.setInterval(() => setPeakNow(new Date()), 60_000)
    return () => window.clearInterval(id)
  }, [peakCfg.enabled])
  const peakActive = isInPeakWindow(peakNow, peakCfg)

  function addToCart(item: CanteenItem) {
    if (item.id === undefined) return
    const stockEnabled = item.stockEnabled === true
    const currentStock = item.currentStock ?? 0
    if (stockEnabled && currentStock <= 0) {
      showToast('Out of stock — restock first')
      return
    }
    const effectivePrice = getEffectivePrice(item, peakNow, peakCfg)
    setCart((prev) => {
      const next = new Map(prev)
      const existing = next.get(item.id!)
      const nextQty = (existing?.quantity ?? 0) + 1
      // Clamp to currentStock when stock tracking is on
      if (stockEnabled && nextQty > currentStock) {
        showToast(`Only ${currentStock} in stock`)
        return prev
      }
      // Existing line keeps its captured price; only new lines pick up current effective price.
      next.set(item.id!, {
        canteenItemId: item.id!,
        name: item.name,
        price: existing?.price ?? effectivePrice,
        quantity: nextQty,
        stockEnabled,
      })
      return next
    })
  }

  function decrementLine(canteenItemId: string) {
    setCart((prev) => {
      const next = new Map(prev)
      const line = next.get(canteenItemId)
      if (!line) return prev
      if (line.quantity <= 1) {
        next.delete(canteenItemId)
      } else {
        next.set(canteenItemId, { ...line, quantity: line.quantity - 1 })
      }
      return next
    })
  }

  function removeLine(canteenItemId: string) {
    setCart((prev) => {
      const next = new Map(prev)
      next.delete(canteenItemId)
      return next
    })
  }

  const cartLines = useMemo(() => [...cart.values()], [cart])
  const subtotal = useMemo(
    () => cartLines.reduce((sum, l) => sum + l.price * l.quantity, 0),
    [cartLines],
  )
  const totalItemCount = cartLines.reduce((s, l) => s + l.quantity, 0)
  const headline = `Quick Sale · ${totalItemCount} item${totalItemCount === 1 ? '' : 's'}`

  async function handleConfirmPayment(
    breakdown: { cash: number; upi: number; wallet: number },
    customerId: string | null,
  ) {
    try {
      await createCanteenSale({
        items: cartLines.map((l) => ({
          canteenItemId: l.canteenItemId,
          name: l.name,
          price: l.price,
          quantity: l.quantity,
        })),
        paymentBreakdown: breakdown,
        customerId: customerId ?? undefined,
      })
      setPaymentOpen(false)
      if (breakdown.upi > 0) {
        // Show UPI QR for the UPI portion only — not the full subtotal.
        setPendingUpiAmount(breakdown.upi)
      } else {
        showToast(`Sale ₹${subtotal.toLocaleString('en-IN')} recorded`)
        navigate('/tables', { replace: true })
      }
    } catch (e) {
      if (e instanceof CanteenSaleStockError) {
        showToast(`${e.itemName}: only ${e.available} in stock`)
        // Re-throw so the sheet shows the error inline too
        throw e
      }
      throw e
    }
  }

  function handleUpiDone() {
    showToast(`Sale ₹${subtotal.toLocaleString('en-IN')} recorded`)
    navigate('/tables', { replace: true })
  }

  // UPI QR screen — shown after a successful sale when upi > 0.
  // Fixed-viewport layout mirrors SessionDetail's post-stop QR screen.
  if (pendingUpiAmount !== null) {
    const upiId = settings?.upiId?.trim()
    const clubName = settings?.clubName || 'ClubKeeper'
    return (
      <div className="fixed inset-0 z-50 bg-bg flex flex-col px-5" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))', paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>
        <header className="flex flex-col items-center gap-1 shrink-0 pt-2">
          <div className="flex items-center gap-2 text-accent">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span className="text-sm font-semibold uppercase tracking-widest">Collect UPI payment</span>
          </div>
          <div className="text-text-dim text-xs">Quick Sale</div>
        </header>
        <main className="flex-1 flex flex-col items-center justify-center min-h-0 gap-4">
          {upiId ? (
            <>
              <UpiQrCard
                upiId={upiId}
                payeeName={clubName}
                amount={pendingUpiAmount}
                transactionNote="Quick Sale"
              />
              <div className="flex flex-col items-center gap-1">
                <div className="text-3xl font-mono font-bold text-text tabular-nums">₹{pendingUpiAmount.toLocaleString('en-IN')}</div>
                <div className="text-xs text-text-dim">UPI portion — scan to pay</div>
              </div>
            </>
          ) : (
            <div className="bg-bg-card border border-border rounded-2xl p-8 flex flex-col items-center gap-2 w-full max-w-xs">
              <div className="text-3xl font-mono font-bold text-text tabular-nums">₹{pendingUpiAmount.toLocaleString('en-IN')}</div>
              <div className="text-text-dim text-sm">UPI portion to collect</div>
              <p className="text-text-faint text-xs text-center mt-1">Add your UPI ID in Settings to show a QR here.</p>
            </div>
          )}
        </main>
        <footer className="shrink-0 flex flex-col gap-3 pt-2">
          {upiId && (
            <p className="text-xs text-text-faint text-center">Works with GPay, PhonePe, Paytm, BHIM</p>
          )}
          <button
            onClick={handleUpiDone}
            className="w-full min-h-[48px] rounded-xl bg-accent text-bg font-semibold text-base active:scale-[0.98] transition-transform"
          >
            Done — back to tables
          </button>
        </footer>
      </div>
    )
  }

  return (
    <div className="bg-bg min-h-screen flex flex-col">
      {/* Desktop container — caps content at 1400px and centers it.
          Mobile (<768px) unaffected. The sticky bottom bar lives OUTSIDE
          this wrapper so it spans the full viewport width on every breakpoint. */}
      <div className="w-full max-w-[1400px] mx-auto">
      {/* Header */}
      <div
        className="px-5 pt-4 pb-3 flex items-center gap-3"
        style={{ paddingTop: 'max(16px, env(safe-area-inset-top))' }}
      >
        <button
          onClick={() => navigate(-1)}
          className="min-w-[44px] min-h-[44px] -ml-2 flex items-center justify-center text-text-dim"
          aria-label="Back"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div>
          <h1 className="text-[22px] font-bold text-text leading-tight">Quick Sale</h1>
          <p className="text-text-faint text-xs mt-0.5">Walk-in canteen — no table</p>
        </div>
      </div>

      {/* Items list */}
      <div className="px-5 pb-2">
        <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint mb-2">
          Items
        </p>
        {/* Search box (#167) — only worth showing once the list is long enough
            to scroll (matches AddItemBottomSheet's >6 threshold). */}
        {items !== undefined && items.length > 6 && (
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items…"
            aria-label="Search canteen items"
            className="w-full bg-bg-card border border-border rounded-2xl px-4 py-3 mb-2 text-text text-[15px] focus:border-accent focus:outline-none transition-colors min-h-[44px] placeholder:text-text-faint"
          />
        )}
        {items === undefined ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-bg-card border border-border rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="bg-bg-card border border-border rounded-2xl p-6 text-center">
            <p className="text-text-dim text-sm">No canteen items yet.</p>
            <button
              onClick={() => navigate('/canteen')}
              className="mt-2 text-accent text-[13px] font-semibold"
            >
              Manage canteen →
            </button>
          </div>
        ) : filteredItems!.length === 0 ? (
          <p className="text-[13px] text-text-dim py-8 text-center">
            No items match “{search.trim()}”.
          </p>
        ) : (
          <div className="space-y-2 md:space-y-0 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-2">
            {filteredItems!.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                onTap={() => addToCart(item)}
                cartQty={cart.get(item.id!)?.quantity ?? 0}
                peakActive={peakActive}
                effectivePrice={getEffectivePrice(item, peakNow, peakCfg)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Cart */}
      {cartLines.length > 0 && (
        <div className="px-5 mt-4 mb-32">
          <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint mb-2">
            Cart
          </p>
          <div className="space-y-2 md:space-y-0 md:grid md:grid-cols-2 lg:grid-cols-3 md:gap-2">
            {cartLines.map((line) => (
              <div
                key={line.canteenItemId}
                className="flex items-center gap-2 bg-bg-card border border-border rounded-2xl px-4 py-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-text text-[14px] font-semibold truncate">{line.name}</p>
                  <p className="text-text-dim text-xs mt-0.5">
                    {line.quantity} × ₹{line.price.toLocaleString('en-IN')} = ₹{(line.price * line.quantity).toLocaleString('en-IN')}
                  </p>
                </div>
                <button
                  onClick={() => decrementLine(line.canteenItemId)}
                  className="w-9 h-9 flex items-center justify-center bg-bg border border-border rounded-xl text-text-dim"
                  aria-label="Decrease"
                >
                  −
                </button>
                <button
                  onClick={() => removeLine(line.canteenItemId)}
                  className="w-9 h-9 flex items-center justify-center text-text-faint"
                  aria-label="Remove"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {cartLines.length === 0 && (
        <div className="px-5 mt-6">
          <p className="text-text-faint text-xs text-center">
            Tap an item to add it to the cart.
          </p>
        </div>
      )}

      </div>
      {/* /max-w-[1400px] — sticky bottom bar is full-width by design */}

      {/* Sticky bottom bar — band spans full viewport for visual weight,
          but inner content caps at 1400px so subtotal/button align with the
          items list above. */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 bg-bg border-t border-border pt-3"
        style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
      >
        <div className="w-full max-w-[1400px] mx-auto px-5">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint">
              Subtotal
            </p>
            <p className="text-accent font-mono font-bold text-xl tabular-nums">
              ₹{subtotal.toLocaleString('en-IN')}
            </p>
          </div>
          <button
            onClick={() => setPaymentOpen(true)}
            disabled={cartLines.length === 0}
            className={
              cartLines.length > 0
                ? 'w-full bg-accent text-bg font-bold py-4 rounded-2xl min-h-[48px]'
                : 'w-full bg-bg-card text-text-faint border border-border font-semibold py-4 rounded-2xl min-h-[48px] opacity-50 cursor-not-allowed'
            }
          >
            Continue to Payment
          </button>
        </div>
      </div>

      {/* Payment sheet — reuses Phase 2 PaymentSplitSheet */}
      <PaymentSplitSheet
        open={paymentOpen}
        total={subtotal}
        headline={headline}
        onCancel={() => setPaymentOpen(false)}
        onConfirm={handleConfirmPayment}
      />
    </div>
  )
}

// ── ItemCard ────────────────────────────────────────────────────────────────

function ItemCard({
  item,
  onTap,
  cartQty,
  peakActive,
  effectivePrice,
}: {
  item: CanteenItem
  onTap: () => void
  cartQty: number
  peakActive: boolean
  effectivePrice: number
}) {
  const stockEnabled = item.stockEnabled === true
  const stock = item.currentStock ?? 0
  const outOfStock = stockEnabled && stock <= 0
  const showPeakTag = peakActive && typeof item.peakPrice === 'number' && item.peakPrice > 0
  return (
    <button
      onClick={onTap}
      disabled={outOfStock}
      className={
        outOfStock
          ? 'w-full flex items-center gap-3 bg-bg-card border border-border rounded-2xl px-4 py-3 text-left opacity-60 cursor-not-allowed'
          : 'w-full flex items-center gap-3 bg-bg-card border border-border rounded-2xl px-4 py-3 text-left active:scale-[0.99] transition-transform'
      }
    >
      <div className="flex-1 min-w-0">
        <p className="text-text text-[15px] font-semibold truncate">{item.name}</p>
        <p className="text-xs mt-0.5 flex items-center gap-1.5">
          <span className={showPeakTag ? 'text-paused font-bold tabular-nums' : 'text-text-dim tabular-nums'}>
            ₹{effectivePrice.toLocaleString('en-IN')}
          </span>
          {showPeakTag && (
            <span className="text-[9px] font-mono font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-paused/15 text-paused leading-none">
              Peak
            </span>
          )}
        </p>
      </div>
      {stockEnabled && (
        <span
          className={
            outOfStock
              ? 'text-[10px] font-mono font-bold px-2 py-1 rounded-full bg-busy/15 text-busy whitespace-nowrap'
              : 'text-[10px] font-mono px-2 py-1 rounded-full bg-bg text-text-faint whitespace-nowrap'
          }
        >
          {outOfStock ? 'Out of stock' : `${stock} left`}
        </span>
      )}
      {cartQty > 0 && (
        <span className="text-[11px] font-mono font-bold px-2 py-1 rounded-full bg-accent/15 text-accent whitespace-nowrap">
          × {cartQty}
        </span>
      )}
    </button>
  )
}

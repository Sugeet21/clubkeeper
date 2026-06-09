import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { getCanteenItems, createCanteenSale, CanteenSaleStockError } from '../db/queries'
import { useToastStore } from '../store/toastStore'
import { PaymentSplitSheet } from '../components/PaymentSplitSheet'
import type { CanteenItem } from '../types'

interface CartLine {
  canteenItemId: number
  name: string
  price: number
  quantity: number
  stockEnabled: boolean
}

export default function QuickSale() {
  const navigate = useNavigate()
  const showToast = useToastStore((s) => s.show)

  const items = useLiveQuery(() => getCanteenItems(false), [])
  const [cart, setCart] = useState<Map<number, CartLine>>(new Map())
  const [paymentOpen, setPaymentOpen] = useState(false)

  function addToCart(item: CanteenItem) {
    if (item.id === undefined) return
    const stockEnabled = item.stockEnabled === true
    const currentStock = item.currentStock ?? 0
    if (stockEnabled && currentStock <= 0) {
      showToast('Out of stock — restock first')
      return
    }
    setCart((prev) => {
      const next = new Map(prev)
      const existing = next.get(item.id!)
      const nextQty = (existing?.quantity ?? 0) + 1
      // Clamp to currentStock when stock tracking is on
      if (stockEnabled && nextQty > currentStock) {
        showToast(`Only ${currentStock} in stock`)
        return prev
      }
      next.set(item.id!, {
        canteenItemId: item.id!,
        name: item.name,
        price: item.defaultPrice,
        quantity: nextQty,
        stockEnabled,
      })
      return next
    })
  }

  function decrementLine(canteenItemId: number) {
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

  function removeLine(canteenItemId: number) {
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
      showToast(
        `Sale ₹${subtotal.toLocaleString('en-IN')} recorded`,
      )
      navigate('/tables', { replace: true })
    } catch (e) {
      if (e instanceof CanteenSaleStockError) {
        showToast(`${e.itemName}: only ${e.available} in stock`)
        // Re-throw so the sheet shows the error inline too
        throw e
      }
      throw e
    }
  }

  return (
    <div className="bg-bg min-h-screen flex flex-col">
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
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                onTap={() => addToCart(item)}
                cartQty={cart.get(item.id!)?.quantity ?? 0}
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
          <div className="space-y-2">
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

      {/* Sticky bottom bar */}
      <div
        className="fixed bottom-0 left-0 right-0 z-40 bg-bg border-t border-border px-5 pt-3"
        style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom))' }}
      >
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
}: {
  item: CanteenItem
  onTap: () => void
  cartQty: number
}) {
  const stockEnabled = item.stockEnabled === true
  const stock = item.currentStock ?? 0
  const outOfStock = stockEnabled && stock <= 0
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
        <p className="text-text-dim text-xs mt-0.5">₹{item.defaultPrice.toLocaleString('en-IN')}</p>
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

import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { useCustomerStore, recentCustomersQuery } from '../store/customerStore'
import { customerFullLabel } from '../lib/customerDisplay'
import type { Customer } from '../types/customer'

interface PaymentSplitSheetProps {
  open: boolean
  total: number
  headline: string                    // e.g. "Pool 1 · 1h 12m" or "Quick Sale"
  // Optional pre-linked customer (e.g. Quick Sale links one above the cart).
  initialCustomer?: Customer | null
  // Allow inline linking from inside the sheet. Defaults to true.
  allowCustomerLink?: boolean
  // Called whenever the linked customer changes (linked or unlinked).
  onCustomerLinked?: (customer: Customer | null) => void
  // v17 P1e: prepaid booking advance. When > 0:
  //  - Sheet shows an "Advance paid" line in the header (₹ amount).
  //  - Steppers collect the REMAINING balance only (total - prepaidAdvance,
  //    clamped to ≥ 0). When advance ≥ total, the steppers all default to 0
  //    and Confirm is immediately allowed; the parent is responsible for
  //    crediting the surplus to the customer's wallet via
  //    creditBookingAdvanceRemainder before/after confirming.
  prepaidAdvance?: number
  onCancel: () => void
  onConfirm: (
    breakdown: { cash: number; upi: number; wallet: number },
    customerId: string | null,
  ) => Promise<void>
}

/**
 * Three-way split payment capture (cash + UPI + wallet).
 *
 * Invariant: confirm is disabled until cash + upi + wallet === total (exact).
 * Wallet row is only enabled when a customer is linked AND has sufficient
 * balance. Inputs are clamped to integers ≥ 0; wallet input is additionally
 * clamped to min(remaining, walletBalance).
 *
 * The Confirm action does NOT touch the DB itself — the parent's onConfirm
 * receives the breakdown + selected customer (or null) and is responsible
 * for atomic persistence. This keeps the sheet reusable across:
 *   - SessionDetail (recordSessionPaymentBreakdown)
 *   - Quick Sale (Phase 3: createCanteenSale)
 */
export function PaymentSplitSheet({
  open,
  total,
  headline,
  initialCustomer,
  allowCustomerLink = true,
  onCustomerLinked,
  prepaidAdvance = 0,
  onCancel,
  onConfirm,
}: PaymentSplitSheetProps) {
  const [cash, setCash] = useState(0)
  const [upi, setUpi] = useState(0)
  const [wallet, setWallet] = useState(0)
  const [linkedCustomer, setLinkedCustomer] = useState<Customer | null>(
    initialCustomer ?? null,
  )
  const [pickerOpen, setPickerOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset state every time the sheet opens
  useEffect(() => {
    if (!open) return
    setCash(0)
    setUpi(0)
    setWallet(0)
    setLinkedCustomer(initialCustomer ?? null)
    setPickerOpen(false)
    setSubmitting(false)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Lock body scroll while open (#177 — shared reference-counted lock).
  useBodyScrollLock(open)

  const walletAvailable = linkedCustomer?.walletBalance ?? 0
  const walletEnabled = linkedCustomer !== null && walletAvailable > 0
  // Prepaid advance reduces what the customer still owes today. When advance
  // ≥ total, collection target is 0 — confirm is immediately allowed (steppers
  // all stay 0; parent credits the surplus to wallet separately).
  const safePrepaid = Math.max(0, Math.floor(prepaidAdvance))
  const collectionTarget = Math.max(0, total - safePrepaid)
  // SINGLE source of truth for the "does the breakdown match?" check.
  // The Confirm button's `disabled` prop AND the status line BOTH read this.
  const sum = cash + upi + wallet
  const remaining = collectionTarget - sum
  const matches = sum === collectionTarget
  const over = sum > collectionTarget
  // Total is "valid for collection" if either positive remaining OR a prepaid
  // advance covers it entirely. Zero-with-no-advance still falls through to the
  // "No amount to record" guard (caller is expected to short-circuit upstream).
  const totalIsValid = Number.isFinite(total) && (total > 0 || safePrepaid > 0)
  // Confirm is gated on the EXACT same `matches` boolean used by the status line.
  const canConfirm = matches && !submitting && totalIsValid

  // ── Helpers ────────────────────────────────────────────────────────────────
  function clampPositiveInt(value: number): number {
    if (!Number.isFinite(value) || value < 0) return 0
    return Math.floor(value)
  }

  function setField(field: 'cash' | 'upi' | 'wallet', raw: number) {
    setError(null)
    const v = clampPositiveInt(raw)
    if (field === 'cash') setCash(v)
    else if (field === 'upi') setUpi(v)
    else {
      // Wallet is clamped to available balance
      setWallet(Math.min(v, walletAvailable))
    }
  }

  function quickFill(mode: 'cash' | 'upi' | 'half' | 'wallet') {
    setError(null)
    const target = collectionTarget
    if (mode === 'cash') { setCash(target); setUpi(0); setWallet(0); return }
    if (mode === 'upi')  { setCash(0); setUpi(target); setWallet(0); return }
    if (mode === 'half') {
      const half = Math.floor(target / 2)
      setCash(half); setUpi(target - half); setWallet(0); return
    }
    // wallet — cap at availableBalance, send the remainder to cash
    if (mode === 'wallet') {
      const w = Math.min(target, walletAvailable)
      setWallet(w); setCash(target - w); setUpi(0); return
    }
  }

  async function handleConfirm() {
    // Defense in depth — never write a payment whose sum != total. The
    // disabled button is the visual gate; this is the runtime gate.
    if (!canConfirm) return
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm({ cash, upi, wallet }, linkedCustomer?.id ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record payment.')
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <>
      {/* Scrim */}
      <div
        className="fixed inset-0 z-[60] bg-black/60"
        onClick={() => !submitting && onCancel()}
      />
      {/* Sheet — mobile: bottom-anchored slide-up. Desktop (md:+): centered
          dialog capped at 560px, all four corners rounded. Mirrors the
          shared <Modal> desktop pattern shipped in Phase 2 (#91). */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[70] bg-bg-card rounded-t-3xl border-t border-border max-h-[92vh] flex flex-col md:bottom-auto md:left-1/2 md:top-1/2 md:right-auto md:-translate-x-1/2 md:-translate-y-1/2 md:w-[min(560px,calc(100vw-2rem))] md:rounded-3xl md:border md:max-h-[85vh]"
        style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
      >
        {/* Header */}
        <div className="shrink-0 px-5 pt-5 pb-3 border-b border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint">
                Record payment
              </p>
              <p className="text-text text-base font-semibold mt-0.5 truncate">{headline}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint">
                {safePrepaid > 0 ? 'Collect' : 'Total'}
              </p>
              <p className="text-accent font-mono font-bold text-xl tabular-nums">
                ₹{(safePrepaid > 0 ? collectionTarget : total).toLocaleString('en-IN')}
              </p>
              {safePrepaid > 0 && (
                <p className="text-text-faint text-[11px] mt-0.5">
                  Total ₹{total.toLocaleString('en-IN')} − advance ₹{safePrepaid.toLocaleString('en-IN')}
                  {safePrepaid > total && (
                    <span className="block text-free">
                      +₹{(safePrepaid - total).toLocaleString('en-IN')} to wallet
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {/* Guard: bad total (≤ 0 or NaN). No steppers — nothing meaningful
              to collect. Free / zero-amount sessions are handled by the caller
              without ever opening this sheet. */}
          {!totalIsValid && (
            <div className="py-6 text-center">
              <p className="text-busy text-[14px] font-semibold">
                No amount to record
              </p>
              <p className="text-text-faint text-xs mt-1">
                Total is ₹{Number.isFinite(total) ? total : 0}. Close this sheet
                and re-check the bill.
              </p>
            </div>
          )}

          {totalIsValid && (
          <>
          {/* Quick-fill chips */}
          <div className="flex flex-wrap gap-2 mb-4">
            <QuickChip label="Cash only" onClick={() => quickFill('cash')} />
            <QuickChip label="UPI only" onClick={() => quickFill('upi')} />
            <QuickChip label="50/50 Cash + UPI" onClick={() => quickFill('half')} />
            {walletEnabled && (
              <QuickChip label="Wallet only" onClick={() => quickFill('wallet')} />
            )}
          </div>

          {/* Customer link row (top, optional) */}
          {allowCustomerLink && (
            <div className="mb-4">
              {linkedCustomer ? (
                <div className="flex items-center justify-between bg-bg border border-border rounded-2xl px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint">
                      Linked customer
                    </p>
                    <p className="text-text text-[14px] font-semibold truncate">
                      {customerFullLabel(linkedCustomer)}
                    </p>
                    <p className="text-text-dim text-xs mt-0.5">
                      Wallet ₹{linkedCustomer.walletBalance.toLocaleString('en-IN')}
                    </p>
                  </div>
                  <button
                    onClick={() => { setLinkedCustomer(null); setWallet(0); onCustomerLinked?.(null) }}
                    className="text-text-faint text-xs min-h-[36px] px-2"
                  >
                    Unlink
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setPickerOpen(true)}
                  className="w-full min-h-[44px] flex items-center justify-center gap-1.5 bg-bg border border-border rounded-2xl text-text-dim text-[13px] font-semibold"
                >
                  + Link customer (for wallet)
                </button>
              )}
            </div>
          )}

          {/* Three stepper rows */}
          <SplitRow
            label="Cash"
            value={cash}
            onChange={(v) => setField('cash', v)}
            disabled={false}
          />
          <SplitRow
            label="UPI"
            value={upi}
            onChange={(v) => setField('upi', v)}
            disabled={false}
          />
          <SplitRow
            label="Wallet"
            value={wallet}
            onChange={(v) => setField('wallet', v)}
            disabled={!walletEnabled}
            helper={
              !linkedCustomer
                ? 'Link a customer to use wallet'
                : walletAvailable === 0
                ? 'Wallet is empty'
                : `Wallet ₹${walletAvailable.toLocaleString('en-IN')}`
            }
            maxValue={walletAvailable}
          />

          {/* Status line — SINGLE source of truth, exclusive states.
              When an error from the submit attempt is present, it REPLACES
              the status line so the user never sees two contradicting
              messages at once. Editing any field clears the error and
              restores the local match status. */}
          <div className="mt-3 text-center min-h-[20px]">
            {error ? (
              <p className="text-busy text-[13px] font-semibold">{error}</p>
            ) : matches ? (
              <p className="text-free text-sm font-semibold">✓ Matches total</p>
            ) : over ? (
              <p className="text-busy text-sm font-semibold">
                ₹{Math.abs(remaining).toLocaleString('en-IN')} over
              </p>
            ) : (
              <p className="text-paused text-sm font-semibold">
                ₹{remaining.toLocaleString('en-IN')} short
              </p>
            )}
          </div>
          </>
          )}
        </div>

        {/* Footer — Confirm disabled is bound to the SAME `canConfirm` boolean
            that drives the green ✓ status line. Visual muting is explicit
            (not just the disabled pseudo-class) so the button NEVER renders
            bright accent while the breakdown is short/over. */}
        <div className="shrink-0 px-5 pt-3 border-t border-border flex flex-col gap-2">
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            aria-disabled={!canConfirm}
            className={
              canConfirm
                ? 'w-full bg-accent text-bg font-bold py-4 rounded-2xl min-h-[48px]'
                : 'w-full bg-bg text-text-faint border border-border font-semibold py-4 rounded-2xl min-h-[48px] opacity-50 cursor-not-allowed'
            }
          >
            {submitting ? 'Saving…' : 'Confirm payment'}
          </button>
          <button
            onClick={onCancel}
            disabled={submitting}
            className="w-full bg-bg-card text-text-dim border border-border py-3 rounded-2xl min-h-[44px]"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Customer picker */}
      {pickerOpen && (
        <CustomerPickerModal
          onCancel={() => setPickerOpen(false)}
          onPick={(c) => {
            setLinkedCustomer(c)
            setPickerOpen(false)
            onCustomerLinked?.(c)
          }}
        />
      )}
    </>
  )
}

// ── SplitRow ─────────────────────────────────────────────────────────────────

interface SplitRowProps {
  label: string
  value: number
  onChange: (v: number) => void
  disabled: boolean
  helper?: string
  maxValue?: number
}

function SplitRow({ label, value, onChange, disabled, helper, maxValue }: SplitRowProps) {
  const STEP = 10
  return (
    <div className={`mb-3 ${disabled ? 'opacity-50' : ''}`}>
      <div className="flex items-center gap-2">
        <div className="w-16 text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint">
          {label}
        </div>
        <button
          onClick={() => onChange(Math.max(0, value - STEP))}
          disabled={disabled || value <= 0}
          className="w-11 h-11 flex items-center justify-center bg-bg border border-border rounded-xl text-text-dim disabled:opacity-30"
          aria-label={`Decrease ${label}`}
        >
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          value={value === 0 ? '' : value}
          placeholder="0"
          onChange={(e) => {
            const raw = e.target.value === '' ? 0 : Number(e.target.value)
            const next = maxValue !== undefined ? Math.min(raw, maxValue) : raw
            onChange(next)
          }}
          disabled={disabled}
          className="flex-1 min-w-0 px-3 py-3 bg-bg border border-border rounded-xl text-text text-[15px] font-mono text-right tabular-nums focus:border-accent outline-none disabled:bg-bg-card"
        />
        <button
          onClick={() => {
            const next = value + STEP
            const clamped = maxValue !== undefined ? Math.min(next, maxValue) : next
            onChange(clamped)
          }}
          disabled={disabled || (maxValue !== undefined && value >= maxValue)}
          className="w-11 h-11 flex items-center justify-center bg-accent/15 border border-accent/30 rounded-xl text-accent disabled:opacity-30"
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
      {helper && (
        <p className="text-[11px] text-text-faint ml-[72px] mt-1">{helper}</p>
      )}
    </div>
  )
}

// ── QuickChip ────────────────────────────────────────────────────────────────

function QuickChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="h-10 px-4 bg-bg border border-border rounded-full text-text-dim text-[12px] font-semibold"
    >
      {label}
    </button>
  )
}

// ── Customer picker modal (small, search + recent) ───────────────────────────

interface CustomerPickerModalProps {
  onCancel: () => void
  onPick: (c: Customer) => void
}

function CustomerPickerModal({ onCancel, onPick }: CustomerPickerModalProps) {
  const [query, setQuery] = useState('')
  const { searchCustomers } = useCustomerStore()
  const [results, setResults] = useState<Customer[] | null>(null)
  const [searching, setSearching] = useState(false)

  const recent = useLiveQuery(
    // #125 — pulled customers lack lastVisitAt; use the shared resilient query
    // so the session-end wallet picker isn't empty after a cross-device pull.
    () => recentCustomersQuery(10),
    [],
    [] as Customer[],
  )

  useEffect(() => {
    let cancelled = false
    if (!query.trim()) {
      setResults(null)
      return
    }
    setSearching(true)
    searchCustomers(query).then((r) => {
      if (!cancelled) setResults(r)
    }).finally(() => {
      if (!cancelled) setSearching(false)
    })
    return () => { cancelled = true }
  }, [query, searchCustomers])

  const list: Customer[] = useMemo(() => {
    if (results !== null) return results
    return recent ?? []
  }, [results, recent])

  return (
    <>
      <div className="fixed inset-0 z-[80] bg-black/70" onClick={onCancel} />
      <div
        className="fixed bottom-0 left-0 right-0 z-[90] bg-bg-card rounded-t-3xl border-t border-border max-h-[80vh] flex flex-col md:bottom-auto md:left-1/2 md:top-1/2 md:right-auto md:-translate-x-1/2 md:-translate-y-1/2 md:w-[min(520px,calc(100vw-2rem))] md:rounded-3xl md:border md:max-h-[75vh]"
        style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}
      >
        <div className="shrink-0 px-5 pt-5 pb-3 border-b border-border">
          <p className="text-text text-base font-semibold mb-3">Link a customer</p>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            placeholder="Search by name or phone"
            className="w-full px-4 py-3 bg-bg border border-border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint"
          />
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-3">
          {searching && (
            <p className="text-text-faint text-sm text-center py-4">Searching…</p>
          )}
          {!searching && list.length === 0 && (
            <p className="text-text-faint text-sm text-center py-4">
              {query ? 'No matches' : 'No customers yet'}
            </p>
          )}
          <div className="space-y-2">
            {list.map((c) => (
              <button
                key={c.id}
                onClick={() => onPick(c)}
                className="w-full flex items-center justify-between bg-bg border border-border rounded-2xl px-4 py-3 text-left min-h-[56px]"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-text text-[14px] font-semibold truncate">
                    {customerFullLabel(c)}
                  </p>
                  <p className="text-text-dim text-xs mt-0.5">
                    Wallet ₹{c.walletBalance.toLocaleString('en-IN')}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="shrink-0 px-5 pt-3 border-t border-border">
          <button
            onClick={onCancel}
            className="w-full bg-bg text-text-dim border border-border py-3 rounded-2xl min-h-[44px]"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  )
}

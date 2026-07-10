import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { format, startOfWeek, subWeeks } from 'date-fns'
import { db } from '../db/database'
import {
  getPiggyBalance,
  listStockPurchases,
  updatePiggyOpeningBalance,
} from '../db/queries'
import { useToastStore } from '../store/toastStore'
import { Modal } from '../components/Modal'
import { useRole } from '../hooks/useRole'
import type { CanteenItem, StockPurchase } from '../types'

function formatINR(n: number): string {
  return '₹' + n.toLocaleString('en-IN')
}

// D6 role split (§2 matrix: Piggy page is owner-only; Pattern A12 rule 3 —
// whole-page restrictions branch to sibling components, owner byte-identical).
// This is the CONTENT gate; the route guard + nav removal land in D7.
export default function Piggy() {
  const role = useRole()
  if (role === 'staff') return <StaffPiggyNotice />
  return <OwnerPiggy />
}

// Staff view: cash-float figures are owner-only. No balances, no restock
// ledger — just a way back to work.
function StaffPiggyNotice() {
  const navigate = useNavigate()
  return (
    <div className="bg-bg min-h-screen flex flex-col items-center justify-center gap-3 px-5">
      <p className="text-text-dim text-sm">Piggy is available to the owner only.</p>
      <button onClick={() => navigate('/tables')} className="text-accent text-sm font-semibold">
        Back to Tables
      </button>
    </div>
  )
}

function OwnerPiggy() {
  const navigate = useNavigate()
  const showToast = useToastStore((s) => s.show)

  const piggy = useLiveQuery(() => getPiggyBalance(), [])
  const piggyStartedAt = useLiveQuery(
    async () => (await db.settings.get(1))?.piggyStartedAt,
    [],
  )

  // All restocks newest-first
  const restocks = useLiveQuery(() => listStockPurchases(), [], [] as StockPurchase[])
  const canteenItemsAll = useLiveQuery(
    () => db.canteenItems.toArray(),
    [],
    [] as CanteenItem[],
  )
  const itemNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const i of canteenItemsAll) {
      if (i.id !== undefined) m.set(i.id, i.name)
    }
    return m
  }, [canteenItemsAll])

  const piggyRestocks = restocks.filter((r) => r.source === 'piggy')
  const otherRestocks = restocks.filter((r) => r.source === 'other')

  // Cash collected by week (this week / last week / week before)
  const cashByWeek = useLiveQuery(
    async () => {
      const since = (await db.settings.get(1))?.piggyStartedAt ?? 0
      const now = new Date()
      const wk0 = startOfWeek(now, { weekStartsOn: 1 }).getTime()
      const wk1 = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 }).getTime()
      const wk2 = startOfWeek(subWeeks(now, 2), { weekStartsOn: 1 }).getTime()

      const windows: { start: number; end: number; label: string }[] = [
        { start: Math.max(wk0, since), end: Date.now(), label: 'This week' },
        { start: Math.max(wk1, since), end: wk0 - 1, label: 'Last week' },
        { start: Math.max(wk2, since), end: wk1 - 1, label: 'Week before' },
      ]

      const results: { label: string; cash: number }[] = []
      for (const w of windows) {
        if (w.start > w.end) {
          results.push({ label: w.label, cash: 0 })
          continue
        }
        const [sessions, sales, walletCredits] = await Promise.all([
          db.sessions
            .where('endedAt')
            .between(w.start, w.end, true, true)
            .filter(
              (s) => s.status === 'completed' && s.paymentBreakdown !== undefined,
            )
            .toArray(),
          db.canteenSales
            .where('createdAt')
            .between(w.start, w.end, true, true)
            .toArray(),
          db.walletTransactions
            .where('createdAt')
            .between(w.start, w.end, true, true)
            .filter((t) => t.type === 'credit' && t.paymentMode === 'cash')
            .toArray(),
        ])
        const a = sessions.reduce((s, x) => s + (x.paymentBreakdown?.cash ?? 0), 0)
        const b = sales.reduce((s, x) => s + x.paymentBreakdown.cash, 0)
        const c = walletCredits.reduce((s, x) => s + x.amount, 0)
        results.push({ label: w.label, cash: a + b + c })
      }
      return results
    },
    [],
    [] as { label: string; cash: number }[],
  )

  const [editingOpening, setEditingOpening] = useState(false)
  const [openingInput, setOpeningInput] = useState('')
  const [savingOpening, setSavingOpening] = useState(false)

  function openEditOpening() {
    setOpeningInput(String(piggy?.opening ?? 0))
    setEditingOpening(true)
  }

  async function handleSaveOpening() {
    const v = Math.floor(Number(openingInput))
    if (!Number.isFinite(v) || v < 0) {
      showToast('Opening balance must be a non-negative integer.', 'error')
      return
    }
    setSavingOpening(true)
    try {
      await updatePiggyOpeningBalance(v)
      setEditingOpening(false)
      showToast('Opening balance updated', 'success')
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to update', 'error')
    } finally {
      setSavingOpening(false)
    }
  }

  const displayPiggy = Math.max(0, piggy?.current ?? 0)
  const isNegative = (piggy?.current ?? 0) < 0
  const startedLabel = piggyStartedAt
    ? format(new Date(piggyStartedAt), 'd MMM yyyy')
    : '—'

  return (
    <div className="bg-bg min-h-screen pb-24">
      {/* Header */}
      <div
        className="px-5 pt-4 pb-2 flex items-center gap-3"
        style={{ paddingTop: 'max(16px, env(safe-area-inset-top))' }}
      >
        <button
          onClick={() => navigate(-1)}
          className="min-w-[44px] min-h-[44px] -ml-2 flex items-center justify-center text-text-dim"
          aria-label="Back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div>
          <h1 className="text-[20px] font-bold text-text leading-tight">Piggy Bank</h1>
          <p className="text-text-faint text-xs mt-0.5">Cash float</p>
        </div>
      </div>

      {/* Current balance */}
      <div className="px-5 mt-3">
        <div className="bg-bg-card border border-border rounded-2xl p-4">
          <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
            Current
          </p>
          <p className="text-[40px] font-mono font-bold text-text leading-none tabular-nums mt-1">
            {formatINR(displayPiggy)}
          </p>
          {isNegative && (
            <p className="text-paused text-[12px] mt-2">
              Piggy is negative — check the restock log below.
            </p>
          )}
          <div className="mt-3 text-[12px] text-text-faint font-mono space-y-0.5">
            <p>Opening {formatINR(piggy?.opening ?? 0)} · started {startedLabel}</p>
            <p>+ {formatINR(piggy?.cashIn ?? 0)} collected since</p>
            <p>− {formatINR(piggy?.restockOut ?? 0)} spent on stock</p>
          </div>
          <div className="mt-3">
            <button
              onClick={openEditOpening}
              className="h-9 px-3 rounded-xl bg-bg border border-border text-text-dim text-[12px] font-semibold"
            >
              Edit opening balance
            </button>
          </div>
        </div>
      </div>

      {/* Cash collected by week */}
      <div className="px-5 mt-5">
        <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-2">
          Cash collected
        </p>
        <div className="bg-bg-card border border-border rounded-2xl p-4 space-y-2">
          {cashByWeek.map((w) => (
            <div key={w.label} className="flex items-center justify-between">
              <p className="text-text text-[14px]">{w.label}</p>
              <p className="text-text font-mono tabular-nums">{formatINR(w.cash)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Restocks (piggy) */}
      <div className="px-5 mt-5">
        <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-2">
          Restocks (paid from piggy)
        </p>
        <RestockList rows={piggyRestocks} itemNameById={itemNameById} />
      </div>

      {/* Restocks (other) */}
      <div className="px-5 mt-5">
        <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint mb-2">
          Other restocks
        </p>
        <RestockList rows={otherRestocks} itemNameById={itemNameById} />
      </div>

      {/* Edit opening balance modal */}
      <Modal
        open={editingOpening}
        onClose={() => !savingOpening && setEditingOpening(false)}
        title="Edit opening balance"
      >
        <p className="text-text-dim text-sm mb-3">
          The starting amount of cash in the till at the moment piggy tracking began.
        </p>
        <input
          type="number"
          inputMode="numeric"
          value={openingInput}
          onChange={(e) => setOpeningInput(e.target.value)}
          placeholder="0"
          className="w-full px-4 py-3 bg-bg border border-border rounded-xl text-text text-[15px] font-mono text-right tabular-nums focus:border-accent outline-none min-h-[44px]"
        />
        <div className="grid grid-cols-2 gap-3 mt-5">
          <button
            type="button"
            onClick={() => setEditingOpening(false)}
            disabled={savingOpening}
            className="py-3.5 bg-bg-card border border-border text-text rounded-xl text-[14px] font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveOpening}
            disabled={savingOpening}
            className="py-3.5 bg-accent text-bg rounded-xl text-[14px] font-bold disabled:opacity-50"
          >
            {savingOpening ? 'Saving…' : 'Save'}
          </button>
        </div>
      </Modal>
    </div>
  )
}

function RestockList({
  rows,
  itemNameById,
}: {
  rows: StockPurchase[]
  itemNameById: Map<string, string>
}) {
  if (rows.length === 0) {
    return (
      <div className="bg-bg-card border border-border rounded-2xl p-4">
        <p className="text-text-faint text-sm text-center">No restocks yet.</p>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div
          key={r.id}
          className="bg-bg-card border border-border rounded-2xl px-4 py-3 flex items-center gap-3"
        >
          <div className="flex-1 min-w-0">
            <p className="text-text text-[14px] font-semibold truncate">
              {itemNameById.get(r.canteenItemId) ?? `Item #${r.canteenItemId}`}
            </p>
            <p className="text-text-dim text-xs mt-0.5">
              +{r.quantityAdded} · {format(new Date(r.createdAt), 'd MMM, h:mm a')}
            </p>
            {r.notes && (
              <p className="text-text-faint text-[11px] mt-1 truncate">{r.notes}</p>
            )}
          </div>
          <p className="text-text font-mono tabular-nums shrink-0">
            ₹{r.cost.toLocaleString('en-IN')}
          </p>
        </div>
      ))}
    </div>
  )
}

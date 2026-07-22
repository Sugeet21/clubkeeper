// #173 Chunk 3 — Bulk Restock Entry screen (owner-only, offline, RECEIVED/ADD).
//
// Lists stock-tracked canteen items with a printed row number (R3), full names
// wrapped (never truncated — R3), current stock + live "12 → 16" once filled
// (R7). Tapping a row selects it; the docked <NumberPad> drives its qty (R1, no
// OS keyboard). Next commits + advances + scrolls into view (R4). "+ Add new
// item" reuses CanteenItemFormModal (R5). Quantities persist as a draft (R6) but
// NEVER silently pre-fill — an explicit Resume / Start-fresh choice (R6a).
//
// The Confirm summary sheet + double-tap guard is Chunk 4; here Confirm just
// opens a placeholder count. Reverse/history is Chunk 5.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { NumberPad, NUMBER_PAD_HEIGHT_PX } from '../components/NumberPad'
import { CanteenItemFormModal } from '../components/CanteenItemFormModal'
import { BulkRestockConfirmSheet } from '../components/BulkRestockConfirmSheet'
import { saveRestockDraft, clearRestockDraft } from '../lib/restockDraft'
import { listRestockItems } from '../lib/restockItems'
import { downloadRestockSheet } from '../lib/restockSheetPdf'
import { getSettings } from '../db/queries'
import { useToastStore } from '../store/toastStore'
import type { BulkRestockRow, BulkRestockResult } from '../db/queries'
import type { CanteenItem, RestockDraft } from '../types'

const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000 // R6a — older than 24h is discarded
const DRAFT_DEBOUNCE_MS = 400                // R6a — debounce, not per-keystroke

// Parse a qty string to a positive integer, or null if blank/invalid (R2 — blank
// is never zero; blank rows are skipped, never written as qty 0).
function parseQty(v: string): number | null {
  if (v === '') return null
  const n = Number(v)
  if (!Number.isInteger(n) || n <= 0) return null
  return n
}

type Phase = 'loading' | 'choose' | 'entry'

export default function BulkRestock() {
  const navigate = useNavigate()

  // Only stock-tracked items, in sortOrder — the SAME source the printed sheet uses,
  // so screen row N and paper row N are always the same item (R1). Do NOT re-inline the
  // orderBy/filter here; listRestockItems() is the single home for that ordering.
  const items = useLiveQuery(() => listRestockItems(), [])

  const [phase, setPhase] = useState<Phase>('loading')
  const [pendingDraft, setPendingDraft] = useState<RestockDraft | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  // One batchId per confirm attempt. Regenerated each time the sheet opens so a
  // cancel-then-reopen doesn't reuse a stale id.
  const [batchId, setBatchId] = useState('')
  // Guards the "Print blank sheet" button while the PDF is being generated (lazy jspdf
  // import + draw). Double-tap while busy is a no-op.
  const [sheetBusy, setSheetBusy] = useState(false)
  const showToast = useToastStore((s) => s.show)

  // R9 — build a downloadable A4 PDF of the blank sheet. Same items/order/row-numbers as
  // this screen (both use listRestockItems). Owner-only surface (route is RequireOwner).
  async function handlePrintSheet() {
    if (sheetBusy) return
    setSheetBusy(true)
    try {
      const settings = await getSettings()
      const count = await downloadRestockSheet(settings.clubName ?? '', Date.now())
      if (count === 0) {
        showToast('No stock-tracked items to print yet.', 'error')
      } else {
        showToast(`Sheet ready — ${count} ${count === 1 ? 'item' : 'items'}`, 'success')
      }
    } catch {
      showToast('Could not build the sheet. Try again.', 'error')
    } finally {
      setSheetBusy(false)
    }
  }

  // ── R6a: decide draft resume/discard ONCE, on first load. NEVER auto-populate.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const row = await db.restockDrafts.get(1)
      if (cancelled) return
      const stale = !row || Date.now() - row.updatedAt > DRAFT_MAX_AGE_MS
      const hasEntries = row ? Object.values(row.quantities).some((v) => v !== '') : false
      if (stale || !hasEntries) {
        if (row) await clearRestockDraft() // discard stale/empty draft
        setPhase('entry')
        return
      }
      // Recent, non-empty draft → force an explicit choice. Fields stay EMPTY.
      setPendingDraft(row)
      setPhase('choose')
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // Select the first row once items load and we're in entry mode.
  useEffect(() => {
    if (phase === 'entry' && selectedId === null && items && items.length > 0) {
      setSelectedId(items[0].id ?? null)
    }
  }, [phase, selectedId, items])

  // ── R6: debounced draft persistence. Only writes in entry phase.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (phase !== 'entry') return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      void saveRestockDraft(values)
    }, DRAFT_DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [values, phase])

  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})

  // Counts reflect the WHOLE draft, never the filtered view — a filled row that
  // search is currently hiding still counts and still confirms.
  const filledCount = useMemo(
    () => Object.values(values).filter((v) => parseQty(v) !== null).length,
    [values],
  )
  const totalUnits = useMemo(
    () => Object.values(values).reduce((sum, v) => sum + (parseQty(v) ?? 0), 0),
    [values],
  )

  // Display list: search filters DISPLAY ONLY (values map untouched), and filled
  // rows pin to the top so the ~5-6 you've entered stay visible while you search
  // for the next of ~50. Printed row NUMBER stays tied to the item's sortOrder
  // position (R3 — matches the paper sheet), NOT its position in this view.
  const numberByItemId = useMemo(() => {
    const m: Record<string, number> = {}
    if (items) items.forEach((it, i) => { if (it.id) m[it.id] = i + 1 })
    return m
  }, [items])

  const displayItems = useMemo(() => {
    if (!items) return []
    const q = search.trim().toLowerCase()
    const matched = q ? items.filter((it) => it.name.toLowerCase().includes(q)) : items
    const isFilled = (id: string) => parseQty(values[id] ?? '') !== null
    // stable partition: filled first, each partition keeps sortOrder.
    const filled = matched.filter((it) => it.id && isFilled(it.id))
    const rest = matched.filter((it) => !(it.id && isFilled(it.id)))
    return [...filled, ...rest]
  }, [items, search, values])

  // Lookup for the confirm sheet (name + currentStock preview per row).
  const itemsById = useMemo(() => {
    const m: Record<string, CanteenItem> = {}
    if (items) for (const it of items) if (it.id) m[it.id] = it
    return m
  }, [items])

  // The rows to WRITE: every filled row across the WHOLE draft, search-independent
  // (a filled row hidden by the current search still confirms — R8). Only items
  // that still exist + are stock-tracked; a qty for a since-deleted item is dropped.
  const filledRows = useMemo<BulkRestockRow[]>(() => {
    const rows: BulkRestockRow[] = []
    for (const [id, v] of Object.entries(values)) {
      const qty = parseQty(v)
      if (qty === null) continue
      if (!itemsById[id]) continue
      rows.push({ canteenItemId: id, quantityAdded: qty })
    }
    return rows
  }, [values, itemsById])

  function resumeDraft() {
    if (pendingDraft) setValues(pendingDraft.quantities)
    setPendingDraft(null)
    setPhase('entry')
  }
  function startFresh() {
    void clearRestockDraft()
    setPendingDraft(null)
    setValues({})
    setPhase('entry')
  }

  function setQty(id: string, next: string) {
    setValues((v) => ({ ...v, [id]: next }))
  }

  function openConfirm() {
    if (filledRows.length === 0) return
    setBatchId(crypto.randomUUID())
    setConfirmOpen(true)
  }

  function handleConfirmDone(result: BulkRestockResult) {
    setConfirmOpen(false)
    // R6 — draft cleared on successful confirm.
    void clearRestockDraft()
    setValues({})
    setSelectedId(null)
    setSearch('')
    const n = result.applied.length
    if (result.failed.length === 0) {
      showToast(`Restocked ${n} ${n === 1 ? 'item' : 'items'}`, 'success')
    } else {
      // Rest applied; name the ones that failed so nothing is silently lost.
      const names = result.failed
        .map((f) => itemsById[f.canteenItemId]?.name ?? f.canteenItemId)
        .slice(0, 3)
        .join(', ')
      const more = result.failed.length > 3 ? ` +${result.failed.length - 3} more` : ''
      showToast(`Restocked ${n}; ${result.failed.length} failed: ${names}${more}`, 'error')
    }
    // replace:true — the just-completed bulk screen shouldn't sit in history, so
    // Back from Canteen goes to Tables, not back into the finished restock.
    navigate('/canteen', { replace: true })
  }

  function selectAndScroll(id: string | null) {
    setSelectedId(id)
    if (id) {
      // R4 — scroll the newly-selected row above the pad.
      requestAnimationFrame(() => {
        rowRefs.current[id]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      })
    }
  }

  function advance() {
    // R4 — move to the next row in the CURRENT display order (which respects
    // search + filled-pinned-top). Prefer the next UNFILLED row after the current
    // one so "Next" keeps finding work; fall back to the immediate next, then stay.
    if (selectedId === null || displayItems.length === 0) return
    const idx = displayItems.findIndex((it) => it.id === selectedId)
    const after = displayItems.slice(idx + 1)
    const nextUnfilled = after.find((it) => it.id && parseQty(values[it.id] ?? '') === null)
    const next = nextUnfilled ?? after[0] ?? null
    selectAndScroll(next?.id ?? null)
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (phase === 'loading' || items === undefined) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center text-text-faint text-sm">
        Loading…
      </div>
    )
  }

  const selectedItem = items.find((it) => it.id === selectedId) ?? null

  return (
    <div className="min-h-screen bg-bg text-text">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-border">
        {/* Back = navigate(-1) (POP), NOT navigate('/canteen') (PUSH). Pushing a
            route on a back button grows the history stack — Canteen→bulk→"back"
            pushed /canteen again, so the browser Back button ping-ponged
            bulk↔canteen forever and never reached /tables (bug_patterns Routing —
            same class as the settings-section history-push). navigate(-1) returns
            through the entry that brought us here. */}
        <button
          onClick={() => navigate(-1)}
          className="text-text-dim text-sm min-h-[44px] px-1 -ml-1 active:text-text transition-colors"
        >
          ← Canteen
        </button>
        <h1 className="text-[16px] font-bold ml-1">Bulk restock</h1>
        <span className="ml-auto mr-2 text-[12px] text-text-faint font-mono tabular-nums">
          {filledCount} · {totalUnits}u
        </span>
        {/* Confirm opens the summary sheet (R8). Disabled until ≥1 filled row. */}
        <button
          onClick={openConfirm}
          disabled={filledRows.length === 0}
          className={
            filledRows.length === 0
              ? 'text-[13px] font-bold px-3 min-h-[44px] rounded-xl text-text-faint opacity-50 cursor-not-allowed'
              : 'text-[13px] font-bold px-3 min-h-[44px] rounded-xl bg-accent text-bg active:scale-[0.98] transition-transform'
          }
        >
          Review
        </button>
      </div>

      {/* R6a — explicit Resume / Start-fresh. Fields stay empty until Resume. */}
      {phase === 'choose' && pendingDraft && (
        <div className="m-3 rounded-2xl border border-accent/40 bg-accent/10 p-4">
          <p className="text-[14px] text-text font-semibold mb-1">Unsaved draft found</p>
          <p className="text-[12px] text-text-dim mb-3">
            {Object.values(pendingDraft.quantities).filter((v) => v !== '').length} items entered,
            saved {timeAgo(pendingDraft.updatedAt)}.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={resumeDraft}
              className="min-h-[44px] rounded-xl bg-accent text-bg text-[14px] font-bold active:scale-[0.98] transition-transform"
            >
              Resume draft
            </button>
            <button
              onClick={startFresh}
              className="min-h-[44px] rounded-xl bg-bg-card border border-border text-text text-[14px] font-semibold active:bg-bg transition-colors"
            >
              Start fresh
            </button>
          </div>
        </div>
      )}

      {/* Search box — ~50 items but only 5-6 restocked daily, so find fast.
          Filters DISPLAY only; the draft (`values`) is untouched, and filled
          rows still confirm even while hidden. Reuses Canteen's search idiom (#167). */}
      {phase === 'entry' && items.length > 0 && (
        <div className="px-3 pt-2 pb-1 sticky top-0 z-10 bg-bg border-b border-border">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search items…"
            aria-label="Search items to restock"
            className="w-full bg-bg-card border border-border rounded-2xl px-4 py-2.5 text-text text-[15px] focus:border-accent focus:outline-none transition-colors min-h-[44px] placeholder:text-text-faint"
          />
        </div>
      )}

      {/* R9 — download a blank A4 sheet to print (at a shop) and hand-fill. Same items,
          order, and row numbers as this screen. Only meaningful once items exist. */}
      {phase === 'entry' && items.length > 0 && (
        <div className="px-3 pt-2 pb-1">
          <button
            onClick={() => void handlePrintSheet()}
            disabled={sheetBusy}
            className="w-full flex items-center justify-center gap-2 min-h-[44px] rounded-xl bg-bg-card border border-border text-text-dim text-[13px] font-semibold active:bg-bg disabled:opacity-50 transition-colors"
          >
            {sheetBusy ? 'Building sheet…' : '⬇ Print blank sheet (PDF)'}
          </button>
        </div>
      )}

      {/* List — padded so the last row + Add button clear the docked pad (R1). */}
      {phase === 'entry' && (
        <>
          <div style={{ paddingBottom: NUMBER_PAD_HEIGHT_PX }}>
            {items.length === 0 && (
              <p className="px-4 py-8 text-center text-text-faint text-sm">
                No stock-tracked items. Add one below or enable stock tracking on an item.
              </p>
            )}
            {items.length > 0 && displayItems.length === 0 && (
              <p className="px-4 py-8 text-center text-text-faint text-sm">
                No item matches “{search}”. Check the name or add it below.
              </p>
            )}
            {displayItems.map((item) => {
              const id = item.id!
              const v = values[id] ?? ''
              const qty = parseQty(v)
              const isSel = id === selectedId
              const cur = item.currentStock ?? 0
              return (
                <div
                  key={id}
                  ref={(el) => {
                    rowRefs.current[id] = el
                  }}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectAndScroll(id)}
                  className={
                    'w-full flex items-start gap-3 px-4 py-3 border-b border-border text-left transition-colors cursor-pointer ' +
                    (isSel ? 'bg-accent/10' : 'active:bg-bg-card')
                  }
                >
                  {/* R3 — printed row number = the item's sortOrder position (matches
                      the paper sheet), NOT its position in this filtered/pinned view. */}
                  <span className="text-[12px] font-mono text-text-faint w-6 shrink-0 pt-0.5 tabular-nums">
                    {numberByItemId[id] ?? '·'}
                  </span>
                  {/* R3 — full name, wrap to any number of lines, never clip */}
                  <span className="flex-1 min-w-0 text-[15px] leading-snug break-words">
                    {item.name}
                    {/* R7 — current stock + live result once filled */}
                    <span className="block text-[11px] text-text-faint mt-0.5 font-mono tabular-nums">
                      {qty === null ? (
                        <>stock {cur}</>
                      ) : (
                        <>
                          stock {cur} → <span className="text-accent font-bold">{cur + qty}</span>
                        </>
                      )}
                    </span>
                  </span>
                  {/* Qty display — readOnly + inputMode none → never opens OS keyboard */}
                  <input
                    readOnly
                    inputMode="none"
                    value={v}
                    placeholder="—"
                    className="w-16 shrink-0 text-right bg-bg border border-border rounded-lg px-2 py-1.5 text-[15px] font-mono tabular-nums text-text placeholder:text-text-faint pointer-events-none"
                    aria-label={`Quantity for ${item.name}`}
                  />
                </div>
              )
            })}

            {/* R5 — inline new item at the end of the list */}
            <button
              onClick={() => setAddOpen(true)}
              className="w-full flex items-center gap-2 px-4 py-3.5 text-accent text-[14px] font-semibold active:bg-bg-card transition-colors"
            >
              <span className="text-[18px] leading-none">+</span> Add new item
            </button>
          </div>

          {/* Docked pad drives the selected row (R1). Next = commit + advance (R4). */}
          <NumberPad
            value={selectedId ? values[selectedId] ?? '' : ''}
            onChange={(next) => selectedId && setQty(selectedId, next)}
            onNext={advance}
            label={selectedItem?.name}
          />
        </>
      )}

      {/* R5 — reuse the canteen create modal. Draft quantities in `values` are
          React state, untouched by the modal, so they survive the create (R6). */}
      <CanteenItemFormModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        existingItems={items}
      />

      {/* R8 — confirm summary + double-tap-guarded write. Rows = whole draft. */}
      <BulkRestockConfirmSheet
        open={confirmOpen}
        rows={filledRows}
        itemsById={itemsById}
        batchId={batchId}
        onCancel={() => setConfirmOpen(false)}
        onDone={handleConfirmDone}
      />
    </div>
  )
}

// Small relative-time helper for the draft banner (no date-fns dependency here).
function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  return `${hrs} h ago`
}

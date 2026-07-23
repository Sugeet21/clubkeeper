// #176 Chunk 2b — Bulk category tag (owner-only, offline). A ONE-TIME cleanup screen so the
// owner can categorise the whole existing item list in one pass instead of opening the edit
// modal 29 times. Lists every active canteen item (in sortOrder — a stable order for tagging,
// NOT the restock order — this screen is about assigning categories, not restocking), with the
// shared <CategoryPicker> inline on each row. Changes are held in local state; ONE Save at the
// end writes only the rows that changed via updateCanteenItem (which already syncs both ways).
//
// Scope note: this reads through getCanteenItems() (active, sortOrder) purely to display a
// stable list. It does NOT change any ordering. The Canteen sell screen and QuickSale keep
// their sortOrder exactly as-is — nothing here touches getCanteenItems' definition or the sell
// surface. The only ordering that changed in #176 is listRestockItems() (restock sheet), Chunk 1.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { CategoryPicker } from '../components/CategoryPicker'
import { getCanteenItems, updateCanteenItem } from '../db/queries'
import { CATEGORY_ORDER } from '../types'
import { useToastStore } from '../store/toastStore'
import type { CanteenItem, CanteenItemCategory } from '../types'

// Normalise a possibly-out-of-union stored value (lenient pull) to a known category or undefined.
function knownCategory(c: string | null | undefined): CanteenItemCategory | undefined {
  return c != null && c in CATEGORY_ORDER ? (c as CanteenItemCategory) : undefined
}

export default function BulkCategoryTag() {
  const navigate = useNavigate()
  const showToast = useToastStore((s) => s.show)

  // Active items in sortOrder — a stable list to tag down. This is display-only; the sell
  // screen's own use of this ordering is unaffected.
  const items = useLiveQuery(() => getCanteenItems(), [])

  // Working draft of category per item id. Seeded ONCE from stored values, then owned locally
  // until Save (no live re-sync — that would clobber in-progress edits, Rule 14 spirit).
  const [draft, setDraft] = useState<Record<string, CanteenItemCategory | undefined>>({})
  const [seeded, setSeeded] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (seeded || !items) return
    const initial: Record<string, CanteenItemCategory | undefined> = {}
    for (const it of items) if (it.id) initial[it.id] = knownCategory(it.category)
    setDraft(initial)
    setSeeded(true)
  }, [items, seeded])

  // The stored (normalised) category per id — the baseline the draft is compared against.
  const stored = useMemo(() => {
    const m: Record<string, CanteenItemCategory | undefined> = {}
    if (items) for (const it of items) if (it.id) m[it.id] = knownCategory(it.category)
    return m
  }, [items])

  // Rows whose draft category differs from what's stored — the only rows Save writes.
  const dirtyIds = useMemo(() => {
    if (!items) return [] as string[]
    return items
      .filter((it) => it.id && draft[it.id] !== stored[it.id])
      .map((it) => it.id!)
  }, [items, draft, stored])

  const taggedCount = useMemo(
    () => (items ? items.filter((it) => it.id && draft[it.id] !== undefined).length : 0),
    [items, draft],
  )

  function setCategory(id: string, next: CanteenItemCategory | undefined) {
    setDraft((d) => ({ ...d, [id]: next }))
  }

  async function handleSave() {
    if (dirtyIds.length === 0 || saving) return
    setSaving(true)
    try {
      // Sequential, all awaited — no fire-and-forget (Rule 8). Small table (≈30 rows), so the
      // extra round-trips are trivial and keep failures attributable to a single item.
      let written = 0
      for (const id of dirtyIds) {
        // Sending `category: undefined` is the explicit-clear signal updateCanteenItem turns
        // into a NULL; a value tags it. Both go through the same sync-both-ways path.
        await updateCanteenItem(id, { category: draft[id] })
        written++
      }
      showToast(`Saved ${written} ${written === 1 ? 'item' : 'items'}`, 'success')
      // Back to Canteen. replace:true — a finished one-time cleanup shouldn't sit in history.
      navigate('/canteen', { replace: true })
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save. Try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (items === undefined) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center text-text-faint text-sm">
        Loading…
      </div>
    )
  }

  const total = items.length

  return (
    <div className="min-h-screen bg-bg text-text">
      {/* Top bar */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2 border-b border-border sticky top-0 z-10 bg-bg">
        {/* navigate(-1) (POP), not a push — same routing rule as BulkRestock. */}
        <button
          onClick={() => navigate(-1)}
          className="text-text-dim text-sm min-h-[44px] px-1 -ml-1 active:text-text transition-colors"
        >
          ← Canteen
        </button>
        <h1 className="text-[16px] font-bold ml-1">Tag categories</h1>
        <span className="ml-auto mr-2 text-[12px] text-text-faint font-mono tabular-nums">
          {taggedCount}/{total}
        </span>
        <button
          onClick={() => void handleSave()}
          disabled={dirtyIds.length === 0 || saving}
          className={
            dirtyIds.length === 0 || saving
              ? 'text-[13px] font-bold px-3 min-h-[44px] rounded-xl text-text-faint opacity-50 cursor-not-allowed'
              : 'text-[13px] font-bold px-3 min-h-[44px] rounded-xl bg-accent text-bg active:scale-[0.98] transition-transform'
          }
        >
          {saving ? 'Saving…' : dirtyIds.length > 0 ? `Save (${dirtyIds.length})` : 'Save'}
        </button>
      </div>

      {/* Helper line — what this screen is for, so the one-time nature is clear. */}
      <p className="px-4 pt-3 pb-1 text-[12px] text-text-dim">
        Assign a category to each item. Categories group the printed restock sheet (drinks,
        then cigarettes, then snacks). Untagged items print last. Tap a chip again to clear it.
      </p>

      {total === 0 && (
        <p className="px-4 py-10 text-center text-text-faint text-sm">
          No canteen items yet. Add items first, then tag them here.
        </p>
      )}

      {/* One row per item: name + inline chips. Untagged rows get a subtle flag so you can
          see at a glance what you've missed before saving. */}
      <div>
        {items.map((item: CanteenItem) => {
          const id = item.id!
          const value = draft[id]
          const untagged = value === undefined
          return (
            <div
              key={id}
              className="px-4 py-3 border-b border-border flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0 text-[15px] leading-snug break-words">
                  {item.name}
                </span>
                {untagged && (
                  <span className="shrink-0 text-[10px] font-mono uppercase tracking-wider text-text-faint">
                    untagged
                  </span>
                )}
              </div>
              <CategoryPicker
                value={value}
                onChange={(next) => setCategory(id, next)}
                dense
                aria-label={`Category for ${item.name}`}
              />
            </div>
          )
        })}
      </div>

      {/* Bottom spacer so the last row clears comfortably. */}
      <div className="h-8" />
    </div>
  )
}

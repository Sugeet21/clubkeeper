import { useState, useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { Modal } from './Modal'
import { Toggle } from './Toggle'
import { useToastStore } from '../store/toastStore'
import { addCanteenItem, getSettings, updateCanteenItem } from '../db/queries'
import { validateCanteenItemName } from '../lib/validation'
import type { CanteenItem } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  item?: CanteenItem
  existingItems: CanteenItem[]
}

export function CanteenItemFormModal({ open, onClose, item, existingItems }: Props) {
  const showToast = useToastStore((s) => s.show)
  const isEdit = item !== undefined

  const settings = useLiveQuery(() => getSettings(), [])
  const peakPricingEnabled = settings?.peakPricingEnabled ?? false

  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [peakPrice, setPeakPrice] = useState('')
  const [stockEnabled, setStockEnabled] = useState(false)
  const [currentStock, setCurrentStock] = useState('')
  const [nameError, setNameError] = useState<string | undefined>()
  const [priceError, setPriceError] = useState<string | undefined>()
  const [peakPriceError, setPeakPriceError] = useState<string | undefined>()
  const [stockError, setStockError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

  // Reset form whenever modal opens or item changes
  useEffect(() => {
    if (!open) return
    if (isEdit && item) {
      setName(item.name)
      setPrice(String(item.defaultPrice))
      setPeakPrice(typeof item.peakPrice === 'number' ? String(item.peakPrice) : '')
      setStockEnabled(item.stockEnabled)
      setCurrentStock(item.currentStock !== null ? String(item.currentStock) : '')
    } else {
      setName('')
      setPrice('')
      setPeakPrice('')
      setStockEnabled(false)
      setCurrentStock('')
    }
    setNameError(undefined)
    setPriceError(undefined)
    setPeakPriceError(undefined)
    setStockError(undefined)
  }, [open, isEdit, item])

  function validateForm(): boolean {
    let ok = true

    const nameVal = validateCanteenItemName(name)
    if (!nameVal.valid) {
      setNameError(nameVal.error)
      ok = false
    } else {
      const trimmed = name.trim().toLowerCase()
      const duplicate = existingItems.find(
        (i) => i.isActive && i.id !== item?.id && i.name.trim().toLowerCase() === trimmed,
      )
      if (duplicate) {
        setNameError(`"${duplicate.name}" already exists`)
        ok = false
      } else {
        setNameError(undefined)
      }
    }

    const priceNum = Number(price)
    if (!price || !Number.isInteger(priceNum) || priceNum < 1 || priceNum > 9999) {
      setPriceError('Price must be a whole number between 1 and 9999')
      ok = false
    } else {
      setPriceError(undefined)
    }

    if (peakPricingEnabled && peakPrice.trim() !== '') {
      const peakNum = Number(peakPrice)
      if (!Number.isInteger(peakNum) || peakNum < 1 || peakNum > 9999) {
        setPeakPriceError('Peak price must be a whole number between 1 and 9999')
        ok = false
      } else {
        setPeakPriceError(undefined)
      }
    } else {
      setPeakPriceError(undefined)
    }

    if (stockEnabled) {
      const stockNum = Number(currentStock)
      if (currentStock === '' || !Number.isInteger(stockNum) || stockNum < 0) {
        setStockError('Stock count must be 0 or more')
        ok = false
      } else {
        setStockError(undefined)
      }
    } else {
      setStockError(undefined)
    }

    return ok
  }

  async function handleSave() {
    if (!validateForm()) return
    setSaving(true)
    try {
      const trimmedName = name.trim()
      const defaultPrice = Number(price)
      const stockCount = stockEnabled ? Number(currentStock) : null
      // Peak price: only when toggle on AND user typed a value; empty input = clear/unset.
      const peakNum =
        peakPricingEnabled && peakPrice.trim() !== '' ? Number(peakPrice) : undefined

      if (isEdit && item?.id !== undefined) {
        const patch: Partial<CanteenItem> = {}
        if (trimmedName !== item.name) patch.name = trimmedName
        if (defaultPrice !== item.defaultPrice) patch.defaultPrice = defaultPrice
        if (stockEnabled !== item.stockEnabled) patch.stockEnabled = stockEnabled
        // Always send currentStock when stockEnabled, or when it changed
        if (stockEnabled !== item.stockEnabled || stockCount !== item.currentStock) {
          patch.currentStock = stockCount
        }
        if (peakPricingEnabled && peakNum !== item.peakPrice) {
          patch.peakPrice = peakNum
        }
        // Toggle OFF doesn't clear stored peakPrice — owner may toggle back on.
        await updateCanteenItem(item.id, patch)
        showToast('Item updated', 'success')
      } else {
        await addCanteenItem({
          name: trimmedName,
          defaultPrice,
          stockEnabled,
          currentStock: stockCount,
          peakPrice: peakNum,
        })
        showToast('Item added', 'success')
      }
      onClose()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Something went wrong', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit canteen item' : 'Add canteen item'}>
      <div className="flex flex-col gap-4">
        {/* Name */}
        <div>
          <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint block mb-1.5">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setNameError(undefined) }}
            placeholder="e.g. Lays, Coke"
            maxLength={50}
            className="w-full px-4 py-3.5 bg-bg-card border border-border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint"
          />
          {nameError && <p className="text-busy text-xs mt-1 pl-1">{nameError}</p>}
        </div>

        {/* Price */}
        <div>
          <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint block mb-1.5">
            {peakPricingEnabled ? 'Regular price (₹)' : 'Price (₹)'}
          </label>
          <input
            type="number"
            value={price}
            onChange={(e) => { setPrice(e.target.value); setPriceError(undefined) }}
            placeholder="20"
            min={1}
            max={9999}
            inputMode="numeric"
            className="w-full px-4 py-3.5 bg-bg-card border border-border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint"
          />
          {priceError && <p className="text-busy text-xs mt-1 pl-1">{priceError}</p>}
        </div>

        {/* Peak price — only when peak pricing is enabled in Settings */}
        {peakPricingEnabled && (
          <div>
            <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint block mb-1.5">
              Peak price (₹)
            </label>
            <input
              type="number"
              value={peakPrice}
              onChange={(e) => { setPeakPrice(e.target.value); setPeakPriceError(undefined) }}
              placeholder="Optional — leave blank to use regular price"
              min={1}
              max={9999}
              inputMode="numeric"
              className="w-full px-4 py-3.5 bg-bg-card border border-border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint"
            />
            {peakPriceError && <p className="text-busy text-xs mt-1 pl-1">{peakPriceError}</p>}
          </div>
        )}

        {/* Track stock toggle */}
        <div className="flex items-center justify-between">
          <span className="text-[15px] text-text">Track stock</span>
          <Toggle
            value={stockEnabled}
            onChange={setStockEnabled}
            aria-label="Track stock"
          />
        </div>

        {/* Current stock — only when tracking enabled */}
        {stockEnabled && (
          <div>
            <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint block mb-1.5">
              Current stock
            </label>
            <input
              type="number"
              value={currentStock}
              onChange={(e) => { setCurrentStock(e.target.value); setStockError(undefined) }}
              placeholder="0"
              min={0}
              inputMode="numeric"
              className="w-full px-4 py-3.5 bg-bg-card border border-border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint"
            />
            {stockError && <p className="text-busy text-xs mt-1 pl-1">{stockError}</p>}
          </div>
        )}

        {/* Buttons */}
        <div className="flex flex-col gap-2 pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="min-h-[52px] bg-accent text-bg font-bold rounded-2xl w-full disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] bg-bg-card text-text-dim border border-border rounded-2xl w-full"
          >
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  )
}

import { useState, useEffect } from 'react'
import { Modal } from './Modal'
import { addTable, updateTable, getActiveSessionForTable } from '../db/queries'
import { validateTableName, TABLE_NAME_MAX } from '../lib/validation'
import { useToastStore } from '../store/toastStore'
import type { GameTable, GameType } from '../types'

const GAME_TYPES: { value: GameType; label: string }[] = [
  { value: 'pool', label: 'Pool' },
  { value: 'snooker', label: 'Snooker' },
  { value: 'carrom', label: 'Carrom' },
  { value: 'playstation', label: 'PlayStation' },
  { value: 'other', label: 'Other' },
]

interface Props {
  open: boolean
  onClose: () => void
  table?: GameTable
  existingTables: GameTable[]
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="flex items-baseline gap-1.5 text-[11px] uppercase tracking-widest text-text-faint font-mono mb-2">
        {label}
        {hint && <span className="text-[10px] normal-case tracking-normal opacity-60">({hint})</span>}
      </label>
      {children}
    </div>
  )
}

export function TableFormModal({ open, onClose, table, existingTables }: Props) {
  const isEditing = Boolean(table)
  const isDisabled = table?.outOfService ?? false

  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [gameType, setGameType] = useState<GameType>('pool')
  const [ratePerHour, setRatePerHour] = useState('')
  const [ratePerFrame, setRatePerFrame] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hasActiveSession, setHasActiveSession] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(table?.name ?? '')
    setGameType(table?.gameType ?? 'pool')
    setRatePerHour(String(table?.ratePerHour ?? ''))
    setRatePerFrame(String(table?.ratePerFrame ?? ''))
    setError(null)
    setNameError(null)
    setConfirmDisable(false)
    setSaving(false)
    setHasActiveSession(false)

    if (table?.id !== undefined) {
      getActiveSessionForTable(table.id).then((s) => setHasActiveSession(s !== undefined))
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleNameChange(val: string) {
    setName(val)
    const result = validateTableName(val)
    setNameError(result.valid ? null : (result.error ?? null))
    setError(null)
  }

  async function handleSave() {
    setError(null)
    const trimmedName = name.trim()

    const nameValidation = validateTableName(trimmedName)
    if (!nameValidation.valid) {
      setError(nameValidation.error ?? 'Invalid name.')
      return
    }

    const duplicate = existingTables.some(
      (t) => t.name.toLowerCase() === trimmedName.toLowerCase() && t.id !== table?.id,
    )
    if (duplicate) { setError(`"${trimmedName}" already exists.`); return }

    const hourRate = parseInt(ratePerHour, 10)
    if (isNaN(hourRate) || hourRate < 1 || hourRate > 99999) {
      setError('Rate per hour must be 1 – 99,999.'); return
    }

    let frameRate: number | undefined
    if (gameType === 'snooker' && ratePerFrame.trim()) {
      frameRate = parseInt(ratePerFrame, 10)
      if (isNaN(frameRate) || frameRate < 1 || frameRate > 99999) {
        setError('Rate per frame must be 1 – 99,999.'); return
      }
    }

    setSaving(true)
    try {
      if (isEditing && table?.id !== undefined) {
        await updateTable(table.id, {
          name: trimmedName,
          gameType,
          ratePerHour: hourRate,
          ratePerFrame: gameType === 'snooker' ? frameRate : undefined,
          // outOfService is intentionally NOT updated here — use Disable/Enable button
        })
      } else {
        const maxOrder = existingTables.reduce((m, t) => Math.max(m, t.sortOrder), 0)
        await addTable({
          name: trimmedName,
          gameType,
          ratePerHour: hourRate,
          ratePerFrame: gameType === 'snooker' ? frameRate : undefined,
          outOfService: false,
          createdAt: Date.now(),
          sortOrder: maxOrder + 1,
        })
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDisable() {
    if (!table?.id) return
    // Race condition guard: re-check for active session before disabling
    const active = await getActiveSessionForTable(table.id)
    if (active) {
      useToastStore.getState().show('Cannot disable — active session detected.', 'error')
      onClose()
      return
    }
    onClose()
    await updateTable(table.id, { outOfService: true })
  }

  async function handleEnable() {
    if (!table?.id) return
    onClose()
    await updateTable(table.id, { outOfService: false })
  }

  const modalTitle = isEditing
    ? `Edit · ${table?.name ?? ''}`
    : 'Add Table'

  return (
    <Modal open={open} onClose={onClose} title={modalTitle}>
      {/* Guard: if the table was just soft-deleted while modal was open, show nothing */}
      {open && isEditing && !table ? null : confirmDisable ? (
        // ── Disable confirmation ──────────────────────────────────────────────
        <div>
          <p className="text-text-dim text-[14px] mb-5">
            "{table?.name ?? 'This table'}" will be hidden from the home screen. Past sessions will
            be preserved. You can re-enable it anytime from Settings.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setConfirmDisable(false)}
              className="py-3.5 bg-bg-card border border-border text-text rounded-xl text-[14px] font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={handleDisable}
              className="py-3.5 bg-busy text-white rounded-xl text-[14px] font-bold"
            >
              Yes, Disable
            </button>
          </div>
        </div>
      ) : (
        // ── Main form ─────────────────────────────────────────────────────────
        <div className="space-y-4">
          {error && (
            <div className="rounded-xl border border-busy/30 bg-busy/10 px-3 py-2.5 text-busy text-[13px]">
              {error}
            </div>
          )}

          <Field label="Name">
            <input
              type="text"
              value={name}
              maxLength={TABLE_NAME_MAX}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g. Pool 3"
              className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text text-[15px] placeholder-text-faint focus:border-accent focus:outline-none transition-colors"
            />
            {nameError && (
              <p className="text-[12px] text-busy mt-1">{nameError}</p>
            )}
          </Field>

          <Field label="Game Type">
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {GAME_TYPES.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => { setGameType(value); setError(null) }}
                  className={`flex-none px-3.5 py-2 rounded-xl text-[13px] font-semibold transition-colors ${
                    gameType === value ? 'bg-accent text-bg' : 'bg-bg text-text-dim border border-border'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Rate per Hour" hint="₹">
            <input
              type="text"
              inputMode="numeric"
              value={ratePerHour}
              onChange={(e) => {
                setRatePerHour(e.target.value.replace(/\D/g, '').slice(0, 5))
                setError(null)
              }}
              placeholder="120"
              className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text text-[15px] placeholder-text-faint focus:border-accent focus:outline-none transition-colors"
            />
          </Field>

          {gameType === 'snooker' && (
            <Field label="Rate per Frame" hint="optional, ₹">
              <input
                type="text"
                inputMode="numeric"
                value={ratePerFrame}
                onChange={(e) => {
                  setRatePerFrame(e.target.value.replace(/\D/g, '').slice(0, 5))
                  setError(null)
                }}
                placeholder="80"
                className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text text-[15px] placeholder-text-faint focus:border-accent focus:outline-none transition-colors"
              />
            </Field>
          )}

          {/* Context-aware destructive button + Cancel + Update/Add */}
          <div className={`grid gap-3 pt-1 ${isEditing ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {isEditing && (
              isDisabled ? (
                // Table is already disabled — offer to re-enable
                <button
                  onClick={handleEnable}
                  className="py-3.5 bg-free/10 text-free border border-free/30 rounded-xl text-[13px] font-semibold"
                >
                  Enable Table
                </button>
              ) : (
                // Active table — offer to disable (blocked if session running)
                <button
                  onClick={() => !hasActiveSession && setConfirmDisable(true)}
                  disabled={hasActiveSession}
                  className={`py-3.5 bg-busy/10 text-busy border border-busy/30 rounded-xl text-[13px] font-semibold ${
                    hasActiveSession ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  Disable Table
                </button>
              )
            )}
            <button
              onClick={onClose}
              className="py-3.5 bg-bg-card border border-border text-text rounded-xl text-[14px] font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || Boolean(nameError)}
              className="py-3.5 bg-accent text-bg rounded-xl text-[14px] font-bold disabled:opacity-60"
            >
              {saving ? 'Saving…' : isEditing ? 'Update' : 'Add Table'}
            </button>
          </div>

          {/* Warning shown below grid when disable is blocked */}
          {isEditing && !isDisabled && hasActiveSession && (
            <p className="text-[12px] text-busy mt-2">
              Cannot disable — this table has a running session. End the session first.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

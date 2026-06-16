import { useState, useEffect } from 'react'
import { Modal } from './Modal'
import { addTable, updateTable, getActiveSessionForTable } from '../db/queries'
import { db } from '../db/database'
import { validateTableName, validateRateCard, TABLE_NAME_MAX } from '../lib/validation'
import { useToastStore } from '../store/toastStore'
import { syncTablesJsonBySlug } from '../lib/playerHubApi'
import type { GameTable, GameType, RateTier } from '../types'

const GAME_TYPES: { value: GameType; label: string }[] = [
  { value: 'pool', label: 'Pool' },
  { value: 'snooker', label: 'Snooker' },
  { value: 'carrom', label: 'Carrom' },
  { value: 'playstation', label: 'PlayStation' },
  { value: 'other', label: 'Other' },
]

const STANDARD_TIERS: { minutes: number }[] = [
  { minutes: 30 },
  { minutes: 60 },
  { minutes: 90 },
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

  // Rate card state
  const [rateCardOpen, setRateCardOpen] = useState(false)
  const [tiers, setTiers] = useState<{ minutes: string; price: string }[]>([])
  const [toleranceStr, setToleranceStr] = useState('10')
  const [rateCardBilling, setRateCardBilling] = useState<'minimum' | 'prorated'>('prorated')
  const [tierErrors, setTierErrors] = useState<(string | null)[]>([])
  const [rateCardError, setRateCardError] = useState<string | null>(null)

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
    setRateCardError(null)
    setTierErrors([])

    const existingCard = table?.rateCard
    if (existingCard && existingCard.length > 0) {
      setTiers(existingCard.map((t) => ({ minutes: String(t.minutes), price: String(t.price) })))
      setToleranceStr(String(table?.toleranceMinutes ?? 10))
      setRateCardBilling(table?.rateCardBilling ?? 'prorated')
      setRateCardOpen(true)
    } else {
      setTiers([])
      setToleranceStr('10')
      setRateCardBilling('prorated')
      setRateCardOpen(false)
    }

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

  function handleAddTier() {
    setTiers((prev) => [...prev, { minutes: '', price: '' }])
    setTierErrors((prev) => [...prev, null])
    setRateCardError(null)
  }

  function handleRemoveTier(i: number) {
    setTiers((prev) => prev.filter((_, idx) => idx !== i))
    setTierErrors((prev) => prev.filter((_, idx) => idx !== i))
    setRateCardError(null)
  }

  function handleTierChange(i: number, field: 'minutes' | 'price', val: string) {
    const digits = val.replace(/\D/g, '').slice(0, 5)
    setTiers((prev) => prev.map((t, idx) => (idx === i ? { ...t, [field]: digits } : t)))
    setTierErrors((prev) => prev.map((e, idx) => (idx === i ? null : e)))
    setRateCardError(null)
  }

  function handlePresetStandard() {
    setTiers(STANDARD_TIERS.map((t) => ({ minutes: String(t.minutes), price: '' })))
    setToleranceStr('10')
    setTierErrors([])
    setRateCardError(null)
  }

  function parsedTiers(): RateTier[] | null {
    const result: RateTier[] = []
    for (const t of tiers) {
      const m = parseInt(t.minutes, 10)
      const p = parseInt(t.price, 10)
      if (isNaN(m) || isNaN(p)) return null
      result.push({ minutes: m, price: p })
    }
    return result
  }

  async function handleSave() {
    setError(null)
    setRateCardError(null)
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

    // Validate rate card if tiers present
    let finalRateCard: RateTier[] | undefined
    let finalTolerance: number | undefined
    let finalBilling: 'minimum' | 'prorated' | undefined

    if (tiers.length > 0) {
      const parsed = parsedTiers()
      if (!parsed) {
        setRateCardError('Fill in all tier values.')
        return
      }
      const tol = parseInt(toleranceStr, 10)
      if (isNaN(tol)) {
        setRateCardError('Tolerance must be a number.')
        return
      }
      // Sort tiers ascending by minutes before validating
      const sorted = [...parsed].sort((a, b) => a.minutes - b.minutes)
      const validation = validateRateCard(sorted, tol, rateCardBilling)
      if (!validation.valid) {
        if (validation.tierErrors) {
          setTierErrors(validation.tierErrors)
        }
        setRateCardError(validation.error ?? 'Fix the errors in the rate card.')
        return
      }
      finalRateCard = sorted
      finalTolerance = tol
      finalBilling = rateCardBilling
    }

    setSaving(true)
    try {
      if (isEditing && table?.id !== undefined) {
        await updateTable(table.id, {
          name: trimmedName,
          gameType,
          ratePerHour: hourRate,
          ratePerFrame: gameType === 'snooker' ? frameRate : undefined,
          rateCard: finalRateCard,
          toleranceMinutes: finalTolerance,
          rateCardBilling: finalBilling,
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
          rateCard: finalRateCard,
          toleranceMinutes: finalTolerance,
          rateCardBilling: finalBilling,
        })
      }
      void mirrorTablesToSupabase()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  async function mirrorTablesToSupabase() {
    try {
      const settings = await db.settings.get(1)
      if (!settings?.slug) {
        console.warn('[mirrorTablesToSupabase] skipped: no slug in settings (Player Hub not set up)')
        return
      }
      // Target the owner's club row by slug — same scoping syncCoinConfig uses.
      // Going via getOwnerClub() + .eq('id') was the original bug: an unfiltered
      // .maybeSingle() can silently return null on a transient auth state, and
      // we'd swallow it without ever attempting the write.
      const allTables = await db.gameTables.toArray()
      await syncTablesJsonBySlug(settings.slug, allTables)
    } catch (err) {
      console.warn('[mirrorTablesToSupabase] failed:', err)
    }
  }

  async function handleDisable() {
    if (!table?.id) return
    const active = await getActiveSessionForTable(table.id)
    if (active) {
      useToastStore.getState().show('Cannot disable — active session detected.', 'error')
      onClose()
      return
    }
    onClose()
    await updateTable(table.id, { outOfService: true })
    void mirrorTablesToSupabase()
  }

  async function handleEnable() {
    if (!table?.id) return
    onClose()
    await updateTable(table.id, { outOfService: false })
    void mirrorTablesToSupabase()
  }

  const modalTitle = isEditing
    ? `Edit · ${table?.name ?? ''}`
    : 'Add Table'

  const footerContent = confirmDisable ? (
    <div className="grid grid-cols-2 gap-3">
      <button
        onClick={() => setConfirmDisable(false)}
        className="py-3.5 bg-bg-card border border-border text-text rounded-xl text-[14px] font-semibold min-h-[44px]"
      >
        Cancel
      </button>
      <button
        onClick={handleDisable}
        className="py-3.5 bg-busy text-white rounded-xl text-[14px] font-bold min-h-[44px]"
      >
        Yes, Disable
      </button>
    </div>
  ) : (
    <div>
      <div className="flex flex-col-reverse sm:grid sm:gap-3 gap-2"
        style={{ gridTemplateColumns: isEditing ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)' }}
      >
        {isEditing && (
          isDisabled ? (
            <button
              onClick={handleEnable}
              className="py-3.5 bg-free/10 text-free border border-free/30 rounded-xl text-[13px] font-semibold min-h-[44px]"
            >
              Enable Table
            </button>
          ) : (
            <button
              onClick={() => !hasActiveSession && setConfirmDisable(true)}
              disabled={hasActiveSession}
              className={`py-3.5 bg-busy/10 text-busy border border-busy/30 rounded-xl text-[13px] font-semibold min-h-[44px] ${
                hasActiveSession ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              Disable Table
            </button>
          )
        )}
        <button
          onClick={onClose}
          className="py-3.5 bg-bg-card border border-border text-text rounded-xl text-[14px] font-semibold min-h-[44px]"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving || Boolean(nameError)}
          className="py-3.5 bg-accent text-bg rounded-xl text-[14px] font-bold disabled:opacity-60 min-h-[44px]"
        >
          {saving ? 'Saving…' : isEditing ? 'Update' : 'Add Table'}
        </button>
      </div>
      {isEditing && !isDisabled && hasActiveSession && (
        <p className="text-[12px] text-busy mt-2">
          Cannot disable — this table has a running session. End the session first.
        </p>
      )}
    </div>
  )

  return (
    <Modal open={open} onClose={onClose} title={modalTitle} footer={footerContent}>
      {open && isEditing && !table ? null : confirmDisable ? (
        <p className="text-text-dim text-[14px] pb-2">
          "{table?.name ?? 'This table'}" will be hidden from the home screen. Past sessions will
          be preserved. You can re-enable it anytime from Settings.
        </p>
      ) : (
        <div className="space-y-4 pb-2">
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

          <Field label="Rate per Hour" hint="₹ — fallback if no rate card">
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

          {/* ── Rate Card (collapsible) ────────────────────────────────────── */}
          <div className="border border-border rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setRateCardOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 min-h-[44px] text-left"
            >
              <div>
                <span className="text-[13px] font-semibold text-text">Tiered Pricing</span>
                {tiers.length > 0 && (
                  <span className="ml-2 text-[11px] text-accent font-mono">{tiers.length} tiers</span>
                )}
                {tiers.length === 0 && (
                  <span className="ml-2 text-[11px] text-text-faint">optional</span>
                )}
              </div>
              <svg
                width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2"
                className={`text-text-faint shrink-0 transition-transform duration-200 ${rateCardOpen ? 'rotate-90' : ''}`}
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>

            <div
              className={`grid transition-all duration-200 ease-out ${
                rateCardOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
              }`}
            >
              <div className="overflow-hidden">
                <div className="px-4 pb-4 pt-1 border-t border-border space-y-3">
                  <p className="text-xs text-text-faint leading-relaxed">
                    If set, replaces the per-hour rate above. Save to auto-sort tiers ascending.
                  </p>

                  {/* Column labels — aligned to the two inputs */}
                  {tiers.length > 0 && (
                    <div className="grid grid-cols-2 gap-3 pr-11 px-1">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint">Minutes</span>
                      <span className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint">Price (₹)</span>
                    </div>
                  )}

                  {/* Tier rows */}
                  {tiers.map((tier, i) => (
                    <div key={i}>
                      <div className="relative">
                        <div className="grid grid-cols-2 gap-3 pr-11">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={tier.minutes}
                            onChange={(e) => handleTierChange(i, 'minutes', e.target.value)}
                            placeholder="e.g. 30"
                            className={`w-full bg-bg border rounded-xl px-3 py-2.5 text-text text-[14px] placeholder-text-faint focus:outline-none transition-colors min-h-[44px] ${
                              tierErrors[i] ? 'border-busy' : 'border-border focus:border-accent'
                            }`}
                          />
                          <input
                            type="text"
                            inputMode="numeric"
                            value={tier.price}
                            onChange={(e) => handleTierChange(i, 'price', e.target.value)}
                            placeholder="e.g. 70"
                            className={`w-full bg-bg border rounded-xl px-3 py-2.5 text-text text-[14px] placeholder-text-faint focus:outline-none transition-colors min-h-[44px] ${
                              tierErrors[i] ? 'border-busy' : 'border-border focus:border-accent'
                            }`}
                          />
                        </div>
                        <button
                          onClick={() => handleRemoveTier(i)}
                          className="absolute right-0 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-text-faint hover:text-busy transition-colors"
                          aria-label="Remove tier"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      {tierErrors[i] && (
                        <p className="text-[11px] text-busy mt-1">{tierErrors[i]}</p>
                      )}
                    </div>
                  ))}

                  {tiers.length < 12 && (
                    <button
                      onClick={handleAddTier}
                      className="w-full min-h-[44px] py-2 bg-bg border border-border rounded-xl text-[13px] font-semibold text-text-dim"
                    >
                      + Add Tier
                    </button>
                  )}

                  {/* Tolerance */}
                  <div>
                    <label className="text-[11px] uppercase tracking-widest text-text-faint font-mono block mb-1.5">
                      Tolerance (minutes)
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={toleranceStr}
                      onChange={(e) => {
                        setToleranceStr(e.target.value.replace(/\D/g, '').slice(0, 2))
                        setRateCardError(null)
                      }}
                      placeholder="10"
                      className="w-full bg-bg border border-border rounded-xl px-3 py-2.5 text-text text-[14px] placeholder-text-faint focus:border-accent focus:outline-none transition-colors min-h-[44px]"
                    />
                    <p className="text-xs text-text-faint mt-1 leading-relaxed">
                      If a player plays within this many minutes past a tier, they're still charged the lower price.
                    </p>
                  </div>

                  {/* Billing behavior toggle */}
                  <div className="space-y-2">
                    <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint block">
                      Billing Behavior
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setRateCardBilling('prorated')}
                        className={`min-h-[44px] rounded-2xl border text-[13px] font-semibold transition-colors ${
                          rateCardBilling === 'prorated'
                            ? 'bg-accent text-bg border-accent'
                            : 'bg-bg-card text-text-dim border-border'
                        }`}
                      >
                        Pro-rated
                      </button>
                      <button
                        type="button"
                        onClick={() => setRateCardBilling('minimum')}
                        className={`min-h-[44px] rounded-2xl border text-[13px] font-semibold transition-colors ${
                          rateCardBilling === 'minimum'
                            ? 'bg-accent text-bg border-accent'
                            : 'bg-bg-card text-text-dim border-border'
                        }`}
                      >
                        Minimum charge
                      </button>
                    </div>
                    <p className="text-xs text-text-faint leading-relaxed">
                      {rateCardBilling === 'prorated'
                        ? 'Below tier 1, charge proportionally (₹0 at start, full tier price at the tier mark). Plateau at each tier for the tolerance window, then climb smoothly to the next tier. Fair and trust-building.'
                        : 'Charge the minimum tier price even for short plays. Each tier price holds until the next tier + tolerance is crossed. Traditional Indian club model.'}
                    </p>
                  </div>

                  {/* Standard preset */}
                  <button
                    onClick={handlePresetStandard}
                    className="text-[12px] text-accent font-semibold min-h-[44px] flex items-center"
                  >
                    Use standard preset (30 / 60 / 90 min) →
                  </button>

                  {rateCardError && (
                    <p className="text-[12px] text-busy">{rateCardError}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Modal>
  )
}

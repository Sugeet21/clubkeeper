import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Toggle } from '../components/Toggle'
import { Modal } from '../components/Modal'
import { CoinTiersEditor } from '../components/CoinTiersEditor'
import { EngagementConfigCard } from '../components/EngagementConfigCard'
import { updateSettings } from '../db/queries'
import { generateSlug, validateSlug, isSlugAvailable } from '../lib/slug'
import { upsertClub, updateAcceptsTopups, getOwnerClub, syncCoinConfig } from '../lib/playerHubApi'
import { useToastStore } from '../store/toastStore'
import { DEFAULT_COIN_CONFIG, resolveCoinConfig } from '../lib/coins'
import type { ClubSettings, CoinTier } from '../types'

// ─── Numeric input that allows full clearance (Pattern F7 / B7) ──────────────

interface RateInputProps {
  label: string
  suffix: string
  value: number
  onChange: (n: number) => void
  min: number
  max: number
  decimal?: boolean
}

function RateInput({ label, suffix, value, onChange, min, max, decimal }: RateInputProps) {
  const [draft, setDraft] = useState(String(value))
  const [error, setError] = useState<string | null>(null)

  function handleBlur() {
    const trimmed = draft.trim()
    if (trimmed === '') {
      onChange(0)
      setDraft('0')
      setError(null)
      return
    }
    const parsed = decimal ? parseFloat(trimmed) : parseInt(trimmed, 10)
    if (isNaN(parsed)) { setError('Enter a number'); return }
    if (parsed < min || parsed > max) { setError(`Must be ${min}–${max}`); return }
    onChange(parsed)
    setDraft(String(parsed))
    setError(null)
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <p className="text-[13px] text-text-dim flex-1">{label}</p>
        <input
          type="text"
          inputMode={decimal ? 'decimal' : 'numeric'}
          value={draft}
          onChange={(e) => { setDraft(e.target.value); setError(null) }}
          onBlur={handleBlur}
          className="w-20 px-2 py-1.5 bg-bg-card border border-border rounded-xl text-text text-[14px] outline-none focus:border-accent text-right"
        />
        <p className="text-[13px] text-text-dim">{suffix}</p>
      </div>
      {error && <p className="text-busy text-[11px] mt-1 text-right">{error}</p>}
    </div>
  )
}

interface Props {
  settings: ClubSettings | undefined
}

const BASE_URL = 'https://app.handbookhq.in'

export function PlayerHubSettings({ settings }: Props) {
  const navigate = useNavigate()
  const { show: showToast } = useToastStore()

  const [setupOpen, setSetupOpen] = useState(false)
  const [slugDraft, setSlugDraft] = useState('')
  const [slugError, setSlugError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [acceptsTopups, setAcceptsTopups] = useState(settings?.acceptsTopups ?? true)
  const [toggling, setToggling] = useState(false)
  const [topupsLoaded, setTopupsLoaded] = useState(false)

  // ── ClubCoins local state ─────────────────────────────────────────────────
  const coinConfig = resolveCoinConfig(settings ?? {})
  const [coinsEnabled, setCoinsEnabled] = useState(coinConfig.coinsEnabled)
  const [coinTiers, setCoinTiers] = useState<CoinTier[]>(coinConfig.coinTiers)
  const [minutesPerCoin, setMinutesPerCoin] = useState(coinConfig.minutesPerCoin)
  const [rupeesPerCoin, setRupeesPerCoin] = useState(coinConfig.rupeesPerCoin)
  const [coinExpiryDays, setCoinExpiryDays] = useState(coinConfig.coinExpiryDays)
  const [coinRedemptionModes, setCoinRedemptionModes] = useState<'time' | 'canteen' | 'both'>(
    settings?.coinRedemptionModes ?? 'both',
  )
  const [coinSaving, setCoinSaving] = useState(false)
  const [editingRates, setEditingRates] = useState(false)

  // Sync local coin state when settings prop changes (first load)
  useEffect(() => {
    if (!settings) return
    const c = resolveCoinConfig(settings)
    setCoinsEnabled(c.coinsEnabled)
    setCoinTiers(c.coinTiers)
    setMinutesPerCoin(c.minutesPerCoin)
    setRupeesPerCoin(c.rupeesPerCoin)
    setCoinExpiryDays(c.coinExpiryDays)
    setCoinRedemptionModes(settings.coinRedemptionModes ?? 'both')
  }, [settings?.coinsEnabled, settings?.coinTiers, settings?.minutesPerCoin,
      settings?.rupeesPerCoin, settings?.coinExpiryDays, settings?.coinRedemptionModes]) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveCoinSettings(patch: Partial<ClubSettings>) {
    await updateSettings(patch)
    // Fire-and-forget sync to Supabase for the public scan page
    const slug = settings?.slug
    if (slug) {
      const enabled = patch.coinsEnabled ?? coinsEnabled
      const tiers = patch.coinTiers ?? coinTiers
      syncCoinConfig(slug, enabled, tiers).catch(() => {})
    }
  }

  async function handleToggleCoins(val: boolean) {
    setCoinSaving(true)
    setCoinsEnabled(val)
    try {
      // Seed default tiers on first enable if none set yet
      const tiersToUse =
        val && (!settings?.coinTiers || settings.coinTiers.length === 0)
          ? [...DEFAULT_COIN_CONFIG.coinTiers]
          : coinTiers
      if (val && tiersToUse !== coinTiers) setCoinTiers(tiersToUse)
      await saveCoinSettings({ coinsEnabled: val, coinTiers: tiersToUse })
    } catch {
      setCoinsEnabled(!val)
      showToast('Failed to update. Please try again.')
    } finally {
      setCoinSaving(false)
    }
  }

  async function handleTiersChange(tiers: CoinTier[]) {
    setCoinTiers(tiers)
    try {
      await saveCoinSettings({ coinTiers: tiers })
    } catch {
      showToast('Failed to save tiers.')
    }
  }

  async function handleSaveRates() {
    setCoinSaving(true)
    try {
      await saveCoinSettings({ minutesPerCoin, rupeesPerCoin, coinExpiryDays, coinRedemptionModes })
      setEditingRates(false)
    } catch {
      showToast('Failed to save rates.')
    } finally {
      setCoinSaving(false)
    }
  }

  async function handleRedemptionModeChange(val: 'time' | 'canteen' | 'both') {
    setCoinRedemptionModes(val)
    try {
      await saveCoinSettings({ coinRedemptionModes: val })
    } catch {
      showToast('Failed to save.')
    }
  }

  // ── Load accepts_topups from Supabase on mount if slug already exists ─────
  // Only runs once (guarded by topupsLoaded) — prevents remount from overriding a just-saved toggle
  useEffect(() => {
    if (!settings?.slug || topupsLoaded) return
    getOwnerClub()
      .then((club) => {
        if (club) setAcceptsTopups(club.acceptsTopups)
        setTopupsLoaded(true)
      })
      .catch(() => { setTopupsLoaded(true) })
  }, [settings?.slug, topupsLoaded])

  // ── Pre-fill slug draft from settings when modal opens ───────────────────
  useEffect(() => {
    if (!setupOpen) return
    const existing = settings?.slug ?? generateSlug(settings?.clubName ?? 'my-club')
    setSlugDraft(existing)
    setSlugError(null)
  }, [setupOpen, settings?.slug, settings?.clubName])

  // ── Debounced uniqueness check ────────────────────────────────────────────
  useEffect(() => {
    if (!slugDraft) return
    const err = validateSlug(slugDraft)
    if (err) { setSlugError(err); return }

    setChecking(true)
    const t = setTimeout(async () => {
      try {
        const available = await isSlugAvailable(slugDraft)
        if (!available && slugDraft !== settings?.slug) {
          setSlugError(`"${slugDraft}" is taken. Try "${slugDraft}-2"?`)
        } else {
          setSlugError(null)
        }
      } catch {
        setSlugError(null)
      } finally {
        setChecking(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [slugDraft, settings?.slug])

  const handleSaveSlug = useCallback(async () => {
    if (slugError || checking) return
    const trimmed = slugDraft.trim()
    const err = validateSlug(trimmed)
    if (err) { setSlugError(err); return }

    setSaving(true)
    try {
      await upsertClub({
        slug: trimmed,
        clubName: settings?.clubName ?? 'My Club',
        upiId: settings?.upiId ?? null,
        acceptsTopups: true,
      })
      await updateSettings({ slug: trimmed, slugLocked: true })
      setSetupOpen(false)
      window.open(`/poster/${trimmed}`, '_blank')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to save'
      setSlugError(msg)
    } finally {
      setSaving(false)
    }
  }, [slugDraft, slugError, checking, settings])

  const handleToggleTopups = useCallback(async (val: boolean) => {
    setToggling(true)
    setAcceptsTopups(val)
    try {
      // Supabase first — if it fails, Dexie is never written, so no desync.
      await updateAcceptsTopups(val)
      await updateSettings({ acceptsTopups: val })
    } catch {
      // Revert optimistic UI update
      setAcceptsTopups(!val)
      showToast('Failed to update. Try again.')
    } finally {
      setToggling(false)
    }
  }, [showToast])

  const slug = settings?.slug
  const locked = settings?.slugLocked

  if (!slug) {
    return (
      <div className="mt-3">
        <div className="bg-bg border border-border rounded-2xl px-4 py-5 flex flex-col gap-4">
          <div>
            <p className="text-[15px] font-semibold text-text">Set up your Player Hub</p>
            <p className="text-text-faint text-[13px] mt-1">
              Give players a QR code to self-register and top up their wallets.
            </p>
          </div>
          <button
            onClick={() => setSetupOpen(true)}
            className="w-full min-h-[44px] bg-accent text-bg font-bold rounded-2xl text-[14px]"
          >
            Set up Player Hub
          </button>
        </div>

        <Modal
          open={setupOpen}
          onClose={() => setSetupOpen(false)}
          title="Set up Player Hub"
          footer={
            <button
              onClick={handleSaveSlug}
              disabled={!!slugError || checking || saving || !slugDraft}
              className={`w-full min-h-[52px] rounded-2xl font-bold text-[15px] transition-opacity ${
                !slugError && !checking && !saving && slugDraft
                  ? 'bg-accent text-bg'
                  : 'bg-accent/40 text-bg/60 cursor-not-allowed'
              }`}
            >
              {saving ? 'Saving…' : 'Save & Download Poster'}
            </button>
          }
        >
          <div className="mt-2 flex flex-col gap-4 pb-2">
            <div>
              <p className="text-text-dim text-[13px] mb-3">
                Choose a short, memorable URL for your club's QR code. This cannot be changed after saving.
              </p>
              <label className="block text-[11px] font-mono font-bold uppercase tracking-widest text-text-faint mb-2">
                Your slug
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={slugDraft}
                  onChange={(e) => setSlugDraft(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40))}
                  placeholder="e.g. ball-bender-pune"
                  className="w-full px-4 py-3.5 bg-bg border border-border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint"
                />
                {checking && (
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                )}
              </div>
              {slugDraft && (
                <p className="text-text-faint text-[12px] mt-1.5 font-mono">
                  {BASE_URL}/c/{slugDraft}
                </p>
              )}
              {slugError && <p className="text-busy text-[13px] mt-1.5">{slugError}</p>}
            </div>
          </div>
        </Modal>
      </div>
    )
  }

  return (
    <div className="mt-3 flex flex-col gap-4">
      {/* QR Link */}
      <div className="bg-bg border border-border rounded-2xl px-4 py-3">
        <p className="text-[11px] font-mono font-bold uppercase tracking-widest text-text-faint mb-1">
          Your QR link
        </p>
        <p className="text-text text-[13px] font-mono break-all">
          {BASE_URL}/c/{slug}
        </p>
        {locked && (
          <div className="flex items-center gap-1.5 text-text-faint text-[12px] mt-2">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            Slug locked
          </div>
        )}
      </div>

      {/* Accept top-ups toggle */}
      <div className="flex items-center justify-between min-h-[44px]">
        <div>
          <p className="text-[14px] font-semibold text-text">Accept top-ups</p>
          <p className="text-[11px] text-text-faint mt-0.5">Players can top up via QR when enabled</p>
        </div>
        <Toggle
          value={acceptsTopups}
          onChange={toggling ? () => {} : handleToggleTopups}
        />
      </div>

      {/* ── ClubCoins sub-card ─────────────────────────────────────────────── */}
      <div className="bg-bg border border-border rounded-2xl px-4 py-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[14px] font-semibold text-text">ClubCoins</p>
            <p className="text-[11px] text-text-faint mt-0.5">Reward returning players with loyalty coins</p>
          </div>
          <Toggle
            value={coinsEnabled}
            onChange={coinSaving ? () => {} : handleToggleCoins}
          />
        </div>

        {coinsEnabled && (
          <div className="mt-4 space-y-4">
            {/* Earning Tiers */}
            <div>
              <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint mb-2">
                Earning Tiers
              </p>
              <CoinTiersEditor tiers={coinTiers} onChange={handleTiersChange} />
            </div>

            {/* Redemption Rates */}
            <div>
              <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint mb-2">
                Redemption Rates
              </p>

              {/* Mode selector */}
              <div className="mb-3">
                <p className="text-[12px] text-text-dim mb-1.5">Players can redeem coins for:</p>
                <div className="flex flex-col gap-1">
                  {([
                    { val: 'time', label: 'Time only (free play minutes)' },
                    { val: 'canteen', label: 'Canteen only (₹ off items)' },
                    { val: 'both', label: 'Both' },
                  ] as const).map(({ val, label }) => (
                    <button
                      key={val}
                      onClick={() => void handleRedemptionModeChange(val)}
                      className={`flex items-center gap-2 min-h-[36px] px-3 rounded-xl border text-[13px] text-left transition-colors ${
                        coinRedemptionModes === val
                          ? 'border-accent bg-accent/10 text-accent font-semibold'
                          : 'border-border bg-bg text-text-dim'
                      }`}
                    >
                      <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 flex items-center justify-center ${coinRedemptionModes === val ? 'border-accent' : 'border-border'}`}>
                        {coinRedemptionModes === val && <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
                      </span>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {editingRates ? (
                <div className="space-y-3">
                  {coinRedemptionModes !== 'time' && (
                    <RateInput
                      label="1 coin ="
                      suffix="₹ off canteen"
                      value={rupeesPerCoin}
                      onChange={setRupeesPerCoin}
                      min={0}
                      max={999}
                      decimal
                    />
                  )}
                  {coinRedemptionModes !== 'canteen' && (
                    <RateInput
                      label="1 coin ="
                      suffix="min free play"
                      value={minutesPerCoin}
                      onChange={setMinutesPerCoin}
                      min={0}
                      max={9999}
                    />
                  )}
                  <RateInput
                    label="Expiry"
                    suffix="days"
                    value={coinExpiryDays}
                    onChange={setCoinExpiryDays}
                    min={0}
                    max={3650}
                  />

                  <div className="flex gap-2 pt-0.5">
                    <button
                      onClick={handleSaveRates}
                      disabled={coinSaving}
                      className="flex-1 min-h-[40px] bg-accent text-bg text-[13px] font-bold rounded-xl"
                    >
                      {coinSaving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      onClick={() => setEditingRates(false)}
                      className="min-h-[40px] px-4 text-text-dim text-[13px] rounded-xl border border-border"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                      {coinRedemptionModes !== 'time' && (
                        <p className="text-[13px] text-text-dim">1 coin = {rupeesPerCoin} ₹ off</p>
                      )}
                      {coinRedemptionModes !== 'canteen' && (
                        <p className="text-[13px] text-text-dim">1 coin = {minutesPerCoin} min free play</p>
                      )}
                    </div>
                    <button
                      onClick={() => setEditingRates(true)}
                      className="min-h-[32px] px-3 text-[12px] text-accent font-semibold shrink-0"
                    >
                      Edit
                    </button>
                  </div>
                  <p className="text-[11px] text-text-faint">Expiry: {coinExpiryDays} days</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Engagement sub-card ───────────────────────────────────────────────── */}
      {coinsEnabled && (
        <div className="bg-bg border border-border rounded-2xl px-4 py-4">
          <p className="text-[14px] font-semibold text-text mb-1">Engagement</p>
          <p className="text-[11px] text-text-faint mb-4">Welcome bonus · Streak · Bring Back nudges</p>
          <EngagementConfigCard />
        </div>
      )}

      {/* Download Poster */}
      <button
        onClick={() => window.open(`/poster/${slug}`, '_blank')}
        className="w-full min-h-[44px] bg-bg border border-border rounded-2xl text-[14px] font-semibold text-text flex items-center justify-center gap-2"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        Download Poster (A4 PDF)
      </button>

      {/* Preview scan page */}
      <button
        onClick={() => window.open(`/c/${slug}`, '_blank')}
        className="w-full min-h-[44px] bg-bg border border-dashed border-border rounded-2xl text-[14px] text-text-dim flex items-center justify-center gap-2"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
        Preview my scan page
      </button>
    </div>
  )
}

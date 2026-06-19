import { useState, useEffect, useRef, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTables, useSettings, useSyncClubFromSupabase } from '../hooks/useLiveData'
import { updateSettings, clearAllSessions, resetEverything, getAllDataForExport, getPiggyBalance, ActiveSessionsPresentError } from '../db/queries'
import { TableFormModal } from '../components/TableFormModal'
import { Modal } from '../components/Modal'
import { Toggle } from '../components/Toggle'
import { SaveIndicator, useSaveIndicator } from '../components/SaveIndicator'
import { PeakWindowBottomSheet } from '../components/PeakWindowBottomSheet'
import { useToastStore } from '../store/toastStore'
import { useAuthStore } from '../store/authStore'
import { validatePlayerName, validateUpiId } from '../lib/validation'
import { db } from '../db/database'
import { supabase } from '../lib/supabase'
import { playBeepOnce, triggerVibration, unlockAudio } from '../lib/alarm'
import { PlayerHubSettings } from './PlayerHubSettings'
import { updateClubNameRemote } from '../lib/playerHubApi'
import { importEverythingFromFile, type ImportSuccess, type ImportFailureReason } from '../lib/importEverything'
import type { GameTable } from '../types'

// ─── Icons ────────────────────────────────────────────────────────────────────

function ChevronLeft() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M12 5l-5 5 5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M11 2l3 3L4.5 14H2v-2.5L11 2z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Section icons — 20×20 inline SVG, stroke-2, currentColor

function IconClubInfo() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 21h18" />
      <path d="M5 21V7l7-4 7 4v14" />
      <rect x="9" y="13" width="6" height="8" />
    </svg>
  )
}

function IconTables() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="13" y="3" width="8" height="8" rx="1" />
      <rect x="3" y="13" width="8" height="8" rx="1" />
      <rect x="13" y="13" width="8" height="8" rx="1" />
    </svg>
  )
}

function IconSubscription() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

function IconData() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function IconUpload() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

function IconCheck() {
  return (
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}

function IconAbout() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  )
}

function IconAccount() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
}

function IconAlerts() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  )
}

function IconPeakPricing() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function formatPeakTime12(h: number, m: number): string {
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  const mm = m.toString().padStart(2, '0')
  return `${h12}:${mm} ${period}`
}

// ─── Collapsible Section Card ─────────────────────────────────────────────────

function SettingsSection({
  id,
  title,
  icon,
  badge,
  isOpen,
  onToggle,
  children,
}: {
  id: string
  title: string
  icon: ReactNode
  badge?: ReactNode
  isOpen: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className="bg-bg-card border border-border rounded-2xl overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={`section-${id}`}
        className="w-full flex items-center gap-3 px-4 py-4 min-h-[56px] text-left"
      >
        <span className="text-text-dim shrink-0">{icon}</span>
        <span className="flex-1 text-[15px] font-semibold text-text">{title}</span>
        {badge}
        <svg
          width="18" height="18" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2"
          className={`text-text-faint shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>
      <div
        id={`section-${id}`}
        className={`grid transition-all duration-200 ease-out ${
          isOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-4 pt-1 border-t border-border">{children}</div>
        </div>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function rupee(n: number) {
  return '₹' + n.toLocaleString('en-IN')
}

function formatDate(ms: number) {
  return format(new Date(ms), 'd MMM yyyy')
}

type RoundingMode = 'none' | '15min' | '30min'

function importErrorMessage(reason: ImportFailureReason): string {
  switch (reason) {
    case 'parse_error':
      return "Couldn't read that file. Make sure it's a valid ClubKeeper backup."
    case 'not_clubkeeper_file':
      return "This doesn't look like a ClubKeeper backup."
    case 'legacy_incomplete_format':
      return "This backup is from an older version that didn't include all data. We can't safely restore it. Please use a backup taken after 14 Jun 2026."
    case 'schema_too_new':
      return 'This backup is from a newer version of ClubKeeper. Update the app first.'
    case 'active_sessions_present':
      return 'Stop all running sessions before importing.'
    case 'empty_file':
      return 'The backup file is empty.'
    case 'transaction_failed':
      return 'Import failed. Your existing data is unchanged.'
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Settings() {
  useSyncClubFromSupabase()
  const navigate = useNavigate()
  const tables = useTables()
  const settings = useSettings()
  const { subscription, user } = useAuthStore()

  // Count tables with active rate cards (for rounding hint)
  const rateCardTableCount = useLiveQuery(
    () => db.gameTables.filter((t) => Array.isArray(t.rateCard) && (t.rateCard?.length ?? 0) > 0).count(),
    [],
  ) ?? 0

  // Piggy live balance — used by the Piggy settings section
  const piggy = useLiveQuery(() => getPiggyBalance(), [])
  const piggyStartedAt = settings?.piggyStartedAt

  // Peak Hour Pricing bottom-sheet (#68)
  const [peakSheetOpen, setPeakSheetOpen] = useState(false)

  // Single open section — only one open at a time
  const [openSection, setOpenSection] = useState<string>('club-info')

  function toggleSection(id: string) {
    setOpenSection((prev) => (prev === id ? '' : id))
  }

  // Persist open section in sessionStorage (UI flag only)
  useEffect(() => {
    const saved = sessionStorage.getItem('ck_settings_section')
    if (saved) setOpenSection(saved)
  }, [])
  useEffect(() => {
    sessionStorage.setItem('ck_settings_section', openSection)
  }, [openSection])

  // Save indicators (Pattern U9)
  const clubNameSave = useSaveIndicator()
  const upiSave = useSaveIndicator()

  // Club name draft
  const [clubName, setClubName] = useState('')
  useEffect(() => {
    if (settings?.clubName !== undefined) setClubName(settings.clubName)
  }, [settings?.clubName])

  // UPI ID draft
  const [upiId, setUpiId] = useState('')
  const [upiError, setUpiError] = useState<string | null>(null)
  useEffect(() => {
    setUpiId(settings?.upiId ?? '')
  }, [settings?.upiId])

  // Low stock threshold draft (#92). String for typing UX, parsed on blur.
  const [lowStockDraft, setLowStockDraft] = useState('5')
  useEffect(() => {
    setLowStockDraft(String(settings?.lowStockThreshold ?? 5))
  }, [settings?.lowStockThreshold])

  // Table form modal
  const [tableModal, setTableModal] = useState<{ open: boolean; table?: GameTable }>({ open: false })

  // Modals
  const [clearModal, setClearModal] = useState(false)
  const [resetModal, setResetModal] = useState(false)
  const [resetConfirmText, setResetConfirmText] = useState('')
  const [cleanModal, setCleanModal] = useState(false)
  const [cancelSubModal, setCancelSubModal] = useState(false)
  const [storageInfo, setStorageInfo] = useState<{ usage: number; quota: number } | null>(null)
  const [busy, setBusy] = useState(false)

  // Rounding confirm modal state
  const [pendingRounding, setPendingRounding] = useState<RoundingMode | null>(null)
  const [roundingConfirmOpen, setRoundingConfirmOpen] = useState(false)
  const [activeSessionCount, setActiveSessionCount] = useState(0)

  // Import everything state
  const importFileRef = useRef<HTMLInputElement | null>(null)
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null)
  const [importConfirmOpen, setImportConfirmOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importSuccess, setImportSuccess] = useState<ImportSuccess | null>(null)

  useEffect(() => {
    if ('storage' in navigator) {
      navigator.storage.estimate().then((est) => {
        if (est.usage !== undefined && est.quota !== undefined) {
          setStorageInfo({ usage: est.usage, quota: est.quota })
        }
      }).catch(() => {})
    }
  }, [])

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleSaveClubName() {
    const trimmed = clubName.trim()
    if (!trimmed || trimmed === settings?.clubName) return
    await clubNameSave.run(async () => {
      await updateSettings({ clubName: trimmed })
      // Fire-and-forget sync to Supabase. If the owner hasn't set up Player
      // Hub yet (no slug), the mirror helper returns slug_missing and skips.
      const slug = settings?.slug
      if (slug) {
        updateClubNameRemote(slug, trimmed).catch(() => {
          useToastStore.getState().show('Saved locally. Will sync when online.', 'error')
        })
      }
    })
  }

  function handleUpiBlur() {
    const err = validateUpiId(upiId)
    setUpiError(err)
  }

  async function handleLowStockBlur() {
    const current = settings?.lowStockThreshold ?? 5
    const parsed = parseInt(lowStockDraft, 10)
    if (!Number.isFinite(parsed)) {
      setLowStockDraft(String(current))
      return
    }
    const clamped = Math.min(999, Math.max(1, parsed))
    setLowStockDraft(String(clamped))
    if (clamped === current) return
    await updateSettings({ lowStockThreshold: clamped })
    useToastStore.getState().show(`Low-stock alert at ${clamped} unit${clamped === 1 ? '' : 's'}`, 'success')
  }

  async function handleSaveUpiId() {
    const trimmed = upiId.trim()
    const err = validateUpiId(trimmed)
    if (err) { setUpiError(err); return }
    await upiSave.run(async () => {
      await updateSettings({ upiId: trimmed || undefined })
      setUpiError(null)
    })
  }

  async function handleRoundingChange(newMode: RoundingMode) {
    if (newMode === settings?.rounding) return
    const active = await db.sessions
      .where('status')
      .anyOf(['running', 'paused'])
      .count()

    if (active > 0) {
      setActiveSessionCount(active)
      setPendingRounding(newMode)
      setRoundingConfirmOpen(true)
      return
    }
    await updateSettings({ rounding: newMode })
  }

  async function handleApplyRounding() {
    if (!pendingRounding) return
    await updateSettings({ rounding: pendingRounding })
    setRoundingConfirmOpen(false)
    setPendingRounding(null)
  }

  async function handleClearSessions() {
    setBusy(true)
    try {
      await clearAllSessions()
      setClearModal(false)
    } finally {
      setBusy(false)
    }
  }

  async function handleReset() {
    if (resetConfirmText !== 'RESET') return
    setBusy(true)
    try {
      await resetEverything()
      setResetModal(false)
      setResetConfirmText('')
      navigate('/tables')
    } catch (err) {
      if (err instanceof ActiveSessionsPresentError) {
        useToastStore.getState().show('Stop all active sessions before resetting.', 'error')
      } else {
        useToastStore.getState().show('Reset failed. Please try again.', 'error')
      }
    } finally {
      setBusy(false)
    }
  }

  async function handleCleanInvalidNames() {
    setBusy(true)
    try {
      const all = await db.sessions.toArray()
      let count = 0
      for (const s of all) {
        if (!s.playerName) continue
        const { valid } = validatePlayerName(s.playerName.trim())
        if (!valid) {
          await db.sessions.update(s.id!, { playerName: null })
          count++
        }
      }
      setCleanModal(false)
      useToastStore.getState().show(`Cleaned ${count} record${count !== 1 ? 's' : ''}.`, 'success')
    } finally {
      setBusy(false)
    }
  }

  async function handleExportJSON() {
    const data = await getAllDataForExport()
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `clubkeeper-backup-${format(new Date(), 'yyyy-MM-dd')}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  function handleImportButtonClick() {
    importFileRef.current?.click()
  }

  function handleImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null
    // Always clear the input value so picking the same file twice still fires onChange
    e.target.value = ''
    if (!file) return
    setPendingImportFile(file)
    setImportConfirmOpen(true)
  }

  function handleImportCancel() {
    if (importing) return
    setImportConfirmOpen(false)
    setPendingImportFile(null)
  }

  async function handleImportConfirm() {
    if (!pendingImportFile || importing) return
    setImporting(true)
    try {
      const result = await importEverythingFromFile(pendingImportFile)
      if (result.ok) {
        setImportConfirmOpen(false)
        setPendingImportFile(null)
        setImportSuccess(result)
      } else {
        setImportConfirmOpen(false)
        setPendingImportFile(null)
        useToastStore.getState().show(importErrorMessage(result.reason), 'error')
      }
    } catch (err) {
      setImportConfirmOpen(false)
      setPendingImportFile(null)
      useToastStore.getState().show(`Import failed: ${String(err)}`, 'error')
    } finally {
      setImporting(false)
    }
  }

  function handleImportSuccessDone() {
    setImportSuccess(null)
    // Hard reload of /tables so every useLiveQuery refetches against the restored DB
    window.location.assign('/tables')
  }

  async function handleCancelSubscription() {
    setBusy(true)
    try {
      const { data: { session: authSession } } = await supabase.auth.getSession()
      if (!authSession) throw new Error('Not authenticated')
      const res = await fetch('/api/cancel-subscription', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authSession.access_token}` },
      })
      if (!res.ok) {
        const err = await res.json() as { error?: string }
        useToastStore.getState().show(err.error ?? 'Failed to cancel', 'error')
        return
      }
      await useAuthStore.getState().refreshProfile(true)
      setCancelSubModal(false)
      useToastStore.getState().show('Subscription cancelled. Access continues until period ends.', 'success')
    } catch (err) {
      useToastStore.getState().show(err instanceof Error ? err.message : 'Something went wrong', 'error')
    } finally {
      setBusy(false)
    }
  }

  // ── Subscription badge (shown in section header when collapsed) ────────────

  const activeTableCount = tables.filter((t) => !t.outOfService).length

  function SubscriptionBadge() {
    if (subscription === null) {
      return <div className="w-16 h-5 rounded-md bg-bg animate-pulse" />
    }
    if (subscription.status === 'trialing') {
      return (
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 rounded-md bg-paused/15 text-paused">
          Trialing
        </span>
      )
    }
    if (subscription.status === 'active') {
      return (
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 rounded-md bg-free/15 text-free">
          Active
        </span>
      )
    }
    if (subscription.status === 'cancelled' || subscription.status === 'expired') {
      return (
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 rounded-md bg-busy/15 text-busy">
          Inactive
        </span>
      )
    }
    // status === 'none' or any other
    return (
      <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 rounded-md bg-accent/15 text-accent">
        Subscribe
      </span>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="pt-safe min-h-screen bg-bg pb-32">

      {/* Top bar */}
      <div className="flex items-center px-3 pt-3 pb-4">
        <button
          onClick={() => navigate('/tables')}
          className="flex items-center gap-1 text-text-dim px-1 min-h-[44px] -ml-1 active:text-text transition-colors"
        >
          <ChevronLeft />
          <span className="text-sm">Home</span>
        </button>
        <h1 className="text-[18px] font-bold text-text ml-2">Settings</h1>
      </div>

      <div className="px-4 space-y-3">

        {/* ── 1: Club Info (default open) ─────────────────────────────────── */}
        <SettingsSection
          id="club-info"
          title="Club Info"
          icon={<IconClubInfo />}
          isOpen={openSection === 'club-info'}
          onToggle={() => toggleSection('club-info')}
        >
          {/* Club name */}
          <div className="mt-3 mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-[11px] font-mono uppercase tracking-widest text-text-faint">
                Club Name
              </label>
              <SaveIndicator state={clubNameSave.state} error={clubNameSave.error} />
            </div>
            <input
              type="text"
              value={clubName}
              onChange={(e) => setClubName(e.target.value)}
              onBlur={handleSaveClubName}
              placeholder="e.g. Star Billiards"
              className="w-full px-4 py-3.5 bg-bg border border-border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint min-h-[44px]"
            />
          </div>

          {/* Currency — compact read-only one-liner (BUG-S4). INR-only per decisions_active.md */}
          <div className="mb-3 text-[13px] text-text-faint">
            Currency: <span className="text-text-dim">₹ Indian Rupee</span>
          </div>

          {/* UPI ID */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] font-mono uppercase tracking-widest text-text-faint">
                UPI ID
              </label>
              <span className="text-[11px] text-text-faint font-mono">optional</span>
            </div>
            <input
              type="text"
              inputMode="email"
              value={upiId}
              onChange={(e) => { setUpiId(e.target.value); setUpiError(null) }}
              onBlur={handleUpiBlur}
              placeholder="e.g. example@upi"
              className={`w-full bg-bg border rounded-2xl px-4 py-3.5 text-text text-[14px] font-mono focus:outline-none transition-colors min-h-[44px] placeholder:text-text-faint ${
                upiError ? 'border-busy focus:border-busy' : 'border-border focus:border-accent'
              }`}
            />
            {upiError && (
              <p className="text-busy text-[12px] mt-1.5">{upiError}</p>
            )}
            {!upiError && (
              <p className="text-text-faint text-[11px] mt-1.5">
                When you set this, a payment QR appears after every session ends. Players scan and pay the exact amount.
              </p>
            )}
            <div className="mt-2.5 flex items-center gap-3">
              <button
                onClick={handleSaveUpiId}
                disabled={
                  Boolean(upiError) ||
                  upiId.trim() === (settings?.upiId ?? '') ||
                  upiSave.state === 'saving'
                }
                className="min-h-[44px] px-5 rounded-xl text-[13px] font-bold active:scale-[0.99] transition-transform bg-accent text-bg disabled:bg-bg disabled:text-text-faint disabled:border disabled:border-border"
              >
                Save UPI ID
              </button>
              <SaveIndicator state={upiSave.state} error={upiSave.error} />
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-border my-4" />

          {/* Low-stock threshold (#92) */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="lowStockThreshold" className="text-[11px] font-mono uppercase tracking-widest text-text-faint">
                Low stock alert at
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="lowStockThreshold"
                  type="number"
                  min={1}
                  max={999}
                  step={1}
                  inputMode="numeric"
                  value={lowStockDraft}
                  onChange={(e) => setLowStockDraft(e.target.value)}
                  onBlur={handleLowStockBlur}
                  className="w-20 px-3 py-2 bg-bg border border-border rounded-xl text-text text-[15px] text-right tabular-nums focus:border-accent outline-none min-h-[44px]"
                />
                <span className="text-[12px] text-text-muted">units</span>
              </div>
            </div>
            <p className="text-[11px] text-text-faint mt-1.5">
              Canteen items at or below this quantity show a "Low stock" badge.
            </p>
          </div>

          {/* Divider */}
          <div className="border-t border-border my-4" />

          {/* Time Rounding */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[14px] font-semibold text-text">Time rounding</span>
            </div>
            <p className="text-[11px] text-text-faint mb-3">
              Rounds up session time when stopping. Helps if you charge by 15-min slots.
            </p>
            <div className="flex gap-1 bg-bg border border-border rounded-xl p-1">
              {(['none', '15min', '30min'] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => void handleRoundingChange(r)}
                  className={`flex-1 min-h-[44px] py-2 rounded-lg text-[12px] font-semibold transition-colors ${
                    (settings?.rounding ?? 'none') === r ? 'bg-accent text-bg' : 'text-text-dim'
                  }`}
                >
                  {r === 'none' ? 'None' : r === '15min' ? '15 min' : '30 min'}
                </button>
              ))}
            </div>
            {rateCardTableCount > 0 && (
              <p className="text-[11px] text-text-faint mt-2 opacity-70">
                Rounding is ignored on tables with a rate card.
              </p>
            )}
          </div>
        </SettingsSection>

        {/* ── 2: Tables ──────────────────────────────────────────────────── */}
        <SettingsSection
          id="tables"
          title="Tables"
          icon={<IconTables />}
          badge={
            <span className="text-text-faint text-xs font-mono mr-1">
              {activeTableCount}
            </span>
          }
          isOpen={openSection === 'tables'}
          onToggle={() => toggleSection('tables')}
        >
          <div className="mt-3 space-y-1">
            {tables.length === 0 ? (
              <p className="text-text-faint text-[13px] py-2">No tables yet.</p>
            ) : (
              tables.map((t) => (
                <div key={t.id} className="flex items-center justify-between py-2.5">
                  <div className={`flex-1 min-w-0 ${t.outOfService ? 'opacity-50' : ''}`}>
                    <div className="flex items-center gap-2">
                      <p className="text-[14px] font-semibold text-text leading-tight">{t.name}</p>
                      {t.outOfService && (
                        <span className="text-[9px] font-mono uppercase tracking-widest text-text-faint bg-bg px-2 py-0.5 rounded">
                          Disabled
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] font-mono text-text-faint uppercase tracking-wide mt-0.5">
                      {t.gameType} · ₹{t.ratePerHour}/hr
                      {t.ratePerFrame ? ` · ₹${t.ratePerFrame}/frame` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => setTableModal({ open: true, table: t })}
                    className="w-9 h-9 min-w-[44px] min-h-[44px] flex items-center justify-center text-text-dim rounded-lg active:bg-bg transition-colors ml-3 shrink-0"
                  >
                    <PencilIcon />
                  </button>
                </div>
              ))
            )}
            <button
              onClick={() => setTableModal({ open: true })}
              className="w-full min-h-[44px] mt-1 py-2.5 border border-dashed border-border rounded-xl text-[13px] font-semibold text-accent flex items-center justify-center gap-1.5"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
              Add Table
            </button>
          </div>
        </SettingsSection>

        {/* ── 3: Alerts ──────────────────────────────────────────────────── */}
        <SettingsSection
          id="alerts"
          title="Alerts"
          icon={<IconAlerts />}
          isOpen={openSection === 'alerts'}
          onToggle={() => toggleSection('alerts')}
        >
          <div className="mt-3 space-y-4">
            <div className="flex items-center justify-between min-h-[44px]">
              <div>
                <p className="text-[14px] font-semibold text-text">Alarm sound</p>
                <p className="text-[11px] text-text-faint mt-0.5">Two-tone beep when timer alert fires</p>
              </div>
              <Toggle
                value={settings?.alarmSoundEnabled ?? true}
                onChange={(v) => void updateSettings({ alarmSoundEnabled: v })}
                aria-label="Toggle alarm sound"
              />
            </div>
            <div className="flex items-center justify-between min-h-[44px]">
              <div>
                <p className="text-[14px] font-semibold text-text">Vibration</p>
                <p className="text-[11px] text-text-faint mt-0.5">Phone vibrates when alert fires</p>
              </div>
              <Toggle
                value={settings?.alarmVibrationEnabled ?? true}
                onChange={(v) => void updateSettings({ alarmVibrationEnabled: v })}
                aria-label="Toggle alarm vibration"
              />
            </div>
            <button
              onClick={() => {
                unlockAudio()
                if (settings?.alarmSoundEnabled ?? true) playBeepOnce()
                if (settings?.alarmVibrationEnabled ?? true) triggerVibration()
              }}
              className="w-full min-h-[44px] flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-bg border border-border active:bg-bg-card transition-colors"
            >
              <span className="text-[14px] text-text font-semibold">Test alert</span>
              <span className="text-[14px]">🔔</span>
            </button>
          </div>
        </SettingsSection>

        {/* ── 4: Subscription ─────────────────────────────────────────────── */}
        <SettingsSection
          id="subscription"
          title="Subscription"
          icon={<IconSubscription />}
          badge={<SubscriptionBadge />}
          isOpen={openSection === 'subscription'}
          onToggle={() => toggleSection('subscription')}
        >
          <div className="mt-3">
            {/* Pattern A3 — three-branch render: never gate on && subscription */}
            {subscription === null ? (
              <div className="py-2">
                <div className="w-full h-5 rounded-md bg-bg animate-pulse mb-2" />
                <div className="w-2/3 h-4 rounded-md bg-bg animate-pulse" />
              </div>
            ) : subscription.status !== 'none' ? (
              <div className="space-y-1">
                <div className="flex items-center justify-between py-2.5 border-b border-border">
                  <span className="text-[13px] text-text-dim">Plan</span>
                  <span className="text-[14px] text-text capitalize">
                    {subscription.plan ?? '—'}{' '}
                    <span className="text-text-faint text-[12px]">
                      {subscription.cancelAtPeriodEnd ? '(cancelling)' : ''}
                    </span>
                  </span>
                </div>
                <div className="flex items-center justify-between py-2.5 border-b border-border">
                  <span className="text-[13px] text-text-dim">Status</span>
                  <span className="text-[13px] font-mono">
                    {subscription.status === 'trialing' && subscription.trialEndsAt && (
                      <span className="text-accent">
                        Trialing — {Math.max(0, Math.ceil((subscription.trialEndsAt - Date.now()) / 86400000))} days left
                      </span>
                    )}
                    {subscription.status === 'active' && !subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd && (
                      <span className="text-accent">Active — renews {formatDate(subscription.currentPeriodEnd)}</span>
                    )}
                    {subscription.status === 'active' && subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd && (
                      <span style={{ color: '#f7c948' }}>Cancelling {formatDate(subscription.currentPeriodEnd)}</span>
                    )}
                    {subscription.status === 'past_due' && (
                      <span className="text-busy">Payment failed</span>
                    )}
                    {(subscription.status === 'cancelled' || subscription.status === 'expired') && (
                      <span className="text-text-faint">{subscription.status}</span>
                    )}
                  </span>
                </div>
                {subscription.currentPeriodEnd && subscription.status === 'active' && (
                  <div className="flex items-center justify-between py-2.5 border-b border-border">
                    <span className="text-[13px] text-text-dim">Next charge</span>
                    <span className="text-[13px] font-mono text-text">
                      {subscription.plan === 'starter'
                        ? rupee(299)
                        : subscription.plan === 'standard'
                        ? rupee(599)
                        : rupee(999)}{' '}
                      on {formatDate(subscription.currentPeriodEnd)}
                    </span>
                  </div>
                )}
                <div className="pt-2 space-y-2">
                  {!subscription.cancelAtPeriodEnd && (subscription.status === 'active' || subscription.status === 'trialing') && (
                    <button
                      onClick={() => setCancelSubModal(true)}
                      className="w-full min-h-[44px] flex items-center justify-between px-4 py-3 rounded-xl bg-busy/8 border border-busy/20 active:bg-busy/15 transition-colors"
                    >
                      <span className="text-[14px] text-busy">Cancel subscription</span>
                      <span className="text-[12px] text-busy/60">→</span>
                    </button>
                  )}
                  <button
                    onClick={() => navigate('/subscribe?change=1')}
                    className="w-full min-h-[44px] flex items-center justify-between px-4 py-3 rounded-xl bg-bg border border-border active:bg-bg-card transition-colors"
                  >
                    <span className="text-[14px] text-text">Change plan</span>
                    <span className="text-[12px] text-accent">→</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-2 flex flex-col gap-3">
                <div>
                  <p className="text-[15px] font-semibold text-text">No active plan</p>
                  <p className="text-[13px] text-text-dim mt-0.5">Subscribe to unlock all features</p>
                </div>
                <button
                  onClick={() => navigate('/subscribe')}
                  aria-label="Subscribe to ClubKeeper"
                  className="w-full min-h-[44px] py-3.5 bg-accent text-bg rounded-xl text-[14px] font-bold active:opacity-80 transition-opacity"
                >
                  Subscribe →
                </button>
              </div>
            )}
          </div>
        </SettingsSection>

        {/* ── 4.5: Piggy ────────────────────────────────────────────────── */}
        <SettingsSection
          id="piggy"
          title="Piggy (cash float)"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 10h-1a7 7 0 0 0-14 0H3a1 1 0 0 0 0 2h1v2a4 4 0 0 0 4 4h1v2a1 1 0 0 0 2 0v-2h4v2a1 1 0 0 0 2 0v-2h0a4 4 0 0 0 4-4v-2h1a1 1 0 0 0 0-2z" />
              <circle cx="15" cy="9" r="1" fill="currentColor" />
            </svg>
          }
          isOpen={openSection === 'piggy'}
          onToggle={() => toggleSection('piggy')}
        >
          <div className="mt-3 space-y-3">
            <div className="bg-bg rounded-xl p-3 border border-border">
              <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Current piggy</p>
              <p className="text-[24px] font-mono font-bold text-text tabular-nums mt-1">
                ₹{Math.max(0, piggy?.current ?? 0).toLocaleString('en-IN')}
              </p>
              <div className="text-[11px] text-text-faint font-mono mt-2 space-y-0.5">
                <p>Opening ₹{(piggy?.opening ?? 0).toLocaleString('en-IN')}</p>
                <p>+ ₹{(piggy?.cashIn ?? 0).toLocaleString('en-IN')} collected · − ₹{(piggy?.restockOut ?? 0).toLocaleString('en-IN')} restocks</p>
                {piggyStartedAt && (
                  <p>Started {format(new Date(piggyStartedAt), 'd MMM yyyy')}</p>
                )}
              </div>
            </div>
            <button
              onClick={() => navigate('/piggy')}
              className="w-full min-h-[44px] flex flex-col items-start px-4 py-3 rounded-xl bg-bg border border-border active:bg-bg-card transition-colors"
            >
              <span className="text-[14px] text-text font-semibold">View piggy details</span>
              <span className="text-[11px] text-text-faint mt-0.5">
                Edit opening balance, see restock log, view cash collected by week.
              </span>
            </button>
          </div>
        </SettingsSection>

        {/* ── 4.55: Peak Hour Pricing (#68) ───────────────────────────────── */}
        <SettingsSection
          id="peak-pricing"
          title="Peak Hour Pricing"
          icon={<IconPeakPricing />}
          isOpen={openSection === 'peak-pricing'}
          onToggle={() => toggleSection('peak-pricing')}
        >
          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between min-h-[44px]">
              <div className="pr-3">
                <p className="text-[14px] font-semibold text-text">Enable</p>
                <p className="text-[11px] text-text-faint mt-0.5">Charge a higher price for canteen items during set hours.</p>
              </div>
              <Toggle
                value={settings?.peakPricingEnabled ?? false}
                onChange={(v) => void updateSettings({ peakPricingEnabled: v })}
                aria-label="Toggle peak hour pricing"
              />
            </div>

            {(settings?.peakPricingEnabled ?? false) && (
              <>
                <button
                  onClick={() => setPeakSheetOpen(true)}
                  className="w-full min-h-[44px] flex items-center justify-between px-4 py-3 rounded-xl bg-bg border border-border active:bg-bg-card transition-colors"
                >
                  <div className="text-left">
                    <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Peak hours</p>
                    <p className="text-[15px] text-text font-mono tabular-nums mt-0.5">
                      {formatPeakTime12(settings?.peakStartHour ?? 22, settings?.peakStartMinute ?? 0)}
                      {' → '}
                      {formatPeakTime12(settings?.peakEndHour ?? 6, settings?.peakEndMinute ?? 0)}
                    </p>
                  </div>
                  <span className="text-[12px] text-accent flex items-center gap-1">
                    Edit
                    <PencilIcon />
                  </span>
                </button>

                <p className="text-[11px] text-text-faint leading-relaxed">
                  Some items cost more during these hours due to higher demand and staffing. Set an optional peak price per item on the Canteen page.
                </p>
              </>
            )}
          </div>
        </SettingsSection>

        {/* ── 4.6: Player Hub ────────────────────────────────────────────── */}
        <SettingsSection
          id="player-hub"
          title="Player Hub"
          icon={
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          }
          isOpen={openSection === 'player-hub'}
          onToggle={() => toggleSection('player-hub')}
        >
          <PlayerHubSettings settings={settings} />
        </SettingsSection>

        {/* ── 5: Data & Backup ───────────────────────────────────────────── */}
        <SettingsSection
          id="data"
          title="Data & Backup"
          icon={<IconData />}
          isOpen={openSection === 'data'}
          onToggle={() => toggleSection('data')}
        >
          <div className="mt-3 space-y-2">
            <button
              onClick={handleExportJSON}
              className="w-full min-h-[44px] flex flex-col items-start px-4 py-3 rounded-xl bg-bg border border-border active:bg-bg-card transition-colors"
            >
              <span className="text-[14px] text-text font-semibold">Export everything</span>
              <span className="text-[11px] text-text-faint mt-0.5">Download a backup file you can save or import later.</span>
            </button>
            <button
              onClick={handleImportButtonClick}
              className="w-full min-h-[44px] flex items-center justify-between px-4 py-3 rounded-xl bg-bg border border-border active:bg-bg-card transition-colors"
            >
              <span className="flex flex-col items-start">
                <span className="text-[14px] text-text font-semibold">Import everything</span>
                <span className="text-[11px] text-text-faint mt-0.5">Restore from a backup file. Replaces all current data.</span>
              </span>
              <span className="text-text-dim shrink-0 ml-3"><IconUpload /></span>
            </button>
            <input
              ref={importFileRef}
              type="file"
              accept="application/json,.json"
              onChange={handleImportFileChange}
              className="hidden"
            />
            <button
              onClick={() => setClearModal(true)}
              className="w-full min-h-[44px] flex flex-col items-start px-4 py-3 rounded-xl bg-busy/8 border border-busy/20 active:bg-busy/15 transition-colors"
            >
              <span className="text-[14px] text-busy font-semibold">Clear all sessions</span>
              <span className="text-[11px] text-text-faint mt-0.5">Removes all session history. Tables and settings stay. Irreversible.</span>
            </button>
            <button
              onClick={() => setCleanModal(true)}
              className="w-full min-h-[44px] flex flex-col items-start px-4 py-3 rounded-xl bg-bg border border-border active:bg-bg-card transition-colors"
            >
              <span className="text-[14px] text-text font-semibold">Tidy player names</span>
              <span className="text-[11px] text-text-faint mt-0.5">Removes stray symbols and trims spaces in saved player names.</span>
            </button>
            <button
              onClick={() => { setResetConfirmText(''); setResetModal(true) }}
              className="w-full min-h-[44px] flex flex-col items-start px-4 py-3 rounded-xl bg-busy/8 border border-busy/20 active:bg-busy/15 transition-colors"
            >
              <span className="text-[14px] text-busy font-bold">Reset everything</span>
              <span className="text-[11px] text-text-faint mt-0.5">Wipes tables, sessions, and settings. Use only when you want a fresh start.</span>
            </button>
          </div>
        </SettingsSection>

        {/* ── 6: About ───────────────────────────────────────────────────── */}
        <SettingsSection
          id="about"
          title="About"
          icon={<IconAbout />}
          isOpen={openSection === 'about'}
          onToggle={() => toggleSection('about')}
        >
          <div className="mt-3 space-y-1 divide-y divide-border">
            <div className="flex items-center justify-between py-2.5">
              <span className="text-[14px] text-text-dim">App version</span>
              <span className="text-[14px] text-text-faint font-mono">v1.0</span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-[14px] text-text-dim">Total tables</span>
              <span className="text-[14px] text-text-faint">{tables.length}</span>
            </div>
            {storageInfo && (
              <div className="flex items-center justify-between py-2.5">
                <span className="text-[14px] text-text-dim">Local storage used</span>
                <span className="text-[14px] text-text-faint font-mono">
                  {formatBytes(storageInfo.usage)} / {formatBytes(storageInfo.quota)}
                </span>
              </div>
            )}
          </div>
        </SettingsSection>

        {/* ── 7: Account ─────────────────────────────────────────────────── */}
        <SettingsSection
          id="account"
          title="Account"
          icon={<IconAccount />}
          isOpen={openSection === 'account'}
          onToggle={() => toggleSection('account')}
        >
          <div className="mt-3">
            {user?.email && (
              <div className="p-3 bg-bg rounded-xl mb-3">
                <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Signed in as</p>
                <p className="text-text text-sm mt-0.5 truncate">{user.email}</p>
              </div>
            )}
            <button
              onClick={() => { void useAuthStore.getState().signOut() }}
              className="w-full min-h-[44px] py-3.5 bg-busy/8 text-busy border border-busy/20 rounded-xl text-[14px] font-semibold active:bg-busy/15 transition-colors"
            >
              Sign out
            </button>
          </div>
        </SettingsSection>

      </div>

      {/* ── Rounding confirm modal ──────────────────────────────────────── */}
      <Modal
        open={roundingConfirmOpen}
        onClose={() => { setRoundingConfirmOpen(false); setPendingRounding(null) }}
        title="Change rounding?"
      >
        <p className="text-text-dim text-[14px] mb-4">
          You have{' '}
          <span className="text-text font-semibold">
            {activeSessionCount} session{activeSessionCount !== 1 ? 's' : ''}
          </span>{' '}
          running right now. The new rounding rule will apply to sessions you stop{' '}
          <span className="text-text">after</span> this change.
        </p>
        <p className="text-text-faint text-[12px] mb-5">
          Sessions already stopped today won't change.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => { setRoundingConfirmOpen(false); setPendingRounding(null) }}
            className="py-3.5 bg-bg-card border border-border text-text rounded-xl text-[14px] font-semibold"
          >
            Cancel
          </button>
          <button
            onClick={handleApplyRounding}
            className="py-3.5 bg-accent text-bg rounded-xl text-[14px] font-bold"
          >
            Apply new rounding
          </button>
        </div>
      </Modal>

      {/* ── Cancel subscription modal ───────────────────────────────────── */}
      <Modal
        open={cancelSubModal}
        onClose={() => !busy && setCancelSubModal(false)}
        title="Cancel subscription?"
      >
        <p className="text-text-dim text-[14px] mb-5">
          You'll keep access until the end of your current billing period. After that, ClubKeeper will stop working.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setCancelSubModal(false)}
            disabled={busy}
            className="py-3.5 bg-bg-card border border-border text-text rounded-xl text-[14px] font-semibold"
          >
            Keep plan
          </button>
          <button
            onClick={handleCancelSubscription}
            disabled={busy}
            className="py-3.5 bg-busy text-white rounded-xl text-[14px] font-bold disabled:opacity-50"
          >
            {busy ? 'Cancelling…' : 'Yes, cancel'}
          </button>
        </div>
      </Modal>

      {/* ── Table form modal ────────────────────────────────────────────── */}
      <TableFormModal
        open={tableModal.open}
        onClose={() => setTableModal({ open: false })}
        table={tableModal.table}
        existingTables={tables}
      />

      {/* ── Peak Hour window picker (#68) ───────────────────────────────── */}
      <PeakWindowBottomSheet
        open={peakSheetOpen}
        initialStartHour={settings?.peakStartHour ?? 22}
        initialStartMinute={settings?.peakStartMinute ?? 0}
        initialEndHour={settings?.peakEndHour ?? 6}
        initialEndMinute={settings?.peakEndMinute ?? 0}
        onCancel={() => setPeakSheetOpen(false)}
        onSave={({ startHour, startMinute, endHour, endMinute }) => {
          void updateSettings({
            peakStartHour: startHour,
            peakStartMinute: startMinute,
            peakEndHour: endHour,
            peakEndMinute: endMinute,
          })
          setPeakSheetOpen(false)
        }}
      />

      {/* ── Clean invalid names modal ───────────────────────────────────── */}
      <Modal
        open={cleanModal}
        onClose={() => !busy && setCleanModal(false)}
        title="Tidy player names?"
      >
        <p className="text-text-dim text-[14px] mb-5">
          This will clear player names from old sessions that don't match current validation rules.
          Session timing and amounts will be preserved.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setCleanModal(false)}
            disabled={busy}
            className="py-3.5 bg-bg-card border border-border text-text rounded-xl text-[14px] font-semibold"
          >
            Cancel
          </button>
          <button
            onClick={handleCleanInvalidNames}
            disabled={busy}
            className="py-3.5 bg-accent text-bg rounded-xl text-[14px] font-bold disabled:opacity-50"
          >
            {busy ? 'Cleaning…' : 'Continue'}
          </button>
        </div>
      </Modal>

      {/* ── Clear sessions modal ────────────────────────────────────────── */}
      <Modal
        open={clearModal}
        onClose={() => !busy && setClearModal(false)}
        title="Clear all sessions?"
      >
        <p className="text-text-dim text-[14px] mb-5">
          All session history will be permanently deleted. Tables will not be affected.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button
            data-testid="clear-modal-cancel"
            onClick={() => setClearModal(false)}
            disabled={busy}
            className="py-3.5 bg-bg-card border border-border text-text rounded-xl text-[14px] font-semibold"
          >
            Cancel
          </button>
          <button
            onClick={handleClearSessions}
            disabled={busy}
            className="py-3.5 bg-busy text-white rounded-xl text-[14px] font-bold disabled:opacity-50"
          >
            {busy ? 'Clearing…' : 'Delete All'}
          </button>
        </div>
      </Modal>

      {/* ── Reset everything modal ──────────────────────────────────────── */}
      <Modal
        open={resetModal}
        onClose={() => !busy && setResetModal(false)}
        title="Reset everything?"
      >
        <p className="text-text-dim text-[14px] mb-4">
          All tables, sessions, and settings will be deleted and replaced with demo data.
          This cannot be undone.
        </p>
        <div className="mb-4">
          <label className="block text-[11px] font-mono uppercase tracking-widest text-text-faint mb-2">
            Type RESET to confirm
          </label>
          <input
            type="text"
            value={resetConfirmText}
            onChange={(e) => setResetConfirmText(e.target.value.toUpperCase())}
            placeholder="RESET"
            className="w-full bg-bg border border-border rounded-xl px-4 py-3 text-text text-[15px] font-mono placeholder-text-faint focus:border-busy focus:outline-none transition-colors"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setResetModal(false)}
            disabled={busy}
            className="py-3.5 bg-bg-card border border-border text-text rounded-xl text-[14px] font-semibold"
          >
            Cancel
          </button>
          <button
            onClick={handleReset}
            disabled={resetConfirmText !== 'RESET' || busy}
            className="py-3.5 bg-busy text-white rounded-xl text-[14px] font-bold disabled:opacity-40"
          >
            {busy ? 'Resetting…' : 'Reset'}
          </button>
        </div>
      </Modal>

      {/* ── Import everything confirm modal ───────────────────────────── */}
      <Modal
        open={importConfirmOpen}
        onClose={handleImportCancel}
        title="Replace all current data?"
      >
        <p className="text-text-dim text-[14px] mb-5">
          This will replace all your current data with the backup. This cannot be undone.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={handleImportCancel}
            disabled={importing}
            className="py-3.5 bg-bg-card border border-border text-text rounded-xl text-[14px] font-semibold"
          >
            Cancel
          </button>
          <button
            onClick={handleImportConfirm}
            disabled={importing}
            className="py-3.5 bg-busy text-white rounded-xl text-[14px] font-bold disabled:opacity-50"
          >
            {importing ? 'Importing…' : 'Yes, replace everything'}
          </button>
        </div>
      </Modal>

      {/* ── Import success overlay ──────────────────────────────────────── */}
      {importSuccess && (
        <div
          className="fixed inset-0 z-50 bg-bg flex flex-col"
          style={{
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          <div className="flex-1 flex flex-col items-center justify-center px-5 text-center">
            <div className="w-20 h-20 rounded-full bg-accent/15 text-accent flex items-center justify-center mb-5">
              <IconCheck />
            </div>
            <h2 className="text-[22px] font-bold text-text mb-2">Backup restored</h2>
            <p className="text-[14px] text-text-dim mb-6">Your data is back. Tap Done to continue.</p>
            <div className="w-full max-w-sm bg-bg-card border border-border rounded-2xl divide-y divide-border">
              <ImportCountRow label="Tables" value={importSuccess.counts.tables} />
              <ImportCountRow label="Sessions" value={importSuccess.counts.sessions} />
              <ImportCountRow label="Session items" value={importSuccess.counts.sessionItems} />
              <ImportCountRow label="Customers" value={importSuccess.counts.customers} />
              <ImportCountRow
                label="Wallet balance"
                value={`₹${importSuccess.walletBalanceTotal.toLocaleString('en-IN')}`}
              />
              <ImportCountRow label="Canteen items" value={importSuccess.counts.canteenItems} />
              <ImportCountRow label="Canteen sales" value={importSuccess.counts.canteenSales} />
              <ImportCountRow label="Stock purchases" value={importSuccess.counts.stockPurchases} />
              <ImportCountRow label="Wallet transactions" value={importSuccess.counts.walletTxs} />
              <ImportCountRow label="Bookings" value={importSuccess.counts.bookings} />
            </div>
          </div>
          <div
            className="shrink-0 px-5 pt-3 border-t border-border"
            style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
          >
            <button
              onClick={handleImportSuccessDone}
              className="w-full min-h-[44px] py-3.5 bg-accent text-bg rounded-xl text-[15px] font-bold active:opacity-90 transition-opacity"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ImportCountRow({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="text-[13px] text-text-dim">{label}</span>
      <span className="text-[14px] text-text font-semibold tabular-nums">{value}</span>
    </div>
  )
}

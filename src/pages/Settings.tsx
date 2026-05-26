import { useState, useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { useTables, useSettings } from '../hooks/useLiveData'
import { updateSettings, clearAllSessions, resetEverything, getAllDataForExport } from '../db/queries'
import { TableFormModal } from '../components/TableFormModal'
import { Modal } from '../components/Modal'
import { useToastStore } from '../store/toastStore'
import { useAuthStore } from '../store/authStore'
import { validatePlayerName, validateUpiId } from '../lib/validation'
import { db } from '../db/database'
import { supabase } from '../lib/supabase'
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

// ─── Layout helpers ───────────────────────────────────────────────────────────

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-7">
      <div className="flex items-center justify-between px-4 mb-2">
        <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint">{title}</p>
        {right}
      </div>
      <div className="mx-4 bg-bg-elevated border border-border rounded-2xl divide-y divide-border overflow-hidden">
        {children}
      </div>
    </div>
  )
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-between px-4 py-3.5 gap-3">{children}</div>
}

function RowLabel({ children }: { children: ReactNode }) {
  return <span className="text-[14px] text-text shrink-0">{children}</span>
}

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

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Settings() {
  const navigate = useNavigate()
  const tables = useTables()
  const settings = useSettings()
  const { subscription } = useAuthStore()

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
    await updateSettings({ clubName: trimmed })
  }

  function handleUpiBlur() {
    const err = validateUpiId(upiId)
    setUpiError(err)
  }

  async function handleSaveUpiId() {
    const trimmed = upiId.trim()
    const err = validateUpiId(trimmed)
    if (err) { setUpiError(err); return }
    // Save trimmed value (or undefined to clear it)
    await updateSettings({ upiId: trimmed || undefined })
    useToastStore.getState().show('UPI ID saved', 'success')
    setUpiError(null)
  }

  async function handleRoundingChange(newMode: RoundingMode) {
    if (newMode === settings?.rounding) return
    // Count active sessions — warn owner if any are running
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
    // No active sessions — apply immediately
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

  const sessionCount = 0

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="pt-safe min-h-screen bg-bg pb-32">

      {/* Top bar */}
      <div className="flex items-center px-3 pt-3 pb-4">
        <button
          onClick={() => navigate('/tables')}
          className="flex items-center gap-1 text-text-dim px-1 py-1.5 -ml-1 active:text-text transition-colors"
        >
          <ChevronLeft />
          <span className="text-sm">Home</span>
        </button>
        <h1 className="text-[18px] font-bold text-text ml-2">Settings</h1>
      </div>

      {/* ── Section 1: Club Info ────────────────────────────────────────── */}
      <Section title="Club Info">
        <Row>
          <RowLabel>Club Name</RowLabel>
          <input
            type="text"
            value={clubName}
            onChange={(e) => setClubName(e.target.value)}
            onBlur={handleSaveClubName}
            className="flex-1 bg-transparent text-right text-[14px] text-text focus:outline-none"
          />
        </Row>
        <Row>
          <RowLabel>Currency</RowLabel>
          <span className="text-[14px] text-text-faint">₹ (Indian Rupee)</span>
        </Row>

        {/* UPI ID */}
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-1.5">
            <RowLabel>UPI ID</RowLabel>
            <span className="text-[11px] text-text-faint font-mono">optional</span>
          </div>
          <input
            type="text"
            inputMode="email"
            value={upiId}
            onChange={(e) => { setUpiId(e.target.value); setUpiError(null) }}
            onBlur={handleUpiBlur}
            placeholder="e.g. 7758969291@axl"
            className={`w-full bg-bg border rounded-xl px-4 py-3 text-text text-[14px] font-mono focus:outline-none transition-colors min-h-[44px] placeholder:text-text-faint ${
              upiError ? 'border-busy focus:border-busy' : 'border-border focus:border-accent'
            }`}
          />
          {upiError && (
            <p className="text-busy text-[12px] mt-1.5">{upiError}</p>
          )}
          {!upiError && (
            <p className="text-text-faint text-[11px] mt-1.5">
              When set, a payment QR appears after every session ends. Players scan and pay the exact amount.
            </p>
          )}
          <button
            onClick={handleSaveUpiId}
            disabled={Boolean(upiError) || upiId.trim() === (settings?.upiId ?? '')}
            className="mt-2.5 min-h-[44px] px-5 bg-accent text-bg rounded-xl text-[13px] font-bold disabled:opacity-40 active:scale-[0.99] transition-transform"
          >
            Save UPI ID
          </button>
        </div>

        {/* Time Rounding */}
        <Row>
          <RowLabel>Time Rounding</RowLabel>
        </Row>
        <div className="px-4 pb-3">
          <div className="flex gap-1 bg-bg border border-border rounded-xl p-1">
            {(['none', '15min', '30min'] as const).map((r) => (
              <button
                key={r}
                onClick={() => void handleRoundingChange(r)}
                className={`flex-1 py-2 rounded-lg text-[12px] font-semibold transition-colors ${
                  (settings?.rounding ?? 'none') === r ? 'bg-accent text-bg' : 'text-text-dim'
                }`}
              >
                {r === 'none' ? 'None' : r === '15min' ? '15 min' : '30 min'}
              </button>
            ))}
          </div>
        </div>
      </Section>

      {/* ── Section 2: Tables ───────────────────────────────────────────── */}
      <Section
        title="Tables"
        right={
          <button
            onClick={() => setTableModal({ open: true })}
            className="text-[13px] font-semibold text-accent"
          >
            + Add Table
          </button>
        }
      >
        {tables.length === 0 ? (
          <Row><span className="text-text-faint text-[13px]">No tables yet.</span></Row>
        ) : (
          tables.map((t) => (
            <div key={t.id} className="flex items-center justify-between px-4 py-3">
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
                className="w-9 h-9 flex items-center justify-center text-text-dim rounded-lg active:bg-bg transition-colors ml-3 shrink-0"
              >
                <PencilIcon />
              </button>
            </div>
          ))
        )}
      </Section>

      {/* ── Section 3: Subscription ─────────────────────────────────────── */}
      {subscription === null ? (
        <Section title="Subscription">
          <Row>
            <span className="text-[13px] text-text-faint font-mono">Loading subscription…</span>
          </Row>
        </Section>
      ) : subscription.status !== 'none' ? (
        <Section title="Subscription">
          <Row>
            <RowLabel>Plan</RowLabel>
            <span className="text-[14px] text-text capitalize">
              {subscription.plan ?? '—'}{' '}
              <span className="text-text-faint text-[12px]">
                {subscription.cancelAtPeriodEnd ? '(cancelling)' : ''}
              </span>
            </span>
          </Row>
          <Row>
            <RowLabel>Status</RowLabel>
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
          </Row>
          {subscription.currentPeriodEnd && subscription.status === 'active' && (
            <Row>
              <RowLabel>Next charge</RowLabel>
              <span className="text-[13px] font-mono text-text">
                {subscription.plan === 'starter'
                  ? rupee(299)
                  : subscription.plan === 'standard'
                  ? rupee(599)
                  : rupee(999)}{' '}
                on {formatDate(subscription.currentPeriodEnd)}
              </span>
            </Row>
          )}
          {!subscription.cancelAtPeriodEnd && (subscription.status === 'active' || subscription.status === 'trialing') && (
            <button
              onClick={() => setCancelSubModal(true)}
              className="w-full flex items-center justify-between px-4 py-3.5 active:bg-bg transition-colors"
            >
              <span className="text-[14px] text-busy">Cancel subscription</span>
              <span className="text-[12px] text-text-faint">→</span>
            </button>
          )}
          <button
            onClick={() => navigate('/subscribe?change=1')}
            className="w-full flex items-center justify-between px-4 py-3.5 active:bg-bg transition-colors"
          >
            <span className="text-[14px] text-text">Change plan</span>
            <span className="text-[12px] text-accent">→</span>
          </button>
        </Section>
      ) : (
        <Section title="Subscription">
          <div className="px-4 py-5 flex flex-col gap-3">
            <div>
              <p className="text-[15px] font-semibold text-text">No active plan</p>
              <p className="text-[13px] text-text-dim mt-0.5">Subscribe to unlock all features</p>
            </div>
            <button
              onClick={() => navigate('/subscribe')}
              aria-label="Subscribe to ClubKeeper"
              className="w-full py-3.5 bg-accent text-bg rounded-xl text-[14px] font-bold active:opacity-80 transition-opacity"
            >
              Subscribe →
            </button>
          </div>
        </Section>
      )}

      {/* ── Section 4: Data ─────────────────────────────────────────────── */}
      <Section title="Data">
        <button
          onClick={handleExportJSON}
          className="w-full flex items-center justify-between px-4 py-3.5 active:bg-bg transition-colors"
        >
          <span className="text-[14px] text-text">Export All Data (JSON)</span>
          <span className="text-[13px] text-accent font-semibold">↓</span>
        </button>
        <button
          onClick={() => setClearModal(true)}
          className="w-full flex items-center justify-between px-4 py-3.5 active:bg-bg transition-colors"
        >
          <span className="text-[14px] text-busy">Clear All Sessions</span>
          <span className="text-[12px] text-text-faint">Irreversible</span>
        </button>
        <button
          onClick={() => setCleanModal(true)}
          className="w-full flex items-center justify-between px-4 py-3.5 active:bg-bg transition-colors"
        >
          <span className="text-[14px] text-text">Clean Invalid Player Names</span>
          <span className="text-[12px] text-text-faint">Preserve sessions</span>
        </button>
        <button
          onClick={() => { setResetConfirmText(''); setResetModal(true) }}
          className="w-full flex items-center justify-between px-4 py-3.5 active:bg-bg transition-colors"
        >
          <span className="text-[14px] text-busy font-bold">Reset Everything</span>
          <span className="text-[12px] text-text-faint">Deletes all data</span>
        </button>
      </Section>

      {/* ── Section 5: About ────────────────────────────────────────────── */}
      <Section title="About">
        <Row>
          <RowLabel>App Version</RowLabel>
          <span className="text-[14px] text-text-faint font-mono">v1.0</span>
        </Row>
        <Row>
          <RowLabel>Tables</RowLabel>
          <span className="text-[14px] text-text-faint">{tables.length}</span>
        </Row>
        {storageInfo && (
          <Row>
            <RowLabel>Storage Used</RowLabel>
            <span className="text-[14px] text-text-faint font-mono">
              {formatBytes(storageInfo.usage)} / {formatBytes(storageInfo.quota)}
            </span>
          </Row>
        )}
        {sessionCount > 0 && (
          <Row>
            <RowLabel>Sessions</RowLabel>
            <span className="text-[14px] text-text-faint">{sessionCount}</span>
          </Row>
        )}
      </Section>

      {/* ── Section 6: Account ─────────────────────────────────────────── */}
      <Section title="Account">
        <button
          onClick={() => void useAuthStore.getState().signOut()}
          className="w-full flex items-center justify-between px-4 py-3.5 active:bg-bg transition-colors"
        >
          <span className="text-[14px] text-busy">Sign Out</span>
          <span className="text-[12px] text-text-faint">→</span>
        </button>
      </Section>

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

      {/* ── Clean invalid names modal ───────────────────────────────────── */}
      <Modal
        open={cleanModal}
        onClose={() => !busy && setCleanModal(false)}
        title="Clean Invalid Player Names?"
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
    </div>
  )
}

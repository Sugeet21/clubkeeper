import { useState, useEffect, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { useTables, useSettings } from '../hooks/useLiveData'
import { updateSettings, clearAllSessions, resetEverything, getAllDataForExport } from '../db/queries'
import { TableFormModal } from '../components/TableFormModal'
import { Modal } from '../components/Modal'
import { useToastStore } from '../store/toastStore'
import { validatePlayerName } from '../lib/validation'
import { db } from '../db/database'
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

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Settings() {
  const navigate = useNavigate()
  const tables = useTables()
  const settings = useSettings()

  // Club name draft
  const [clubName, setClubName] = useState('')
  useEffect(() => {
    if (settings?.clubName !== undefined) setClubName(settings.clubName)
  }, [settings?.clubName])

  // Table form modal
  const [tableModal, setTableModal] = useState<{ open: boolean; table?: GameTable }>({ open: false })

  // Modals
  const [clearModal, setClearModal] = useState(false)
  const [resetModal, setResetModal] = useState(false)
  const [resetConfirmText, setResetConfirmText] = useState('')
  const [cleanModal, setCleanModal] = useState(false)
  const [storageInfo, setStorageInfo] = useState<{ usage: number; quota: number } | null>(null)
  const [busy, setBusy] = useState(false)

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
      navigate('/')
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

  const sessionCount = 0 // shown in about; could use useLiveQuery but not worth extra hook here

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="pt-safe min-h-screen bg-bg pb-32">

      {/* Top bar */}
      <div className="flex items-center px-3 pt-3 pb-4">
        <button
          onClick={() => navigate('/')}
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
        <Row>
          <RowLabel>Time Rounding</RowLabel>
        </Row>
        <div className="px-4 pb-3">
          <div className="flex gap-1 bg-bg border border-border rounded-xl p-1">
            {(['none', '15min', '30min'] as const).map((r) => (
              <button
                key={r}
                onClick={() => void updateSettings({ rounding: r })}
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
              {/* Text area fades for disabled tables; pencil stays full opacity */}
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

      {/* ── Section 3: Data ─────────────────────────────────────────────── */}
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

      {/* ── Section 4: About ────────────────────────────────────────────── */}
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

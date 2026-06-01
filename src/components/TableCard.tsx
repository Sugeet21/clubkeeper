import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import type { GameTable, Session } from '../types'
import { getElapsedMs, formatHMS } from '../lib/time'

interface Props {
  table: GameTable
  session: Session | undefined
  onStartTap: () => void
}

function MetaLine({ table }: { table: GameTable }) {
  const parts = [table.gameType.toUpperCase()]
  if (table.ratePerFrame) {
    parts.push(`₹${table.ratePerHour}/HR · ₹${table.ratePerFrame}/FRAME`)
  } else {
    parts.push(`₹${table.ratePerHour}/HR`)
  }
  return (
    <p className="text-[10px] uppercase tracking-wider text-text-faint font-mono mt-0.5">
      {parts.join(' · ')}
    </p>
  )
}

function Timer({ session, paused }: { session: Session; paused: boolean }) {
  const hms = formatHMS(getElapsedMs(session))
  const hhmm = hms.slice(0, 5)
  const ss = hms.slice(6)
  return (
    <span
      className={`text-[26px] font-mono font-bold tracking-tight leading-none ${
        paused ? 'text-paused' : 'text-text'
      }`}
    >
      {hhmm}
      <span className={`text-[18px] ${paused ? 'text-paused/60' : 'text-text-dim'}`}>
        :{ss}
      </span>
    </span>
  )
}

export default function TableCard({ table, session, onStartTap }: Props) {
  // OUT OF SERVICE
  if (table.outOfService) {
    return (
      <div className="rounded-[18px] border border-border bg-bg-card p-4 opacity-40">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-[17px] font-bold tracking-tight text-text">{table.name}</h3>
            <MetaLine table={table} />
          </div>
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 rounded-md bg-border text-text-faint border border-border">
            Out of Service
          </span>
        </div>
      </div>
    )
  }

  // Bell icon — passive indicator when alarm is armed and unacknowledged
  const alarmArmed =
    session != null &&
    session.notifyAtMs != null &&
    !session.notifyAcknowledgedAt

  // BUSY — session running
  if (session?.status === 'running') {
    return (
      <Link
        to={`/session/${session.id}`}
        className="block rounded-[18px] border border-busy/30 bg-gradient-to-br from-busy/[0.08] to-bg-card p-4 active:scale-[0.99] transition-transform"
      >
        <div className="flex items-start justify-between mb-2 min-w-0">
          <div className="min-w-0 flex-1">
            <h3 className="text-[17px] font-bold tracking-tight text-text">{table.name}</h3>
            <MetaLine table={table} />
          </div>
          <div className="text-right shrink-0 ml-3 flex items-start gap-2">
            {alarmArmed && (
              <svg
                width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="text-accent animate-pulse mt-0.5 shrink-0"
                aria-label="Alarm set"
              >
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 01-3.46 0" />
              </svg>
            )}
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-text leading-tight max-w-[140px] truncate">
                {session.playerName || '—'}
              </p>
              <p className="text-[11px] text-text-dim font-mono mt-0.5">
                Started {format(session.startedAt, 'h:mm a')}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 rounded-md bg-busy/20 text-busy border border-busy/30">
            <span className="w-1.5 h-1.5 rounded-full bg-busy animate-pulse" />
            Running
          </span>
        </div>
        <Timer session={session} paused={false} />
      </Link>
    )
  }

  // PAUSED
  if (session?.status === 'paused') {
    return (
      <Link
        to={`/session/${session.id}`}
        className="block rounded-[18px] border border-paused/30 bg-gradient-to-br from-paused/[0.08] to-bg-card p-4 active:scale-[0.99] transition-transform"
      >
        <div className="flex items-start justify-between mb-2 min-w-0">
          <div className="min-w-0 flex-1">
            <h3 className="text-[17px] font-bold tracking-tight text-text">{table.name}</h3>
            <MetaLine table={table} />
          </div>
          <div className="text-right shrink-0 ml-3 flex items-start gap-2">
            {alarmArmed && (
              <svg
                width="16" height="16" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className="text-accent mt-0.5 shrink-0"
                aria-label="Alarm set"
              >
                <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 01-3.46 0" />
              </svg>
            )}
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-text leading-tight max-w-[140px] truncate">
                {session.playerName || '—'}
              </p>
              <p className="text-[11px] text-text-dim font-mono mt-0.5">
                Paused {format(session.pausedAt!, 'h:mm a')}
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 rounded-md bg-paused/20 text-paused border border-paused/30">
            <span className="w-1.5 h-1.5 rounded-full bg-paused" />
            Paused
          </span>
        </div>
        <Timer session={session} paused={true} />
      </Link>
    )
  }

  // FREE
  return (
    <button
      onClick={onStartTap}
      className="w-full text-left rounded-[18px] border border-border bg-bg-card p-4 active:scale-[0.99] transition-transform"
    >
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-[17px] font-bold tracking-tight text-text">{table.name}</h3>
          <MetaLine table={table} />
        </div>
        <span className="text-[10px] font-mono font-bold uppercase tracking-widest px-2.5 py-1 rounded-md bg-free/20 text-free border border-free/30">
          Free
        </span>
      </div>
      <div className="flex items-center justify-between mt-3">
        <span className="text-[12px] text-text-faint">Tap to start session</span>
        <span className="w-7 h-7 rounded-lg bg-bg-elevated border border-border-bright flex items-center justify-center text-accent text-lg font-bold leading-none">
          +
        </span>
      </div>
    </button>
  )
}

import { useRef } from 'react'
import { useTick } from '../../hooks/useTick'
import { Eyebrow } from './Eyebrow'

const START_OFFSET_MS = (1 * 3600 + 24 * 60 + 36) * 1000

function pad(n: number) {
  return String(Math.floor(n)).padStart(2, '0')
}

function formatHMS(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${pad(h)}:${pad(m)}:${pad(s)}`
}

interface MockCardProps {
  name: string
  meta: string
  badge: React.ReactNode
  timer: React.ReactNode
  last?: boolean
}

function MockCard({ name, meta, badge, timer, last = false }: MockCardProps) {
  return (
    <div
      className={`flex items-center justify-between bg-bg-card border border-border rounded-[14px] px-4 py-3.5 ${
        last ? '' : 'mb-2.5'
      }`}
    >
      <div className="flex flex-col gap-1">
        <span className="font-bold text-[15px] text-text">{name}</span>
        <span className="font-mono text-[11.5px] text-text-faint tracking-[.04em]">{meta}</span>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        {badge}
        {timer}
      </div>
    </div>
  )
}

export function HeroSection({ onCTA }: { onCTA: () => void }) {
  const startMsRef = useRef(Date.now() - START_OFFSET_MS)
  useTick()

  const elapsed = Date.now() - startMsRef.current
  const liveTimer = formatHMS(elapsed)

  return (
    <section className="px-5 pt-9 pb-12 relative z-[1]">
      <Eyebrow>For indoor games clubs</Eyebrow>

      <h1 className="mt-3.5 text-[34px] font-extrabold tracking-[-0.035em] leading-[1.05] text-text">
        Stop losing <span className="text-accent">₹10,800</span> every month
      </h1>

      <p className="mt-3.5 text-[15.5px] text-text-dim leading-relaxed max-w-[340px]">
        Your staff forgets to start the timer. Customers dispute the bill. The notebook can't help
        you. ClubKeeper can.
      </p>

      {/* App mockup */}
      <div
        className="my-6 p-3.5 rounded-[20px] border border-border relative overflow-hidden"
        aria-hidden="true"
        style={{ background: 'linear-gradient(180deg, rgba(255,255,255,.02), rgba(0,0,0,0))' }}
      >
        {/* Corner glow */}
        <div
          className="absolute -bottom-10 -right-10 w-[180px] h-[180px] pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(184,255,90,.18), transparent 60%)' }}
        />

        {/* Mock header */}
        <div className="flex items-center justify-between px-1.5 pb-3 text-text-faint">
          <span className="font-mono text-[12px] uppercase tracking-[.16em]">Tables · Live</span>
          <span
            className="w-1.5 h-1.5 rounded-full bg-free"
            style={{ boxShadow: '0 0 0 4px rgba(93,217,130,.15)' }}
          />
        </div>

        {/* Pool 01 — Free */}
        <MockCard
          name="Pool 01"
          meta="₹120/hr · Standby"
          badge={
            <span className="font-mono text-[10.5px] px-2 py-1 rounded-full uppercase tracking-[.1em] font-semibold bg-free/10 text-free border border-free/25">
              Free
            </span>
          }
          timer={
            <span className="font-mono font-bold text-[18px] tracking-[.04em] text-text">
              00:00:00
            </span>
          }
        />

        {/* Snooker 02 — Running */}
        <MockCard
          name="Snooker 02"
          meta="₹200/hr · Aman & Co."
          badge={
            <span className="font-mono text-[10.5px] px-2 py-1 rounded-full uppercase tracking-[.1em] font-semibold bg-busy/10 text-busy border border-busy/30 flex items-center gap-1.5">
              <span className="w-[7px] h-[7px] rounded-full bg-busy animate-pulse" />
              Running
            </span>
          }
          timer={
            <span className="font-mono font-bold text-[18px] tracking-[.04em] text-busy">
              {liveTimer}
            </span>
          }
        />

        {/* Carrom 03 — Paused */}
        <MockCard
          name="Carrom 03"
          meta="₹60/hr · Paused"
          badge={
            <span className="font-mono text-[10.5px] px-2 py-1 rounded-full uppercase tracking-[.1em] font-semibold bg-paused/10 text-paused border border-paused/30">
              Paused
            </span>
          }
          timer={
            <span className="font-mono font-bold text-[18px] tracking-[.04em] text-paused">
              00:42:18
            </span>
          }
          last
        />
      </div>

      {/* Primary CTA */}
      <button
        onClick={onCTA}
        className="w-full min-h-[54px] py-4 bg-accent text-bg font-bold text-[16px] tracking-[-0.01em] rounded-2xl active:scale-[0.99] transition-transform"
        style={{ boxShadow: '0 8px 24px -8px rgba(184,255,90,.45), inset 0 -2px 0 rgba(0,0,0,.08)' }}
      >
        Start 7-day Free Trial →
      </button>

      {/* Trust line */}
      <p className="mt-3.5 text-center text-text-faint text-[11.5px] tracking-[.02em]">
        Card required<span className="mx-1.5">·</span>Cancel anytime
        <span className="mx-1.5">·</span>No charge until day 8
      </p>
    </section>
  )
}

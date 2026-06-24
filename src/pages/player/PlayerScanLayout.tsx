import type { ReactNode } from 'react'

// Player-side shell. Used by PlayerScan (/c/:slug) and BookingScreen
// (/c/:slug/book). Design system anchors:
//   §1   — radial-gradient felt background (inline; see comment below)
//   §4.7 — page header: yellow top border, club name (Fraunces),
//          meta (Mono uppercase) on the right
//
// Token naming reminder: player tokens are kebab-case in tailwind.config.js
// (bg-player-felt-deep, text-player-cue-yellow, etc.). Do NOT camelCase them
// in JSX — Tailwind's slash-opacity modifier doesn't parse camelCase keys.

interface Props {
  children: ReactNode
  // Optional header content. When clubName is omitted, the header is hidden
  // entirely — this preserves the existing loading/error states which render
  // before clubInfo arrives. Once clubInfo loads, the page passes clubName
  // and the header appears.
  clubName?: string
  meta?: string // e.g. "OPEN · 11 PM CLOSE" — Mono uppercase, right side
}

export default function PlayerScanLayout({ children, clubName, meta }: Props) {
  return (
    <div
      // Player ambient — radial gradient per design system §1. Intentionally inline, not a Tailwind utility (single-use, plugin overhead not justified).
      style={{
        background:
          'radial-gradient(ellipse at top, rgba(20, 90, 63, 0.4), transparent 60%),' +
          'radial-gradient(ellipse at bottom, rgba(6, 36, 24, 0.6), transparent 60%),' +
          '#0a3d2a',
      }}
      className="min-h-screen font-body text-player-ball-white"
    >
      <div className="mx-auto w-full max-w-[480px] px-[18px] pb-10">
        {clubName && (
          <header
            // §4.7 — yellow top border + bottom hairline, club name left, meta right
            className="border-t-2 border-player-cue-yellow border-b border-player-ball-white/15 py-5 mb-8 flex items-baseline justify-between gap-3"
          >
            <h2 className="font-display font-bold text-[18px] leading-none text-player-ball-white truncate">
              {clubName}
            </h2>
            {meta && (
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-player-cue-cream/65 whitespace-nowrap">
                {meta}
              </p>
            )}
          </header>
        )}
        {!clubName && <div className="pt-8" />}
        <main className="animate-player-fade-in motion-reduce:animate-none">{children}</main>
        <footer className="mt-12 pt-6 border-t border-player-ball-white/15 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-player-cue-cream/40">
            Powered by ClubKeeper
          </p>
        </footer>
      </div>
    </div>
  )
}

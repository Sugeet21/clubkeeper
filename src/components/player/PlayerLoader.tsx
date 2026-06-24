// Player-side loading indicator. Per design system §4.10: pulsing yellow
// dot, never a spinning arc. Used in place of the inline border-spinner
// pattern duplicated across PlayerScan and BookingScreen.
//
// Two variants:
//   - inline (default): just the dot, sized for in-button use
//   - block: dot + uppercase mono "LOADING…" label, centered, for full-page
//
// Staff app keeps its existing spinner — this is player-only.

interface Props {
  size?: number
  label?: string | null
  variant?: 'inline' | 'block'
}

export function PlayerLoader({ size = 12, label = null, variant = 'inline' }: Props) {
  if (variant === 'block') {
    return (
      <div className="flex flex-col items-center justify-center gap-4" role="status" aria-live="polite">
        <span
          className="rounded-full bg-player-cue-yellow animate-player-pulse"
          style={{ width: size, height: size }}
        />
        {label !== null && (
          <span className="font-mono text-[12px] uppercase tracking-[0.2em] text-player-cue-cream/65">
            {label}
          </span>
        )}
      </div>
    )
  }

  return (
    <span
      className="inline-block rounded-full bg-player-cue-yellow animate-player-pulse"
      style={{ width: size, height: size }}
      role="status"
      aria-label={label ?? 'Loading'}
    />
  )
}

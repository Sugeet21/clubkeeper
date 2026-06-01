// Chip presets for "set alarm" — shared by StartSession and SessionDetail edit pill.
// Change once here, both screens update.
export const NOTIFY_PRESETS = [
  { ms: null, label: 'None' },
  { ms: 30 * 60_000, label: '30 min' },
  { ms: 60 * 60_000, label: '1 hr' },
  { ms: 90 * 60_000, label: '1.5 hr' },
  { ms: 120 * 60_000, label: '2 hr' },
] as const satisfies readonly { ms: number | null; label: string }[]

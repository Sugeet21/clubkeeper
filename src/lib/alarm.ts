// Shared alarm audio for SessionAlarmModal and Settings Test button.
// All sound goes through a single shared AudioContext to handle iOS unlock cleanly.

let sharedCtx: AudioContext | null = null
let unlocked = false

function getCtx(): AudioContext | null {
  try {
    if (!sharedCtx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      sharedCtx = new Ctor()
    }
    return sharedCtx
  } catch {
    return null
  }
}

/**
 * Call from ANY user gesture (button click, tap) anywhere in the app.
 * Safe to call repeatedly — only the first call does real work.
 * iOS Safari requires a user gesture to "unlock" AudioContext for later programmatic playback.
 */
export function unlockAudio(): void {
  if (unlocked) return
  const ctx = getCtx()
  if (!ctx) return
  try {
    if (ctx.state === 'suspended') {
      void ctx.resume()
    }
    // Play a 1-sample silent buffer to fully unlock
    const buffer = ctx.createBuffer(1, 1, 22050)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.start(0)
    unlocked = true
  } catch {
    // Best-effort, fail silent
  }
}

function playTone(ctx: AudioContext, freq: number, startAt: number, duration: number) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  // Envelope: 10ms attack, hold, 50ms decay — avoids clicks/pops
  gain.gain.setValueAtTime(0, startAt)
  gain.gain.linearRampToValueAtTime(1.0, startAt + 0.01)
  gain.gain.setValueAtTime(1.0, startAt + duration - 0.05)
  gain.gain.linearRampToValueAtTime(0, startAt + duration)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(startAt)
  osc.stop(startAt + duration + 0.02)
}

/**
 * One two-tone beep: 880 Hz for 500ms → 50ms gap → 1100 Hz for 500ms.
 * Gain = 1.0. Total duration ~1.05s.
 */
export function playBeepOnce(): void {
  const ctx = getCtx()
  if (!ctx) return
  try {
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime
    playTone(ctx, 880, now, 0.5)
    playTone(ctx, 1100, now + 0.55, 0.5)
  } catch {
    // Silent fail
  }
}

/**
 * Starts an alarm loop: one playBeepOnce() immediately, then every 3 seconds.
 * Auto-stops after 60 seconds (battery safety). Sound only — modal stays open.
 * Returns a cleanup function that immediately stops the loop.
 *
 * Usage in useEffect:
 *   useEffect(() => startAlarmLoop(), [])
 */
export function startAlarmLoop(): () => void {
  playBeepOnce()
  const intervalId = window.setInterval(() => {
    playBeepOnce()
  }, 3000)
  const autoStopId = window.setTimeout(() => {
    window.clearInterval(intervalId)
  }, 60_000)
  return () => {
    window.clearInterval(intervalId)
    window.clearTimeout(autoStopId)
  }
}

export function triggerVibration(): void {
  try {
    if ('vibrate' in navigator) {
      navigator.vibrate([400, 200, 400, 200, 400])
    }
  } catch {
    // Not supported, silent
  }
}

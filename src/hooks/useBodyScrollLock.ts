import { useEffect } from 'react'

// Reference-counted body scroll lock (#177 — fixes the app-wide "scroll stuck"
// leak). MULTIPLE modals/sheets can be open (or overlap during a transition);
// the body must stay locked while ANY of them is open and unlock ONLY when the
// LAST one closes.
//
// WHY A SHARED COUNTER (the bug this replaces):
// The old per-component pattern was
//     const prev = document.body.style.overflow
//     document.body.style.overflow = 'hidden'
//     return () => { document.body.style.overflow = prev }
// which is correct for a SINGLE modal but LEAKS when two overlap: sheet B opens
// while A already set 'hidden', B captures prev='hidden', and on B's close
// "restores" the body to 'hidden' permanently → scroll dead app-wide until a
// reload (buttons still work; only scrolling dies). The bulk-restock flow
// (#173) overlaps sheets around navigation and surfaced it.
//
// FIX: one module-level counter. Baseline is captured on the 0→1 transition and
// restored on the 1→0 transition — never per-component, so no component can ever
// capture another's 'hidden' as its baseline.
//
// Do NOT re-introduce a local `document.body.style.overflow` write in any modal.
// Call this hook instead. Sweep query lives in bug_patterns.md Pattern M6.

let lockCount = 0
let baselineOverflow = ''

/**
 * Locks `document.body` scroll while `locked` is true. Safe to use from many
 * components at once — the body unlocks only when the last active lock releases.
 *
 * @param locked whether THIS caller currently wants the body locked (usually the
 *   modal's `open` prop). Passing `false` is a no-op that holds no lock.
 */
export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return

    // 0 → 1: first lock in the app. Capture the TRUE baseline (whatever the page
    // had set, normally '') exactly once, then apply the lock.
    if (lockCount === 0) {
      baselineOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    lockCount += 1

    return () => {
      lockCount -= 1
      // 1 → 0: last lock released. Restore the captured baseline, never a
      // possibly-'hidden' intermediate value. Clamp at 0 defensively so a
      // double-cleanup (StrictMode remount) can't drive the count negative.
      if (lockCount <= 0) {
        lockCount = 0
        document.body.style.overflow = baselineOverflow
      }
    }
  }, [locked])
}

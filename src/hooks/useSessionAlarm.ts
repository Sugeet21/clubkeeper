import { useTick } from './useTick'
import type { Session } from '../types'
import type { Role } from './useRole'

// #171 — owner is a silent safety-net for table alarms. The alarm is a shared
// session field (notifyAtMs), so it syncs to every device on the club. Staff
// (the floor responder) gets the loud fullscreen alarm immediately at
// notifyAtMs. The OWNER's device withholds the alarm for this grace window so
// routine staff-handled alarms don't take over the owner's phone — the overdue
// table still shows its normal alert state on the Home table card. If nobody
// acknowledges within the window, it escalates to the owner too (staff clearly
// isn't handling it → revenue protection). notifyAcknowledgedAt clears it on
// both devices at once, so an acknowledged alarm never escalates.
const OWNER_ALARM_SILENT_MS = 5 * 60_000

/**
 * Watches active sessions and returns the first one whose alarm should fire.
 * Returns null when no alarm is pending.
 *
 * Pattern T1: timestamp comparison, never a setInterval counter.
 * Pattern T4: runs in render body (not inside useLiveQuery), so useTick() drives it.
 * Only fires for status === 'running' — paused sessions clock is frozen.
 *
 * @param role  the current device's role. On 'owner', each alarm is withheld
 *   for OWNER_ALARM_SILENT_MS past notifyAtMs (#171 silent-backup). Any other
 *   role (staff) fires immediately at notifyAtMs.
 */
export function useSessionAlarm(activeSessions: Session[], role: Role): Session | null {
  useTick()
  const now = Date.now()
  // #171 — owners only start seeing the alarm after the silent window; staff at 0.
  const fireOffsetMs = role === 'owner' ? OWNER_ALARM_SILENT_MS : 0
  return (
    activeSessions.find(
      (s) =>
        s.status === 'running' &&
        typeof s.notifyAtMs === 'number' &&
        s.notifyAtMs !== null &&
        !s.notifyAcknowledgedAt &&
        now >= s.notifyAtMs + fireOffsetMs,
    ) ?? null
  )
}

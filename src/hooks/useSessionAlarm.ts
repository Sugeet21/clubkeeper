import { useTick } from './useTick'
import type { Session } from '../types'

/**
 * Watches active sessions and returns the first one whose alarm should fire.
 * Returns null when no alarm is pending.
 *
 * Pattern T1: timestamp comparison, never a setInterval counter.
 * Pattern T4: runs in render body (not inside useLiveQuery), so useTick() drives it.
 * Only fires for status === 'running' — paused sessions clock is frozen.
 */
export function useSessionAlarm(activeSessions: Session[]): Session | null {
  useTick()
  const now = Date.now()
  return (
    activeSessions.find(
      (s) =>
        s.status === 'running' &&
        typeof s.notifyAtMs === 'number' &&
        s.notifyAtMs !== null &&
        !s.notifyAcknowledgedAt &&
        now >= s.notifyAtMs,
    ) ?? null
  )
}

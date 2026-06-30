// Phase C Chunk 5 — the read half of multi-device sync.
//
// SyncReader pulls existing Supabase rows down to Dexie on sign-in, then
// keeps Dexie current via realtime subscriptions on the main `supabase`
// client. The drain (SyncRunner) handles the WRITE direction; this file
// handles READS.
//
// ─── Chunk 5.0 scope ────────────────────────────────────────────────────────
// SKELETON ONLY. start() and stop() wire up the lifecycle bookkeeping (boot
// gate, placeholder-DB gate, generation counter, started flag) so the
// component shell exists and is mounted by App.tsx. No pulls, no channel
// subscriptions, no LWW logic yet — those land in 5.2–5.4.
//
// Diagnostic logs are ON from this chunk so 5.1+ work doesn't require a
// second wiring pass to add them. Tag every log with `[syncReader]` to
// mirror the `[syncRunner]` convention.
//
// ─── Lifecycle ──────────────────────────────────────────────────────────────
// Owned by <SyncReaderBoot /> in App.tsx. Same gate as SyncRunnerBoot:
//   dbReady && session && !isPlayerHubRoute(pathname)
// Per-Pattern S15 mirror: generation counter bumped on start()/stop() so
// orphan tasks from a prior cycle bail at their next post-await guard
// (Chunks 5.2+ will use this — the field exists now so the singleton's
// shape is stable across chunks).

import { db } from './database'

const PLACEHOLDER_DB_NAME = 'ClubKeeperDB__pending'

class SyncReader {
  private started = false
  // Pattern S15 — bumped on every start()/stop(). Chunks 5.2+ will capture
  // this at the entry of each long-running async task and bail after every
  // await if the generation has moved on. Declared in 5.0 so the singleton's
  // public shape is stable.
  // eslint-disable-next-line @typescript-eslint/no-unused-private-class-members
  private readerGeneration = 0

  /**
   * Boot the reader. Called by <SyncReaderBoot /> when (dbReady && session)
   * lands AND we're not on a player-hub route.
   *
   * Chunk 5.0: no-op beyond bookkeeping. 5.2 will add `initialPull()`, 5.3
   * will open realtime channels, 5.4 will register a polling fallback.
   */
  start(): void {
    if (this.started) return

    // Defensive gate — the boot component already filters on dbReady, but a
    // DEV test page might call start() before sign-in completes. The
    // placeholder DB is the singleton that lives between sign-out and
    // sign-in; any drain or pull against it would silently apply rows to a
    // throwaway Dexie instance.
    if (db.name === PLACEHOLDER_DB_NAME) {
      console.log('[syncReader] start skipped — placeholder DB')
      return
    }

    this.started = true
    this.readerGeneration += 1
    console.log('[syncReader] start (no-op skeleton, Chunk 5.0)')
  }

  /**
   * Tear down the reader. Called on sign-out, route change to player-hub,
   * or component unmount.
   *
   * Chunk 5.0: no-op beyond bookkeeping. 5.3 will close realtime channels,
   * 5.4 will clear polling intervals.
   */
  stop(): void {
    if (!this.started) return
    this.started = false
    // Pattern S15 — bump generation so any in-flight task from this cycle
    // bails at its next post-await guard. Cheap and always safe.
    this.readerGeneration += 1
    console.log('[syncReader] stop')
  }
}

export const syncReader = new SyncReader()

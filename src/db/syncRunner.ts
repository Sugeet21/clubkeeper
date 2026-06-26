// Phase C Chunk 4 — the real drain engine.
//
// Replaces the Chunk 3 stub. Reads _outbox rows in FIFO order (seq ASC),
// pushes each to Supabase via upsert (insert/update) or targeted UPDATE
// (soft_delete), and deletes the row on success. On error: increments
// attempts, records lastError, and at attempts+1 >= 10 flips `stuck=true`
// so the row stops blocking the queue. Other rows keep draining.
//
// ─── Lifecycle ──────────────────────────────────────────────────────────────
// Owned by <SyncRunnerBoot /> in App.tsx. start() registers the `online`
// listener + 30s heartbeat. stop() (called on sign-out / route change to
// player hub / unmount) clears them. The singleton survives hot-reload but
// not full page navigation — that's fine; the outbox is on disk.
//
// ─── Atomicity contract (Pattern D7) ────────────────────────────────────────
// drainOnce reads a batch of rows in ONE tx, then awaits Supabase calls
// OUTSIDE any open Dexie tx, then issues per-row delete / update each in its
// own short tx. NEVER hold a Dexie tx open across an `await supabase...`
// boundary — Dexie auto-commits at the next non-Dexie await.
//
// ─── Idempotency (§6.5) ─────────────────────────────────────────────────────
// `upsert(..., { onConflict: 'id' })` means re-running an insert is a no-op,
// re-running an update overwrites with the same merged shape. soft_delete
// re-runs are also idempotent (deleted_at = same ISO). Safe to retry forever.

import { db } from './database'
import { supabase } from '../lib/supabase'
import type { OutboxRow } from '../types'

const PLACEHOLDER_DB_NAME = 'ClubKeeperDB__pending'
const BATCH_SIZE = 50
const INITIAL_RETRY_MS = 1_000
const MAX_RETRY_MS = 60_000
const HEARTBEAT_MS = 30_000
const DEAD_LETTER_THRESHOLD = 10

class SyncRunner {
  private draining = false
  private retryDelay = INITIAL_RETRY_MS
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private onlineHandler: (() => void) | null = null
  private started = false

  start(): void {
    if (this.started) return
    this.started = true

    // `void` dispatch is intentional here: event-handler and setInterval
    // callbacks cannot `await` (the runtime ignores returned Promises). The
    // CLAUDE.md "no fire-and-forget" rule is about Dexie writes done without
    // awaiting; here the awaiting happens INSIDE scheduleDrain. The `void`
    // keyword silences ESLint no-floating-promises and signals intent.
    this.onlineHandler = () => {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log('[syncRunner] online event — scheduling drain')
      }
      void this.scheduleDrain()
    }
    window.addEventListener('online', this.onlineHandler)

    this.heartbeatTimer = setInterval(() => {
      void this.scheduleDrain()
    }, HEARTBEAT_MS)

    // Kick once on startup so any leftover rows from previous sessions push
    // without waiting for the first heartbeat or new mutation.
    void this.scheduleDrain()
  }

  stop(): void {
    if (!this.started) return
    this.started = false

    if (this.onlineHandler) {
      window.removeEventListener('online', this.onlineHandler)
      this.onlineHandler = null
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    // Do not flip `this.draining` — let the in-flight drain unwind naturally
    // on its next tick; new schedule calls are blocked by `started=false`
    // because they go through wrappers, which still call scheduleDrain even
    // when started=false (no-op in that case).
  }

  /** Public entry — wrappers call this after every commit. Safe to call any
   *  time; cheap when not online / not started / already draining. */
  async scheduleDrain(): Promise<void> {
    if (!this.started) return
    if (this.draining) return
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    // Pattern A1 — never operate on the placeholder DB. Wrappers may fire
    // scheduleDrain via test pages before auth completes; nothing to push.
    if (db.name === PLACEHOLDER_DB_NAME) return

    this.draining = true
    let drained = 0
    try {
      drained = await this.drainOnce()
      this.retryDelay = INITIAL_RETRY_MS
      // Large-backlog continuation (reviewer concern, Chunk 4): if drainOnce
      // returned a full batch, more rows likely remain. Re-kick on next tick
      // so a 500-row queue does not wait for the 30s heartbeat between
      // batches. The next call enters with draining=false (set in finally).
    } catch (err) {
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn('[syncRunner] drain error, backing off', this.retryDelay, err)
      }
      const next = Math.min(this.retryDelay * 2, MAX_RETRY_MS)
      this.retryDelay = next
      if (this.retryTimer) clearTimeout(this.retryTimer)
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null
        void this.scheduleDrain()
      }, next)
    } finally {
      this.draining = false
    }
    if (drained >= BATCH_SIZE) {
      void this.scheduleDrain()
    }
  }

  private async drainOnce(): Promise<number> {
    // Pattern D7: read the batch in its own tx, then drop the tx before any
    // Supabase await.
    //
    // Stuck-row starvation fix (reviewer concern, Chunk 4): we cannot simply
    // `.filter(r => r.stuck !== true).limit(BATCH_SIZE)` because Dexie applies
    // the filter AFTER the index-driven limit — if the first BATCH_SIZE rows in
    // `seq` order are all stuck, the batch comes back empty and every fresh
    // outbox row beyond that point is starved. Stuck is also not indexed (would
    // require a v21 schema bump). Cheapest correct path: stream from
    // orderBy('seq') and stop once we have BATCH_SIZE non-stuck rows. `each`
    // returns a cancellable iteration; we throw a sentinel to break early.
    const batch: OutboxRow[] = []
    const STOP = Symbol('drainOnce-stop')
    try {
      await db._outbox.orderBy('seq').each((r) => {
        if (r.stuck === true) return
        batch.push(r)
        if (batch.length >= BATCH_SIZE) {
          // eslint-disable-next-line @typescript-eslint/only-throw-error
          throw STOP
        }
      })
    } catch (e) {
      if (e !== STOP) throw e
    }

    if (batch.length === 0) return 0

    let successCount = 0
    for (const row of batch) {
      try {
        await this.pushOne(row)
        // Success → drop the outbox row in its own short tx.
        if (typeof row.seq === 'number') {
          await db._outbox.delete(row.seq)
        }
        successCount += 1
      } catch (e) {
        const lastError = e instanceof Error ? e.message : String(e)
        const nextAttempts = row.attempts + 1
        const shouldStick = nextAttempts >= DEAD_LETTER_THRESHOLD

        if (typeof row.seq === 'number') {
          await db._outbox.update(row.seq, {
            attempts: nextAttempts,
            lastError,
            lastAttemptAt: Date.now(),
            ...(shouldStick ? { stuck: true } : {}),
          })
        }

        if (shouldStick) {
          // Dead-letter: log + skip. Other rows in the batch keep going.
          // eslint-disable-next-line no-console
          console.error(
            `[syncRunner] dead-letter row seq=${row.seq} table=${row.table} op=${row.op}: ${lastError}`,
          )
          continue
        }

        // Transient failure — re-throw to break the loop and trigger backoff.
        // Remaining rows in this batch will be picked up on the next drain.
        throw e
      }
    }
    return successCount
  }

  private async pushOne(row: OutboxRow): Promise<void> {
    if (row.op === 'insert' || row.op === 'update') {
      // Cast payload through unknown — caller-supplied row shape varies per
      // table but always matches the Supabase column set.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const payload = row.payload as Record<string, any>
      const { error } = await supabase
        .from(row.table)
        .upsert(payload, { onConflict: 'id', ignoreDuplicates: false })
      if (error) throw new Error(`${row.table}.upsert: ${error.message}`)
      return
    }

    if (row.op === 'soft_delete') {
      // We set updated_at = deleted_at deliberately. The Chunk 5 read path
      // (initial pull + realtime polling fallback) filters incoming rows by
      // `WHERE updated_at > cursor`; without bumping updated_at, peer devices
      // would never see the soft-delete via the cursor-based pull. The
      // syncedSoftDelete wrapper also stamps the local Dexie row's updated_at
      // to the same timestamp so local + remote agree.
      const payload = row.payload as { deleted_at: string }
      const { error } = await supabase
        .from(row.table)
        .update({ deleted_at: payload.deleted_at, updated_at: payload.deleted_at })
        .eq('id', row.rowId)
      if (error) throw new Error(`${row.table}.soft_delete: ${error.message}`)
      return
    }

    // Exhaustiveness check — TS narrows row.op to `never` if all branches
    // are covered. New op variants will trip this at compile time.
    const _exhaustive: never = row.op
    throw new Error(`syncRunner: unknown op ${String(_exhaustive)}`)
  }
}

export const syncRunner = new SyncRunner()

/** Bound forwarder used by syncWrappers via scheduleDrain.ts. */
export function scheduleDrain(): void {
  void syncRunner.scheduleDrain()
}

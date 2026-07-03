// Phase C Chunk 5 — the read half of multi-device sync.
//
// SyncReader pulls existing Supabase rows down to Dexie on sign-in, then
// keeps Dexie current via realtime subscriptions on the main `supabase`
// client. The drain (SyncRunner) handles the WRITE direction; this file
// handles READS.
//
// ─── Chunk 5.3 scope ────────────────────────────────────────────────────────
// Initial pull + resumable compound cursor per table + realtime DIRECT-APPLY
// LWW handler (§7.3) with doorbell fallback. All 9 tables are mapped
// (syncReadMapper).
//
// ─── Chunk 5.4 — polling fallback (§7.4) ────────────────────────────────────
// When a channel GROUP reports CHANNEL_ERROR / TIMED_OUT / CLOSED and stays
// down for >30s (grace period — a quick reconnect blip shouldn't trigger
// polling), start a 60s-interval poll that calls the EXISTING `requestPull`
// doorbell for every table in every currently-down group. No new apply
// path — the serialized job queue + cursor pull IS the polling primitive.
// Polling stops the moment the group's channel reports SUBSCRIBED again.
// Same per-table cursors as always; no cursor resets, no epoch re-pulls.
// Pattern S15 mirror: generation-guarded, torn down in stop()/teardownRealtime().
//
// The read mapper (src/db/syncReadMapper.ts) is strict-per-table-fail-loud,
// symmetric with the write mapper. A mapper throw surfaces an error into
// the console rather than silently corrupting Dexie. drainOnce-style
// backoff does NOT apply here — a mapper throw is a code bug (or a missing
// server migration — see 20260702_sync_client_fields.sql), not a network
// transient.
//
// ─── Realtime = direct-apply LWW, doorbell as fallback (Chunk 5.3) ──────────
// Channels live on the MAIN `supabase` client (supabaseSync has no .auth so
// it CANNOT drive realtime — Pattern S16 three-client rule). An INSERT/UPDATE
// postgres_changes event applies payload.new directly to Dexie through the
// full §7.3 machinery: outbox-guard → numeric epoch-ms LWW compare (Pattern
// S17) → tie-break (equal ms + different updated_by → accept remote) →
// syncReadMapper → put → monotonic cursor advance. Events the direct path
// can't safely apply (DELETE — payload carries only the PK; malformed or
// unparseable payloads) fall back to the 5.2b doorbell: re-enqueue a cursor
// pull of that table.
//
// Both paths run through ONE serialized job queue (single worker) so a
// direct apply can never race a cursor pull on `settings.pullCursors`, and
// two pulls of the same table can never race each other. Direct apply also
// fixes a 5.2b gap: a stale-stamped row (offline edit pushed late, its
// updated_at BEHIND our cursor) was invisible to the doorbell's cursor pull;
// the direct path applies it regardless of cursor position.
//
// §7.2 channel groupings (4 channels per club):
//   club:<id>:operations  → sessions, session_items
//   club:<id>:catalog     → game_tables, canteen_items
//   club:<id>:commerce    → customers, wallet_transactions, canteen_sales
//   club:<id>:scheduling  → bookings, stock_purchases
//
// ─── Lifecycle (Pattern S22) ────────────────────────────────────────────────
// Owned by <SyncReaderBoot /> in App.tsx. Same gate as SyncRunnerBoot:
//   dbReady && session && !isPlayerHubRoute(pathname)
// Channels subscribe inside initialPull (once the club_id claim is known)
// and tear down in stop() — subscribe on login, teardown on logout. The
// subscribe path is teardown-before-register so a TOKEN_REFRESHED-deferred
// retry can never stack duplicate channels.
//
// Pattern S15 mirror — the reader has its own generation counter bumped on
// start() and stop(). initialPull and the pull worker capture the generation
// at entry and bail after every await if it's moved on. That kills orphan
// pulls from a prior cycle without waiting for them to complete.
//
// ─── Pull-vs-drain coexistence (§7.3 outbox guard) ──────────────────────────
// Each page:
//   1. Fetch up to 1000 rows via a compound-cursor query on supabaseSync.
//   2. In ONE Dexie tx, scan _outbox for rows of this table with a pending
//      write. Build a Set<rowId>.
//   3. Filter the page: drop rows whose id is in the pending set. Those
//      rows have a local edit the drain will push shortly — we must not
//      clobber it with the (older or racing) server version.
//   4. bulkPut the survivors in a fresh short tx (Pattern D7: no Dexie tx
//      held across an await boundary).
//   5. Advance the compound cursor to the last row's (updated_at, id).
//
// ─── Compound-cursor pagination ─────────────────────────────────────────────
// `.gt(<col>, cursor.ts)` alone is unsafe — rows sharing the exact boundary
// timestamp get skipped on the next page (silent data loss). The compound
// form `(<col> > ts) OR (<col> = ts AND id > cursor.id)` with `ORDER BY
// (<col>, id)` guarantees no skipped rows and no duplicates. First page (no
// cursor yet) omits the .or() and pulls from epoch.
//
// The cursor COLUMN is per-table: `updated_at` for the 8 mutable tables,
// `created_at` for wallet_transactions (append-only ledger — it has NO
// updated_at column; ordering the query on updated_at would 400).
//
// ─── Fresh-vs-existing device ───────────────────────────────────────────────
// bulkPut replaces by primary key. Fresh device = empty Dexie = create.
// Existing device with local rows = replace, filtered by outbox-guard so
// user's in-flight edits survive. Seed rows (game_tables inserted by
// seedIfEmpty on first launch) survive a fresh-server pull because that
// pull is a no-op for an empty server table. A fresh device pulling
// against a server that already has game_tables from another device = the
// server version wins — which is exactly what "sync" means. (game_tables
// is unmapped in 5.2, so this scenario is theoretical until 5.2b.)

import { db } from './database'
import { supabase } from '../lib/supabase'
import { supabaseSync } from '../lib/supabaseSync'
import { useAuthStore } from '../store/authStore'
import { fromSupabaseRow } from './syncReadMapper'
import { getOwnerClubIdFromJwt, NoUserClubIdClaimError } from './syncClubId'
import { getPullCursor, setPullCursor, type PullCursor } from './syncPullCursors'
import { dexieTableFor, SYNC_TABLES_PULL_ORDER } from './syncTableMap'
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import type { OutboxRow, SyncTableName } from '../types'

const PLACEHOLDER_DB_NAME = 'ClubKeeperDB__pending'
const PAGE_SIZE = 1000
/** §7.4 — grace period before a down channel group triggers polling. */
const POLL_GRACE_MS = 30_000
/** §7.4 — polling interval once a group has been down past the grace period. */
const POLL_INTERVAL_MS = 60_000

/** §7.2 realtime channel groupings — 4 channels per club, covering all 9
 *  synced tables. Grouped (not per-table) to stay under Supabase concurrent
 *  channel limits (4 × N devices per club, not 9 × N). */
const CHANNEL_GROUPS: ReadonlyArray<{ key: string; tables: readonly SyncTableName[] }> = [
  { key: 'operations', tables: ['sessions', 'session_items'] },
  { key: 'catalog', tables: ['game_tables', 'canteen_items'] },
  { key: 'commerce', tables: ['customers', 'wallet_transactions', 'canteen_sales'] },
  { key: 'scheduling', tables: ['bookings', 'stock_purchases'] },
]

/** wallet_transactions is append-only (no updated_at column) — its cursor
 *  walks created_at instead. Everything else cursors on updated_at so
 *  soft-deletes and edits are seen. */
function cursorColumnFor(table: SyncTableName): 'updated_at' | 'created_at' {
  return table === 'wallet_transactions' ? 'created_at' : 'updated_at'
}

/** Wire shape of a realtime postgres_changes payload (rows are opaque —
 *  the read mapper validates per-column). */
type RealtimeRowPayload = RealtimePostgresChangesPayload<Record<string, unknown>>

/** One unit of work for the serialized worker (Chunk 5.3). `pull` re-runs
 *  the compound-cursor pull for a table (initial pull + doorbell fallback);
 *  `apply` is a single realtime event applied directly under §7.3 LWW. */
type ReaderJob =
  | { kind: 'pull'; table: SyncTableName }
  | { kind: 'apply'; table: SyncTableName; payload: RealtimeRowPayload }

class SyncReader {
  private started = false
  // Pattern S15 — bumped on every start()/stop(). initialPull captures at
  // entry and bails after every await if the generation has moved on.
  private readerGeneration = 0
  // ─── deferForRefresh state ──────────────────────────────────────────────
  // Set when initialPull throws NoUserClubIdClaimError so that we don't
  // spam the root-cause guidance on every TOKEN_REFRESHED retry. Reset only
  // by stop() (i.e. sign-out or unmount), so a permanently broken hook logs
  // the guidance exactly once per SyncReader instance lifetime.
  private hasLoggedClaimGuidance = false
  // Unsub function returned by supabase.auth.onAuthStateChange, held so
  // stop() and re-defers can tear the listener down. Kept as an outer-level
  // handle so `deferForRefresh` can enforce the ONE-listener invariant
  // (teardown-before-register) even under a permanently broken hook.
  private tokenRefreshUnsub: (() => void) | null = null
  // ─── Serialized job queue (Chunk 5.2b Set → Chunk 5.3 FIFO) ─────────────
  // The initial pull, doorbell-fallback pulls AND realtime direct-apply
  // events all funnel through this FIFO + single worker, so an apply can
  // never race a pull on the per-table cursor. Pull jobs stay deduped (one
  // queued pull per table, tracked in queuedPullTables); apply jobs are one
  // per event — ordering across events of one table is delivery order.
  private jobQueue: ReaderJob[] = []
  private queuedPullTables = new Set<SyncTableName>()
  private pullWorkerActive = false
  // club_id from the JWT claim — cached once initialPull resolves it so
  // doorbell re-pulls don't re-decode the token. Cleared in stop().
  private clubId: string | null = null
  // ─── Realtime channels (Pattern S22) ────────────────────────────────────
  // 4 grouped channels on the MAIN `supabase` client (supabaseSync has no
  // .auth and cannot drive realtime — Pattern S16). Subscribed once the
  // club_id claim is known; torn down in stop().
  private channels: RealtimeChannel[] = []
  // ─── Polling fallback (Chunk 5.4, §7.4) ─────────────────────────────────
  // groupKey -> Date.now() when that group FIRST went down (CHANNEL_ERROR /
  // TIMED_OUT / CLOSED). Cleared the instant the group reports SUBSCRIBED.
  // Not reset on repeated down-events for an already-down group — the grace
  // period is measured from the FIRST failure, not the latest one.
  private channelDownSince = new Map<string, number>()
  // groupKey -> pending 30s grace-check timeout id. Cleared explicitly on
  // recovery/teardown rather than relying solely on the generation guard, so
  // a stopped reader has zero pending timers, not just inert ones.
  private graceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  // Single shared 60s poll interval covering every table across every
  // currently-down group (not one interval per group).
  private pollTimer: ReturnType<typeof setInterval> | null = null

  /**
   * Boot the reader. Called by <SyncReaderBoot /> when (dbReady && session)
   * lands AND we're not on a player-hub route.
   *
   * Kicks off initialPull (which also subscribes realtime). Polling
   * fallback lands in 5.4.
   */
  start(): void {
    if (this.started) return

    if (db.name === PLACEHOLDER_DB_NAME) {
      console.log('[syncReader] start skipped — placeholder DB')
      return
    }

    this.started = true
    this.readerGeneration += 1
    console.log('[syncReader] start (Chunk 5.3 — initialPull kicking off)')

    // `void` dispatch: initialPull returns a Promise but we can't await here
    // (start() is sync so React's effect cleanup can call stop() promptly).
    // The Promise's errors are handled inside initialPull; a top-level
    // .catch keeps unhandled-rejection noise out of the console.
    void this.initialPull().catch((err) => {
      console.error('[syncReader] initialPull crashed', err)
    })
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    this.readerGeneration += 1
    // Tear down any deferred TOKEN_REFRESHED listener AND reset the
    // logged-guidance latch so the next start() (fresh sign-in) gets a
    // clean slate.
    if (this.tokenRefreshUnsub) {
      this.tokenRefreshUnsub()
      this.tokenRefreshUnsub = null
    }
    this.hasLoggedClaimGuidance = false
    // Pattern S22 — teardown on logout: remove all realtime channels, drop
    // any queued jobs (pulls AND applies — events for a signed-out user must
    // never touch the next user's Dexie), forget the club. The generation
    // bump above makes an in-flight worker bail at its next post-await guard.
    // §7.4 — teardownRealtime() also clears grace timers, the down-group
    // map, and stops the poll interval, so no polling timer survives a
    // sign-out or a player-hub route navigation. stop() must stay
    // synchronous (React effect cleanup contract) so this is a deliberate
    // void-dispatch, not an unawaited async op: the generation bump above
    // already makes any late channel-removal callback a no-op via the
    // myGen guard, so nothing downstream depends on this Promise settling.
    void this.teardownRealtime().catch((err) => {
      console.error('[syncReader] teardownRealtime failed during stop()', err)
    })
    this.jobQueue = []
    this.queuedPullTables.clear()
    this.clubId = null
    console.log('[syncReader] stop')
  }

  // ─── Realtime (Pattern S22) ───────────────────────────────────────────────

  /**
   * Subscribe the 4 §7.2 grouped channels for this club on the MAIN
   * `supabase` client. Teardown-before-register: a TOKEN_REFRESHED-deferred
   * initialPull retry re-enters here with the same generation, and stacking
   * a second set of channels would double every doorbell.
   *
   * Handlers enqueue the event into the serialized worker as an `apply`
   * job — the worker runs the §7.3 direct-apply LWW path (Chunk 5.3) and
   * falls back to a doorbell pull for events it can't safely apply.
   */
  private async subscribeRealtime(clubId: string, myGen: number): Promise<void> {
    // §7.4 — MUST await teardown, not fire-and-forget it. supabase-js's
    // removeChannel() is async (the leave push + _onClose/CLOSED delivery
    // resolve on a later tick) and supabase.channel(topic) hands back the
    // SAME object for a topic that hasn't finished being removed yet — our
    // deterministic `club:<id>:<group>` topic is identical across a
    // teardown-before-register cycle (TOKEN_REFRESHED-deferred retry,
    // StrictMode re-mount), so registering before the old removal settles
    // reuses the old channel's identity. Awaiting first guarantees the new
    // `supabase.channel()` call gets a genuinely fresh object, which is what
    // makes the CLOSED-after-teardown guard below actually work.
    await this.teardownRealtime()
    if (myGen !== this.readerGeneration) return

    for (const group of CHANNEL_GROUPS) {
      const channel = supabase.channel(`club:${clubId}:${group.key}`)
      for (const table of group.tables) {
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table, filter: `club_id=eq.${clubId}` },
          (payload: RealtimeRowPayload) => {
            // Generation guard: events racing a sign-out are dropped.
            if (myGen !== this.readerGeneration) return
            this.enqueueApply(table, payload)
          },
        )
      }
      channel.subscribe((status, err) => {
        if (myGen !== this.readerGeneration) return
        if (status === 'SUBSCRIBED') {
          console.log(`[syncReader] realtime ${group.key} SUBSCRIBED`)
          this.markGroupUp(group.key)
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          console.warn(`[syncReader] realtime ${group.key} ${status}`, err ?? '')
          this.markGroupDown(group.key, myGen)
        }
      })
      this.channels.push(channel)
    }
  }

  /** Remove every tracked channel and clear all §7.4 poll state. Returns a
   *  Promise so subscribeRealtime can await full removal before registering
   *  replacements (see the comment there for why that await is mandatory).
   *  stop() intentionally does NOT await this — sign-out doesn't need to
   *  block on the channel leave round-trip, and stop()'s generation bump
   *  (before this runs) already makes any stray late CLOSED a no-op via the
   *  myGen guard in the status callback above. */
  private teardownRealtime(): Promise<unknown> {
    const removals = this.channels.map((channel) => supabase.removeChannel(channel))
    this.channels = []
    // §7.4 — a torn-down channel set has no meaningful "down" state to poll
    // for, and stop()/re-subscribe must never leave orphan timers running.
    for (const timer of this.graceTimers.values()) clearTimeout(timer)
    this.graceTimers.clear()
    this.channelDownSince.clear()
    this.stopPolling()
    return Promise.all(removals)
  }

  // ─── Polling fallback (Chunk 5.4, §7.4) ───────────────────────────────────

  /** Channel recovered — drop it from the down-set and stop polling if that
   *  was the last down group. */
  private markGroupUp(groupKey: string): void {
    this.channelDownSince.delete(groupKey)
    const graceTimer = this.graceTimers.get(groupKey)
    if (graceTimer) {
      clearTimeout(graceTimer)
      this.graceTimers.delete(groupKey)
    }
    if (this.channelDownSince.size === 0) this.stopPolling()
  }

  /** Channel down — record first-failure time (idempotent: repeated errors
   *  on an already-down group do NOT push the timestamp forward) and arm a
   *  30s grace-check if one isn't already pending for this group. */
  private markGroupDown(groupKey: string, myGen: number): void {
    if (!this.channelDownSince.has(groupKey)) {
      this.channelDownSince.set(groupKey, Date.now())
    }
    if (this.graceTimers.has(groupKey)) return
    const timer = setTimeout(() => {
      this.graceTimers.delete(groupKey)
      if (myGen !== this.readerGeneration) return
      if (!this.channelDownSince.has(groupKey)) return // recovered during the grace window
      console.warn(
        `[syncReader] realtime ${groupKey} still down after ${POLL_GRACE_MS / 1000}s grace — starting poll fallback`,
      )
      this.startPolling(myGen)
    }, POLL_GRACE_MS)
    this.graceTimers.set(groupKey, timer)
  }

  /** Start the shared poll loop. No-op if already running — the interval
   *  callback re-reads `channelDownSince` on every fire, so a newly-down
   *  group is picked up without needing a second interval. */
  private startPolling(myGen: number): void {
    if (this.pollTimer !== null) return
    this.pollTimer = setInterval(() => {
      if (myGen !== this.readerGeneration) {
        this.stopPolling()
        return
      }
      if (this.channelDownSince.size === 0) {
        this.stopPolling()
        return
      }
      const downTables = new Set<SyncTableName>()
      for (const group of CHANNEL_GROUPS) {
        if (this.channelDownSince.has(group.key)) {
          for (const t of group.tables) downTables.add(t)
        }
      }
      console.log(`[syncReader] poll fallback tick — requesting pull for [${[...downTables].join(', ')}]`)
      for (const table of downTables) this.requestPull(table)
    }, POLL_INTERVAL_MS)
  }

  private stopPolling(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
      console.log('[syncReader] poll fallback stopped')
    }
  }

  // ─── Serialized job queue ─────────────────────────────────────────────────

  /**
   * Doorbell entry point — enqueue a cursor pull for a table (deduped: at
   * most one queued pull per table) and make sure a worker is draining.
   * Safe to call at any rate: the dedup Set caps the queue, the worker
   * serializes, bulkPut is idempotent.
   */
  private requestPull(table: SyncTableName): void {
    this.enqueuePull(table)
    this.kickWorker()
  }

  /** Queue a pull job WITHOUT kicking the worker (initialPull awaits the
   *  worker itself and must not have a void-dispatched twin steal the
   *  pullWorkerActive latch first). */
  private enqueuePull(table: SyncTableName): void {
    if (this.queuedPullTables.has(table)) return
    this.queuedPullTables.add(table)
    this.jobQueue.push({ kind: 'pull', table })
  }

  /** Realtime entry point — every event is one apply job (no dedup; each
   *  event carries a distinct row version). */
  private enqueueApply(table: SyncTableName, payload: RealtimeRowPayload): void {
    this.jobQueue.push({ kind: 'apply', table, payload })
    this.kickWorker()
  }

  private kickWorker(): void {
    void this.runPullWorker(this.readerGeneration).catch((err) => {
      console.error('[syncReader] pull worker crashed', err)
    })
  }

  /**
   * Drain the job queue one job at a time. Only one worker runs at any
   * moment (pullWorkerActive latch) — a second invocation while active
   * returns immediately and the live worker picks up the newly-added
   * jobs on its next loop iteration.
   *
   * Returns the number of rows applied by THIS invocation (0 if another
   * worker was already active).
   */
  private async runPullWorker(myGen: number): Promise<number> {
    if (this.pullWorkerActive) return 0
    this.pullWorkerActive = true
    let totalApplied = 0
    try {
      while (true) {
        if (myGen !== this.readerGeneration) return totalApplied
        const clubId = this.clubId
        if (!clubId) return totalApplied
        const job = this.jobQueue.shift()
        if (!job) return totalApplied
        if (job.kind === 'pull') this.queuedPullTables.delete(job.table)
        try {
          totalApplied +=
            job.kind === 'pull'
              ? await this.pullTable(job.table, clubId, myGen)
              : await this.applyEvent(job.table, job.payload, myGen)
        } catch (err) {
          // Do not abort the queue — the other jobs can still succeed.
          // A mapper throw (code bug or missing server migration) needs
          // visibility, not silent progression.
          console.error(`[syncReader] ${job.kind} ${job.table} failed`, err)
        }
      }
    } finally {
      this.pullWorkerActive = false
    }
  }

  // ─── Direct-apply LWW (Chunk 5.3, §7.3) ──────────────────────────────────

  /**
   * Apply one realtime event directly to Dexie. Steps:
   *   1. Safety triage — DELETE (payload carries only the PK; the app never
   *      hard-deletes synced rows) and malformed/unparseable payloads fall
   *      back to the doorbell pull.
   *   2. Outbox-guard — a pending local write on this row wins locally; the
   *      drain pushes it and the server LWW trigger arbitrates.
   *   3. LWW compare as NUMBERS (Pattern S17): remote wire ISO → Date.parse;
   *      local Dexie `updatedAt` is already epoch ms. Missing local
   *      `updatedAt` compares as 0 (any stamped remote wins — mirrors the
   *      server trigger's NULL semantics). Tie-break per §7.3: equal ms +
   *      `updated_by !== currentUserId` → accept remote. NOTE the actual
   *      semantics today: our push mapper never sends updated_by, so the
   *      server column is always NULL and equal-ms ALWAYS yields to remote
   *      (server-authoritative; the server LWW trigger owns true ties). A
   *      self-echo at equal ms therefore does one idempotent re-put —
   *      harmless. If push ever starts populating updated_by, this branch
   *      becomes a real self-vs-peer discriminator; re-verify then.
   *   4. Map (fail-loud) + put.
   *   5. Cursor advance — only forward (numeric compare), and NEVER from a
   *      null cursor: null means this table's epoch pull hasn't recorded
   *      history yet, and seeding the cursor from one event would truncate
   *      that pull into silent data loss.
   *
   * Returns rows applied (0 or 1). Throws only via fromSupabaseRow (caught
   * by the worker's per-job catch — same fail-loud contract as pulls).
   */
  private async applyEvent(
    table: SyncTableName,
    payload: RealtimeRowPayload,
    myGen: number,
  ): Promise<number> {
    const eventType = payload.eventType

    if (eventType === 'DELETE') {
      // Known 5.2b limitation carried forward: a cursor pull cannot see a
      // hard-deleted row either, so the local copy survives until the next
      // epoch pull. Acceptable — hard deletes only happen via out-of-band
      // SQL cleanup (the app soft-deletes, which arrives as UPDATE).
      console.warn(`[syncReader] realtime ${table}/DELETE — direct apply unsafe, doorbell fallback`)
      this.requestPull(table)
      return 0
    }

    const newRow = payload.new as Record<string, unknown>
    const id = typeof newRow.id === 'string' ? newRow.id : null
    const cursorCol = cursorColumnFor(table)
    const rawTs = typeof newRow[cursorCol] === 'string' ? (newRow[cursorCol] as string) : null
    const remoteMs = rawTs !== null ? Date.parse(rawTs) : NaN

    if (!id || Number.isNaN(remoteMs)) {
      console.warn(
        `[syncReader] realtime ${table}/${eventType} — payload missing id or ${cursorCol}, doorbell fallback`,
      )
      this.requestPull(table)
      return 0
    }

    // ── Outbox-guard (§7.3) ─────────────────────────────────────────────
    const pending = await db._outbox
      .where('table')
      .equals(table)
      .and((row: OutboxRow) => row.rowId === id)
      .first()
    if (myGen !== this.readerGeneration) return 0
    if (pending) {
      console.log(`[syncReader] realtime ${table}/${eventType} ${id} — skipped (pending outbox write)`)
      return 0
    }

    // ── LWW compare — numbers only (Pattern S17) ────────────────────────
    const dexieTable = dexieTableFor(table)
    const dbAny = db as unknown as Record<
      string,
      { get: (id: string) => Promise<Record<string, unknown> | undefined>; put: (row: unknown) => Promise<unknown> }
    >
    const local = await dbAny[dexieTable].get(id)
    if (myGen !== this.readerGeneration) return 0

    if (local) {
      const localMs = typeof local.updatedAt === 'number' ? local.updatedAt : 0
      const currentUserId = useAuthStore.getState().session?.user?.id ?? null
      const tieAcceptRemote = remoteMs === localMs && newRow.updated_by !== currentUserId
      if (!(remoteMs > localMs || tieAcceptRemote)) {
        console.log(
          `[syncReader] realtime ${table}/${eventType} ${id} — skipped (local ${localMs} newer than remote ${remoteMs})`,
        )
        return 0
      }
    }

    // ── Map (fail-loud) + apply ─────────────────────────────────────────
    const mapped = fromSupabaseRow(table, newRow)
    await dbAny[dexieTable].put(mapped)
    if (myGen !== this.readerGeneration) return 1

    // ── Monotonic cursor advance ────────────────────────────────────────
    const current = await getPullCursor(table)
    if (myGen !== this.readerGeneration) return 1
    if (current) {
      const currentMs = Date.parse(current.ts)
      if (Number.isNaN(currentMs) || remoteMs > currentMs) {
        await setPullCursor(table, { ts: rawTs as string, id })
      }
    }

    console.log(`[syncReader] realtime ${table}/${eventType} ${id} — applied (remote ${remoteMs})`)
    return 1
  }

  /**
   * Register a ONE-SHOT listener for the next TOKEN_REFRESHED event and
   * retry initialPull when it fires. Idempotent: if a listener is already
   * registered from a prior defer, this tears the old one down before
   * installing the new one. Guarantees the "one listener per SyncReader
   * instance" invariant even if initialPull re-throws on every retry
   * (broken hook that never gets fixed).
   *
   * NOT called for arbitrary errors — only for NoUserClubIdClaimError,
   * which is a fixable configuration issue on Supabase's side that
   * TOKEN_REFRESHED will surface the fix for.
   */
  private deferForRefresh(): void {
    // Teardown-before-register: if a listener from a prior defer is still
    // alive, unsub it FIRST so we can never accumulate more than one active
    // listener. This is the "N-listener stack" bug the reviewer flagged —
    // once fixed here, a permanently broken hook produces exactly one live
    // listener at any moment regardless of how many refresh cycles pass.
    if (this.tokenRefreshUnsub) {
      this.tokenRefreshUnsub()
      this.tokenRefreshUnsub = null
    }

    const capturedGen = this.readerGeneration
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== 'TOKEN_REFRESHED') return
      // Generation guard: if stop() ran between register and fire, ignore.
      if (capturedGen !== this.readerGeneration) return
      // Take the unsub down BEFORE the retry so a synchronous re-defer
      // inside initialPull's catch installs a fresh listener cleanly.
      if (this.tokenRefreshUnsub) {
        this.tokenRefreshUnsub()
        this.tokenRefreshUnsub = null
      }
      console.log('[syncReader] TOKEN_REFRESHED — retrying initialPull')
      void this.initialPull().catch((err) => {
        console.error('[syncReader] deferred initialPull crashed', err)
      })
    })
    this.tokenRefreshUnsub = () => sub.subscription.unsubscribe()
  }

  /**
   * Resolve club_id from the JWT, subscribe realtime (Pattern S22), then
   * enqueue all 9 synced tables in dependency-safe order (catalog before
   * operational — see SYNC_TABLES_PULL_ORDER) into the serialized pull
   * worker and await the drain. Each table pulls via compound-cursor
   * pagination until the server returns fewer than PAGE_SIZE rows.
   */
  private async initialPull(): Promise<void> {
    const myGen = this.readerGeneration
    const t0 = Date.now()

    let clubId: string | null
    try {
      clubId = await getOwnerClubIdFromJwt()
    } catch (err) {
      // Only NoUserClubIdClaimError is deferrable — a fixable configuration
      // issue on Supabase's side. Every other error is a hard failure: log
      // once and give up. NO auto-retry loop for unknown errors, per the
      // Chunk 5.2 review contract.
      if (err instanceof NoUserClubIdClaimError) {
        // Log the ROOT-CAUSE guidance exactly once per SyncReader instance
        // lifetime. If a broken hook stays broken forever, TOKEN_REFRESHED
        // events will keep firing every ~50 min, each one re-attempting the
        // pull that re-throws the same error — but the guidance only prints
        // the FIRST time, so a broken deploy doesn't spam the console.
        if (!this.hasLoggedClaimGuidance) {
          this.hasLoggedClaimGuidance = true
          // eslint-disable-next-line no-console
          console.warn('[syncReader] initialPull deferred — awaiting user_club_id claim in JWT:', err.message)
        } else {
          console.log('[syncReader] initialPull re-deferred — claim still missing on token refresh')
        }
        this.deferForRefresh()
        return
      }
      // Any other error: log and stop. No retry.
      console.error('[syncReader] initialPull: cannot read club_id from JWT', err)
      return
    }
    if (!clubId) {
      console.warn('[syncReader] initialPull: no club_id — skipping')
      return
    }
    // Post-await generation guard: sign-out may have flipped between the
    // JWT read and the first pull query.
    if (myGen !== this.readerGeneration) {
      console.log('[syncReader] initialPull bailed — generation stale after JWT read')
      return
    }

    this.clubId = clubId

    // Subscribe realtime BEFORE the pull so there is no event gap between
    // "pull finished" and "channels live". Events arriving mid-pull just
    // re-enqueue their table — the worker dedupes and bulkPut is idempotent.
    // §7.4 — this now awaits: subscribeRealtime awaits its own teardown of
    // any prior channel set (mandatory so a fresh supabase.channel() object
    // is guaranteed — see subscribeRealtime's comment). An event arriving
    // between the await and the enqueue loop below just lands in the same
    // deduped/idempotent queue the loop populates, so this yield point is
    // safe: enqueuePull's `queuedPullTables` Set absorbs any duplicate.
    await this.subscribeRealtime(clubId, myGen)
    if (myGen !== this.readerGeneration) {
      console.log('[syncReader] initialPull bailed — generation stale after realtime subscribe')
      return
    }

    for (const table of SYNC_TABLES_PULL_ORDER) {
      this.enqueuePull(table)
    }
    const totalRows = await this.runPullWorker(myGen)
    if (myGen !== this.readerGeneration) {
      console.log('[syncReader] initialPull bailed — generation stale during pull')
      return
    }

    console.log(
      `[syncReader] initialPull complete in ${Date.now() - t0}ms — ${totalRows} rows across ${SYNC_TABLES_PULL_ORDER.length} tables`,
    )
  }

  /**
   * Pull a single table to convergence via compound-cursor pagination.
   * Returns the total number of rows applied (post outbox-guard filter).
   */
  private async pullTable(
    table: SyncTableName,
    clubId: string,
    myGen: number,
  ): Promise<number> {
    let cursor: PullCursor | null = await getPullCursor(table)
    if (myGen !== this.readerGeneration) return 0
    let totalApplied = 0

    const cursorCol = cursorColumnFor(table)

    for (let page = 1; ; page += 1) {
      // ── Build query ─────────────────────────────────────────────────
      // First page: no cursor filter — pull from epoch. Every subsequent
      // page: compound predicate `(<col> > ts) OR (<col> = ts AND id >
      // cursor.id)` guaranteed by ORDER BY (<col>, id) plus the .or()
      // below. <col> is updated_at except for the append-only
      // wallet_transactions (created_at — see cursorColumnFor).
      let q = supabaseSync
        .from(table)
        .select('*')
        .eq('club_id', clubId)
        .order(cursorCol, { ascending: true })
        .order('id', { ascending: true })
        .limit(PAGE_SIZE)

      if (cursor) {
        // PostgREST .or() operators:
        //   <col>.gt.<ts>  → <col> > ts
        //   and(<col>.eq.<ts>,id.gt.<id>) → tie-break on shared ts
        // Combined with the double .order() above, this gives a stable,
        // gap-free, dup-free cursor walk.
        q = q.or(
          `${cursorCol}.gt.${cursor.ts},and(${cursorCol}.eq.${cursor.ts},id.gt.${cursor.id})`,
        )
      }

      const { data, error } = await q
      if (myGen !== this.readerGeneration) return totalApplied
      if (error) throw error
      if (!data || data.length === 0) {
        console.log(
          `[syncReader] pull ${table} — done at page ${page} (${totalApplied} total applied)`,
        )
        break
      }

      // ── Outbox-guard: ONE scan per page (not N+1) ─────────────────
      // Build a Set of ids of rows this device has pending writes for on
      // this table. Anything in the incoming page whose id is in the set
      // is dropped — the drain will push our newer local version shortly,
      // and clobbering it here would silently lose the local edit.
      const pendingIds = new Set<string>()
      await db._outbox
        .where('table')
        .equals(table)
        .each((row: OutboxRow) => {
          pendingIds.add(row.rowId)
        })

      if (myGen !== this.readerGeneration) return totalApplied

      // ── Map + filter ─────────────────────────────────────────────────
      const dexieTable = dexieTableFor(table)
      const survivors: Record<string, unknown>[] = []
      let outboxDropped = 0
      for (const raw of data) {
        const id = typeof raw === 'object' && raw !== null ? (raw as { id?: unknown }).id : undefined
        if (typeof id === 'string' && pendingIds.has(id)) {
          outboxDropped += 1
          continue
        }
        // fromSupabaseRow THROWS on any per-column shape violation. Let
        // the throw surface — bad data on the wire is a code bug (mapper
        // wrong, or Supabase schema drifted from expected) and needs to
        // be seen, not swallowed.
        survivors.push(fromSupabaseRow(table, raw))
      }

      // ── bulkPut in a fresh tx AFTER the await boundary (Pattern D7) ─
      if (survivors.length > 0) {
        // Cast: dexieTable is a DexieSyncTableName literal but Dexie's Proxy
        // returns Table<unknown, string> at that indexed access — a bulkPut
        // of Partial<T> is safe because .put semantics accept partial rows
        // by primary key, and the mapper's output includes the id field.
        await (db as unknown as Record<string, { bulkPut: (rows: unknown[]) => Promise<unknown> }>)[dexieTable].bulkPut(survivors)
      }

      totalApplied += survivors.length

      console.log(
        `[syncReader] pull ${table} — page ${page}: fetched ${data.length}, applied ${survivors.length}, outbox-dropped ${outboxDropped}`,
      )

      // ── Advance the compound cursor ────────────────────────────────
      // Use the LAST row of the fetched page (BEFORE outbox filtering)
      // as the new cursor. Skipping past outbox-dropped rows would cause
      // us to lose track of them on the next pull — but that's fine:
      // they'll get re-fetched next time and dropped again (idempotent).
      // Using the RAW last row keeps the cursor advancing regardless of
      // how many rows survived the filter this page.
      const lastRaw = data[data.length - 1] as Record<string, unknown>
      const lastTs = typeof lastRaw[cursorCol] === 'string' ? (lastRaw[cursorCol] as string) : null
      const lastId = typeof lastRaw.id === 'string' ? lastRaw.id : null
      if (!lastTs || !lastId) {
        console.error(
          `[syncReader] pull ${table} — page ${page} last row missing ${cursorCol} or id; aborting cursor advance`,
        )
        break
      }
      cursor = { ts: lastTs, id: lastId }
      await setPullCursor(table, cursor)
      if (myGen !== this.readerGeneration) return totalApplied

      // Short-circuit: less than a full page means we've caught up.
      if (data.length < PAGE_SIZE) {
        console.log(
          `[syncReader] pull ${table} — caught up at page ${page} (${totalApplied} total applied)`,
        )
        break
      }
    }

    return totalApplied
  }
}

export const syncReader = new SyncReader()

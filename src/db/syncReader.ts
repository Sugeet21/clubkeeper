// Phase C Chunk 5 — the read half of multi-device sync.
//
// SyncReader pulls existing Supabase rows down to Dexie on sign-in, then
// keeps Dexie current via realtime subscriptions on the main `supabase`
// client. The drain (SyncRunner) handles the WRITE direction; this file
// handles READS.
//
// ─── Chunk 5.2b scope ───────────────────────────────────────────────────────
// Initial pull + resumable compound cursor per table + realtime doorbell.
// All 9 tables are mapped (syncReadMapper). Polling fallback lands in 5.4.
//
// The read mapper (src/db/syncReadMapper.ts) is strict-per-table-fail-loud,
// symmetric with the write mapper. A mapper throw surfaces an error into
// the console rather than silently corrupting Dexie. drainOnce-style
// backoff does NOT apply here — a mapper throw is a code bug (or a missing
// server migration — see 20260702_sync_client_fields.sql), not a network
// transient.
//
// ─── Realtime = doorbell, not a second apply path (owner decision 2 Jul) ────
// Channels live on the MAIN `supabase` client (supabaseSync has no .auth so
// it CANNOT drive realtime — Pattern S16 three-client rule). A postgres_
// changes event does NOT apply payload.new directly; it just enqueues that
// table into the same serialized pull worker the initial pull uses. That
// reuses the proven cursor + outbox-guard + mapper path, keeps the cursor
// consistent for the 5.4 polling fallback, and defers the direct-apply LWW
// handler to Chunk 5.3. Cost: one extra REST round-trip per event burst
// (the Set dedupes bursts).
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
import { fromSupabaseRow } from './syncReadMapper'
import { getOwnerClubIdFromJwt, NoUserClubIdClaimError } from './syncClubId'
import { getPullCursor, setPullCursor, type PullCursor } from './syncPullCursors'
import { dexieTableFor, SYNC_TABLES_PULL_ORDER } from './syncTableMap'
import type { RealtimeChannel } from '@supabase/supabase-js'
import type { OutboxRow, SyncTableName } from '../types'

const PLACEHOLDER_DB_NAME = 'ClubKeeperDB__pending'
const PAGE_SIZE = 1000

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
  // ─── Serialized pull queue (Chunk 5.2b) ─────────────────────────────────
  // Both the initial pull AND realtime doorbell events funnel through this
  // insertion-ordered Set + single worker, so two pulls of the same table
  // can never race the per-table cursor. The Set also dedupes event bursts.
  private pendingPulls = new Set<SyncTableName>()
  private pullWorkerActive = false
  // club_id from the JWT claim — cached once initialPull resolves it so
  // doorbell re-pulls don't re-decode the token. Cleared in stop().
  private clubId: string | null = null
  // ─── Realtime channels (Pattern S22) ────────────────────────────────────
  // 4 grouped channels on the MAIN `supabase` client (supabaseSync has no
  // .auth and cannot drive realtime — Pattern S16). Subscribed once the
  // club_id claim is known; torn down in stop().
  private channels: RealtimeChannel[] = []

  /**
   * Boot the reader. Called by <SyncReaderBoot /> when (dbReady && session)
   * lands AND we're not on a player-hub route.
   *
   * Chunk 5.2: kicks off initialPull. Realtime + polling land in 5.3 / 5.4.
   */
  start(): void {
    if (this.started) return

    if (db.name === PLACEHOLDER_DB_NAME) {
      console.log('[syncReader] start skipped — placeholder DB')
      return
    }

    this.started = true
    this.readerGeneration += 1
    console.log('[syncReader] start (Chunk 5.2 — initialPull kicking off)')

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
    // any queued doorbell pulls, forget the club. The generation bump above
    // makes an in-flight worker bail at its next post-await guard.
    this.teardownRealtime()
    this.pendingPulls.clear()
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
   * Handlers are DOORBELLS — they never touch payload.new. They enqueue the
   * table into the serialized pull worker, which re-runs the proven
   * cursor + outbox-guard + mapper path (owner decision, 2 Jul 2026).
   */
  private subscribeRealtime(clubId: string, myGen: number): void {
    this.teardownRealtime()
    if (myGen !== this.readerGeneration) return

    for (const group of CHANNEL_GROUPS) {
      const channel = supabase.channel(`club:${clubId}:${group.key}`)
      for (const table of group.tables) {
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table, filter: `club_id=eq.${clubId}` },
          () => {
            // Generation guard: events racing a sign-out are dropped.
            if (myGen !== this.readerGeneration) return
            this.requestPull(table)
          },
        )
      }
      channel.subscribe((status, err) => {
        if (status === 'SUBSCRIBED') {
          console.log(`[syncReader] realtime ${group.key} SUBSCRIBED`)
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Polling fallback is Chunk 5.4 — visibility only for now. The
          // cursor-based initial pull on next sign-in self-heals any gap.
          console.warn(`[syncReader] realtime ${group.key} ${status}`, err ?? '')
        }
      })
      this.channels.push(channel)
    }
  }

  private teardownRealtime(): void {
    for (const channel of this.channels) {
      supabase.removeChannel(channel)
    }
    this.channels = []
  }

  // ─── Serialized pull queue ────────────────────────────────────────────────

  /**
   * Doorbell entry point — enqueue a table and make sure a worker is
   * draining. Safe to call from realtime handlers at any rate: the Set
   * dedupes, the worker serializes, bulkPut is idempotent.
   */
  private requestPull(table: SyncTableName): void {
    this.pendingPulls.add(table)
    void this.runPullWorker(this.readerGeneration).catch((err) => {
      console.error('[syncReader] pull worker crashed', err)
    })
  }

  /**
   * Drain pendingPulls one table at a time. Only one worker runs at any
   * moment (pullWorkerActive latch) — a second invocation while active
   * returns immediately and the live worker picks up the newly-added
   * tables on its next loop iteration.
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
        const next = this.pendingPulls.values().next()
        if (next.done) return totalApplied
        const table = next.value
        this.pendingPulls.delete(table)
        try {
          totalApplied += await this.pullTable(table, clubId, myGen)
        } catch (err) {
          // Do not abort the queue — the other tables can still succeed.
          // A mapper throw (code bug or missing server migration) needs
          // visibility, not silent progression.
          console.error(`[syncReader] pull ${table} failed`, err)
        }
      }
    } finally {
      this.pullWorkerActive = false
    }
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
    this.subscribeRealtime(clubId, myGen)

    for (const table of SYNC_TABLES_PULL_ORDER) {
      this.pendingPulls.add(table)
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

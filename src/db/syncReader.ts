// Phase C Chunk 5 — the read half of multi-device sync.
//
// SyncReader pulls existing Supabase rows down to Dexie on sign-in, then
// (Chunk 5.3+) keeps Dexie current via realtime subscriptions on the main
// `supabase` client. The drain (SyncRunner) handles the WRITE direction;
// this file handles READS.
//
// ─── Chunk 5.2 scope ────────────────────────────────────────────────────────
// Initial pull + resumable compound (updated_at, id) cursor per table.
// Realtime subscriptions and polling fallback still land in 5.3 / 5.4.
//
// The read mapper (src/db/syncReadMapper.ts) is strict-per-table-fail-loud,
// symmetric with the write mapper. Only customers + canteen_sales are wired
// today (the two tables the write side also covers); the other 7 throw
// until Chunk 5.2b designs their bidirectional shape. That means the pull
// for those 7 tables will surface an error into the console rather than
// silently corrupting Dexie. drainOnce-style backoff does NOT apply here —
// an unmapped-table throw is a code bug, not a network transient.
//
// ─── Lifecycle ──────────────────────────────────────────────────────────────
// Owned by <SyncReaderBoot /> in App.tsx. Same gate as SyncRunnerBoot:
//   dbReady && session && !isPlayerHubRoute(pathname)
//
// Pattern S15 mirror — the reader has its own generation counter bumped on
// start() and stop(). initialPull captures the generation at entry and bails
// after every await if it's moved on. That kills orphan pulls from a prior
// cycle without waiting for them to complete.
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
// `.gt('updated_at', cursor.ts)` alone is unsafe — rows sharing the exact
// boundary timestamp get skipped on the next page (silent data loss). The
// compound form `(updated_at > ts) OR (updated_at = ts AND id > cursor.id)`
// with `ORDER BY (updated_at, id)` guarantees no skipped rows and no
// duplicates. First page (no cursor yet) omits the .or() and pulls from
// epoch.
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
import type { OutboxRow, SyncTableName } from '../types'

const PLACEHOLDER_DB_NAME = 'ClubKeeperDB__pending'
const PAGE_SIZE = 1000
// Read mapper throws on the 7 unmapped tables. Log once per pull and skip —
// don't spam the console on every page attempt. Chunk 5.2b will map them.
const UNMAPPED_TABLES = new Set<SyncTableName>([
  'game_tables',
  'sessions',
  'session_items',
  'canteen_items',
  'wallet_transactions',
  'stock_purchases',
  'bookings',
])

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
    console.log('[syncReader] stop')
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
   * Iterate all 9 synced tables in dependency-safe order (catalog before
   * operational — see SYNC_TABLES_PULL_ORDER). For each mapped table, pull
   * via compound-cursor pagination until the server returns fewer than
   * PAGE_SIZE rows. Unmapped tables are logged and skipped.
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

    let totalRows = 0
    let mappedTables = 0
    let skippedTables = 0

    for (const table of SYNC_TABLES_PULL_ORDER) {
      if (UNMAPPED_TABLES.has(table)) {
        console.log(`[syncReader] pull ${table} — skipped (unmapped, waiting for Chunk 5.2b)`)
        skippedTables += 1
        continue
      }

      try {
        const rows = await this.pullTable(table, clubId, myGen)
        if (myGen !== this.readerGeneration) {
          console.log(`[syncReader] pull ${table} bailed — generation stale`)
          return
        }
        totalRows += rows
        mappedTables += 1
      } catch (err) {
        console.error(`[syncReader] pull ${table} failed`, err)
        // Do not abort the whole pull — the other tables can still succeed.
        // A code bug (e.g. mapper throw on a malformed row) needs visibility,
        // not silent progression, so we keep the error visible.
      }
    }

    console.log(
      `[syncReader] initialPull complete in ${Date.now() - t0}ms — ${totalRows} rows across ${mappedTables} mapped table(s), ${skippedTables} unmapped skipped`,
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

    for (let page = 1; ; page += 1) {
      // ── Build query ─────────────────────────────────────────────────
      // First page: no cursor filter — pull from epoch. Every subsequent
      // page: compound predicate `(updated_at > ts) OR (updated_at = ts
      // AND id > cursor.id)` guaranteed by ORDER BY (updated_at, id) plus
      // the .or() below.
      let q = supabaseSync
        .from(table)
        .select('*')
        .eq('club_id', clubId)
        .order('updated_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(PAGE_SIZE)

      if (cursor) {
        // PostgREST .or() operators:
        //   updated_at.gt.<ts>  → updated_at > ts
        //   and(updated_at.eq.<ts>,id.gt.<id>) → tie-break on shared ts
        // Combined with the double .order() above, this gives a stable,
        // gap-free, dup-free cursor walk.
        q = q.or(
          `updated_at.gt.${cursor.ts},and(updated_at.eq.${cursor.ts},id.gt.${cursor.id})`,
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
      const lastTs = typeof lastRaw.updated_at === 'string' ? lastRaw.updated_at : null
      const lastId = typeof lastRaw.id === 'string' ? lastRaw.id : null
      if (!lastTs || !lastId) {
        console.error(
          `[syncReader] pull ${table} — page ${page} last row missing updated_at or id; aborting cursor advance`,
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

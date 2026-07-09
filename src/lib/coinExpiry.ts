import Dexie from 'dexie'
import { db } from '../db/database'
import { syncedBatch } from '../db/syncWrappers'
import { getCoinConfig } from '../db/queries'
import type { WalletTransaction } from '../types/walletTransaction'

// ─── FIFO lot accounting ──────────────────────────────────────────────────────

interface Lot {
  txId: string
  createdAt: number
  remaining: number
}

/**
 * Pure function — no DB access.
 * Walks coin transactions in ascending createdAt order.
 * Earns open new lots; debits consume from oldest lot first (FIFO).
 * Returns how many coins should expire (oldest lots past threshold with remaining > 0).
 */
export function computeExpiryDebit(
  txs: WalletTransaction[],
  expiryDays: number,
  now: number,
): { coinsToExpire: number; expiredBatches: Array<{ txId: string; coinsExpired: number }> } {
  const expiryThreshold = now - expiryDays * 24 * 60 * 60 * 1000

  const lots: Lot[] = []

  for (const tx of txs) {
    if ((tx.balanceType ?? 'wallet') !== 'coins') continue
    const delta = tx.coinDelta ?? 0
    if (delta > 0) {
      lots.push({ txId: tx.id, createdAt: tx.createdAt, remaining: delta })
    } else if (delta < 0) {
      let toConsume = -delta
      for (const lot of lots) {
        if (toConsume === 0) break
        const take = Math.min(lot.remaining, toConsume)
        lot.remaining -= take
        toConsume -= take
      }
      // toConsume > 0 here = data integrity gap; skip silently rather than crash
    }
  }

  let coinsToExpire = 0
  const expiredBatches: Array<{ txId: string; coinsExpired: number }> = []

  for (const lot of lots) {
    if (lot.createdAt < expiryThreshold && lot.remaining > 0) {
      coinsToExpire += lot.remaining
      expiredBatches.push({ txId: lot.txId, coinsExpired: lot.remaining })
      lot.remaining = 0
    }
  }

  return { coinsToExpire, expiredBatches }
}

/**
 * Returns the Date of the earliest non-fully-redeemed earn lot, offset by expiryDays.
 * Used on CustomerProfile to show "Coins expire in N days".
 * Returns null when there are no coin lots with remaining > 0.
 */
export function getNextExpiryDate(
  txs: WalletTransaction[],
  expiryDays: number,
  now: number,
): Date | null {
  const lots: Lot[] = []

  for (const tx of [...txs].sort((a, b) => a.createdAt - b.createdAt)) {
    if ((tx.balanceType ?? 'wallet') !== 'coins') continue
    const delta = tx.coinDelta ?? 0
    if (delta > 0) {
      lots.push({ txId: tx.id, createdAt: tx.createdAt, remaining: delta })
    } else if (delta < 0) {
      let toConsume = -delta
      for (const lot of lots) {
        if (toConsume === 0) break
        const take = Math.min(lot.remaining, toConsume)
        lot.remaining -= take
        toConsume -= take
      }
    }
  }

  const oldest = lots.find((l) => l.remaining > 0)
  if (!oldest) return null

  const expiryMs = oldest.createdAt + expiryDays * 24 * 60 * 60 * 1000
  // If already past expiry, sweep hasn't run yet — return null (sweep will clean up)
  if (expiryMs <= now) return null

  return new Date(expiryMs)
}

// ─── Per-customer expiry write ────────────────────────────────────────────────

/**
 * Reads the customer's full coin tx history, computes expiry via FIFO,
 * and writes a coin_expiry debit row if any coins are due to expire.
 *
 * Debounce: skips re-running if expiryAppliedAt was set within the last hour.
 * Pattern D7: outer tx only — never called from inside another transaction.
 */
export async function applyExpiryForCustomer(customerId: string): Promise<{ expired: number }> {
  const config = await getCoinConfig()
  if (!config.coinsEnabled || !config.coinExpiryDays) return { expired: 0 }

  // Group C (#126) — FIFO expiry debit INSERT + customer stamp/balance UPDATE,
  // atomic with their outbox rows. Callback reads BOTH tables (customer row +
  // full coin tx history), so both ride the tables list. wallet_transactions
  // is append-only (§4.6) — the expiry debit is b.insert. syncedBatch returns
  // void, so capture `expired` outside.
  let expired = 0
  await syncedBatch(['customers', 'wallet_transactions'], async (b) => {
    const customer = await db.customers.get(customerId)
    if (!customer) return

    const now = Date.now()

    // Per-customer debounce: at most once per hour
    if (customer.expiryAppliedAt && now - customer.expiryAppliedAt < 60 * 60 * 1000) {
      return
    }

    // Skip customers with no coins — just stamp and exit
    if ((customer.coinBalance ?? 0) <= 0) {
      await b.update('customers', customerId, { expiryAppliedAt: now })
      return
    }

    const txs = await db.walletTransactions
      .where('[customerId+createdAt]')
      .between([customerId, 0], [customerId, Dexie.maxKey])
      .toArray()

    // Sort ascending for FIFO walk
    txs.sort((a, b) => a.createdAt - b.createdAt)

    const { coinsToExpire, expiredBatches } = computeExpiryDebit(txs, config.coinExpiryDays, now)

    if (coinsToExpire > 0) {
      const newCoinBalance = Math.max(0, (customer.coinBalance ?? 0) - coinsToExpire)

      const debitRow: WalletTransaction = {
        id: crypto.randomUUID(),
        customerId,
        type: 'debit',
        balanceType: 'coins',
        amount: 0,
        coinDelta: -coinsToExpire,
        balanceAfter: newCoinBalance,
        paymentMode: null,
        referenceType: 'coin_expiry',
        referenceId: null,
        notes: `Expired ${coinsToExpire} coins from ${expiredBatches.length} batch(es)`,
        createdAt: now,
      }
      await b.insert('wallet_transactions', debitRow)

      await b.update('customers', customerId, {
        coinBalance: newCoinBalance,
        expiryAppliedAt: now,
      })
    } else {
      await b.update('customers', customerId, { expiryAppliedAt: now })
    }

    expired = coinsToExpire
  })

  return { expired }
}

// ─── Sweep across all customers ───────────────────────────────────────────────

/**
 * Runs applyExpiryForCustomer for every customer with coinBalance > 0.
 * Each customer is its own Dexie transaction (Pattern D7 — failures isolated).
 *
 * Called from App.tsx after dbReady + session + subscriptionLoaded.
 * Outer debounce via sessionStorage.lastExpirySweep (4 hours) is in App.tsx.
 */
export async function applyExpirySweep(): Promise<{
  customersProcessed: number
  totalExpired: number
}> {
  const config = await getCoinConfig()
  if (!config.coinsEnabled || !config.coinExpiryDays) {
    return { customersProcessed: 0, totalExpired: 0 }
  }

  const customers = await db.customers
    .filter((c) => (c.coinBalance ?? 0) > 0)
    .toArray()

  let totalExpired = 0
  for (const c of customers) {
    const { expired } = await applyExpiryForCustomer(c.id)
    totalExpired += expired
  }

  return { customersProcessed: customers.length, totalExpired }
}

// ─── Display helper ───────────────────────────────────────────────────────────

/**
 * Returns days until expiry of the oldest surviving coin lot, or null.
 * Negative = already overdue (sweep hasn't caught up yet).
 */
export function daysUntilExpiry(
  txs: WalletTransaction[],
  expiryDays: number,
  now: number,
): number | null {
  const date = getNextExpiryDate(txs, expiryDays, now)
  if (!date) return null
  return Math.ceil((date.getTime() - now) / (24 * 60 * 60 * 1000))
}

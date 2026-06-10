import { db } from '../db/database'
import type { Customer } from '../types/customer'

/**
 * Returns up to `limit` customers who:
 *   - have a phone number (contactable)
 *   - have coinBalance > 0 (worth reaching out)
 *   - haven't visited in thresholdDays days
 *
 * Sorted: highest coin balance first, then oldest last-visit first.
 * Never returns walk-in-only customers (no phone).
 */
export async function getDormantCustomers(
  thresholdDays: number,
  limit = 10,
): Promise<Customer[]> {
  const threshold = Date.now() - thresholdDays * 24 * 60 * 60 * 1000

  const customers = await db.customers
    .filter(
      (c) =>
        !!c.phone &&
        (c.coinBalance ?? 0) > 0 &&
        (c.lastVisitAt ?? 0) < threshold,
    )
    .toArray()

  customers.sort((a, b) => {
    const coinDiff = (b.coinBalance ?? 0) - (a.coinBalance ?? 0)
    if (coinDiff !== 0) return coinDiff
    return (a.lastVisitAt ?? 0) - (b.lastVisitAt ?? 0)
  })

  return customers.slice(0, limit)
}

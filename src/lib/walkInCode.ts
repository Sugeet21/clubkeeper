import { db } from '../db/database'
import { syncedCreate } from '../db/syncWrappers'
import type { Customer } from '../types/customer'

// Generates the next sequential walk-in code ("WALK-001", "WALK-002", …)
// and inserts the new customer via syncedCreate (Group C, #126).
//
// settings is NOT a synced table, so the counter allocation cannot ride a
// syncedBatch tables list (Pattern S24 note 2). It gets its own small tx,
// COUNTER-FIRST: a crash between the counter bump and the customer insert can
// skip a code number, but can never mint a duplicate code — which is the
// invariant the old single flat tx existed to protect.
export async function createWalkInCustomer(
  name: string | null,
): Promise<Customer> {
  const walkInCode = await db.transaction('rw', db.settings, async () => {
    const settings = await db.settings.get(1)
    const counter = (settings?.walkInCounter ?? 0) + 1
    await db.settings.update(1, { walkInCounter: counter })
    return `WALK-${String(counter).padStart(3, '0')}`
  })

  const now = Date.now()
  const customer: Customer = {
    id: crypto.randomUUID(),
    phone: null,
    name: name?.trim() || null,
    walkInCode,
    walletBalance: 0,
    createdAt: now,
    lastVisitAt: now,
  }

  await syncedCreate('customers', customer)
  return customer
}

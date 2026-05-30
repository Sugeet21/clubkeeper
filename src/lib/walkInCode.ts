import { db } from '../db/database'
import type { Customer } from '../types/customer'

// Generates the next sequential walk-in code ("WALK-001", "WALK-002", …)
// and inserts the new customer atomically in a single Dexie transaction so a
// crash mid-write cannot desync the counter.
export async function createWalkInCustomer(
  name: string | null,
): Promise<Customer> {
  return db.transaction('rw', db.settings, db.customers, async () => {
    const settings = await db.settings.get(1)
    const counter = (settings?.walkInCounter ?? 0) + 1
    const padded = String(counter).padStart(3, '0')
    const walkInCode = `WALK-${padded}`

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

    await db.settings.update(1, { walkInCounter: counter })
    await db.customers.add(customer)
    return customer
  })
}

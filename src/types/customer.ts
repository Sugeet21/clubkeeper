export interface Customer {
  id: string                // UUID v4, primary key
  phone: string | null      // "+91XXXXXXXXXX" (12 chars), null for walk-ins
  name: string | null       // optional display name
  walkInCode: string | null // "WALK-001" etc., only when phone is null
  walletBalance: number     // integer rupees (matches existing money convention)
  createdAt: number         // Date.now()
  lastVisitAt: number       // updated on any transaction
}

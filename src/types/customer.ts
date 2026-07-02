export interface Customer {
  id: string                // UUID v4, primary key
  phone: string | null      // "+91XXXXXXXXXX" (12 chars), null for walk-ins
  name: string | null       // optional display name
  walkInCode: string | null // "WALK-001" etc., only when phone is null
  walletBalance: number     // integer rupees (matches existing money convention)
  coinBalance?: number      // v15: ClubCoins; integer; undefined treated as 0 in all read paths
  createdAt: number         // Date.now()
  lastVisitAt: number       // updated on any transaction
  // v16: engagement timestamp fields — all optional, undefined = feature not yet triggered
  firstTopupAt?: number     // epoch ms; set on first confirmed topup; guards welcome bonus one-shot
  lastStreakBonusAt?: number // epoch ms; set when streak bonus awarded; guards cooldown
  expiryAppliedAt?: number  // epoch ms; last time expiry sweep ran for this customer (debounces per-customer sweep)
  updatedAt?: number        // Phase C LWW metadata (#117) — epoch ms; stamped by sync wrappers / read mappers
  deletedAt?: number | null // Phase C soft-delete marker (#117) — epoch ms
}

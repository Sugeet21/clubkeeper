export type WalletTransactionType = 'credit' | 'debit' | 'adjustment'
export type WalletPaymentMode = 'cash' | 'upi' | 'card'
export type WalletReferenceType =
  | 'topup'
  | 'session'
  | 'item'
  | 'manual'
  | 'refund'
  | 'canteen_sale'
  | 'coin_redemption'
  | 'coin_expiry'      // Phase 3: coins auto-expired after coinExpiryDays
  | 'welcome_bonus'    // Phase 3: first-topup one-shot bonus
  | 'streak_bonus'     // Phase 3: N distinct visit-days in window bonus
  | 'engagement_log'   // Phase 3: zero-balance audit row when nudge is sent
  | 'booking_advance'  // v17 Phase 1 P1e: advance carried into a linked session (excess credited; cancel refund)

export interface WalletTransaction {
  id: string                            // UUID v4
  customerId: string
  type: WalletTransactionType
  amount: number                        // always positive; type indicates direction. 0 for coin-only rows
  balanceAfter: number                  // wallet balance after this tx; for coin rows = coin balance after
  paymentMode: WalletPaymentMode | null // null for debit/adjustment/coin rows
  referenceType: WalletReferenceType | null
  referenceId: string | null            // sessionId / itemId / null
  notes: string | null                  // mandatory for 'adjustment' and 'refund'
  createdAt: number                     // Date.now()
  // v15: ClubCoins fields — undefined on all pre-v15 rows (backward compatible)
  balanceType?: 'wallet' | 'coins'      // undefined treated as 'wallet' for all pre-v15 rows
  coinDelta?: number                    // signed integer; positive = earned, negative = redeemed. Only set when balanceType='coins'
  rupeeEquivalent?: number              // ₹ value at redemption time (for audit; coin rate may change later)
}

// Phase 2 note: session debit = new WalletTransaction with type:'debit',
// referenceType:'session', referenceId: sessionId.toString()
// Phase 3 note: refund = new WalletTransaction with type:'debit',
// referenceType:'refund', mandatory notes. Never UPDATE an existing row.

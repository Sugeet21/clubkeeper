export type WalletTransactionType = 'credit' | 'debit' | 'adjustment'
export type WalletPaymentMode = 'cash' | 'upi' | 'card'
export type WalletReferenceType = 'topup' | 'session' | 'item' | 'manual' | 'refund' | 'canteen_sale'

export interface WalletTransaction {
  id: string                            // UUID v4
  customerId: string
  type: WalletTransactionType
  amount: number                        // always positive; type indicates direction
  balanceAfter: number                  // balance snapshot after this transaction (audit trail)
  paymentMode: WalletPaymentMode | null // null for debit/adjustment
  referenceType: WalletReferenceType | null
  referenceId: string | null            // sessionId / itemId / null
  notes: string | null                  // mandatory for 'adjustment' and 'refund'
  createdAt: number                     // Date.now()
}

// Phase 2 note: session debit = new WalletTransaction with type:'debit',
// referenceType:'session', referenceId: sessionId.toString()
// Phase 3 note: refund = new WalletTransaction with type:'debit',
// referenceType:'refund', mandatory notes. Never UPDATE an existing row.

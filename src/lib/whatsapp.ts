import { customerDisplayName } from './customerDisplay'
import type { Customer } from '../types/customer'

// Builds a WhatsApp receipt URL for wallet topup confirmation.
// Only call when customer.phone is non-null.
export function buildWhatsAppReceiptUrl(params: {
  customer: Customer
  amountPaid: number   // rupees (what the customer physically paid)
  bonus: number        // rupees bonus credited
  totalCredited: number
  newBalance: number
  clubName: string
}): string {
  const { customer, amountPaid, bonus, totalCredited, newBalance, clubName } = params
  // Strip leading + for wa.me URL format
  const digits = (customer.phone ?? '').replace(/^\+/, '')

  const name = customerDisplayName(customer)
  const lines = [
    `*${clubName} — Wallet Receipt*`,
    ``,
    `Hi ${name},`,
    ``,
    `Paid:        ₹${amountPaid.toLocaleString('en-IN')}`,
    bonus > 0 ? `Bonus:       ₹${bonus.toLocaleString('en-IN')}` : null,
    `Credited:    ₹${totalCredited.toLocaleString('en-IN')}`,
    `New balance: ₹${newBalance.toLocaleString('en-IN')}`,
    ``,
    `Thank you for visiting!`,
  ]
    .filter((l) => l !== null)
    .join('\n')

  return `https://wa.me/${digits}?text=${encodeURIComponent(lines)}`
}

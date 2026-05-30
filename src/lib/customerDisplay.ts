import type { Customer } from '../types/customer'

// Returns the best single-word display label for a customer.
// Rules:
//   has name             → "Rahul"      (caller adds phoneTail if disambiguation needed)
//   no name + has phone  → "Customer"   (contactable but unnamed — NOT "Walk-in")
//   no name + no phone   → "Walk-in"    (truly anonymous)
export function customerDisplayName(c: Customer): string {
  if (c.name) return c.name
  if (c.phone) return 'Customer'
  return 'Walk-in'
}

// Phone tail for disambiguation when two customers share the same display name.
// Returns " ·4523" (with leading space) or "" if no phone.
export function phoneTail(c: Customer): string {
  return c.phone ? ` ·${c.phone.slice(-4)}` : ''
}

// Full label for list views where space allows disambiguation.
// Examples:
//   has name + phone   → "Rahul ·4523"
//   has name + no phone → "Rahul"
//   no name + phone    → "Customer ·7474"
//   no name + no phone + walkInCode → "Walk-in #WALK-001"
//   no name + no phone + no code   → "Walk-in"
export function customerFullLabel(c: Customer): string {
  if (c.name) return `${c.name}${phoneTail(c)}`
  if (c.phone) return `Customer${phoneTail(c)}`
  if (c.walkInCode) return `Walk-in #${c.walkInCode}`
  return 'Walk-in'
}

// Formatted phone for display: "+91 99219 67474"
// Returns null if no phone.
export function formattedPhone(c: Customer): string | null {
  if (!c.phone) return null
  return `+91 ${c.phone.slice(3, 8)} ${c.phone.slice(8)}`
}

import type { CanteenItem } from '../types'

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function findMatchingCanteenItem(
  name: string,
  price: number,
  canteenItems: CanteenItem[]
): CanteenItem | null {
  const normalized = normalizeName(name)
  if (!normalized) return null
  return canteenItems.find(
    item =>
      item.isActive === true &&
      normalizeName(item.name) === normalized &&
      item.defaultPrice === price
  ) ?? null
}

export function findCanteenItemByName(
  name: string,
  canteenItems: CanteenItem[]
): CanteenItem | null {
  const normalized = normalizeName(name)
  if (!normalized) return null
  return canteenItems.find(
    item => item.isActive === true && normalizeName(item.name) === normalized
  ) ?? null
}

import { db } from '../db/database'
import type { Customer } from '../types/customer'
import { customerDisplayName } from './customerDisplay'
import { daysUntilExpiry } from './coinExpiry'
import type { WalletTransaction } from '../types/walletTransaction'
import Dexie from 'dexie'

// ─── Template rendering ───────────────────────────────────────────────────────

export interface NudgeVars {
  name: string
  clubName: string
  coins: number
  rupeeValue: number
  daysSinceVisit: number
  daysToExpiry: number | null
  minutesValue: number
}

/**
 * Replaces {variable} placeholders in the template.
 * Unknown or null variables are replaced with empty string (never "{undefined}").
 */
export function renderNudgeTemplate(template: string, vars: NudgeVars): string {
  return template
    .replace(/\{name\}/g, vars.name)
    .replace(/\{clubName\}/g, vars.clubName)
    .replace(/\{coins\}/g, String(vars.coins))
    .replace(/\{rupeeValue\}/g, `₹${vars.rupeeValue.toLocaleString('en-IN')}`)
    .replace(/\{daysSinceVisit\}/g, String(vars.daysSinceVisit))
    .replace(/\{daysToExpiry\}/g, vars.daysToExpiry != null ? String(vars.daysToExpiry) : '')
    .replace(/\{minutesValue\}/g, String(vars.minutesValue))
}

/** Sample vars used for template preview in the editor UI. */
export const SAMPLE_NUDGE_VARS: NudgeVars = {
  name: 'Rohit',
  clubName: 'My Club',
  coins: 80,
  rupeeValue: 40,
  daysSinceVisit: 18,
  daysToExpiry: 12,
  minutesValue: 160,
}

// ─── WhatsApp link builder ────────────────────────────────────────────────────

/**
 * Builds a wa.me deep-link URL with the encoded message.
 * Handles both 10-digit and full-with-country-code inputs.
 * Always prefixes with India country code 91.
 */
export function buildWhatsAppLink(mobile: string, message: string): string {
  const digits = mobile.replace(/\D/g, '')
  const fullNumber = digits.length === 10 ? `91${digits}` : digits
  return `https://wa.me/${fullNumber}?text=${encodeURIComponent(message)}`
}

// ─── Nudge vars builder for a real customer ───────────────────────────────────

export async function buildNudgeVars(
  customer: Customer,
  clubName: string,
  rupeesPerCoin: number,
  minutesPerCoin: number,
  coinExpiryDays: number,
): Promise<NudgeVars> {
  const now = Date.now()
  const coins = customer.coinBalance ?? 0
  const daysSinceVisit = Math.floor((now - (customer.lastVisitAt ?? now)) / (24 * 60 * 60 * 1000))

  // Load coin transactions to compute expiry
  const txs: WalletTransaction[] = await db.walletTransactions
    .where('[customerId+createdAt]')
    .between([customer.id, 0], [customer.id, Dexie.maxKey])
    .toArray()
  txs.sort((a, b) => a.createdAt - b.createdAt)

  const daysToExpiry = daysUntilExpiry(txs, coinExpiryDays, now)

  return {
    name: customerDisplayName(customer),
    clubName,
    coins,
    rupeeValue: Math.floor(coins * rupeesPerCoin),
    daysSinceVisit,
    daysToExpiry,
    minutesValue: coins * minutesPerCoin,
  }
}

// ─── Engagement audit log ────────────────────────────────────────────────────

/**
 * Writes a zero-balance WalletTransaction row for audit purposes when
 * a nudge WhatsApp message is opened. No balance impact (amount=0, coinDelta=0).
 */
export async function logNudgeSent(customerId: string): Promise<void> {
  await db.walletTransactions.add({
    id: crypto.randomUUID(),
    customerId,
    type: 'credit',           // type must be valid; credit with 0 amount = no-op
    amount: 0,
    balanceAfter: 0,          // irrelevant for audit rows; 0 is safe placeholder
    paymentMode: null,
    referenceType: 'engagement_log',
    referenceId: null,
    notes: 'Nudge sent via WhatsApp',
    createdAt: Date.now(),
  })
}

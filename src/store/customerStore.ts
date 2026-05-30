// Phone uniqueness is enforced HERE in the store layer, NOT via a Dexie &phone
// unique index. Reason: IndexedDB unique index behaviour with multiple null values
// is undefined across browsers — multiple walk-in customers (phone=null) would
// violate the index. Do NOT "fix" this by adding &phone to the Dexie schema.
// The pre-check pattern matches how sessions enforce one-active-per-table.

import { create } from 'zustand'
import { db } from '../db/database'
import type { Customer } from '../types/customer'
import type { WalletTransaction } from '../types/walletTransaction'
import { createWalkInCustomer } from '../lib/walkInCode'

interface CustomerStore {
  // CRUD
  createCustomerWithPhone: (phone: string, name: string | null) => Promise<Customer>
  createWalkIn: (name: string | null) => Promise<Customer>
  updateCustomerPhone: (customerId: string, phone: string) => Promise<void>
  updateCustomerName: (customerId: string, name: string | null) => Promise<void>
  // Combined edit — updates name and/or phone atomically. Phone uniqueness checked.
  updateCustomer: (customerId: string, fields: { name: string | null; phone: string | null }) => Promise<void>
  getCustomer: (customerId: string) => Promise<Customer | undefined>

  // Queries
  searchCustomers: (query: string) => Promise<Customer[]>
  getRecentCustomers: (limit?: number) => Promise<Customer[]>
  findByPhone: (phone: string) => Promise<Customer | undefined>

  // Wallet operations
  topUp: (params: {
    customerId: string
    amountPaid: number
    bonus: number
    paymentMode: 'cash' | 'upi' | 'card'
  }) => Promise<{ customer: Customer; transaction: WalletTransaction }>

  applyManualAdjustment: (params: {
    customerId: string
    type: 'credit' | 'debit'
    amount: number
    notes: string
  }) => Promise<{ customer: Customer; transaction: WalletTransaction }>

  getTransactionHistory: (customerId: string) => Promise<WalletTransaction[]>
}

export const useCustomerStore = create<CustomerStore>(() => ({
  // ── CRUD ──────────────────────────────────────────────────────────────────

  async createCustomerWithPhone(phone, name) {
    // Pre-check for duplicate phone (uniqueness enforced here, not in Dexie index)
    const existing = await db.customers.where('phone').equals(phone).first()
    if (existing) {
      throw new DuplicatePhoneError(
        `This number is already saved as ${existing.name ?? existing.walkInCode ?? 'a customer'}`,
        existing,
      )
    }
    const now = Date.now()
    const customer: Customer = {
      id: crypto.randomUUID(),
      phone,
      name: name?.trim() || null,
      walkInCode: null,
      walletBalance: 0,
      createdAt: now,
      lastVisitAt: now,
    }
    await db.customers.add(customer)
    return customer
  },

  async createWalkIn(name) {
    return createWalkInCustomer(name)
  },

  async updateCustomerPhone(customerId, phone) {
    // Check no other customer already has this phone
    const existing = await db.customers.where('phone').equals(phone).first()
    if (existing && existing.id !== customerId) {
      throw new DuplicatePhoneError(
        `This number is already saved as ${existing.name ?? existing.walkInCode ?? 'a customer'}`,
        existing,
      )
    }
    // If this customer was a walk-in, clear the walk-in code when a phone is added
    await db.customers.update(customerId, {
      phone,
      walkInCode: null,
      lastVisitAt: Date.now(),
    })
  },

  async updateCustomerName(customerId, name) {
    await db.customers.update(customerId, { name: name?.trim() || null })
  },

  async updateCustomer(customerId, { name, phone }) {
    // Phone duplicate check — skip if phone unchanged or being cleared
    if (phone !== null) {
      const existing = await db.customers.where('phone').equals(phone).first()
      if (existing && existing.id !== customerId) {
        throw new DuplicatePhoneError(
          `This number is already saved as ${existing.name ?? existing.walkInCode ?? 'a customer'}`,
          existing,
        )
      }
    }
    const trimmedName = name?.trim() || null
    await db.customers.update(customerId, {
      name: trimmedName,
      phone,
      lastVisitAt: Date.now(),
    })
  },

  async getCustomer(customerId) {
    return db.customers.get(customerId)
  },

  // ── Queries ───────────────────────────────────────────────────────────────

  async searchCustomers(query) {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const all = await db.customers.toArray()
    return all.filter((c) => {
      const nameMatch = c.name?.toLowerCase().includes(q) ?? false
      const phoneMatch = c.phone?.includes(q) ?? false
      const codeMatch = c.walkInCode?.toLowerCase().includes(q) ?? false
      return nameMatch || phoneMatch || codeMatch
    })
  },

  async getRecentCustomers(limit = 10) {
    return db.customers.orderBy('lastVisitAt').reverse().limit(limit).toArray()
  },

  async findByPhone(phone) {
    return db.customers.where('phone').equals(phone).first()
  },

  // ── Wallet operations ─────────────────────────────────────────────────────

  async topUp({ customerId, amountPaid, bonus, paymentMode }) {
    return db.transaction('rw', db.customers, db.walletTransactions, async () => {
      const customer = await db.customers.get(customerId)
      if (!customer) throw new Error('Customer not found')

      const totalCredited = amountPaid + bonus
      const newBalance = customer.walletBalance + totalCredited
      const now = Date.now()

      const transaction: WalletTransaction = {
        id: crypto.randomUUID(),
        customerId,
        type: 'credit',
        amount: totalCredited,
        balanceAfter: newBalance,
        paymentMode,
        referenceType: 'topup',
        referenceId: null,
        notes: bonus > 0 ? `Paid ₹${amountPaid} + ₹${bonus} bonus` : null,
        createdAt: now,
      }

      await db.walletTransactions.add(transaction)
      await db.customers.update(customerId, {
        walletBalance: newBalance,
        lastVisitAt: now,
      })

      const updated = (await db.customers.get(customerId))!
      return { customer: updated, transaction }
    })
  },

  async applyManualAdjustment({ customerId, type, amount, notes }) {
    return db.transaction('rw', db.customers, db.walletTransactions, async () => {
      const customer = await db.customers.get(customerId)
      if (!customer) throw new Error('Customer not found')

      const delta = type === 'credit' ? amount : -amount
      const newBalance = customer.walletBalance + delta

      if (newBalance < 0) {
        throw new Error(
          `Insufficient balance. Current: ₹${customer.walletBalance.toLocaleString('en-IN')}, debit: ₹${amount.toLocaleString('en-IN')}`,
        )
      }

      const now = Date.now()
      const transaction: WalletTransaction = {
        id: crypto.randomUUID(),
        customerId,
        type,        // 'credit' or 'debit' — direction preserved; referenceType:'manual' is the category
        amount,
        balanceAfter: newBalance,
        paymentMode: null,
        referenceType: 'manual',
        referenceId: null,
        notes,
        createdAt: now,
      }

      await db.walletTransactions.add(transaction)
      await db.customers.update(customerId, {
        walletBalance: newBalance,
        lastVisitAt: now,
      })

      const updated = (await db.customers.get(customerId))!
      return { customer: updated, transaction }
    })
  },

  async getTransactionHistory(customerId) {
    return db.walletTransactions
      .where('[customerId+createdAt]')
      .between([customerId, Dexie.minKey], [customerId, Dexie.maxKey])
      .reverse()
      .toArray()
  },
}))

// ── Custom error for duplicate phone ─────────────────────────────────────────

export class DuplicatePhoneError extends Error {
  existingCustomer: Customer
  constructor(message: string, existingCustomer: Customer) {
    super(message)
    this.name = 'DuplicatePhoneError'
    this.existingCustomer = existingCustomer
  }
}

// ── Dexie namespace needed for minKey/maxKey ──────────────────────────────────
import Dexie from 'dexie'

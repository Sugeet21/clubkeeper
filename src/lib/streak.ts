import { startOfDay } from 'date-fns'
import Dexie from 'dexie'
import { db } from '../db/database'

// ─── Engagement config helpers ────────────────────────────────────────────────

export interface EngagementConfig {
  welcomeBonusEnabled: boolean
  welcomeBonusCoins: number
  streakEnabled: boolean
  streakRequiredDays: number
  streakWindowDays: number
  streakBonusCoins: number
  dormancyEnabled: boolean
  dormantThresholdDays: number
  nudgeTemplate: string
}

export const DEFAULT_ENGAGEMENT_CONFIG: EngagementConfig = {
  welcomeBonusEnabled: false,
  welcomeBonusCoins: 50,
  streakEnabled: false,
  streakRequiredDays: 3,
  streakWindowDays: 7,
  streakBonusCoins: 50,
  dormancyEnabled: false,
  dormantThresholdDays: 14,
  nudgeTemplate:
    'Hi {name}, we miss you at {clubName}! You have {coins} ClubCoins waiting (worth about {rupeeValue}). They expire in {daysToExpiry} days — come use them before they\'re gone. See you soon!',
}

export async function getEngagementConfig(): Promise<EngagementConfig> {
  const settings = await db.settings.get(1)
  if (!settings) return { ...DEFAULT_ENGAGEMENT_CONFIG }
  return {
    welcomeBonusEnabled: settings.welcomeBonusEnabled ?? DEFAULT_ENGAGEMENT_CONFIG.welcomeBonusEnabled,
    welcomeBonusCoins: settings.welcomeBonusCoins ?? DEFAULT_ENGAGEMENT_CONFIG.welcomeBonusCoins,
    streakEnabled: settings.streakEnabled ?? DEFAULT_ENGAGEMENT_CONFIG.streakEnabled,
    streakRequiredDays: settings.streakRequiredDays ?? DEFAULT_ENGAGEMENT_CONFIG.streakRequiredDays,
    streakWindowDays: settings.streakWindowDays ?? DEFAULT_ENGAGEMENT_CONFIG.streakWindowDays,
    streakBonusCoins: settings.streakBonusCoins ?? DEFAULT_ENGAGEMENT_CONFIG.streakBonusCoins,
    dormancyEnabled: settings.dormancyEnabled ?? DEFAULT_ENGAGEMENT_CONFIG.dormancyEnabled,
    dormantThresholdDays: settings.dormantThresholdDays ?? DEFAULT_ENGAGEMENT_CONFIG.dormantThresholdDays,
    nudgeTemplate: settings.nudgeTemplate ?? DEFAULT_ENGAGEMENT_CONFIG.nudgeTemplate,
  }
}

// ─── Streak check + award ─────────────────────────────────────────────────────

/**
 * Checks if a customer qualifies for a streak bonus and awards it if so.
 *
 * Streak is measured via wallet debit rows with referenceType='session'
 * (these are written when wallet is used at a session). For customers who
 * pay cash/UPI (no wallet debit), we fall back to counting sessions whose
 * endedAt falls within the window — but since sessions have no customerId,
 * we rely solely on wallet transactions. Streak only applies to customers
 * who have wallet activity.
 *
 * Cooldown: at most once per streakWindowDays.
 * Pattern D7: never call from inside another db.transaction().
 */
export async function checkAndAwardStreak(
  customerId: string,
): Promise<{ awarded: boolean; coins: number; customerName: string | null }> {
  const engagement = await getEngagementConfig()
  if (!engagement.streakEnabled) return { awarded: false, coins: 0, customerName: null }

  const customer = await db.customers.get(customerId)
  if (!customer) return { awarded: false, coins: 0, customerName: null }

  const now = Date.now()
  const windowMs = engagement.streakWindowDays * 24 * 60 * 60 * 1000

  // Cooldown: don't re-award within streakWindowDays of last bonus
  if (customer.lastStreakBonusAt && now - customer.lastStreakBonusAt < windowMs) {
    return { awarded: false, coins: 0, customerName: customer.name }
  }

  const windowStart = now - windowMs

  // Count distinct calendar days the customer had a wallet-debit session
  const txs = await db.walletTransactions
    .where('[customerId+createdAt]')
    .between([customerId, windowStart], [customerId, Dexie.maxKey])
    .filter(
      (t) =>
        (t.balanceType ?? 'wallet') === 'wallet' &&
        t.type === 'debit' &&
        t.referenceType === 'session',
    )
    .toArray()

  const distinctDays = new Set(txs.map((t) => startOfDay(new Date(t.createdAt)).getTime()))

  if (distinctDays.size < engagement.streakRequiredDays) {
    return { awarded: false, coins: 0, customerName: customer.name }
  }

  // Award bonus in its own transaction
  const bonus = engagement.streakBonusCoins
  await db.transaction('rw', db.customers, db.walletTransactions, async () => {
    const fresh = await db.customers.get(customerId)
    if (!fresh) return

    const newCoinBalance = (fresh.coinBalance ?? 0) + bonus

    await db.walletTransactions.add({
      id: crypto.randomUUID(),
      customerId,
      type: 'credit',
      balanceType: 'coins',
      amount: 0,
      coinDelta: bonus,
      balanceAfter: newCoinBalance,
      paymentMode: null,
      referenceType: 'streak_bonus',
      referenceId: null,
      notes: `Streak: ${distinctDays.size} visit days in ${engagement.streakWindowDays} days`,
      createdAt: now,
    })

    await db.customers.update(customerId, {
      coinBalance: newCoinBalance,
      lastStreakBonusAt: now,
    })
  })

  return { awarded: true, coins: bonus, customerName: customer.name }
}

import { useState, useCallback, useEffect } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Modal } from './Modal'
import { db } from '../db/database'
import { supabase } from '../lib/supabase'
import { useTopupInbox } from '../store/topupInbox'
import { useToastStore } from '../store/toastStore'
import { recordTopupWithCoins, getCoinConfig } from '../db/queries'
import { coinsEarnedForTopup, resolveCoinConfig } from '../lib/coins'
import { getEngagementConfig } from '../lib/streak'
import type { EngagementConfig } from '../lib/streak'
import { customerDisplayName, formattedPhone } from '../lib/customerDisplay'
import type { PendingTopupRow } from '../lib/playerHubApi'
import type { CoinConfig } from '../lib/coins'

interface Props {
  intents: PendingTopupRow[]
  clubId: string
  onIntentHandled: (intentId: string) => void
  coinConfig?: CoinConfig
  engagementConfig?: EngagementConfig
}

type RowState = 'idle' | 'confirming' | 'rejecting' | 'done'

interface RowStatus {
  state: RowState
  error: string | null
  rejectInput: string
}

function ConfirmRow({
  intent,
  clubId,
  onHandled,
  coinConfig,
  engagementConfig,
}: {
  intent: PendingTopupRow
  clubId: string
  onHandled: (id: string) => void
  coinConfig: CoinConfig
  engagementConfig: EngagementConfig | null
}) {
  const { decrementPending } = useTopupInbox()
  const { show: showToast } = useToastStore()
  const [rowStatus, setRowStatus] = useState<RowStatus>({
    state: 'idle',
    error: null,
    rejectInput: '',
  })

  const formattedMobile = `+91${intent.playerMobile}`
  // Three-state lookup: 'loading' until the one-shot Dexie probe resolves,
  // then either 'new' (no customer with this phone) or 'existing'. We do NOT
  // use useLiveQuery here because Dexie's .first() returns undefined for
  // both loading AND not-found, which the previous code conflated and which
  // permanently disabled the Confirm button for new players (#86).
  const [lookupState, setLookupState] = useState<'loading' | 'new' | 'existing'>('loading')

  useEffect(() => {
    let cancelled = false
    setLookupState('loading')
    db.customers
      .where('phone')
      .equals(formattedMobile)
      .first()
      .then((row) => {
        if (cancelled) return
        setLookupState(row ? 'existing' : 'new')
      })
      .catch(() => {
        if (cancelled) return
        // Treat lookup failure as 'new' — handleConfirm does its own
        // authoritative find-or-create, so worst case we briefly show a
        // welcome-bonus preview that the actual tx then suppresses.
        setLookupState('new')
      })
    return () => { cancelled = true }
  }, [formattedMobile])

  const previewTierCoins = coinConfig.coinsEnabled
    ? coinsEarnedForTopup(intent.amount, coinConfig.coinTiers)
    : 0
  const previewWelcomeCoins =
    coinConfig.coinsEnabled &&
    engagementConfig?.welcomeBonusEnabled &&
    lookupState === 'new'
      ? (engagementConfig.welcomeBonusCoins ?? 0)
      : 0
  const previewCoins = previewTierCoins + previewWelcomeCoins

  const handleConfirm = useCallback(async () => {
    setRowStatus((s) => ({ ...s, state: 'confirming', error: null }))

    const mobile = `+91${intent.playerMobile}`

    try {
      // ── Find or create customer ───────────────────────────────────────
      let customer = await db.customers.where('phone').equals(mobile).first()
      if (!customer) {
        const now = Date.now()
        const newCustomer = {
          id: crypto.randomUUID(),
          phone: mobile,
          name: intent.playerName || null,
          walkInCode: null as string | null,
          walletBalance: 0,
          createdAt: now,
          lastVisitAt: now,
        }
        await db.customers.add(newCustomer)
        customer = newCustomer
      }

      // ── Idempotency check — refuse to double-credit ───────────────────
      const alreadyCredited = await db.walletTransactions
        .where('customerId').equals(customer.id)
        .filter((t) => t.referenceType === 'topup' && t.referenceId === intent.id)
        .first()

      if (alreadyCredited) {
        showToast('Already credited.')
      } else {
        await recordTopupWithCoins({
          customerId: customer.id,
          rupees: intent.amount,
          paymentMode: 'upi',
          refId: intent.id,
        })
      }

      // ── Cloud update via Supabase client (owner is authed, RLS permits) ──
      const { error: cloudErr } = await supabase
        .from('topup_intents')
        .update({
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
        })
        .eq('id', intent.id)

      if (cloudErr) {
        // Local credit succeeded; queue cloud retry — do NOT decrement yet,
        // the intent will reappear on next poll and the idempotency guard
        // will prevent double-credit.
        const pending: string[] = JSON.parse(localStorage.getItem('ck_failedConfirmTopups') ?? '[]') as string[]
        if (!pending.includes(intent.id)) pending.push(intent.id)
        localStorage.setItem('ck_failedConfirmTopups', JSON.stringify(pending))
        showToast('Wallet updated but cloud sync failed. Will retry on next open.', 6000)
        // Keep row visible so owner knows to check connectivity
        setRowStatus((s) => ({ ...s, state: 'idle', error: 'Cloud sync failed — will retry' }))
        return
      }

      decrementPending()
      setRowStatus((s) => ({ ...s, state: 'done' }))
      onHandled(intent.id)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      setRowStatus((s) => ({ ...s, state: 'idle', error: `Failed to confirm: ${msg}` }))
    }
  }, [intent, decrementPending, showToast, onHandled])

  const handleRejectSubmit = useCallback(async () => {
    setRowStatus((s) => ({ ...s, state: 'confirming', error: null }))
    try {
      const { error } = await supabase
        .from('topup_intents')
        .update({
          status: 'rejected',
          reject_reason: rowStatus.rejectInput.trim() || null,
        })
        .eq('id', intent.id)

      if (error) throw error

      decrementPending()
      setRowStatus((s) => ({ ...s, state: 'done' }))
      onHandled(intent.id)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to reject'
      setRowStatus((s) => ({ ...s, state: 'idle', error: msg }))
    }
  }, [intent, rowStatus.rejectInput, decrementPending, onHandled])

  const shortCode = `CK-${intent.id.slice(-6).toUpperCase()}`

  const displayName = customerDisplayName({
    id: '', phone: `+91${intent.playerMobile}`, name: intent.playerName || null,
    walkInCode: null, walletBalance: 0, createdAt: 0, lastVisitAt: 0,
  })
  const phone = formattedPhone({
    id: '', phone: `+91${intent.playerMobile}`, name: intent.playerName || null,
    walkInCode: null, walletBalance: 0, createdAt: 0, lastVisitAt: 0,
  })

  if (rowStatus.state === 'done') return null

  return (
    <div className="bg-bg-card border border-border rounded-2xl p-4 mb-3">
      {/* Top: amount + code */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-[18px] font-bold font-mono text-text">
          ₹{intent.amount.toLocaleString('en-IN')}
        </span>
        <span className="text-[11px] font-mono text-accent tracking-wider">{shortCode}</span>
      </div>

      {/* Middle: name + phone */}
      <p className="text-text text-[14px]">
        {displayName}
        {phone && (
          <span className="text-text-dim"> · {phone}</span>
        )}
      </p>

      {/* Bottom: time + coin preview */}
      <div className="flex items-center gap-3 mt-0.5">
        <p className="text-text-faint text-[12px]">
          {formatDistanceToNow(new Date(intent.createdAt), { addSuffix: true })}
        </p>
        {previewCoins > 0 && (
          <p className="text-amber-400 text-[12px] font-semibold">
            {previewWelcomeCoins > 0
              ? `🪙 +${previewTierCoins} + ${previewWelcomeCoins} welcome = ${previewCoins} coins`
              : `🪙 +${previewCoins.toLocaleString('en-IN')} coins`}
          </p>
        )}
      </div>

      {/* Inline error */}
      {rowStatus.error && (
        <p className="text-busy text-[12px] mt-2">{rowStatus.error}</p>
      )}

      {rowStatus.state === 'rejecting' ? (
        <div className="mt-3 flex flex-col gap-2">
          <input
            type="text"
            value={rowStatus.rejectInput}
            onChange={(e) => setRowStatus((s) => ({ ...s, rejectInput: e.target.value.slice(0, 80) }))}
            placeholder="Reason (optional)"
            className="w-full px-3 py-2.5 bg-bg border border-border rounded-xl text-text text-[14px] focus:border-accent outline-none placeholder:text-text-faint"
          />
          <div className="flex gap-2">
            <button
              onClick={handleRejectSubmit}
              className="flex-1 min-h-[44px] bg-busy/12 text-busy border border-busy/30 rounded-xl text-[13px] font-bold"
            >
              {rowStatus.state === 'confirming' ? 'Rejecting…' : 'Confirm reject'}
            </button>
            <button
              onClick={() => setRowStatus((s) => ({ ...s, state: 'idle' }))}
              className="flex-1 min-h-[44px] bg-bg-card text-text-dim border border-border rounded-xl text-[13px]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 mt-3">
          <button
            onClick={handleConfirm}
            disabled={rowStatus.state === 'confirming'}
            className={`flex-1 min-h-[44px] rounded-xl text-[13px] font-bold transition-opacity ${
              rowStatus.state === 'confirming'
                ? 'bg-free/20 text-free/60 cursor-not-allowed'
                : 'bg-free/12 text-free border border-free/30'
            }`}
          >
            {rowStatus.state === 'confirming' ? 'Confirming…' : 'Confirm received'}
          </button>
          <button
            onClick={() => setRowStatus((s) => ({ ...s, state: 'rejecting' }))}
            disabled={rowStatus.state === 'confirming'}
            className="flex-1 min-h-[44px] bg-busy/12 text-busy border border-busy/30 rounded-xl text-[13px] font-bold"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  )
}

export default function PendingTopupsModal({
  intents,
  clubId,
  onIntentHandled,
  coinConfig,
  engagementConfig,
}: Props) {
  const { modalOpen, closeModal } = useTopupInbox()
  const [resolvedConfig, setResolvedConfig] = useState<CoinConfig>(
    coinConfig ?? resolveCoinConfig({}),
  )
  const [resolvedEngagement, setResolvedEngagement] = useState<EngagementConfig | null>(
    engagementConfig ?? null,
  )

  useEffect(() => {
    if (coinConfig) { setResolvedConfig(coinConfig); return }
    getCoinConfig().then(setResolvedConfig).catch(() => {/* use defaults */})
  }, [coinConfig])

  useEffect(() => {
    if (engagementConfig) { setResolvedEngagement(engagementConfig); return }
    getEngagementConfig().then(setResolvedEngagement).catch(() => {/* use defaults */})
  }, [engagementConfig])

  return (
    <Modal
      open={modalOpen}
      onClose={closeModal}
      title={`Pending Top-ups (${intents.length})`}
    >
      {intents.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-text-dim text-sm">No pending top-ups</p>
        </div>
      ) : (
        <div className="py-2">
          {intents.map((intent) => (
            <ConfirmRow
              key={intent.id}
              intent={intent}
              clubId={clubId}
              onHandled={onIntentHandled}
              coinConfig={resolvedConfig}
              engagementConfig={resolvedEngagement}
            />
          ))}
        </div>
      )}
    </Modal>
  )
}

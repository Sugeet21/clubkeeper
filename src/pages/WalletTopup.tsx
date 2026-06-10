import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db/database'
import { useSettings } from '../hooks/useLiveData'
import { useToastStore } from '../store/toastStore'
import { recordTopupWithCoins, getCoinConfig } from '../db/queries'
import { coinsEarnedForTopup, resolveCoinConfig } from '../lib/coins'
import { getEngagementConfig } from '../lib/streak'
import type { EngagementConfig } from '../lib/streak'
import { buildWhatsAppReceiptUrl } from '../lib/whatsapp'
import { UpiQrCard } from '../components/UpiQrCard'
import type { Customer } from '../types/customer'
import type { CoinConfig } from '../lib/coins'
import { customerDisplayName } from '../lib/customerDisplay'

type PaymentMode = 'cash' | 'upi' | 'card'

const AMOUNT_CHIPS = [200, 500, 1000, 2000]
const BONUS_CHIPS = [0, 25, 50, 100]

export default function WalletTopup() {
  const { customerId } = useParams<{ customerId: string }>()
  const navigate = useNavigate()
  const { show: showToast } = useToastStore()
  const settings = useSettings()

  const customer = useLiveQuery(
    () => (customerId ? db.customers.get(customerId) : undefined),
    [customerId],
  )

  const [amountStr, setAmountStr] = useState('')
  const [bonusStr, setBonusStr] = useState('0')
  const [paymentMode, setPaymentMode] = useState<PaymentMode | null>(null)
  const [saving, setSaving] = useState(false)
  const [coinConfig, setCoinConfig] = useState<CoinConfig>(resolveCoinConfig({}))
  const [engagementConfig, setEngagementConfig] = useState<EngagementConfig | null>(null)

  // Success state
  const [success, setSuccess] = useState<{
    totalCredited: number
    newBalance: number
    coinsEarned: number
    welcomeCoinsEarned: number
    customer: Customer
  } | null>(null)

  useEffect(() => {
    getCoinConfig().then(setCoinConfig).catch(() => {/* use defaults */})
    getEngagementConfig().then(setEngagementConfig).catch(() => {/* use defaults */})
  }, [])

  const amount = parseInt(amountStr, 10) || 0
  const bonus = parseInt(bonusStr, 10) || 0
  const totalCredited = amount + bonus

  const previewTierCoins =
    coinConfig.coinsEnabled && amount > 0
      ? coinsEarnedForTopup(amount, coinConfig.coinTiers)
      : 0
  const isFirstTopup = !customer?.firstTopupAt
  const previewWelcomeCoins =
    coinConfig.coinsEnabled &&
    engagementConfig?.welcomeBonusEnabled &&
    isFirstTopup
      ? (engagementConfig.welcomeBonusCoins ?? 0)
      : 0
  const previewCoins = previewTierCoins + previewWelcomeCoins

  const canConfirm = !saving && amount > 0 && paymentMode !== null

  async function handleConfirm() {
    if (!canConfirm || !customerId || !customer) return
    setSaving(true)
    try {
      const result = await recordTopupWithCoins({
        customerId,
        rupees: totalCredited,
        paymentMode: paymentMode!,
        refId: null,
      })
      const updated = await db.customers.get(customerId)
      if (!updated) throw new Error('Customer not found after topup')
      setSuccess({
        totalCredited,
        newBalance: updated.walletBalance,
        coinsEarned: result.coinsEarned,
        welcomeCoinsEarned: result.welcomeCoinsEarned,
        customer: updated,
      })
    } catch {
      showToast({ message: 'Top-up failed. Try again.', type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  function handleAddAnother() {
    setAmountStr('')
    setBonusStr('0')
    setPaymentMode(null)
    setSuccess(null)
  }

  // Loading state
  if (customer === undefined) {
    return (
      <div className="bg-bg min-h-screen flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!customer) {
    return (
      <div className="bg-bg min-h-screen flex flex-col items-center justify-center gap-3 px-5">
        <p className="text-text-dim text-sm">Customer not found.</p>
        <button onClick={() => navigate('/wallet')} className="text-accent text-sm font-semibold">
          Back to Wallet
        </button>
      </div>
    )
  }

  const displayName = customerDisplayName(customer)

  // ── Success screen ─────────────────────────────────────────────────────────
  if (success) {
    const { totalCredited: credited, newBalance, coinsEarned, welcomeCoinsEarned, customer: updatedCustomer } = success
    const whatsappUrl =
      updatedCustomer.phone
        ? buildWhatsAppReceiptUrl({
            customer: updatedCustomer,
            amountPaid: amount,
            bonus,
            totalCredited: credited,
            newBalance,
            clubName: settings?.clubName ?? 'Club',
          })
        : null

    return (
      <div className="bg-bg min-h-screen pb-24">
        <div className="pt-safe px-5">
          <div className="flex items-center gap-3 pt-4 pb-6">
            <button
              onClick={() => navigate('/tables')}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center -ml-1 text-text-dim"
              aria-label="Done"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <h1 className="text-[22px] font-bold text-text">Top-up Done</h1>
          </div>

          {/* Success card */}
          <div className="bg-bg-card border border-border rounded-2xl p-5 mb-6 text-center">
            <div className="w-12 h-12 rounded-full bg-free/15 border border-free/30 flex items-center justify-center mx-auto mb-3">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-free">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <p className="text-text text-[17px] font-bold">
              ₹{credited.toLocaleString('en-IN')} added to {displayName}
            </p>
            <p className="text-text-dim text-sm mt-1">
              New balance:{' '}
              <span className="text-accent font-bold">
                ₹{newBalance.toLocaleString('en-IN')}
              </span>
            </p>
            {(coinsEarned > 0 || welcomeCoinsEarned > 0) && (
              <p className="text-amber-400 text-[13px] font-semibold mt-2">
                {welcomeCoinsEarned > 0
                  ? `🪙 +${coinsEarned} + ${welcomeCoinsEarned} welcome = ${coinsEarned + welcomeCoinsEarned} ClubCoins!`
                  : `🪙 +${coinsEarned.toLocaleString('en-IN')} ClubCoins earned!`}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="space-y-3">
            {whatsappUrl && (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noreferrer"
                className="w-full min-h-[54px] flex items-center justify-center gap-2 bg-[#25D366]/15 border border-[#25D366]/30 text-[#25D366] font-semibold text-[15px] rounded-2xl"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
                  <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.55 4.116 1.516 5.845L.057 23.25a.5.5 0 0 0 .614.65l5.595-1.464A11.938 11.938 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.73 9.73 0 0 1-4.966-1.359l-.356-.212-3.69.968.982-3.594-.232-.37A9.712 9.712 0 0 1 2.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z" />
                </svg>
                Send WhatsApp Receipt
              </a>
            )}
            <button
              onClick={handleAddAnother}
              className="w-full min-h-[54px] bg-bg-card border border-border text-text font-semibold text-[15px] rounded-2xl"
            >
              Add another top-up
            </button>
            <button
              onClick={() => navigate('/tables')}
              className="w-full min-h-[54px] bg-accent text-bg font-bold text-[16px] rounded-2xl"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Topup form ─────────────────────────────────────────────────────────────
  return (
    <div className="bg-bg min-h-screen pb-24">
      <div className="pt-safe px-5">
        {/* Header */}
        <div className="flex items-center gap-3 pt-4 pb-2">
          <button
            onClick={() => navigate(-1)}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center -ml-1 text-text-dim"
            aria-label="Back"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div>
            <h1 className="text-[18px] font-bold text-text leading-tight">{displayName}</h1>
            <p className="text-[13px] text-text-dim">
              Balance: <span className="text-accent font-semibold">₹{customer.walletBalance.toLocaleString('en-IN')}</span>
            </p>
          </div>
        </div>

        <div className="space-y-5 mt-4">
          {/* Amount */}
          <div>
            <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint block mb-2">
              Amount Paid (₹)
            </label>
            <input
              type="number"
              inputMode="numeric"
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              placeholder="0"
              className="w-full px-4 py-3.5 bg-bg-card border border-border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint"
            />
            <div className="flex gap-2 mt-2 flex-wrap">
              {AMOUNT_CHIPS.map((chip) => (
                <button
                  key={chip}
                  onClick={() => setAmountStr(String(chip))}
                  className={`min-h-[44px] px-4 rounded-full text-[13px] font-semibold border transition-colors ${
                    amount === chip
                      ? 'bg-accent text-bg border-accent'
                      : 'bg-bg-card text-text-dim border-border'
                  }`}
                >
                  ₹{chip.toLocaleString('en-IN')}
                </button>
              ))}
            </div>
          </div>

          {/* Bonus */}
          <div>
            <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint block mb-2">
              Bonus (₹) <span className="normal-case tracking-normal font-normal text-text-faint">(optional)</span>
            </label>
            <input
              type="number"
              inputMode="numeric"
              value={bonusStr}
              onChange={(e) => setBonusStr(e.target.value)}
              placeholder="0"
              className="w-full px-4 py-3.5 bg-bg-card border border-border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint"
            />
            <div className="flex gap-2 mt-2 flex-wrap">
              {BONUS_CHIPS.map((chip) => (
                <button
                  key={chip}
                  onClick={() => setBonusStr(String(chip))}
                  className={`min-h-[44px] px-4 rounded-full text-[13px] font-semibold border transition-colors ${
                    bonus === chip
                      ? 'bg-accent text-bg border-accent'
                      : 'bg-bg-card text-text-dim border-border'
                  }`}
                >
                  {chip === 0 ? 'No bonus' : `₹${chip}`}
                </button>
              ))}
            </div>
          </div>

          {/* Payment mode */}
          <div>
            <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint block mb-2">
              Payment Mode
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['cash', 'upi', 'card'] as PaymentMode[]).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setPaymentMode(mode)}
                  className={`min-h-[54px] rounded-2xl text-[14px] font-semibold border capitalize transition-colors ${
                    paymentMode === mode
                      ? 'bg-accent text-bg border-accent'
                      : 'bg-bg-card text-text-dim border-border'
                  }`}
                >
                  {mode.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* UPI QR — shown when mode=UPI and amount>0 */}
          {paymentMode === 'upi' && amount > 0 && (() => {
            const upiId = settings?.upiId?.trim()
            const clubName = settings?.clubName || 'ClubKeeper'
            return upiId ? (
              <div className="flex flex-col items-center gap-3">
                <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint self-start">
                  UPI QR — ₹{amount.toLocaleString('en-IN')}
                </p>
                <UpiQrCard
                  upiId={upiId}
                  payeeName={clubName}
                  amount={amount}
                  transactionNote={`Wallet top-up — ${displayName}`}
                />
                <p className="text-[11px] text-text-faint">Show this QR to the customer</p>
              </div>
            ) : (
              <p className="text-[13px] text-text-faint text-center py-1">
                Set UPI ID in Settings to show QR
              </p>
            )
          })()}

          {/* Summary */}
          {amount > 0 && (
            <div className="bg-bg-card border border-border rounded-2xl p-4 space-y-2">
              <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint mb-3">
                Summary
              </p>
              <div className="flex justify-between text-[14px]">
                <span className="text-text-dim">Paid</span>
                <span className="text-text font-semibold">₹{amount.toLocaleString('en-IN')}</span>
              </div>
              {bonus > 0 && (
                <div className="flex justify-between text-[14px]">
                  <span className="text-text-dim">Bonus</span>
                  <span className="text-free font-semibold">+₹{bonus.toLocaleString('en-IN')}</span>
                </div>
              )}
              <div className="border-t border-border pt-2 flex justify-between text-[14px]">
                <span className="text-text-dim">Credited</span>
                <span className="text-text font-bold">₹{totalCredited.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between text-[14px]">
                <span className="text-text-dim">New balance</span>
                <span className="text-accent font-bold">
                  ₹{(customer.walletBalance + totalCredited).toLocaleString('en-IN')}
                </span>
              </div>
              {previewTierCoins > 0 && (
                <div className="flex justify-between text-[14px] pt-1 border-t border-border mt-1">
                  <span className="text-amber-400">ClubCoins earned</span>
                  <span className="text-amber-400 font-semibold">+{previewTierCoins.toLocaleString('en-IN')} 🪙</span>
                </div>
              )}
              {previewWelcomeCoins > 0 && (
                <div className="flex justify-between text-[14px]">
                  <span className="text-amber-400">Welcome bonus</span>
                  <span className="text-amber-400 font-semibold">+{previewWelcomeCoins.toLocaleString('en-IN')} 🪙</span>
                </div>
              )}
            </div>
          )}

          {/* Confirm */}
          <button
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="w-full min-h-[54px] bg-accent text-bg font-bold text-[16px] rounded-2xl disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving ? (
              <div className="w-5 h-5 border-2 border-bg border-t-transparent rounded-full animate-spin" />
            ) : (
              'Confirm Top-up'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

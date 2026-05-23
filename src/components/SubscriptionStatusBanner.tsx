import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { useAuthStore } from '../store/authStore'

export function SubscriptionStatusBanner() {
  const navigate = useNavigate()
  const { subscription } = useAuthStore()

  if (!subscription) return null

  const { status, trialEndsAt, cancelAtPeriodEnd, currentPeriodEnd, plan } = subscription

  const planMonthlyPrice = plan === 'starter' ? 299 : plan === 'standard' ? 599 : 999

  if (status === 'trialing' && trialEndsAt) {
    const daysLeft = Math.max(0, Math.ceil((trialEndsAt - Date.now()) / 86400000))
    const chargeDate = format(new Date(trialEndsAt), 'd MMM')
    return (
      <div
        className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-xl px-4 py-3 border"
        style={{ background: 'rgba(184,255,90,.06)', borderColor: 'rgba(184,255,90,.25)' }}
      >
        <p className="text-[13px] text-text leading-snug">
          <span className="font-bold text-accent">Free trial:</span>{' '}
          {daysLeft} day{daysLeft !== 1 ? 's' : ''} left.{' '}
          ₹{planMonthlyPrice.toLocaleString('en-IN')} charged on {chargeDate}.
        </p>
        <button
          onClick={() => navigate('/settings')}
          className="text-[12px] font-bold text-accent shrink-0"
        >
          Manage →
        </button>
      </div>
    )
  }

  if (status === 'past_due') {
    return (
      <div
        className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-xl px-4 py-3 border"
        style={{ background: 'rgba(239,68,68,.08)', borderColor: 'rgba(239,68,68,.3)' }}
      >
        <p className="text-[13px] text-[#ef4444] leading-snug font-semibold">
          Payment failed. Update payment method.
        </p>
        <button
          onClick={() => navigate('/settings')}
          className="text-[12px] font-bold text-[#ef4444] shrink-0"
        >
          Fix Now →
        </button>
      </div>
    )
  }

  if (status === 'active' && cancelAtPeriodEnd && currentPeriodEnd) {
    const endDate = format(new Date(currentPeriodEnd), 'd MMM')
    return (
      <div
        className="mx-4 mb-3 flex items-center justify-between gap-3 rounded-xl px-4 py-3 border"
        style={{ background: 'rgba(247,201,72,.08)', borderColor: 'rgba(247,201,72,.3)' }}
      >
        <p className="text-[13px] leading-snug" style={{ color: '#f7c948' }}>
          Cancelling on {endDate}.
        </p>
        <button
          onClick={() => navigate('/settings')}
          className="text-[12px] font-bold shrink-0"
          style={{ color: '#f7c948' }}
        >
          Resume →
        </button>
      </div>
    )
  }

  return null
}

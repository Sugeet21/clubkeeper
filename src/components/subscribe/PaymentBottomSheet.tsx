import { useState } from 'react'

type PlanId = 'starter' | 'standard'
type Billing = 'monthly' | 'annual'
type Method = 'upi' | 'card' | 'netbanking' | 'wallets' | ''

interface Props {
  open: boolean
  onClose: () => void
  selectedPlan: PlanId
  billing: Billing
  currentPrice: number
  trialEndDate: string
  paying: boolean
  payError: string | null
  onPay: () => void
}

const PLAN_NAMES: Record<PlanId, string> = {
  starter: 'Starter Plan',
  standard: 'Standard Plan',
}

function rupee(n: number) {
  return '₹' + n.toLocaleString('en-IN')
}

function GoogleLogoSmall() {
  return (
    <svg className="w-[22px] h-[22px]" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
      <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34A21.99 21.99 0 0 0 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z" />
      <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
    </svg>
  )
}

const UPI_APPS = [
  { name: 'GPay', bg: '#fff', content: <GoogleLogoSmall />, textColor: '' },
  { name: 'PhonePe', bg: '#5f259f', label: 'Pe', textColor: '#fff' },
  { name: 'Paytm', bg: '#00baf2', label: 'P', textColor: '#fff' },
  { name: 'BHIM', bg: '#ff9933', label: 'B', textColor: '#fff' },
]

const METHODS: { id: Method; icon: string; name: string; tag?: string; body: string }[] = [
  { id: 'upi', icon: '📲', name: 'UPI', tag: 'Fastest', body: '' },
  { id: 'card', icon: '💳', name: 'Credit / Debit Card', body: 'Visa, Mastercard, RuPay, Amex accepted.' },
  { id: 'netbanking', icon: '🏦', name: 'Net Banking', body: 'SBI · HDFC · ICICI · Axis · Kotak & 50+ more' },
  { id: 'wallets', icon: '👛', name: 'Wallets', body: 'Paytm Wallet · Mobikwik · Amazon Pay · Freecharge' },
]

export function PaymentBottomSheet({
  open, onClose, selectedPlan, billing, currentPrice, trialEndDate, paying, payError, onPay,
}: Props) {
  const [openMethod, setOpenMethod] = useState<Method>('upi')
  function toggleMethod(id: Method) {
    setOpenMethod((prev) => (prev === id ? '' : id))
  }
  const [upiId, setUpiId] = useState('')

  const planDesc =
    billing === 'monthly'
      ? `7-day trial · then ${rupee(currentPrice)} / month`
      : `7-day trial · then ${rupee(currentPrice)} / year`

  return (
    <div
      className="absolute left-0 right-0 bottom-0 z-[25] bg-bg border-t border-border rounded-t-[24px] flex flex-col transition-transform duration-300"
      style={{
        transform: open ? 'translateY(0)' : 'translateY(100%)',
        transitionTimingFunction: 'cubic-bezier(.2,.8,.2,1)',
        maxHeight: '88%',
        boxShadow: '0 -30px 60px rgba(0,0,0,.55)',
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Payment"
    >
      {/* Grab handle */}
      <div className="w-10 h-1 rounded-full bg-border mx-auto mt-2.5 flex-shrink-0" />

      {/* Header */}
      <div className="flex items-center justify-between gap-2.5 px-[18px] py-3.5 flex-shrink-0">
        <h2 className="text-[20px] font-extrabold tracking-[-0.03em] text-text">
          Start Your 7-Day Trial
        </h2>
        <button
          onClick={onClose}
          className="w-11 h-11 rounded-[12px] flex items-center justify-center text-text-dim border border-transparent transition-all duration-200 active:bg-bg-card active:border-border"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto overscroll-contain px-[18px] pb-2">
        {/* Summary row */}
        <div className="flex items-center justify-between gap-2.5 px-3.5 py-3.5 bg-bg-card border border-border rounded-[14px] mb-3.5">
          <div className="flex flex-col gap-0.5">
            <span className="font-bold text-[14px] text-text">{PLAN_NAMES[selectedPlan]}</span>
            <span className="text-[12px] text-text-dim font-mono tracking-[.02em]">{planDesc}</span>
          </div>
          <span className="font-mono font-bold text-[18px] text-text flex-shrink-0">
            {rupee(currentPrice)}
          </span>
        </div>

        {/* Payment methods */}
        <div className="flex flex-col gap-2">
          {METHODS.map((m) => {
            const isOpen = openMethod === m.id
            return (
              <div
                key={m.id}
                className={`bg-bg-card rounded-[14px] overflow-hidden border transition-colors duration-200 ${
                  isOpen ? 'border-accent/35' : 'border-border'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleMethod(m.id)}
                  className="w-full flex items-center gap-3 px-3.5 py-3.5 min-h-[60px] text-left"
                >
                  <div className="w-[34px] h-[34px] flex-shrink-0 rounded-[10px] bg-[#0f1411] border border-border flex items-center justify-center text-[16px]">
                    {m.icon}
                  </div>
                  <span className="font-semibold text-[14px] text-text flex-1">{m.name}</span>
                  {m.tag && (
                    <span className="font-mono text-[10px] uppercase tracking-[.16em] text-accent bg-accent/12 px-1.5 py-0.5 rounded-[6px]">
                      {m.tag}
                    </span>
                  )}
                  <span
                    className="text-text-faint font-bold text-[18px] transition-transform duration-200"
                    style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0deg)', color: isOpen ? '#b8ff5a' : undefined }}
                  >
                    ›
                  </span>
                </button>

                <div
                  style={{
                    maxHeight: isOpen ? '400px' : '0',
                    overflow: 'hidden',
                    transition: 'max-height 0.3s ease',
                    borderTop: isOpen ? '1px solid #2a322d' : '1px solid transparent',
                  }}
                >
                  <div className="p-3.5">
                    {m.id === 'upi' ? (
                      <>
                        {/* UPI app grid */}
                        <div className="grid grid-cols-4 gap-2 mb-3.5">
                          {UPI_APPS.map((app) => (
                            <button
                              key={app.name}
                              type="button"
                              className="flex flex-col items-center gap-1.5 bg-[#0f1411] border border-border rounded-[12px] py-2.5 px-1.5 min-h-[64px] active:scale-[.96] active:border-accent/35 transition-all duration-200"
                            >
                              <div
                                className="w-[30px] h-[30px] rounded-lg flex items-center justify-center font-extrabold text-[14px]"
                                style={{ background: app.bg, color: app.textColor || undefined }}
                              >
                                {app.content ?? app.label}
                              </div>
                              <span className="font-mono text-[10.5px] text-text-dim">{app.name}</span>
                            </button>
                          ))}
                        </div>

                        {/* Divider */}
                        <div className="flex items-center gap-2.5 font-mono text-[11px] uppercase tracking-[.14em] text-text-faint my-1.5 mb-2.5">
                          <span className="flex-1 h-px bg-border" />
                          or pay with UPI ID
                          <span className="flex-1 h-px bg-border" />
                        </div>

                        {/* UPI ID input */}
                        <div className="flex gap-2 items-center">
                          <input
                            type="text"
                            inputMode="email"
                            placeholder="yourname@oksbi"
                            value={upiId}
                            onChange={(e) => setUpiId(e.target.value)}
                            className="flex-1 bg-[#0f1411] border border-border text-text font-mono text-[14px] px-3.5 py-3 rounded-[12px] min-h-[46px] outline-none focus:border-accent/35 transition-colors"
                            style={{ boxShadow: upiId ? '0 0 0 3px rgba(184,255,90,.08)' : undefined }}
                          />
                          <button
                            type="button"
                            className="bg-bg-card text-text-dim border border-border px-3 min-h-[46px] rounded-[12px] font-mono text-[11px] uppercase tracking-[.1em]"
                          >
                            Scan QR
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="text-[13px] text-text-dim">{m.body}</p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Footer */}
      <div
        className="px-[18px] pb-[22px] pt-3.5 flex-shrink-0 border-t"
        style={{
          borderColor: 'rgba(42,50,45,.55)',
          background: 'linear-gradient(180deg, rgba(10,14,12,.4), #0a0e0c)',
        }}
      >
        <button
          type="button"
          onClick={onPay}
          disabled={paying}
          className="w-full flex items-center justify-center gap-2 bg-accent text-bg min-h-[54px] rounded-[14px] font-extrabold text-[15px] tracking-[-0.005em] active:translate-y-[1px] transition-transform disabled:opacity-80"
          style={{ boxShadow: '0 8px 22px -8px rgba(184,255,90,.55)' }}
        >
          {paying && (
            <span
              className="w-4 h-4 rounded-full animate-spin flex-shrink-0"
              style={{ border: '2.5px solid rgba(10,14,12,.2)', borderTopColor: '#0a0e0c' }}
            />
          )}
          <span>{paying ? 'Processing…' : 'Start Free Trial'}</span>
        </button>

        <p className="mt-2.5 text-center text-[11px] text-text-faint leading-relaxed">
          ₹0 charged today.{' '}
          <span className="font-semibold text-text">{rupee(currentPrice)}</span> will be charged on{' '}
          <span className="font-semibold text-text">{trialEndDate}</span>. Cancel anytime in Settings before then to avoid charges.
        </p>

        {payError && (
          <div
            className="mt-2.5 flex items-start gap-2 px-3 py-2.5 rounded-[10px] text-[12px] leading-[1.4]"
            style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.3)' }}
          >
            <span className="text-[#ef4444] font-bold flex-shrink-0">!</span>
            <span className="text-[#ef4444]">{payError}</span>
          </div>
        )}

        <div className="flex items-center justify-center gap-1.5 mt-2.5 font-mono text-[10.5px] tracking-[.06em] text-text-faint">
          <span className="flex items-center gap-1 text-text-dim font-semibold">
            <span className="w-2 h-2 rounded-[2px] bg-[#3395ff]" />
            Powered by Razorpay
          </span>
          · 256-bit SSL
        </div>
      </div>
    </div>
  )
}

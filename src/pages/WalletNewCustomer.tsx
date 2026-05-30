import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCustomerStore, DuplicatePhoneError } from '../store/customerStore'
import { useToastStore } from '../store/toastStore'

type Mode = 'phone' | 'walkin'

export default function WalletNewCustomer() {
  const navigate = useNavigate()
  const { createCustomerWithPhone, createWalkIn } = useCustomerStore()
  const { show: showToast } = useToastStore()

  const [mode, setMode] = useState<Mode>('phone')
  const [phoneDigits, setPhoneDigits] = useState('')
  const [name, setName] = useState('')
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [phoneErrorCustomerId, setPhoneErrorCustomerId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function handlePhoneChange(value: string) {
    // Allow only digits, max 10
    const digits = value.replace(/\D/g, '').slice(0, 10)
    setPhoneDigits(digits)
    if (phoneError) { setPhoneError(null); setPhoneErrorCustomerId(null) }
  }

  function isPhoneValid() {
    return phoneDigits.length === 10
  }

  const canSave =
    !saving &&
    (mode === 'walkin' || isPhoneValid())

  async function handleSave() {
    if (!canSave) return
    setSaving(true)
    try {
      if (mode === 'phone') {
        const phone = `+91${phoneDigits}`
        const customer = await createCustomerWithPhone(phone, name || null)
        navigate(`/wallet/topup/${customer.id}`, { replace: true })
      } else {
        const customer = await createWalkIn(name || null)
        navigate(`/wallet/topup/${customer.id}`, { replace: true })
      }
    } catch (err) {
      if (err instanceof DuplicatePhoneError) {
        // Inline error + View profile link replaces the toast for this case —
        // the user needs to see where to tap, not just a dismissible notification.
        setPhoneError(err.message)
        setPhoneErrorCustomerId(err.existingCustomer.id)
      } else {
        showToast({ message: 'Something went wrong. Try again.', type: 'error' })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-bg min-h-screen pb-24">
      <div className="pt-safe px-5">
        {/* Header */}
        <div className="flex items-center gap-3 pt-4 pb-6">
          <button
            onClick={() => navigate('/wallet')}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center -ml-1 text-text-dim"
            aria-label="Back"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <h1 className="text-[22px] font-bold text-text">Add Customer</h1>
        </div>

        {/* Phone section */}
        {mode === 'phone' && (
          <div className="space-y-4">
            <div>
              <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint block mb-2">
                Phone Number
              </label>
              <div className="flex gap-2">
                <div className="flex items-center px-4 py-3.5 bg-bg-card border border-border rounded-2xl text-text-dim text-[15px] shrink-0">
                  +91
                </div>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={phoneDigits}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  placeholder="XXXXX XXXXX"
                  className={`flex-1 px-4 py-3.5 bg-bg-card border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint ${
                    phoneError ? 'border-busy' : 'border-border'
                  }`}
                  autoFocus
                />
              </div>
              {phoneError && (
                <div className="flex items-center justify-between gap-2 mt-2">
                  <p className="text-[13px] text-busy">{phoneError}</p>
                  {phoneErrorCustomerId && (
                    <button
                      onClick={() => navigate(`/customer/${phoneErrorCustomerId}`)}
                      className="text-[13px] text-accent font-semibold shrink-0 min-h-[36px] flex items-center"
                    >
                      View profile →
                    </button>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint block mb-2">
                Name <span className="normal-case tracking-normal font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Customer name"
                className="w-full px-4 py-3.5 bg-bg-card border border-border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint"
              />
            </div>

            <button
              onClick={() => { setMode('walkin'); setPhoneDigits(''); setPhoneError(null) }}
              className="text-text-dim text-[13px] underline underline-offset-2"
            >
              Skip phone — walk-in customer
            </button>
          </div>
        )}

        {/* Walk-in section */}
        {mode === 'walkin' && (
          <div className="space-y-4">
            <div className="bg-bg-card border border-border rounded-2xl p-4">
              <p className="text-[13px] text-text-dim">
                A walk-in code (WALK-001, WALK-002…) will be assigned automatically.
                You can add a phone number later from the customer profile.
              </p>
            </div>

            <div>
              <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint block mb-2">
                Name <span className="normal-case tracking-normal font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Walk-in customer name"
                className="w-full px-4 py-3.5 bg-bg-card border border-border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint"
                autoFocus
              />
            </div>

            <button
              onClick={() => setMode('phone')}
              className="text-text-dim text-[13px] underline underline-offset-2"
            >
              Enter phone number instead
            </button>
          </div>
        )}

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={!canSave}
          className="w-full mt-8 min-h-[54px] bg-accent text-bg font-bold text-[16px] rounded-2xl disabled:opacity-40 flex items-center justify-center gap-2"
        >
          {saving ? (
            <div className="w-5 h-5 border-2 border-bg border-t-transparent rounded-full animate-spin" />
          ) : (
            mode === 'phone' ? 'Save & Add Credit' : 'Continue as Walk-in'
          )}
        </button>
      </div>
    </div>
  )
}

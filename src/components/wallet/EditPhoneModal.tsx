import { useEffect, useState } from 'react'
import { useCustomerStore, DuplicatePhoneError } from '../../store/customerStore'
import { useToastStore } from '../../store/toastStore'
import { useNavigate } from 'react-router-dom'
import type { Customer } from '../../types/customer'

interface Props {
  customer: Customer
  onClose: () => void
}

export default function EditPhoneModal({ customer, onClose }: Props) {
  const { updateCustomerPhone } = useCustomerStore()
  const { show: showToast } = useToastStore()
  const navigate = useNavigate()

  const [phoneDigits, setPhoneDigits] = useState(
    customer.phone ? customer.phone.slice(3) : '',
  )
  const [phoneError, setPhoneError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const isValid = phoneDigits.length === 10

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  function handlePhoneChange(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 10)
    setPhoneDigits(digits)
    if (phoneError) setPhoneError(null)
  }

  async function handleSave() {
    if (!isValid || saving) return
    setSaving(true)
    try {
      const phone = `+91${phoneDigits}`
      await updateCustomerPhone(customer.id, phone)
      showToast({ message: 'Phone number updated', type: 'success' })
      onClose()
    } catch (err) {
      if (err instanceof DuplicatePhoneError) {
        setPhoneError(err.message)
        showToast({
          message: err.message,
          type: 'error',
          actionLabel: 'View profile',
          onAction: () => {
            onClose()
            navigate(`/customer/${err.existingCustomer.id}`)
          },
        })
      } else {
        showToast({ message: 'Failed to update phone. Try again.', type: 'error' })
      }
    } finally {
      setSaving(false)
    }
  }

  const displayName = customer.name ?? customer.walkInCode ?? 'Customer'

  return (
    <>
      {/* Scrim — Pattern M1 */}
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
      {/* Sheet */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-bg-card rounded-t-3xl p-5 pb-safe">
        <div className="w-10 h-1 bg-border rounded-full mx-auto mb-5" />

        <h2 className="text-[18px] font-bold text-text mb-1">
          {customer.phone ? 'Edit Phone' : 'Add Phone'}
        </h2>
        <p className="text-[13px] text-text-dim mb-5">{displayName}</p>

        {customer.walkInCode && !customer.phone && (
          <div className="bg-paused/10 border border-paused/20 rounded-xl px-4 py-3 mb-4">
            <p className="text-[13px] text-paused">
              Adding a phone will remove the walk-in code ({customer.walkInCode}).
            </p>
          </div>
        )}

        <div className="mb-5">
          <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint block mb-2">
            Phone Number
          </label>
          <div className="flex gap-2">
            <div className="flex items-center px-4 py-3.5 bg-bg border border-border rounded-2xl text-text-dim text-[15px] shrink-0">
              +91
            </div>
            <input
              type="tel"
              inputMode="numeric"
              value={phoneDigits}
              onChange={(e) => handlePhoneChange(e.target.value)}
              placeholder="XXXXX XXXXX"
              className="flex-1 px-4 py-3.5 bg-bg border border-border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint"
              style={{ borderColor: phoneError ? '#ff6b4a' : undefined }}
              autoFocus
            />
          </div>
          {phoneError && (
            <p className="text-[13px] text-busy mt-2">{phoneError}</p>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 min-h-[54px] bg-bg border border-border text-text-dim font-semibold text-[15px] rounded-2xl"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={!isValid || saving}
            className="flex-1 min-h-[54px] bg-accent text-bg font-bold text-[15px] rounded-2xl disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving ? (
              <div className="w-5 h-5 border-2 border-bg border-t-transparent rounded-full animate-spin" />
            ) : (
              'Save'
            )}
          </button>
        </div>
      </div>
    </>
  )
}

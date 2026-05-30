import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCustomerStore, DuplicatePhoneError } from '../../store/customerStore'
import { useToastStore } from '../../store/toastStore'
import { customerDisplayName } from '../../lib/customerDisplay'
import type { Customer } from '../../types/customer'

interface Props {
  customer: Customer
  onClose: () => void
}

export default function EditCustomerModal({ customer, onClose }: Props) {
  const { updateCustomer } = useCustomerStore()
  const { show: showToast } = useToastStore()
  const navigate = useNavigate()

  const [name, setName] = useState(customer.name ?? '')
  const [phoneDigits, setPhoneDigits] = useState(
    customer.phone ? customer.phone.slice(3) : '',
  )
  const [phoneError, setPhoneErrorState] = useState<string | null>(null)
  const [phoneErrorCustomerId, setPhoneErrorCustomerId] = useState<string | null>(null)
  const [nameError, setNameError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  function handleNameChange(value: string) {
    setName(value)
    if (nameError) setNameError(null)
    if (phoneError) { setPhoneErrorState(null); setPhoneErrorCustomerId(null) }
  }

  function handlePhoneChange(value: string) {
    const digits = value.replace(/\D/g, '').slice(0, 10)
    setPhoneDigits(digits)
    if (phoneError) { setPhoneErrorState(null); setPhoneErrorCustomerId(null) }
  }

  const trimmedName = name.trim()
  const phoneEntered = phoneDigits.length > 0
  const phoneValid = phoneDigits.length === 10

  // Validation:
  // - Name max 40 chars
  // - Phone if entered: must be exactly 10 digits
  // - If customer has no walkInCode: at least one of name or phone required
  // - Nothing changed: disable save (no-op guard)
  const nameChanged = trimmedName !== (customer.name ?? '')
  const phoneChanged = phoneDigits !== (customer.phone ? customer.phone.slice(3) : '')
  const nothingChanged = !nameChanged && !phoneChanged

  const nameToStore = trimmedName || null
  const phoneToStore = phoneDigits.length === 10 ? `+91${phoneDigits}` : phoneDigits.length === 0 ? null : null

  // A customer without a walkInCode must have at least name or phone
  const needsAtLeastOne = !customer.walkInCode
  const wouldHaveNeither = needsAtLeastOne && !nameToStore && !phoneToStore

  const canSave =
    !saving &&
    !nothingChanged &&
    (!phoneEntered || phoneValid) &&
    trimmedName.length <= 40 &&
    !wouldHaveNeither

  async function handleSave() {
    if (!canSave) return

    // Show inline error if phone partially entered but not 10 digits
    if (phoneEntered && !phoneValid) {
      setPhoneErrorState('Enter full 10-digit number')
      return
    }
    if (trimmedName.length > 40) {
      setNameError('Name too long (max 40 characters)')
      return
    }

    setSaving(true)
    try {
      await updateCustomer(customer.id, {
        name: nameToStore,
        phone: phoneToStore,
      })
      showToast({ message: 'Customer updated', type: 'success' })
      onClose()
    } catch (err) {
      if (err instanceof DuplicatePhoneError) {
        setPhoneErrorState(err.message)
        setPhoneErrorCustomerId(err.existingCustomer.id)
      } else {
        showToast({ message: 'Failed to save. Try again.', type: 'error' })
      }
    } finally {
      setSaving(false)
    }
  }

  const headerLabel = customerDisplayName(customer)

  return (
    <>
      {/* Scrim — Pattern M1 */}
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} />
      {/* Sheet — Pattern M1 */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-bg-card rounded-t-3xl p-5 pb-safe">
        <div className="w-10 h-1 bg-border rounded-full mx-auto mb-5" />

        <h2 className="text-[18px] font-bold text-text mb-1">Edit Customer</h2>
        <p className="text-[13px] text-text-dim mb-5">{headerLabel}</p>

        {/* Name input */}
        <div className="mb-4">
          <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint block mb-2">
            Name <span className="normal-case tracking-normal font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Customer name"
            className={`w-full px-4 py-3.5 bg-bg border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint ${
              nameError ? 'border-busy' : 'border-border'
            }`}
            autoFocus
          />
          {nameError && (
            <p className="text-[13px] text-busy mt-2">{nameError}</p>
          )}
        </div>

        {/* Phone input */}
        <div className="mb-5">
          <label className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint block mb-2">
            Phone <span className="normal-case tracking-normal font-normal">(optional)</span>
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
              className={`flex-1 px-4 py-3.5 bg-bg border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint ${
                phoneError ? 'border-busy' : 'border-border'
              }`}
            />
          </div>
          {phoneError && (
            <div className="flex items-center justify-between gap-2 mt-2">
              <p className="text-[13px] text-busy">{phoneError}</p>
              {phoneErrorCustomerId && (
                <button
                  onClick={() => {
                    onClose()
                    navigate(`/customer/${phoneErrorCustomerId}`)
                  }}
                  className="text-[13px] text-accent font-semibold shrink-0 min-h-[36px] flex items-center"
                >
                  View profile →
                </button>
              )}
            </div>
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
            disabled={!canSave}
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

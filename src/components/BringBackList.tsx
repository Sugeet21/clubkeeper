import { useState, useEffect } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { getDormantCustomers } from '../lib/dormancy'
import { buildWhatsAppLink, buildNudgeVars, logNudgeSent, renderNudgeTemplate } from '../lib/nudge'
import { customerDisplayName, formattedPhone } from '../lib/customerDisplay'
import { formatCoins } from '../lib/coins'
import type { Customer } from '../types/customer'

interface Props {
  thresholdDays: number
  nudgeTemplate: string
  clubName: string
  rupeesPerCoin: number
  minutesPerCoin: number
  coinExpiryDays: number
}

export function BringBackList({
  thresholdDays,
  nudgeTemplate,
  clubName,
  rupeesPerCoin,
  minutesPerCoin,
  coinExpiryDays,
}: Props) {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [skipped, setSkipped] = useState<Set<string>>(() => {
    // Restore skips from sessionStorage on mount
    const raw = sessionStorage.getItem('nudge_skipped') ?? '[]'
    try { return new Set(JSON.parse(raw) as string[]) } catch { return new Set() }
  })

  useEffect(() => {
    getDormantCustomers(thresholdDays).then(setCustomers).catch(() => setCustomers([]))
  }, [thresholdDays])

  const visible = customers.filter((c) => !skipped.has(c.id))

  if (visible.length === 0) return null

  function skipCustomer(id: string) {
    setSkipped((prev) => {
      const next = new Set(prev)
      next.add(id)
      const arr = Array.from(next)
      sessionStorage.setItem('nudge_skipped', JSON.stringify(arr))
      return next
    })
  }

  async function handleWhatsApp(customer: Customer) {
    if (!customer.phone) return
    const vars = await buildNudgeVars(
      customer,
      clubName,
      rupeesPerCoin,
      minutesPerCoin,
      coinExpiryDays,
    )
    const message = renderNudgeTemplate(nudgeTemplate, vars)
    const link = buildWhatsAppLink(customer.phone, message)
    window.open(link, '_blank', 'noopener,noreferrer')
    // Audit log — fire-and-forget
    logNudgeSent(customer.id).catch(() => {/* non-critical */})
    skipCustomer(customer.id)
  }

  return (
    <div className="mb-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[12px] font-mono font-bold uppercase tracking-widest text-text-faint">
          Bring Back · {visible.length} dormant
        </span>
      </div>

      <div className="space-y-2">
        {visible.map((c) => (
          <BringBackRow
            key={c.id}
            customer={c}
            onWhatsApp={() => handleWhatsApp(c)}
            onSkip={() => skipCustomer(c.id)}
          />
        ))}
      </div>
    </div>
  )
}

function BringBackRow({
  customer,
  onWhatsApp,
  onSkip,
}: {
  customer: Customer
  onWhatsApp: () => void
  onSkip: () => void
}) {
  const name = customerDisplayName(customer)
  const phone = formattedPhone(customer)
  const coins = customer.coinBalance ?? 0

  return (
    <div className="bg-bg-card border border-border rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-text font-semibold text-[14px] truncate">{name}</p>
          {phone && <p className="text-text-dim text-[12px] font-mono mt-0.5">{phone}</p>}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-amber-400 text-[12px] font-semibold">
              🪙 {formatCoins(coins)} coins
            </span>
            <span className="text-text-faint text-[12px]">
              · last visit {formatDistanceToNow(customer.lastVisitAt ?? customer.createdAt, { addSuffix: true })}
            </span>
          </div>
        </div>
      </div>

      <div className="flex gap-2 mt-3">
        <button
          onClick={onWhatsApp}
          className="flex-1 min-h-[44px] flex items-center justify-center gap-2 bg-[#25D366]/15 border border-[#25D366]/30 text-[#25D366] font-semibold text-[13px] rounded-xl"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
            <path d="M12 0C5.373 0 0 5.373 0 12c0 2.123.55 4.116 1.516 5.845L.057 23.25a.5.5 0 0 0 .614.65l5.595-1.464A11.938 11.938 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75a9.73 9.73 0 0 1-4.966-1.359l-.356-.212-3.69.968.982-3.594-.232-.37A9.712 9.712 0 0 1 2.25 12C2.25 6.615 6.615 2.25 12 2.25S21.75 6.615 21.75 12 17.385 21.75 12 21.75z" />
          </svg>
          WhatsApp
        </button>
        <button
          onClick={onSkip}
          className="min-h-[44px] px-4 text-text-faint text-[13px] border border-border rounded-xl"
        >
          Skip
        </button>
      </div>
    </div>
  )
}

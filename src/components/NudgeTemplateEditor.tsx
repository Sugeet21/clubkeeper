import { SAMPLE_NUDGE_VARS, renderNudgeTemplate } from '../lib/nudge'
import { DEFAULT_ENGAGEMENT_CONFIG } from '../lib/streak'

const VARIABLE_CHIPS: { label: string; variable: string }[] = [
  { label: 'Name', variable: '{name}' },
  { label: 'Club', variable: '{clubName}' },
  { label: 'Coins', variable: '{coins}' },
  { label: '₹ Value', variable: '{rupeeValue}' },
  { label: 'Days away', variable: '{daysSinceVisit}' },
  { label: 'Expires in', variable: '{daysToExpiry}' },
  { label: 'Minutes', variable: '{minutesValue}' },
]

const BROKEN_TEMPLATE_MARKER = '₹{rupeeValue}'

interface Props {
  value: string
  onChange: (value: string) => void
}

export function NudgeTemplateEditor({ value, onChange }: Props) {
  const hasBrokenTemplate = value.includes(BROKEN_TEMPLATE_MARKER)

  function insertVariable(variable: string) {
    onChange(value + variable)
  }

  const preview = renderNudgeTemplate(value, SAMPLE_NUDGE_VARS)

  return (
    <div className="flex flex-col gap-3">
      {hasBrokenTemplate && (
        <div className="flex items-start justify-between gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2.5">
          <p className="text-amber-400 text-[12px] leading-snug">
            ⚠️ Default template was updated to fix ₹₹ display.
          </p>
          <button
            onClick={() => onChange(DEFAULT_ENGAGEMENT_CONFIG.nudgeTemplate)}
            className="text-amber-400 text-[12px] font-semibold shrink-0 underline"
          >
            Reset to new default
          </button>
        </div>
      )}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        placeholder="Hi {name}, we miss you at {clubName}! You have {coins} coins worth ₹{rupeeValue} waiting. Come back soon!"
        className="w-full px-3 py-3 bg-bg border border-border rounded-xl text-text text-[14px] focus:border-accent outline-none placeholder:text-text-faint resize-none"
      />

      {/* Variable chips */}
      <div className="flex flex-wrap gap-1.5">
        {VARIABLE_CHIPS.map(({ label, variable }) => (
          <button
            key={variable}
            onClick={() => insertVariable(variable)}
            className="px-2.5 py-1 bg-bg-card border border-border rounded-lg text-[12px] text-text-dim font-mono"
          >
            {label}
          </button>
        ))}
      </div>

      {/* Live preview */}
      {value.trim() && (
        <div className="bg-bg-card border border-border rounded-xl p-3">
          <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint mb-1.5">
            Preview
          </p>
          <p className="text-text text-[13px] whitespace-pre-wrap leading-relaxed">{preview}</p>
        </div>
      )}
    </div>
  )
}

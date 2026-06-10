import { useState, useEffect } from 'react'
import { db } from '../db/database'
import { getEngagementConfig, DEFAULT_ENGAGEMENT_CONFIG } from '../lib/streak'
import type { EngagementConfig } from '../lib/streak'
import { NudgeTemplateEditor } from './NudgeTemplateEditor'
import { useToastStore } from '../store/toastStore'

export function EngagementConfigCard() {
  const { show: showToast } = useToastStore()
  const [config, setConfig] = useState<EngagementConfig>({ ...DEFAULT_ENGAGEMENT_CONFIG })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getEngagementConfig().then(setConfig).catch(() => {})
  }, [])

  async function save(patch: Partial<EngagementConfig>) {
    const next = { ...config, ...patch }
    setConfig(next)
    setSaving(true)
    try {
      await db.settings.update(1, {
        welcomeBonusEnabled: next.welcomeBonusEnabled,
        welcomeBonusCoins: next.welcomeBonusCoins,
        streakEnabled: next.streakEnabled,
        streakRequiredDays: next.streakRequiredDays,
        streakWindowDays: next.streakWindowDays,
        streakBonusCoins: next.streakBonusCoins,
        dormancyEnabled: next.dormancyEnabled,
        dormantThresholdDays: next.dormantThresholdDays,
        nudgeTemplate: next.nudgeTemplate,
      })
    } catch {
      showToast('Failed to save', 3000)
    } finally {
      setSaving(false)
    }
  }

  function numericInput(value: number, onCommit: (n: number) => void, min = 1, max = 365) {
    return (
      <input
        type="number"
        inputMode="numeric"
        defaultValue={value}
        onBlur={(e) => {
          const n = parseInt(e.target.value, 10)
          if (!isNaN(n) && n >= min && n <= max) onCommit(n)
          else e.target.value = String(value)
        }}
        className="w-16 text-center px-2 py-1.5 bg-bg border border-border rounded-lg text-text text-[14px] font-mono focus:border-accent outline-none"
      />
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Welcome Bonus */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-text text-[14px] font-semibold">Welcome Bonus</p>
            <p className="text-text-faint text-[12px] mt-0.5">One-time coins for first top-up</p>
          </div>
          <button
            onClick={() => void save({ welcomeBonusEnabled: !config.welcomeBonusEnabled })}
            className={`relative w-11 h-6 rounded-full transition-colors ${config.welcomeBonusEnabled ? 'bg-accent' : 'bg-border'}`}
            aria-label="Toggle welcome bonus"
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${config.welcomeBonusEnabled ? 'translate-x-5' : ''}`} />
          </button>
        </div>
        {config.welcomeBonusEnabled && (
          <div className="flex items-center gap-3 mt-2">
            <span className="text-text-dim text-[13px]">Bonus coins</span>
            {numericInput(config.welcomeBonusCoins, (n) => void save({ welcomeBonusCoins: n }), 1, 9999)}
            <span className="text-text-faint text-[12px]">🪙</span>
          </div>
        )}
      </div>

      <div className="h-px bg-border" />

      {/* Streak Bonus */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-text text-[14px] font-semibold">Streak Bonus</p>
            <p className="text-text-faint text-[12px] mt-0.5">Reward repeat wallet visits</p>
          </div>
          <button
            onClick={() => void save({ streakEnabled: !config.streakEnabled })}
            className={`relative w-11 h-6 rounded-full transition-colors ${config.streakEnabled ? 'bg-accent' : 'bg-border'}`}
            aria-label="Toggle streak bonus"
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${config.streakEnabled ? 'translate-x-5' : ''}`} />
          </button>
        </div>
        {config.streakEnabled && (
          <div className="flex flex-col gap-2 mt-2">
            <div className="flex items-center gap-3">
              <span className="text-text-dim text-[13px] w-28 shrink-0">Days required</span>
              {numericInput(config.streakRequiredDays, (n) => void save({ streakRequiredDays: n }), 2, 30)}
              <span className="text-text-faint text-[12px]">days</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-text-dim text-[13px] w-28 shrink-0">Within window</span>
              {numericInput(config.streakWindowDays, (n) => void save({ streakWindowDays: n }), 2, 30)}
              <span className="text-text-faint text-[12px]">days</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-text-dim text-[13px] w-28 shrink-0">Bonus coins</span>
              {numericInput(config.streakBonusCoins, (n) => void save({ streakBonusCoins: n }), 1, 9999)}
              <span className="text-text-faint text-[12px]">🪙</span>
            </div>
          </div>
        )}
      </div>

      <div className="h-px bg-border" />

      {/* Bring Back */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-text text-[14px] font-semibold">Bring Back</p>
            <p className="text-text-faint text-[12px] mt-0.5">Show dormant customers on Wallet page</p>
          </div>
          <button
            onClick={() => void save({ dormancyEnabled: !config.dormancyEnabled })}
            className={`relative w-11 h-6 rounded-full transition-colors ${config.dormancyEnabled ? 'bg-accent' : 'bg-border'}`}
            aria-label="Toggle bring back"
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${config.dormancyEnabled ? 'translate-x-5' : ''}`} />
          </button>
        </div>
        {config.dormancyEnabled && (
          <div className="flex items-center gap-3 mt-2">
            <span className="text-text-dim text-[13px]">Dormant after</span>
            {numericInput(config.dormantThresholdDays, (n) => void save({ dormantThresholdDays: n }), 1, 365)}
            <span className="text-text-faint text-[12px]">days</span>
          </div>
        )}
      </div>

      <div className="h-px bg-border" />

      {/* Nudge Template */}
      <div>
        <p className="text-text text-[14px] font-semibold mb-1">WhatsApp Nudge Message</p>
        <p className="text-text-faint text-[12px] mb-3">Sent when you tap WhatsApp on the Bring Back list</p>
        <NudgeTemplateEditor
          value={config.nudgeTemplate}
          onChange={(v) => void save({ nudgeTemplate: v })}
        />
      </div>

      {saving && (
        <p className="text-text-faint text-[11px] text-right">Saving…</p>
      )}
    </div>
  )
}

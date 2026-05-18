import type { GameType } from '../types'

type FilterValue = 'all' | GameType

interface Pill {
  label: string
  value: FilterValue
  count: number
}

interface Props {
  pills: Pill[]
  active: FilterValue
  onChange: (value: FilterValue) => void
}

export default function FilterPills({ pills, active, onChange }: Props) {
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-3 -mx-4 px-4">
      {pills.map((pill) => {
        const isActive = pill.value === active
        return (
          <button
            key={pill.value}
            onClick={() => onChange(pill.value)}
            className={`flex-none flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap transition-colors ${
              isActive
                ? 'bg-accent text-bg'
                : 'bg-bg-elevated text-text-dim border border-border'
            }`}
          >
            {pill.label}
            <span
              className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                isActive ? 'bg-black/20 text-bg' : 'bg-bg-card text-text-faint'
              }`}
            >
              {pill.count}
            </span>
          </button>
        )
      })}
    </div>
  )
}

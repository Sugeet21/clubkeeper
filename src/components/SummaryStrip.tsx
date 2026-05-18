interface Props {
  totalTables: number
  runningCount: number
  todayTotal: number
  currency: string
}

export default function SummaryStrip({ totalTables, runningCount, todayTotal, currency }: Props) {
  return (
    <div className="grid grid-cols-3 gap-2 mb-4">
      <StatCell label="Tables" value={String(totalTables)} />
      <StatCell label="Running" value={String(runningCount)} accent={runningCount > 0} />
      <StatCell
        label="Today"
        value={`${currency}${todayTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
      />
    </div>
  )
}

function StatCell({
  label,
  value,
  accent = false,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className="bg-bg-elevated rounded-xl px-3 py-2.5 border border-border">
      <p className="text-[10px] uppercase tracking-widest font-mono text-text-faint mb-1">
        {label}
      </p>
      <p className={`text-xl font-bold leading-none ${accent ? 'text-busy' : 'text-text'}`}>
        {value}
      </p>
    </div>
  )
}

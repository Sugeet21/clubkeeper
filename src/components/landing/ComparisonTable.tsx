import { Eyebrow } from './Eyebrow'

type CellVal = 'yes' | 'no' | 'soon' | string

interface TableRow {
  feature: string
  s: CellVal
  st: CellVal
  p: CellVal
}

const ROWS: TableRow[] = [
  { feature: 'Tables', s: '3', st: '8', p: '∞' },
  { feature: 'Live timer', s: 'yes', st: 'yes', p: 'yes' },
  { feature: 'Works offline', s: 'yes', st: 'yes', p: 'yes' },
  { feature: 'Daily reports', s: 'yes', st: 'yes', p: 'yes' },
  { feature: 'Multi-day history', s: 'no', st: 'yes', p: 'yes' },
  { feature: 'Excel / CSV export', s: 'no', st: 'yes', p: 'yes' },
  { feature: 'Time rounding', s: 'no', st: 'yes', p: 'yes' },
  { feature: 'Priority support', s: 'no', st: 'yes', p: 'yes' },
  { feature: 'Multi-staff login', s: 'no', st: 'no', p: 'soon' },
  { feature: 'WhatsApp bills', s: 'no', st: 'no', p: 'soon' },
  { feature: 'Monthly P&L', s: 'no', st: 'no', p: 'soon' },
  { feature: 'Live dashboard', s: 'no', st: 'no', p: 'soon' },
  { feature: 'Multi-location', s: 'no', st: 'no', p: 'soon' },
]

function Cell({ val }: { val: CellVal }) {
  if (val === 'yes') return <span className="font-mono font-bold text-accent">✓</span>
  if (val === 'no') return <span className="font-mono text-text-faint">✗</span>
  if (val === 'soon')
    return (
      <span className="font-mono text-paused text-[11px] tracking-[.05em]">Soon</span>
    )
  return <span className="font-mono text-text">{val}</span>
}

export function ComparisonTable() {
  return (
    <section className="px-5 py-14 relative z-[1]">
      <div className="flex flex-col gap-2.5 mb-5">
        <Eyebrow>Compare</Eyebrow>
        <h2 className="text-[26px] font-extrabold tracking-[-0.03em] leading-[1.1] text-text">
          Compare plans
        </h2>
      </div>

      <div className="border border-border rounded-[18px] overflow-hidden bg-bg-card">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]" style={{ minWidth: '380px' }}>
            <thead>
              <tr>
                <th className="px-3 py-3 text-left font-mono text-[11px] uppercase tracking-[.14em] text-text-faint font-semibold bg-[#0f1411] sticky left-0 border-b border-r border-border min-w-[160px] whitespace-nowrap">
                  Feature
                </th>
                {['Starter', 'Standard', 'Pro'].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-3 text-center font-mono text-[11px] uppercase tracking-[.14em] text-text-faint font-semibold bg-[#0f1411] border-b border-border whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row, i) => (
                <tr key={row.feature}>
                  <td
                    className={`px-3 py-3 text-left text-text font-medium sticky left-0 bg-bg-card border-r border-border whitespace-nowrap ${
                      i < ROWS.length - 1 ? 'border-b border-border' : ''
                    }`}
                  >
                    {row.feature}
                  </td>
                  <td
                    className={`px-3 py-3 text-center ${
                      i < ROWS.length - 1 ? 'border-b border-border' : ''
                    }`}
                  >
                    <Cell val={row.s} />
                  </td>
                  <td
                    className={`px-3 py-3 text-center ${
                      i < ROWS.length - 1 ? 'border-b border-border' : ''
                    }`}
                  >
                    <Cell val={row.st} />
                  </td>
                  <td
                    className={`px-3 py-3 text-center ${
                      i < ROWS.length - 1 ? 'border-b border-border' : ''
                    }`}
                  >
                    <Cell val={row.p} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-2.5 text-right font-mono text-[11px] uppercase tracking-[.1em] text-text-faint">
        ← Swipe to compare →
      </p>
    </section>
  )
}

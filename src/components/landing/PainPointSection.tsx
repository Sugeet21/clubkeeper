import { Eyebrow } from './Eyebrow'

const PAINS = [
  {
    icon: '📓',
    title: 'Forgotten timers',
    desc: 'Your boy gets busy. Forgets to start the clock. You lose ₹120/hour, every time.',
  },
  {
    icon: '⏱️',
    title: 'Customer disputes',
    desc: '"Sir we played only 30 minutes!" — You have no proof. You lose the argument and the money.',
  },
  {
    icon: '💸',
    title: 'No daily visibility',
    desc: "How much did you earn yesterday? Today? This week? The notebook won't tell you in 5 seconds.",
  },
]

export function PainPointSection() {
  return (
    <section className="px-5 py-14 relative z-[1]">
      <div className="flex flex-col gap-2.5 mb-5">
        <Eyebrow>The problem</Eyebrow>
        <h2 className="text-[26px] font-extrabold tracking-[-0.03em] leading-[1.1] text-text">
          The notebook is killing your business
        </h2>
      </div>

      <div className="flex flex-col gap-3">
        {PAINS.map((p) => (
          <div
            key={p.title}
            className="bg-bg-card border border-border rounded-2xl p-[18px] flex gap-3.5 items-start"
          >
            <div className="flex-shrink-0 w-11 h-11 rounded-[12px] bg-[#0f1411] border border-border flex items-center justify-center text-[22px]">
              {p.icon}
            </div>
            <div>
              <h3 className="text-[18px] font-bold tracking-tight text-text mb-1.5">{p.title}</h3>
              <p className="text-[14px] text-text-dim leading-relaxed">{p.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

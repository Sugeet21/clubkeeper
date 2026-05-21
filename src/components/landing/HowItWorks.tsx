import { Eyebrow } from './Eyebrow'

const STEPS = [
  {
    num: '01',
    title: 'Add your tables',
    desc: 'Pool, snooker, carrom — set rates per hour. Takes 2 minutes.',
  },
  {
    num: '02',
    title: 'Tap to start timer',
    desc: 'When customer plays, tap. App tracks time and bill automatically.',
  },
  {
    num: '03',
    title: 'See your real revenue',
    desc: 'Daily and monthly reports. No more guessing what you earned.',
  },
]

export function HowItWorks() {
  return (
    <section className="px-5 py-14 relative z-[1]">
      <div className="flex flex-col gap-2.5 mb-5">
        <Eyebrow>The fix</Eyebrow>
        <h2 className="text-[26px] font-extrabold tracking-[-0.03em] leading-[1.1] text-text">
          How it works
        </h2>
      </div>

      <div className="flex flex-col gap-3.5">
        {STEPS.map((s) => (
          <div
            key={s.num}
            className="grid gap-4 bg-bg-card border border-border rounded-2xl px-4 py-[18px]"
            style={{ gridTemplateColumns: '64px 1fr' }}
          >
            <span className="font-mono font-bold text-[44px] tracking-[-0.04em] text-accent leading-none">
              {s.num}
            </span>
            <div>
              <h3 className="text-[18px] font-bold tracking-tight text-text mb-1">{s.title}</h3>
              <p className="text-[14px] text-text-dim leading-relaxed">{s.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

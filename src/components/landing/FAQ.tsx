import { useState } from 'react'
import { Eyebrow } from './Eyebrow'

const FAQS = [
  {
    q: 'Do I need internet?',
    a: 'No. ClubKeeper works fully offline. Your data is stored on your phone.',
  },
  {
    q: 'What if I want to cancel?',
    a: "Cancel anytime from settings. During the trial, cancelling means you're never charged. After the trial, you keep access until the end of your billing period.",
  },
  {
    q: 'Is my data safe?',
    a: "Yes. All data stays on your phone. Nothing is sent anywhere unless you choose to backup.",
  },
  {
    q: 'Is the 7-day trial really free?',
    a: "Yes. We collect your card upfront, but charge ₹0 for the first 7 days. If you cancel before day 8, you're never charged. After day 7 your selected plan kicks in automatically.",
  },
  {
    q: 'What if I have more than 8 tables?',
    a: "Pro plan supports unlimited tables. Reach out and we'll set you up.",
  },
  {
    q: 'Do you support Hindi / Marathi?',
    a: 'English for now. Hindi UI coming soon.',
  },
]

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  return (
    <section className="px-5 py-14 relative z-[1]">
      <div className="flex flex-col gap-2.5 mb-5">
        <Eyebrow>Questions</Eyebrow>
        <h2 className="text-[26px] font-extrabold tracking-[-0.03em] leading-[1.1] text-text">
          Frequently asked
        </h2>
      </div>

      <div className="flex flex-col gap-2.5">
        {FAQS.map((item, i) => {
          const isOpen = openIndex === i
          return (
            <div key={item.q} className="bg-bg-card border border-border rounded-[14px] overflow-hidden">
              <button
                onClick={() => setOpenIndex(isOpen ? null : i)}
                className="w-full flex items-center justify-between gap-3 px-4 py-[18px] min-h-[54px] text-left font-semibold text-[15px] text-text"
              >
                <span>{item.q}</span>
                <span
                  className="flex-shrink-0 w-7 h-7 rounded-full bg-[#0f1411] border flex items-center justify-center font-mono text-[16px] leading-none transition-all duration-200"
                  style={{
                    transform: isOpen ? 'rotate(45deg)' : 'rotate(0deg)',
                    color: isOpen ? '#b8ff5a' : '#8a948c',
                    borderColor: isOpen ? 'rgba(184,255,90,.35)' : '#2a322d',
                  }}
                >
                  +
                </span>
              </button>
              <div
                style={{
                  maxHeight: isOpen ? '300px' : '0',
                  overflow: 'hidden',
                  transition: 'max-height 0.2s ease',
                }}
              >
                <p className="px-4 pb-[18px] text-[14px] text-text-dim leading-[1.55]">
                  {item.a}
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

export function FinalCTA({ onCTA }: { onCTA: () => void }) {
  return (
    <section className="px-5 pb-14 relative z-[1]">
      <div className="bg-accent rounded-[24px] px-[22px] py-7 relative overflow-hidden">
        {/* Corner glow */}
        <div
          className="absolute -right-[60px] -bottom-[60px] w-[220px] h-[220px] rounded-full pointer-events-none"
          style={{ background: 'radial-gradient(circle, rgba(255,255,255,.18), transparent 60%)' }}
        />

        <h2 className="text-[28px] font-extrabold tracking-[-0.03em] leading-[1.1] text-bg relative z-[1]">
          Ready to stop losing money?
        </h2>
        <p
          className="mt-2.5 text-[15px] leading-relaxed max-w-[300px] relative z-[1]"
          style={{ color: 'rgba(10,14,12,.78)' }}
        >
          Owners using ClubKeeper report ₹8,000–15,000/month in recovered revenue.
        </p>
        <button
          onClick={onCTA}
          className="mt-5 w-full min-h-[54px] py-4 bg-bg text-accent font-bold text-[16px] rounded-2xl active:scale-[0.99] transition-transform relative z-[1]"
          style={{ boxShadow: '0 8px 24px -10px rgba(0,0,0,.5)' }}
        >
          Try Free for 7 Days
        </button>
        <p
          className="mt-3 text-center font-mono text-[12px] tracking-[.04em] relative z-[1]"
          style={{ color: 'rgba(10,14,12,.7)' }}
        >
          ₹0 today · ₹599 charged on day 8 · Cancel anytime
        </p>
      </div>
    </section>
  )
}

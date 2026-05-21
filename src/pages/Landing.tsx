import { useNavigate } from 'react-router-dom'
import { HeroSection } from '../components/landing/HeroSection'
import { PainPointSection } from '../components/landing/PainPointSection'
import { ROICalculator } from '../components/landing/ROICalculator'
import { HowItWorks } from '../components/landing/HowItWorks'
import { PricingSection } from '../components/landing/PricingSection'
import { ComparisonTable } from '../components/landing/ComparisonTable'
import { FAQ } from '../components/landing/FAQ'
import { FinalCTA } from '../components/landing/FinalCTA'
import { Footer } from '../components/landing/Footer'

export default function Landing() {
  const navigate = useNavigate()
  const goSignup = () => navigate('/signup')

  return (
    <div
      className="min-h-screen flex justify-center"
      style={{
        background:
          'radial-gradient(1200px 600px at 50% -200px, rgba(184,255,90,.05), transparent 60%), #05080a',
      }}
    >
      {/* 390px mobile column — full width on phone, centered on desktop */}
      <div className="w-full max-w-[390px] bg-bg relative">
        {/* Corner radial glows */}
        <div
          className="absolute inset-0 pointer-events-none z-0"
          style={{
            background:
              'radial-gradient(420px 320px at 90% -40px, rgba(184,255,90,.10), transparent 60%), radial-gradient(600px 400px at -20% 8%, rgba(184,255,90,.04), transparent 60%)',
          }}
        />

        {/* Sticky top bar */}
        <header
          className="sticky top-0 z-50 h-[60px] flex items-center justify-between px-5 border-b"
          style={{
            background: 'rgba(10,14,12,.78)',
            backdropFilter: 'saturate(140%) blur(10px)',
            WebkitBackdropFilter: 'saturate(140%) blur(10px)',
            borderColor: 'rgba(42,50,45,.6)',
          }}
        >
          <span className="font-extrabold text-[20px] tracking-tight text-text">
            Club<span className="text-accent">Keeper</span>
          </span>
          <button
            onClick={goSignup}
            className="text-[14px] text-text-dim min-h-[44px] px-3 active:text-text transition-colors"
          >
            Sign in
          </button>
        </header>

        {/* Page sections */}
        <HeroSection onCTA={goSignup} />
        <PainPointSection />
        <ROICalculator />
        <HowItWorks />
        <PricingSection onCTA={goSignup} />
        <ComparisonTable />
        <FAQ />
        <FinalCTA onCTA={goSignup} />
        <Footer />
      </div>
    </div>
  )
}

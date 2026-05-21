import { useNavigate } from 'react-router-dom'

export default function Landing() {
  const navigate = useNavigate()
  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-6 gap-8">
      <div className="text-center">
        <h1 className="text-[32px] font-extrabold tracking-tight text-text">ClubKeeper</h1>
        <p className="text-text-dim text-[14px] mt-2">
          Smart timer & billing for indoor game clubs
        </p>
      </div>
      <div className="w-full max-w-xs flex flex-col gap-3">
        <button
          onClick={() => navigate('/signup')}
          className="w-full py-4 bg-accent text-bg rounded-2xl text-[15px] font-bold"
        >
          Get Started
        </button>
        <button
          onClick={() => navigate('/tables')}
          className="w-full py-4 bg-bg-card border border-border text-text rounded-2xl text-[15px] font-semibold"
        >
          Go to App
        </button>
      </div>
      <p className="text-[11px] text-text-faint font-mono">Full UI coming in Prompt 10</p>
    </div>
  )
}

// Phase C Chunk 1 — Owner is signed in but has no clubs row provisioned.
// Phase D will add a real onboarding wizard; for v1 sync, we ask Sugeet
// to provision the clubs row manually.

export default function NoClubScreen() {
  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        <h1 className="text-2xl font-semibold mb-3">Almost there</h1>
        <p className="text-slate-300 leading-relaxed mb-6">
          Your ClubKeeper account is signed in, but your club hasn&apos;t been
          set up on the cloud yet. Sync needs a provisioned club to attach your
          data to.
        </p>
        <p className="text-slate-400 text-sm">
          Please contact Sugeet at{' '}
          <a
            href="mailto:sugeetjadhav@gmail.com"
            className="text-amber-400 underline"
          >
            sugeetjadhav@gmail.com
          </a>{' '}
          to provision your club. He&apos;ll have you running in a few minutes.
        </p>
      </div>
    </div>
  )
}

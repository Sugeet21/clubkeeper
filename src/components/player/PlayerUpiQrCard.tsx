import { PaymentQR } from '../PaymentQR'

// Player-side UPI QR card. Forked from src/components/UpiQrCard.tsx so the
// staff version (used in SessionDetail + WalletTopup + QuickSale) can keep
// its current presentation untouched.
//
// Design system §4.13:
//   - White background — QR needs WHITE bg to scan reliably
//   - 16px inner padding, 8px radius
//   - 2px solid --player-cueYellow border
//   - Below: small text-dim caption "Scan with any UPI app" (Mono, 11px, uppercase)
//
// The underlying PaymentQR (./PaymentQR) is untouched — it's just the
// generator. All player-specific framing lives here.

interface Props {
  amount: number        // integer rupees — encodes ONLY the amount to pay
  upiId: string
  payeeName: string     // club name
  transactionNote: string
}

export function PlayerUpiQrCard({ amount, upiId, payeeName, transactionNote }: Props) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="bg-player-ball-white rounded-md border-2 border-player-cue-yellow p-4 flex items-center justify-center"
        style={{ width: 'min(64vw, 240px)', aspectRatio: '1 / 1' }}
      >
        <PaymentQR
          upiId={upiId}
          payeeName={payeeName}
          amount={amount}
          transactionNote={transactionNote}
        />
      </div>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-player-cue-cream/65">
        Scan with any UPI app
      </p>
    </div>
  )
}

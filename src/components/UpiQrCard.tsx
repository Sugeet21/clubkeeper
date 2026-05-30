import { PaymentQR } from './PaymentQR'

// Shared UPI QR card used in:
//   - src/pages/SessionDetail.tsx  (post-stop payment screen)
//   - src/pages/WalletTopup.tsx    (inline topup UPI QR)
// If you change the card dimensions or PaymentQR props here, both screens are affected.
// See ripple_effects.md → "UPI QR rendering".

interface Props {
  amount: number    // integer rupees — encodes ONLY the amount to pay, never the bonus
  upiId: string
  payeeName: string // club name
  transactionNote: string
}

export function UpiQrCard({ amount, upiId, payeeName, transactionNote }: Props) {
  return (
    // White card: aspect-square + flex centering = equal borders on all 4 sides (Pattern U7)
    <div
      className="bg-white rounded-2xl p-3 aspect-square flex items-center justify-center"
      style={{ width: 'min(72vw, 280px)' }}
    >
      <PaymentQR
        upiId={upiId}
        payeeName={payeeName}
        amount={amount}
        transactionNote={transactionNote}
      />
    </div>
  )
}

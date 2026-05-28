import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

interface PaymentQRProps {
  upiId: string
  payeeName: string       // club name
  amount: number          // integer rupees
  transactionNote: string // e.g. "Pool 1 - 8m"
  size?: number           // internal render resolution only — NOT the displayed CSS size
}

// Render at 2× for retina sharpness. Displayed size is controlled by the parent container.
const RENDER_SIZE = 560

export function PaymentQR({ upiId, payeeName, amount, transactionNote }: PaymentQRProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDataUrl(null)
    setError(null)

    // UPI URI spec: upi://pay?pa=<vpa>&pn=<name>&am=<amount>&tn=<note>&cu=INR
    const params = new URLSearchParams({
      pa: upiId,
      pn: payeeName,
      am: String(amount),
      tn: transactionNote,
      cu: 'INR',
    })
    const uri = `upi://pay?${params.toString()}`

    QRCode.toDataURL(uri, {
      width: RENDER_SIZE,
      margin: 1,
      color: {
        dark: '#0a0e0c',  // QR dots — dark
        light: '#ffffff', // background — white (QR scanners need contrast)
      },
      errorCorrectionLevel: 'M',
    })
      .then((url) => setDataUrl(url))
      .catch((e: Error) => setError(e.message))
  }, [upiId, payeeName, amount, transactionNote])

  if (error) {
    return <div className="text-busy text-sm">QR generation failed: {error}</div>
  }
  if (!dataUrl) {
    // Skeleton fills parent container via width/height 100%
    return <div className="w-full aspect-square bg-bg-card animate-pulse rounded-xl" />
  }
  return (
    <img
      src={dataUrl}
      alt={`UPI payment QR for ₹${amount.toLocaleString('en-IN')}`}
      // Let the parent container control display size — no hardcoded px width/height
      style={{ width: '100%', height: 'auto', display: 'block' }}
    />
  )
}

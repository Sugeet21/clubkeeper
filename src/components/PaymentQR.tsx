import { useEffect, useState } from 'react'
import QRCode from 'qrcode'

interface PaymentQRProps {
  upiId: string
  payeeName: string       // club name
  amount: number          // integer rupees
  transactionNote: string // e.g. "Pool 1 - 8m"
  size?: number           // px, default 240
}

export function PaymentQR({ upiId, payeeName, amount, transactionNote, size = 240 }: PaymentQRProps) {
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
      width: size,
      margin: 1,
      color: {
        dark: '#0a0e0c',  // QR dots — dark
        light: '#ffffff', // background — white (QR scanners need contrast)
      },
      errorCorrectionLevel: 'M',
    })
      .then((url) => setDataUrl(url))
      .catch((e: Error) => setError(e.message))
  }, [upiId, payeeName, amount, transactionNote, size])

  if (error) {
    return <div className="text-busy text-sm">QR generation failed: {error}</div>
  }
  if (!dataUrl) {
    return (
      <div
        style={{ width: size, height: size }}
        className="bg-bg-card rounded-2xl animate-pulse"
      />
    )
  }
  return (
    <img
      src={dataUrl}
      alt={`UPI payment QR for ₹${amount.toLocaleString('en-IN')}`}
      width={size}
      height={size}
      className="rounded-2xl bg-white p-3"
    />
  )
}

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { PaymentQR } from '../components/PaymentQR'
import { getClubPublicInfo } from '../lib/playerHubApi'
import type { ClubPublicInfo } from '../types/playerHub'

const BASE_URL = 'https://app.handbookhq.in'

export default function Poster() {
  const { slug } = useParams<{ slug: string }>()
  const [info, setInfo] = useState<ClubPublicInfo | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!slug) { setNotFound(true); setLoading(false); return }

    getClubPublicInfo(slug)
      .then((data) => {
        if (!data) setNotFound(true)
        else setInfo(data)
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [slug])

  useEffect(() => {
    if (!loading && !notFound && info) {
      const t = setTimeout(() => window.print(), 500)
      return () => clearTimeout(t)
    }
  }, [loading, notFound, info])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <p style={{ color: '#333' }}>Loading poster…</p>
      </div>
    )
  }

  if (notFound || !info) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <p style={{ color: '#333' }}>Club not found. Invalid QR code.</p>
      </div>
    )
  }

  const scanUrl = `${BASE_URL}/c/${slug ?? ''}`

  return (
    <>
      <style>{`
        @page { size: A4; margin: 15mm; }
        @media print {
          body { margin: 0; background: white; }
          .no-print { display: none !important; }
        }
        body { font-family: 'Arial', sans-serif; background: white; color: #111; }
      `}</style>

      {/* Download / print button — hidden on print */}
      <div className="no-print" style={{ position: 'fixed', top: 16, right: 16, zIndex: 100 }}>
        <button
          onClick={() => window.print()}
          style={{
            background: '#b8ff5a',
            color: '#0a0e0c',
            border: 'none',
            borderRadius: 12,
            padding: '10px 20px',
            fontWeight: 700,
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Download as PDF
        </button>
      </div>

      {/* A4 poster layout */}
      <div
        style={{
          width: '210mm',
          minHeight: '297mm',
          margin: '0 auto',
          padding: '15mm',
          background: 'white',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '16mm',
          boxSizing: 'border-box',
        }}
      >
        {/* Club name */}
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '48pt', fontWeight: 800, margin: 0, lineHeight: 1.1 }}>
            {info.clubName}
          </h1>
          <p style={{ fontSize: '24pt', fontWeight: 500, margin: '8mm 0 0', color: '#444' }}>
            Scan to Pay &amp; Play
          </p>
        </div>

        {/* QR code — 60% A4 width = ~108mm */}
        <div
          style={{
            width: '108mm',
            height: '108mm',
            background: 'white',
            border: '2px solid #e0e0e0',
            borderRadius: 12,
            padding: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <PaymentQR
            upiId=""
            payeeName={info.clubName}
            amount={0}
            transactionNote={scanUrl}
            urlOverride={scanUrl}
          />
        </div>

        {/* URL */}
        <p style={{ fontSize: '16pt', fontFamily: 'monospace', color: '#333', margin: 0 }}>
          {scanUrl}
        </p>

        {/* Instructions */}
        <div
          style={{
            border: '1.5px solid #ccc',
            borderRadius: 12,
            padding: '8mm 10mm',
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          <ol style={{ fontSize: '14pt', lineHeight: 2, margin: 0, paddingLeft: '1.2em' }}>
            <li>Scan this QR with any UPI app or phone camera</li>
            <li>Pay any amount from ₹100 to ₹10,000</li>
            <li>Show your mobile number at the table to use your balance</li>
          </ol>
        </div>

        {/* Footer */}
        <p style={{ fontSize: '10pt', color: '#999', marginTop: 'auto' }}>
          Powered by ClubKeeper
        </p>
      </div>
    </>
  )
}

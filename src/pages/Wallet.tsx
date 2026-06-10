import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { formatDistanceToNow } from 'date-fns'
import { db } from '../db/database'
import { supabase } from '../lib/supabase'
import type { Customer } from '../types/customer'
import { useCustomerStore } from '../store/customerStore'
import CustomerListRow from '../components/wallet/CustomerListRow'
import PendingTopupsModal from '../components/PendingTopupsModal'
import { BringBackList } from '../components/BringBackList'
import { useTopupInbox } from '../store/topupInbox'
import { useAuthStore } from '../store/authStore'
import { subscribeToTopupIntents, unsubscribeTopupIntents } from '../lib/realtimeTopups'
import { getPendingTopups, getOwnerClub } from '../lib/playerHubApi'
import type { PendingTopupRow } from '../lib/playerHubApi'
import { useSettings } from '../hooks/useLiveData'
import { resolveCoinConfig } from '../lib/coins'
import { getEngagementConfig } from '../lib/streak'
import type { EngagementConfig } from '../lib/streak'

export default function Wallet() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const { searchCustomers } = useCustomerStore()
  const { pendingCount, openModal } = useTopupInbox()
  const { dbReady, session } = useAuthStore()
  const settings = useSettings()
  const coinConfig = resolveCoinConfig(settings ?? {})
  const [engagementConfig, setEngagementConfig] = useState<EngagementConfig | null>(null)

  // Pending topups state for modal
  const [pendingIntents, setPendingIntents] = useState<PendingTopupRow[]>([])
  const [clubId, setClubId] = useState<string | null>(null)

  const recentCustomers = useLiveQuery(
    () => db.customers.orderBy('lastVisitAt').reverse().limit(10).toArray(),
    [],
    [] as Customer[],
  )

  const [searchResults, setSearchResults] = useState<Customer[] | null>(null)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    getEngagementConfig().then(setEngagementConfig).catch(() => {})
  }, [])

  // Set up realtime subscription + load club + pending intents when ready
  useEffect(() => {
    if (!dbReady || !session) return

    let cancelled = false
    let currentClubId: string | null = null

    async function init() {
      try {
        const club = await getOwnerClub()
        if (cancelled || !club) return
        currentClubId = club.id
        setClubId(club.id)

        const intents = await getPendingTopups(club.id)
        if (!cancelled) setPendingIntents(intents)

        await subscribeToTopupIntents(club.id)
      } catch { /* ignore — club may not exist yet */ }
    }

    void init()

    return () => {
      cancelled = true
      unsubscribeTopupIntents()
    }
  }, [dbReady, session])

  // Reload pending intents whenever pending count changes
  useEffect(() => {
    if (!clubId) return
    getPendingTopups(clubId)
      .then((intents) => setPendingIntents(intents))
      .catch(() => {})
  }, [pendingCount, clubId])

  // Retry failed confirm-topup cloud syncs via Supabase client directly
  useEffect(() => {
    if (!dbReady) return
    const failed: string[] = JSON.parse(localStorage.getItem('ck_failedConfirmTopups') ?? '[]') as string[]
    if (failed.length === 0) return

    Promise.all(
      failed.map(async (intentId) => {
        const { error } = await supabase
          .from('topup_intents')
          .update({
            status: 'confirmed',
            confirmed_at: new Date().toISOString(),
          })
          .eq('id', intentId)
        return error ? null : intentId
      }),
    ).then((results) => {
      const stillFailed = failed.filter((id) => !results.includes(id))
      localStorage.setItem('ck_failedConfirmTopups', JSON.stringify(stillFailed))
    }).catch(() => {})
  }, [dbReady])

  function handleIntentHandled(intentId: string) {
    setPendingIntents((prev) => prev.filter((i) => i.id !== intentId))
  }

  async function handleSearch(q: string) {
    setQuery(q)
    if (!q.trim()) {
      setSearchResults(null)
      return
    }
    setSearching(true)
    try {
      const results = await searchCustomers(q)
      setSearchResults(results)
    } finally {
      setSearching(false)
    }
  }

  const displayList = searchResults !== null ? searchResults : (recentCustomers ?? [])
  const isSearching = query.trim().length > 0

  return (
    <div className="bg-bg min-h-screen pb-24">
      {/* Header */}
      <div className="pt-safe px-5">
        <div className="flex items-center gap-3 pt-4 pb-3">
          <button
            onClick={() => navigate('/tables')}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center -ml-1 text-text-dim"
            aria-label="Back"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <h1 className="text-[22px] font-bold text-text">Wallet</h1>
          <div className="flex-1" />
          <button
            onClick={() => navigate('/wallet/new')}
            className="min-h-[44px] px-4 flex items-center gap-1.5 bg-accent text-bg text-[13px] font-bold rounded-full"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New
          </button>
        </div>

        {/* Bring-Back dormant nudges */}
        {engagementConfig?.dormancyEnabled && (
          <BringBackList
            thresholdDays={engagementConfig.dormantThresholdDays ?? 14}
            nudgeTemplate={engagementConfig.nudgeTemplate ?? ''}
            clubName={settings?.clubName ?? ''}
            rupeesPerCoin={coinConfig.rupeesPerCoin}
            minutesPerCoin={coinConfig.minutesPerCoin}
            coinExpiryDays={coinConfig.coinExpiryDays ?? 0}
          />
        )}

        {/* Pending top-ups strip */}
        {pendingCount > 0 ? (
          <button
            onClick={openModal}
            className="w-full mb-3 min-h-[48px] flex items-center gap-3 px-4 bg-paused/8 border border-paused/30 rounded-2xl"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-paused shrink-0">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 01-3.46 0" />
            </svg>
            <p className="flex-1 text-left text-[14px] font-semibold text-paused">
              {pendingCount} pending top-up{pendingCount !== 1 ? 's' : ''} · Tap to review
            </p>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-paused shrink-0">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        ) : (
          <div className="mb-3 px-1">
            <p className="text-text-faint text-[12px]">Player Hub: 0 pending</p>
          </div>
        )}

        {/* Search input */}
        <div className="relative mb-4">
          <svg
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-faint"
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search by name or phone"
            className="w-full pl-10 pr-4 py-3.5 bg-bg-card border border-border rounded-2xl text-text text-[15px] focus:border-accent outline-none placeholder:text-text-faint"
          />
          {query && (
            <button
              onClick={() => { setQuery(''); setSearchResults(null) }}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 min-w-[28px] min-h-[28px] flex items-center justify-center text-text-faint"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* List */}
      <div className="px-5">
        {!isSearching && (
          <p className="text-[10px] font-mono font-bold uppercase tracking-widest text-text-faint mb-3">
            Recent
          </p>
        )}
        {isSearching && searching && (
          <div className="py-8 flex justify-center">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}
        {!searching && displayList.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            {isSearching ? (
              <>
                <p className="text-text-dim text-sm">No customers found</p>
                <button
                  onClick={() => navigate('/wallet/new')}
                  className="text-accent text-sm font-semibold"
                >
                  + Add new customer
                </button>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-bg-card border border-border flex items-center justify-center">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-text-faint">
                    <path d="M20 12V22H4V12" /><path d="M22 7H2v5h20V7z" /><path d="M12 22V7" />
                    <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" />
                    <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
                  </svg>
                </div>
                <p className="text-text-dim text-sm text-center">No customers yet</p>
                <button
                  onClick={() => navigate('/wallet/new')}
                  className="min-h-[44px] px-5 bg-accent text-bg text-[14px] font-bold rounded-2xl flex items-center"
                >
                  Add first customer
                </button>
              </>
            )}
          </div>
        )}
        <div className="space-y-2">
          {displayList.map((customer) => (
            <CustomerListRow
              key={customer.id}
              customer={customer}
              distanceLabel={formatDistanceToNow(customer.lastVisitAt, { addSuffix: true })}
              onClick={() => navigate(`/customer/${customer.id}`)}
            />
          ))}
        </div>
      </div>

      {/* Pending topups modal */}
      {clubId && (
        <PendingTopupsModal
          intents={pendingIntents}
          clubId={clubId}
          onIntentHandled={handleIntentHandled}
        />
      )}
    </div>
  )
}

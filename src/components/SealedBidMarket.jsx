import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { isDeadlineFuture } from '../lib/gameweek'
import PlayerRow from './PlayerRow'

const STATUS_LABELS = { pending: 'In attesa', won: 'Vinta', lost: 'Persa', cancelled: 'Annullata' }

export default function SealedBidMarket({ league, membership, userId }) {
  const [players, setPlayers] = useState([])
  const [ownedByAnyone, setOwnedByAnyone] = useState(new Set())
  const [myBids, setMyBids] = useState([])
  const [pastResults, setPastResults] = useState([])
  const [search, setSearch] = useState('')
  const [bidAmounts, setBidAmounts] = useState({})
  const [submittingId, setSubmittingId] = useState(null)
  const [bidError, setBidError] = useState(null)
  const [loading, setLoading] = useState(true)

  const deadline = league.sealed_bid_deadline ? new Date(league.sealed_bid_deadline) : null
  const sessionOpen = isDeadlineFuture(league.sealed_bid_deadline)

  async function load() {
    setLoading(true)

    const [playersRes, rosterRes] = await Promise.all([
      supabase.from('players').select('*').order('name'),
      supabase.from('league_rosters').select('player_id').eq('league_id', league.id),
    ])

    setPlayers(playersRes.data ?? [])
    setOwnedByAnyone(new Set((rosterRes.data ?? []).map((r) => r.player_id)))

    if (sessionOpen) {
      const { data } = await supabase
        .from('sealed_bids')
        .select('*')
        .eq('league_id', league.id)
        .eq('user_id', userId)
        .eq('deadline', league.sealed_bid_deadline)
      setMyBids(data ?? [])
    } else if (league.sealed_bid_deadline) {
      const { data } = await supabase
        .from('sealed_bids')
        .select('*, players(name)')
        .eq('league_id', league.id)
        .eq('deadline', league.sealed_bid_deadline)
        .order('bid_amount', { ascending: false })
      setPastResults(data ?? [])
    }

    setLoading(false)
  }

  useEffect(() => {
    async function run() {
      await load()
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league.id, league.sealed_bid_deadline])

  const myBidByPlayerId = useMemo(() => {
    const map = {}
    myBids.forEach((b) => {
      map[b.player_id] = b
    })
    return map
  }, [myBids])

  const availablePlayers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return players.filter((p) => {
      if (ownedByAnyone.has(p.id)) return false
      if (q && !p.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [players, ownedByAnyone, search])

  async function handleBid(player) {
    const amount = Number(bidAmounts[player.id])
    if (!amount || amount <= 0) return

    setSubmittingId(player.id)
    setBidError(null)

    const { error } = await supabase.from('sealed_bids').insert({
      league_id: league.id,
      user_id: userId,
      player_id: player.id,
      bid_amount: amount,
      deadline: league.sealed_bid_deadline,
      status: 'pending',
    })

    setSubmittingId(null)

    if (error) {
      setBidError('Offerta non riuscita (crediti insufficienti o deadline scaduta).')
      return
    }

    await load()
  }

  if (loading) return <p className="status-text">Caricamento…</p>

  if (!league.sealed_bid_deadline) {
    return <p className="status-text">Nessuna sessione di mercato a busta chiusa aperta al momento.</p>
  }

  if (!sessionOpen) {
    return (
      <div>
        <h2>Risultati ultima sessione</h2>
        {pastResults.length === 0 ? (
          <p className="status-text">Nessun risultato disponibile.</p>
        ) : (
          <ul className="player-rows">
            {pastResults
              .filter((b) => b.user_id === userId)
              .map((b) => (
                <li key={b.id} className="player-row card">
                  <div className="player-main">
                    <span className="player-name">{b.players?.name}</span>
                  </div>
                  <div className="player-meta">
                    <span>Offerta: {b.bid_amount}</span>
                    <span className={b.status === 'won' ? 'positive' : 'negative'}>{STATUS_LABELS[b.status]}</span>
                  </div>
                </li>
              ))}
          </ul>
        )}
      </div>
    )
  }

  return (
    <div>
      <p className="deadline-info">
        Sessione aperta — scade {deadline.toLocaleDateString('it-IT')} alle{' '}
        {deadline.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
      </p>
      <p className="status-text">{membership.league_credits} crediti disponibili</p>

      <input
        type="search"
        placeholder="Cerca per nome…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {bidError && <p className="error-text">{bidError}</p>}

      <ul className="player-rows">
        {availablePlayers.map((p) => {
          const existingBid = myBidByPlayerId[p.id]
          return (
            <PlayerRow
              key={p.id}
              player={p}
              meta={<strong>{p.price_current} crediti</strong>}
              actions={
                existingBid ? (
                  <span className="badge-tag">Offerta inviata: {existingBid.bid_amount}</span>
                ) : (
                  <>
                    <input
                      type="number"
                      min={1}
                      style={{ width: 90 }}
                      value={bidAmounts[p.id] ?? ''}
                      onChange={(e) => setBidAmounts((prev) => ({ ...prev, [p.id]: e.target.value }))}
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={submittingId === p.id}
                      onClick={() => handleBid(p)}
                    >
                      Offri
                    </button>
                  </>
                )
              }
            />
          )
        })}
      </ul>
    </div>
  )
}

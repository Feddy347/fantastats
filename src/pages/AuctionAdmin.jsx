import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/useAuth'
import { getLeagueModuleSystem, playerRolesFor } from '../lib/leagueModules'
import { isDeadlineFuture } from '../lib/gameweek'
import { usePageTitle } from '../hooks/usePageTitle'
import './AuctionAdmin.css'

export default function AuctionAdmin() {
  usePageTitle('Asta')
  const { id } = useParams()
  const { user } = useAuth()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [league, setLeague] = useState(null)
  const [members, setMembers] = useState([])
  const [players, setPlayers] = useState([])
  const [roster, setRoster] = useState([]) // whole-league league_rosters
  const [tab, setTab] = useState('live')

  const [search, setSearch] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [selectedPlayer, setSelectedPlayer] = useState(null)
  const [buyerId, setBuyerId] = useState('')
  const [price, setPrice] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [assignError, setAssignError] = useState(null)
  const [round, setRound] = useState(1)

  const [sealedDeadlineInput, setSealedDeadlineInput] = useState('')
  const [openingSession, setOpeningSession] = useState(false)

  async function loadAll() {
    const [leagueRes, membersRes, playersRes, rosterRes] = await Promise.all([
      supabase.from('leagues').select('*').eq('id', id).maybeSingle(),
      supabase.from('league_members').select('*, profiles(username)').eq('league_id', id),
      supabase.from('players').select('*').order('name'),
      supabase.from('league_rosters').select('user_id, player_id').eq('league_id', id),
    ])

    if (!leagueRes.data) {
      setError('Lega non trovata.')
      return
    }

    setLeague(leagueRes.data)
    setMembers(membersRes.data ?? [])
    setPlayers(playersRes.data ?? [])
    setRoster(rosterRes.data ?? [])
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      await loadAll()
      if (!cancelled) setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const moduleSystem = useMemo(() => (league ? getLeagueModuleSystem(league) : null), [league])
  const teamOptions = useMemo(() => [...new Set(players.map((p) => p.team))].sort(), [players])
  const ownedByAnyone = useMemo(() => new Set(roster.map((r) => r.player_id)), [roster])
  const rosterCountByUser = useMemo(() => {
    const map = {}
    roster.forEach((r) => {
      map[r.user_id] = (map[r.user_id] ?? 0) + 1
    })
    return map
  }, [roster])

  const availablePlayers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return players.filter((p) => {
      if (ownedByAnyone.has(p.id)) return false
      if (q && !p.name.toLowerCase().includes(q)) return false
      if (teamFilter && p.team !== teamFilter) return false
      return true
    })
  }, [players, ownedByAnyone, search, teamFilter])

  function selectPlayer(p) {
    setSelectedPlayer(p)
    setPrice(String(p.price_initial ?? p.price_current ?? ''))
    setBuyerId('')
    setAssignError(null)
  }

  async function handleAssign() {
    if (!selectedPlayer || !buyerId || !price) return
    setAssigning(true)
    setAssignError(null)

    const { error: rpcError } = await supabase.rpc('auction_assign_player', {
      p_league_id: Number(id),
      p_player_id: selectedPlayer.id,
      p_buyer_id: buyerId,
      p_price: Number(price),
      p_round: round,
    })

    setAssigning(false)

    if (rpcError) {
      setAssignError(
        rpcError.message.includes('insufficient credits') || rpcError.message.includes('Insufficient')
          ? 'Il partecipante non ha abbastanza crediti.'
          : 'Assegnazione non riuscita.'
      )
      return
    }

    setSelectedPlayer(null)
    setRound((r) => r + 1)
    await loadAll()
  }

  async function handleOpenSealedSession() {
    if (!sealedDeadlineInput) return
    setOpeningSession(true)
    await supabase
      .from('leagues')
      .update({ sealed_bid_deadline: new Date(sealedDeadlineInput).toISOString() })
      .eq('id', id)
    setOpeningSession(false)
    await loadAll()
  }

  if (loading) return <p className="status-text">Caricamento…</p>
  if (error) return <p className="error-text">{error}</p>

  const isAdmin = members.some((m) => m.user_id === user.id && m.is_admin) || league.admin_id === user.id

  if (!isAdmin) {
    return (
      <div className="auction-page">
        <Link to={`/leagues/${id}`} className="back-link">
          ‹ {league.name}
        </Link>
        <p className="status-text">
          Solo l'admin della lega può gestire l'asta. Puoi seguirla in sola lettura dalla{' '}
          <Link to={`/leagues/${id}/auction/live`}>vista spettatore</Link>.
        </p>
      </div>
    )
  }

  const sealedOpen = isDeadlineFuture(league.sealed_bid_deadline)

  return (
    <div className="auction-page">
      <Link to={`/leagues/${id}`} className="back-link">
        ‹ {league.name}
      </Link>
      <h1>Asta — {league.name}</h1>
      <Link to={`/leagues/${id}/auction/live`} className="btn btn-secondary btn-block">
        Apri vista spettatore
      </Link>

      <div className="auction-budgets card">
        <h2>Partecipanti</h2>
        <ul className="auction-budget-list">
          {members.map((m) => (
            <li key={m.id}>
              <span>{m.profiles?.username ?? m.team_name}</span>
              <span>
                {rosterCountByUser[m.user_id] ?? 0}/{league.roster_size}
              </span>
              <span className="auction-budget-credits">{m.league_credits} cr.</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="category-tabs">
        <button type="button" className={'category-tab' + (tab === 'live' ? ' active' : '')} onClick={() => setTab('live')}>
          Asta classica
        </button>
        <button type="button" className={'category-tab' + (tab === 'sealed' ? ' active' : '')} onClick={() => setTab('sealed')}>
          Busta chiusa
        </button>
      </div>

      {tab === 'live' && (
        <>
          {!selectedPlayer ? (
            <>
              <div className="market-filters">
                <input
                  type="search"
                  placeholder="Cerca giocatore…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
                  <option value="">Tutte le squadre</option>
                  {teamOptions.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <ul className="player-rows">
                {availablePlayers.slice(0, 30).map((p) => (
                  <li key={p.id} className="player-row card">
                    <div className="player-main">
                      <span className="player-name">{p.name}</span>
                      <span className="player-team">{p.team}</span>
                    </div>
                    <div className="player-roles">
                      <span className="role-tag">{playerRolesFor(p, moduleSystem.roleField).join('/')}</span>
                    </div>
                    <div className="player-actions">
                      <button type="button" className="btn btn-primary" onClick={() => selectPlayer(p)}>
                        Seleziona
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="auction-card card">
              <h2>{selectedPlayer.name}</h2>
              <div className="category-stats">
                <span>{selectedPlayer.team}</span>
                <span>{playerRolesFor(selectedPlayer, moduleSystem.roleField).join('/')}</span>
                <span>Base: {selectedPlayer.price_initial}</span>
              </div>

              <div className="form-field">
                <label htmlFor="buyer">Vincitore</label>
                <select id="buyer" value={buyerId} onChange={(e) => setBuyerId(e.target.value)}>
                  <option value="">Seleziona…</option>
                  {members.map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.profiles?.username ?? m.team_name} ({m.league_credits} cr.)
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-field">
                <label htmlFor="price">Prezzo finale</label>
                <input id="price" type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>

              {assignError && <p className="error-text">{assignError}</p>}

              <div className="auction-card-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setSelectedPlayer(null)}>
                  Annulla
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={assigning || !buyerId || !price}
                  onClick={handleAssign}
                >
                  {assigning ? 'Assegno…' : 'Conferma assegnazione'}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'sealed' && (
        <div className="card auction-card">
          <h2>Busta chiusa</h2>
          {sealedOpen ? (
            <p className="status-text">
              Sessione aperta, scade il {new Date(league.sealed_bid_deadline).toLocaleString('it-IT')}.
            </p>
          ) : (
            <p className="status-text">Nessuna sessione aperta al momento.</p>
          )}
          <p className="status-text">
            {availablePlayers.length} giocatori svincolati disponibili per l'offerta.
          </p>

          <div className="form-field">
            <label htmlFor="sealed-deadline">Deadline nuova sessione</label>
            <input
              id="sealed-deadline"
              type="datetime-local"
              value={sealedDeadlineInput}
              onChange={(e) => setSealedDeadlineInput(e.target.value)}
            />
          </div>

          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={openingSession || !sealedDeadlineInput}
            onClick={handleOpenSealedSession}
          >
            {openingSession ? 'Apertura…' : 'Apri sessione'}
          </button>

          <p className="status-text">
            Dopo la deadline, esegui <code>npm run resolve:sealed-bids</code> per assegnare i giocatori al miglior
            offerente.
          </p>
        </div>
      )}
    </div>
  )
}

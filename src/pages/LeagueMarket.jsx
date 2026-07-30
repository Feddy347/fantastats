import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/useAuth'
import PlayerRow from '../components/PlayerRow'
import ConfirmDialog from '../components/ConfirmDialog'
import SealedBidMarket from '../components/SealedBidMarket'
import { getLeagueModuleSystem, playerRolesFor } from '../lib/leagueModules'
import './Market.css'

const PAGE_SIZE = 20

export default function LeagueMarket() {
  const { id } = useParams()
  const { user } = useAuth()

  const [tab, setTab] = useState('buy')
  const [league, setLeague] = useState(null)
  const [membership, setMembership] = useState(null)
  const [players, setPlayers] = useState([])
  const [allRoster, setAllRoster] = useState([]) // [{ user_id, player_id, purchase_price }] across the whole league
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [search, setSearch] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [page, setPage] = useState(1)

  const [buyTarget, setBuyTarget] = useState(null)
  const [sellTarget, setSellTarget] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [actionPending, setActionPending] = useState(false)

  async function loadData() {
    const [leagueRes, memberRes, playersRes, rosterRes] = await Promise.all([
      supabase.from('leagues').select('*').eq('id', id).maybeSingle(),
      supabase.from('league_members').select('*').eq('league_id', id).eq('user_id', user.id).maybeSingle(),
      supabase.from('players').select('*').order('name'),
      supabase.from('league_rosters').select('user_id, player_id, purchase_price').eq('league_id', id),
    ])

    if (!leagueRes.data) {
      setError('Lega non trovata.')
      return
    }

    setLeague(leagueRes.data)
    setMembership(memberRes.data ?? null)
    setPlayers(playersRes.data ?? [])
    setAllRoster(rosterRes.data ?? [])
  }

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)
      await loadData()
      if (!cancelled) setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user.id])

  const moduleSystem = useMemo(() => (league ? getLeagueModuleSystem(league) : null), [league])

  const ownedByAnyone = useMemo(() => new Set(allRoster.map((r) => r.player_id)), [allRoster])
  const myRoster = useMemo(() => allRoster.filter((r) => r.user_id === user.id), [allRoster, user.id])
  const myRosterByPlayerId = useMemo(() => {
    const map = {}
    myRoster.forEach((r) => {
      map[r.player_id] = r
    })
    return map
  }, [myRoster])

  const teamOptions = useMemo(
    () => [...new Set(players.map((p) => p.team))].sort((a, b) => a.localeCompare(b)),
    [players]
  )
  const roleOptions = useMemo(() => {
    if (!moduleSystem) return []
    const set = new Set()
    players.forEach((p) => {
      playerRolesFor(p, moduleSystem.roleField).forEach((r) => set.add(r))
    })
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [players, moduleSystem])

  const availablePlayers = useMemo(() => {
    if (!moduleSystem) return []
    const q = search.trim().toLowerCase()
    return players.filter((p) => {
      if (ownedByAnyone.has(p.id)) return false
      if (q && !p.name.toLowerCase().includes(q)) return false
      if (teamFilter && p.team !== teamFilter) return false
      if (roleFilter && !playerRolesFor(p, moduleSystem.roleField).includes(roleFilter)) return false
      return true
    })
  }, [players, ownedByAnyone, search, teamFilter, roleFilter, moduleSystem])

  const ownedPlayers = useMemo(
    () => players.filter((p) => myRosterByPlayerId[p.id]),
    [players, myRosterByPlayerId]
  )

  const totalPages = Math.max(1, Math.ceil(availablePlayers.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const buyPageItems = availablePlayers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  function resetPage() {
    setPage(1)
  }

  async function confirmBuy() {
    if (!buyTarget) return
    setActionPending(true)
    setActionError(null)
    const { error: rpcError } = await supabase.rpc('league_buy_player', {
      p_league_id: Number(id),
      p_player_id: buyTarget.id,
    })
    setActionPending(false)
    if (rpcError) {
      setActionError(
        rpcError.message.includes('Insufficient credits') ? 'Crediti insufficienti.' : 'Acquisto non riuscito.'
      )
      return
    }
    setBuyTarget(null)
    await loadData()
  }

  async function confirmSell() {
    if (!sellTarget) return
    setActionPending(true)
    setActionError(null)
    const { error: rpcError } = await supabase.rpc('league_sell_player', {
      p_league_id: Number(id),
      p_player_id: sellTarget.id,
    })
    setActionPending(false)
    if (rpcError) {
      setActionError('Svincolo non riuscito.')
      return
    }
    setSellTarget(null)
    await loadData()
  }

  if (loading) return <p className="status-text">Caricamento…</p>
  if (error) return <p className="error-text">{error}</p>

  if (!membership) {
    return (
      <div className="market-page">
        <Link to={`/leagues/${id}`} className="back-link">
          ‹ {league.name}
        </Link>
        <p className="status-text">Non fai parte di questa lega.</p>
      </div>
    )
  }

  if (league.market_type === 'auction') {
    return (
      <div className="market-page">
        <Link to={`/leagues/${id}`} className="back-link">
          ‹ {league.name}
        </Link>
        <h1>Mercato di riparazione — {league.name}</h1>
        <SealedBidMarket league={league} membership={membership} userId={user.id} />
      </div>
    )
  }

  const credits = membership.league_credits

  return (
    <div className="market-page">
      <Link to={`/leagues/${id}`} className="back-link">
        ‹ {league.name}
      </Link>
      <h1>Mercato — {league.name}</h1>
      <p className="deadline-info">{credits} crediti disponibili</p>

      <div className="market-tabs">
        <button
          type="button"
          className={'market-tab' + (tab === 'buy' ? ' active' : '')}
          onClick={() => setTab('buy')}
        >
          Compra
        </button>
        <button
          type="button"
          className={'market-tab' + (tab === 'sell' ? ' active' : '')}
          onClick={() => setTab('sell')}
        >
          Vendi
        </button>
      </div>

      {tab === 'buy' && (
        <>
          <div className="market-filters">
            <input
              type="search"
              placeholder="Cerca per nome…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                resetPage()
              }}
            />
            <select
              value={teamFilter}
              onChange={(e) => {
                setTeamFilter(e.target.value)
                resetPage()
              }}
            >
              <option value="">Tutte le squadre</option>
              {teamOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value)
                resetPage()
              }}
            >
              <option value="">Tutti i ruoli</option>
              {roleOptions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {availablePlayers.length === 0 ? (
            <p className="status-text">Nessun giocatore trovato.</p>
          ) : (
            <>
              <ul className="player-rows">
                {buyPageItems.map((p) => (
                  <PlayerRow
                    key={p.id}
                    player={p}
                    meta={<strong>{p.price_current} crediti</strong>}
                    actions={
                      <button type="button" className="btn btn-primary" onClick={() => setBuyTarget(p)}>
                        Acquista
                      </button>
                    }
                  />
                ))}
              </ul>
              <div className="pagination">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={currentPage === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Precedente
                </button>
                <span>
                  Pagina {currentPage} di {totalPages}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={currentPage === totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Successiva
                </button>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'sell' && (
        <>
          {ownedPlayers.length === 0 ? (
            <p className="status-text">Non hai giocatori in rosa.</p>
          ) : (
            <ul className="player-rows">
              {ownedPlayers.map((p) => {
                const purchasePrice = myRosterByPlayerId[p.id]?.purchase_price ?? 0
                const diff = p.price_current - purchasePrice
                return (
                  <PlayerRow
                    key={p.id}
                    player={p}
                    meta={
                      <>
                        <span>
                          Acquisto: <strong>{purchasePrice}</strong>
                        </span>
                        <span>
                          Attuale: <strong>{p.price_current}</strong>
                        </span>
                        <span className={diff >= 0 ? 'positive' : 'negative'}>
                          {diff >= 0 ? `+${diff}` : diff}
                        </span>
                      </>
                    }
                    actions={
                      <button type="button" className="btn btn-secondary" onClick={() => setSellTarget(p)}>
                        Svincola
                      </button>
                    }
                  />
                )
              })}
            </ul>
          )}
        </>
      )}

      <ConfirmDialog
        open={Boolean(buyTarget)}
        title="Conferma acquisto"
        confirmLabel={actionPending ? 'Acquisto…' : 'Acquista'}
        confirmDisabled={actionPending || (buyTarget && credits < buyTarget.price_current)}
        onConfirm={confirmBuy}
        onCancel={() => {
          setBuyTarget(null)
          setActionError(null)
        }}
      >
        {buyTarget && (
          <>
            <span>
              {buyTarget.name} — <strong>{buyTarget.price_current} crediti</strong>
            </span>
            <span>Crediti residui dopo l'acquisto: {credits - buyTarget.price_current}</span>
            {credits < buyTarget.price_current && <span className="error-text">Crediti insufficienti.</span>}
            {actionError && <span className="error-text">{actionError}</span>}
          </>
        )}
      </ConfirmDialog>

      <ConfirmDialog
        open={Boolean(sellTarget)}
        title="Conferma svincolo"
        confirmLabel={actionPending ? 'Svincolo…' : 'Svincola'}
        confirmDisabled={actionPending}
        onConfirm={confirmSell}
        onCancel={() => {
          setSellTarget(null)
          setActionError(null)
        }}
      >
        {sellTarget && (
          <>
            <span>{sellTarget.name}</span>
            <span>Riceverai {sellTarget.price_current} crediti (prezzo attuale).</span>
            {actionError && <span className="error-text">{actionError}</span>}
          </>
        )}
      </ConfirmDialog>
    </div>
  )
}

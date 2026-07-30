import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/useAuth'
import PlayerRow from '../components/PlayerRow'
import ConfirmDialog from '../components/ConfirmDialog'
import { buildTeamsByName, eligibleCategoriesForPlayer, isPlayerEligible } from '../lib/categoryPool'
import { usePageTitle } from '../hooks/usePageTitle'
import './Market.css'

const PAGE_SIZE = 20

export default function Market() {
  usePageTitle('Mercato')
  const { user, profile, refreshProfile } = useAuth()

  const [tab, setTab] = useState('buy')
  const [players, setPlayers] = useState([])
  const [teams, setTeams] = useState([])
  const [categories, setCategories] = useState([])
  const [roster, setRoster] = useState([]) // [{ player_id, purchase_price }]
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [search, setSearch] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [page, setPage] = useState(1)

  const [buyTarget, setBuyTarget] = useState(null)
  const [sellTarget, setSellTarget] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [actionPending, setActionPending] = useState(false)

  async function loadData() {
    const [playersRes, teamsRes, categoriesRes, rosterRes] = await Promise.all([
      supabase.from('players').select('*').order('name'),
      supabase.from('teams').select('*'),
      supabase.from('categories').select('*').eq('is_active', true).eq('is_event', false).order('id'),
      supabase.from('user_players').select('player_id, purchase_price').eq('user_id', user.id),
    ])

    if (playersRes.error) setError('Impossibile caricare i giocatori.')
    setPlayers(playersRes.data ?? [])
    setTeams(teamsRes.data ?? [])
    setCategories(categoriesRes.data ?? [])
    setRoster(rosterRes.data ?? [])
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
  }, [user.id])

  const teamsByName = useMemo(() => buildTeamsByName(teams), [teams])
  const totalTeams = teams.length
  const rosterByPlayerId = useMemo(() => {
    const map = {}
    roster.forEach((r) => {
      map[r.player_id] = r
    })
    return map
  }, [roster])

  const teamOptions = useMemo(
    () => [...new Set(players.map((p) => p.team))].sort((a, b) => a.localeCompare(b)),
    [players]
  )
  const roleOptions = useMemo(() => {
    const set = new Set()
    players.forEach((p) => {
      (p.role_fantastats ?? '').split(';').forEach((r) => {
        const trimmed = r.trim()
        if (trimmed) set.add(trimmed)
      })
    })
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [players])

  const availablePlayers = useMemo(() => {
    const q = search.trim().toLowerCase()
    return players.filter((p) => {
      if (rosterByPlayerId[p.id]) return false
      if (q && !p.name.toLowerCase().includes(q)) return false
      if (teamFilter && p.team !== teamFilter) return false
      if (roleFilter) {
        const roles = (p.role_fantastats ?? '').split(';').map((r) => r.trim())
        if (!roles.includes(roleFilter)) return false
      }
      if (categoryFilter) {
        const category = categories.find((c) => c.slug === categoryFilter)
        if (category && !isPlayerEligible(p, teamsByName[p.team], category, totalTeams)) return false
      }
      return true
    })
  }, [players, rosterByPlayerId, search, teamFilter, roleFilter, categoryFilter, categories, teamsByName, totalTeams])

  const ownedPlayers = useMemo(
    () => players.filter((p) => rosterByPlayerId[p.id]),
    [players, rosterByPlayerId]
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
    const { error } = await supabase.rpc('buy_player', { p_player_id: buyTarget.id })
    setActionPending(false)
    if (error) {
      setActionError(error.message.includes('Insufficient credits')
        ? 'Crediti insufficienti.'
        : 'Acquisto non riuscito.')
      return
    }
    setBuyTarget(null)
    await Promise.all([loadData(), refreshProfile()])
  }

  async function confirmSell() {
    if (!sellTarget) return
    setActionPending(true)
    setActionError(null)
    const { error } = await supabase.rpc('sell_player', { p_player_id: sellTarget.id })
    setActionPending(false)
    if (error) {
      setActionError('Svincolo non riuscito.')
      return
    }
    setSellTarget(null)
    await Promise.all([loadData(), refreshProfile()])
  }

  const credits = profile?.credits ?? 0

  return (
    <div className="market-page">
      <h1>Mercato</h1>

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

      {loading && <p className="status-text">Caricamento…</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && !error && tab === 'buy' && (
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
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value)
                resetPage()
              }}
            >
              <option value="">Tutte le categorie</option>
              {categories.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {availablePlayers.length === 0 ? (
            <p className="status-text">Nessun giocatore trovato.</p>
          ) : (
            <>
              <ul className="player-rows">
                {buyPageItems.map((p) => {
                  const badges = eligibleCategoriesForPlayer(p, teamsByName, categories, totalTeams).map(
                    (c) => c.name
                  )
                  return (
                    <PlayerRow
                      key={p.id}
                      player={p}
                      badges={badges}
                      meta={<strong>{p.price_current} crediti</strong>}
                      actions={
                        <button type="button" className="btn btn-primary" onClick={() => setBuyTarget(p)}>
                          Acquista
                        </button>
                      }
                    />
                  )
                })}
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

      {!loading && !error && tab === 'sell' && (
        <>
          {ownedPlayers.length === 0 ? (
            <p className="status-text">Non hai giocatori in rosa.</p>
          ) : (
            <ul className="player-rows">
              {ownedPlayers.map((p) => {
                const purchasePrice = rosterByPlayerId[p.id]?.purchase_price ?? 0
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

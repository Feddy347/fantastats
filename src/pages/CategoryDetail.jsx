import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/useAuth'
import PlayerRow from '../components/PlayerRow'
import GameweekLeaderboard from '../components/GameweekLeaderboard'
import SeasonStandings from '../components/SeasonStandings'
import { buildTeamsByName, computePool } from '../lib/categoryPool'
import { getModule } from '../lib/modules'
import { getCurrentGameweek, isLineupLocked, formatDeadline } from '../lib/gameweek'
import { usePageTitle } from '../hooks/usePageTitle'
import './Categories.css'
import './CategoryDetail.css'

const PAGE_SIZE = 20

export default function CategoryDetail() {
  const { slug } = useParams()
  const { user } = useAuth()

  const [category, setCategory] = useState(null)
  usePageTitle(category?.name ?? 'Categoria')
  const [teams, setTeams] = useState([])
  const [players, setPlayers] = useState([])
  const [rosterPlayerIds, setRosterPlayerIds] = useState([])
  const [isEnrolled, setIsEnrolled] = useState(false)
  const [participantCount, setParticipantCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [enrolling, setEnrolling] = useState(false)
  const [enrollError, setEnrollError] = useState(null)
  const [page, setPage] = useState(1)
  const [gameweek, setGameweek] = useState(null)
  const [lineup, setLineup] = useState(null)
  const [tab, setTab] = useState('roster')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      const [{ data: categoryData, error: categoryError }, gw] = await Promise.all([
        supabase.from('categories').select('*').eq('slug', slug).maybeSingle(),
        getCurrentGameweek(),
      ])

      if (cancelled) return

      if (categoryError || !categoryData) {
        setError('Categoria non trovata.')
        setLoading(false)
        return
      }

      const [teamsRes, playersRes, rosterRes, enrollRes, countsRes, lineupRes] = await Promise.all([
        supabase.from('teams').select('*'),
        supabase.from('players').select('*'),
        supabase.from('user_players').select('player_id').eq('user_id', user.id),
        supabase
          .from('user_category_enrollments')
          .select('id')
          .eq('user_id', user.id)
          .eq('category_id', categoryData.id)
          .maybeSingle(),
        supabase.rpc('get_category_participant_counts'),
        gw
          ? supabase
              .from('lineups')
              .select('*, lineup_players(*, players(name, team))')
              .eq('user_id', user.id)
              .eq('category_id', categoryData.id)
              .eq('gameweek_id', gw.id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ])

      if (cancelled) return

      setCategory(categoryData)
      setTeams(teamsRes.data ?? [])
      setPlayers(playersRes.data ?? [])
      setRosterPlayerIds((rosterRes.data ?? []).map((r) => r.player_id))
      setIsEnrolled(Boolean(enrollRes.data))
      const countRow = (countsRes.data ?? []).find((row) => row.category_id === categoryData.id)
      setParticipantCount(countRow?.participant_count ?? 0)
      setGameweek(gw)
      setLineup(lineupRes.data ?? null)
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [slug, user.id])

  const teamsByName = useMemo(() => buildTeamsByName(teams), [teams])
  const totalTeams = teams.length

  const pool = useMemo(() => {
    if (!category) return []
    return computePool(players, teamsByName, category, totalTeams)
  }, [players, teamsByName, category, totalTeams])

  const rosterPlayers = useMemo(
    () => players.filter((p) => rosterPlayerIds.includes(p.id)),
    [players, rosterPlayerIds]
  )

  const eligibleRosterPlayers = useMemo(() => {
    if (!category) return []
    return computePool(rosterPlayers, teamsByName, category, totalTeams)
  }, [rosterPlayers, teamsByName, category, totalTeams])

  const totalPages = Math.max(1, Math.ceil(pool.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageItems = pool.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  async function handleEnroll() {
    if (!category) return
    setEnrolling(true)
    setEnrollError(null)

    const { error } = await supabase
      .from('user_category_enrollments')
      .insert({ user_id: user.id, category_id: category.id })

    setEnrolling(false)

    if (error) {
      setEnrollError('Non hai abbastanza giocatori eleggibili per iscriverti.')
      return
    }

    setIsEnrolled(true)
    setParticipantCount((c) => c + 1)
  }

  if (loading) return <p className="status-text">Caricamento…</p>
  if (error) return <p className="error-text">{error}</p>

  const missing = Math.max(0, 7 - eligibleRosterPlayers.length)
  const locked = isLineupLocked(gameweek)

  return (
    <div className="category-detail">
      <Link to="/categories" className="back-link">
        ‹ Categorie
      </Link>

      <div className="category-detail-header card">
        <div className="category-card-header">
          <h1>{category.name}</h1>
          {isEnrolled && <span className="badge-tag">Iscritto</span>}
        </div>
        <p className="category-description">{category.description}</p>
        <div className="category-stats">
          <span>{pool.length} giocatori nel pool</span>
          <span>{participantCount} partecipanti</span>
        </div>

        {!isEnrolled && missing > 0 && (
          <p className="category-warning">Ti servono altri {missing} giocatori eleggibili</p>
        )}
        {enrollError && <p className="error-text">{enrollError}</p>}
        {!isEnrolled && (
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={enrolling}
            onClick={handleEnroll}
          >
            {enrolling ? 'Iscrizione…' : 'Iscriviti'}
          </button>
        )}
      </div>

      {isEnrolled && gameweek && (
        <div className="lineup-summary card">
          <div className="category-card-header">
            <h2>Formazione — Giornata {gameweek.number}</h2>
          </div>

          {locked ? (
            <p className="error-text">Formazione bloccata — la giornata è in corso.</p>
          ) : (
            <span className="deadline-info">Deadline: {formatDeadline(gameweek)}</span>
          )}

          {lineup ? (
            <>
              <p className="lineup-summary-module">{getModule(lineup.module).label}</p>
              <ul className="lineup-summary-players">
                {(lineup.lineup_players ?? [])
                  .filter((lp) => lp.slot_type === 'starter')
                  .sort((a, b) => (a.slot_position ?? 0) - (b.slot_position ?? 0))
                  .map((lp) => (
                    <li key={lp.id}>
                      <span className="role-tag">{lp.slot_role}</span> {lp.players?.name}
                    </li>
                  ))}
              </ul>
              {!locked && (
                <Link to={`/categories/${slug}/lineup`} className="btn btn-secondary btn-block">
                  Modifica formazione
                </Link>
              )}
            </>
          ) : (
            !locked && (
              <Link to={`/categories/${slug}/lineup`} className="btn btn-primary btn-block">
                Schiera formazione
              </Link>
            )
          )}
        </div>
      )}

      <div className="category-tabs">
        <button
          type="button"
          className={'category-tab' + (tab === 'roster' ? ' active' : '')}
          onClick={() => setTab('roster')}
        >
          Rosa
        </button>
        <button
          type="button"
          className={'category-tab' + (tab === 'gameweek' ? ' active' : '')}
          onClick={() => setTab('gameweek')}
        >
          Classifica
        </button>
        <button
          type="button"
          className={'category-tab' + (tab === 'season' ? ' active' : '')}
          onClick={() => setTab('season')}
        >
          Stagione
        </button>
      </div>

      {tab === 'roster' && (
        <>
          <section>
            <h2>La tua rosa eleggibile ({eligibleRosterPlayers.length})</h2>
            {eligibleRosterPlayers.length === 0 ? (
              <p className="status-text">Nessun giocatore eleggibile in rosa.</p>
            ) : (
              <ul className="player-rows">
                {eligibleRosterPlayers.map((p) => (
                  <PlayerRow key={p.id} player={p} />
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2>Pool giocatori</h2>
            {pool.length === 0 ? (
              <p className="status-text">Nessun giocatore eleggibile per questa categoria.</p>
            ) : (
              <>
                <ul className="player-rows">
                  {pageItems.map((p) => (
                    <PlayerRow key={p.id} player={p} />
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
          </section>
        </>
      )}

      {tab === 'gameweek' && (
        <section>
          {gameweek ? (
            <GameweekLeaderboard categoryId={category.id} gameweek={gameweek} currentUserId={user.id} />
          ) : (
            <p className="status-text">Nessuna giornata disponibile.</p>
          )}
        </section>
      )}

      {tab === 'season' && (
        <section>
          <SeasonStandings categoryId={category.id} currentUserId={user.id} />
        </section>
      )}
    </div>
  )
}

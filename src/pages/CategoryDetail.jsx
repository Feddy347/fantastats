import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/useAuth'
import PlayerRow from '../components/PlayerRow'
import GameweekLeaderboard from '../components/GameweekLeaderboard'
import SeasonStandings from '../components/SeasonStandings'
import PlayerBreakdownModal from '../components/PlayerBreakdownModal'
import { buildTeamsByName, computePool } from '../lib/categoryPool'
import { getModule } from '../lib/modules'
import { getCurrentGameweek, isLineupLocked, formatDeadline } from '../lib/gameweek'
import { usePageTitle } from '../hooks/usePageTitle'
import './Categories.css'
import './CategoryDetail.css'

const PAGE_SIZE = 20

function scoreClass(score) {
  if (score == null) return ''
  if (score > 0) return 'positive'
  if (score < 0) return 'negative'
  return 'neutral'
}

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
  const [scoresByPlayerId, setScoresByPlayerId] = useState({})
  const [selectedPlayer, setSelectedPlayer] = useState(null)

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

  // Per-player scores for the fielded starters, once the lineup + gameweek
  // are known (kept separate from the main load since it depends on data
  // that only exists after that first load resolves).
  useEffect(() => {
    let cancelled = false

    async function loadScores() {
      const starters = (lineup?.lineup_players ?? []).filter((lp) => lp.slot_type === 'starter')
      if (!gameweek || starters.length === 0) {
        if (!cancelled) setScoresByPlayerId({})
        return
      }

      const { data } = await supabase
        .from('player_match_scores')
        .select('player_id, total_score, is_final, score_breakdown')
        .eq('gameweek_id', gameweek.id)
        .in('player_id', starters.map((lp) => lp.player_id))

      if (cancelled) return
      const map = {}
      ;(data ?? []).forEach((row) => {
        map[row.player_id] = row
      })
      setScoresByPlayerId(map)
    }

    loadScores()
    return () => {
      cancelled = true
    }
  }, [lineup, gameweek])

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
          {category.is_reverse_scoring && <span className="badge-tag reverse">🔄 Flop XI</span>}
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
                  .map((lp) => {
                    const scoreRow = scoresByPlayerId[lp.player_id]
                    return (
                      <li key={lp.id}>
                        <button
                          type="button"
                          className="lineup-summary-player-btn"
                          onClick={() =>
                            setSelectedPlayer({
                              playerId: lp.player_id,
                              name: lp.players?.name,
                              role: lp.slot_role,
                              totalScore: scoreRow?.total_score ?? null,
                              breakdown: scoreRow?.score_breakdown ?? {},
                            })
                          }
                        >
                          <span className="role-tag">{lp.slot_role}</span>
                          <span className="lineup-summary-player-name">{lp.players?.name}</span>
                          {scoreRow && !scoreRow.is_final && <span className="live-dot" aria-label="In corso" />}
                          {scoreRow && (
                            <span className={'lineup-summary-player-score ' + scoreClass(scoreRow.total_score)}>
                              {scoreRow.total_score.toFixed(1)}
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
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
            <GameweekLeaderboard
              categoryId={category.id}
              gameweek={gameweek}
              currentUserId={user.id}
              isReverse={category.is_reverse_scoring}
            />
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

      {selectedPlayer && (
        <PlayerBreakdownModal
          playerName={selectedPlayer.name}
          role={selectedPlayer.role}
          totalScore={selectedPlayer.totalScore}
          breakdown={selectedPlayer.breakdown}
          isReverse={category.is_reverse_scoring}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </div>
  )
}

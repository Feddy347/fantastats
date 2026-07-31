import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/useAuth'
import HomeTabs from '../components/HomeTabs'
import RewardsBanner from '../components/RewardsBanner'
import { buildTeamsByName, computePool } from '../lib/categoryPool'
import { getCategoryColorVar } from '../lib/categoryColors'
import { getCurrentGameweek } from '../lib/gameweek'
import { usePageTitle } from '../hooks/usePageTitle'
import './Categories.css'

export default function CategoriesList() {
  usePageTitle('Categorie')
  const { user, profile } = useAuth()
  const [categories, setCategories] = useState([])
  const [teams, setTeams] = useState([])
  const [players, setPlayers] = useState([])
  const [rosterPlayerIds, setRosterPlayerIds] = useState([])
  const [enrolledIds, setEnrolledIds] = useState([])
  const [participantCounts, setParticipantCounts] = useState({})
  const [gameweek, setGameweek] = useState(null)
  const [categoryStats, setCategoryStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [enrollingSlug, setEnrollingSlug] = useState(null)
  const [enrollErrors, setEnrollErrors] = useState({})

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const [categoriesRes, teamsRes, playersRes, rosterRes, enrollRes, countsRes, gw] = await Promise.all([
        supabase.from('categories').select('*').eq('is_active', true).eq('is_event', false).order('id'),
        supabase.from('teams').select('*'),
        supabase.from('players').select('*'),
        supabase.from('user_players').select('player_id').eq('user_id', user.id),
        supabase.from('user_category_enrollments').select('category_id').eq('user_id', user.id),
        supabase.rpc('get_category_participant_counts'),
        getCurrentGameweek(),
      ])

      if (cancelled) return

      if (categoriesRes.error) {
        setError('Impossibile caricare le categorie.')
      }

      setCategories(categoriesRes.data ?? [])
      setTeams(teamsRes.data ?? [])
      setPlayers(playersRes.data ?? [])
      setRosterPlayerIds((rosterRes.data ?? []).map((r) => r.player_id))
      setEnrolledIds((enrollRes.data ?? []).map((e) => e.category_id))
      setGameweek(gw)

      const counts = {}
      ;(countsRes.data ?? []).forEach((row) => {
        counts[row.category_id] = row.participant_count
      })
      setParticipantCounts(counts)

      if (gw) {
        const [lineupsRes, scoresRes] = await Promise.all([
          supabase
            .from('lineups')
            .select('category_id, lineup_players(slot_type)')
            .eq('user_id', user.id)
            .eq('gameweek_id', gw.id),
          gw.status === 'live'
            ? supabase.rpc('get_live_scores', { p_user_id: user.id, p_gameweek_id: gw.id })
            : supabase
                .from('category_gameweek_scores')
                .select('category_id, total_score, rank')
                .eq('user_id', user.id)
                .eq('gameweek_id', gw.id),
        ])

        if (cancelled) return

        const stats = {}
        ;(lineupsRes.data ?? []).forEach((l) => {
          const activeCount = (l.lineup_players ?? []).filter((lp) => lp.slot_type === 'starter').length
          stats[l.category_id] = { ...stats[l.category_id], activeCount }
        })
        ;(scoresRes.data ?? []).forEach((row) => {
          stats[row.category_id] = {
            ...stats[row.category_id],
            score: row.total_score,
            rank: row.rank,
          }
        })
        setCategoryStats(stats)
      } else {
        setCategoryStats({})
      }

      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [user.id])

  const teamsByName = useMemo(() => buildTeamsByName(teams), [teams])
  const totalTeams = teams.length

  const rosterPlayers = useMemo(
    () => players.filter((p) => rosterPlayerIds.includes(p.id)),
    [players, rosterPlayerIds]
  )

  async function handleEnroll(category) {
    setEnrollingSlug(category.slug)
    setEnrollErrors((prev) => ({ ...prev, [category.slug]: null }))

    const { error } = await supabase
      .from('user_category_enrollments')
      .insert({ user_id: user.id, category_id: category.id })

    setEnrollingSlug(null)

    if (error) {
      setEnrollErrors((prev) => ({
        ...prev,
        [category.slug]: 'Non hai abbastanza giocatori eleggibili per iscriverti.',
      }))
      return
    }

    setEnrolledIds((prev) => [...prev, category.id])
    setParticipantCounts((prev) => ({ ...prev, [category.id]: (prev[category.id] ?? 0) + 1 }))
  }

  return (
    <div className="categories-page">
      <HomeTabs />

      {profile?.team_name && <p className="home-team-name">{profile.team_name}</p>}

      <RewardsBanner />

      <div className="summary-bar card">
        <div className="summary-item">
          <span className="summary-label">Crediti</span>
          <span className="summary-value">{profile?.credits ?? 0}/500</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">In rosa</span>
          <span className="summary-value">{rosterPlayers.length}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Categorie attive</span>
          <span className="summary-value">{enrolledIds.length}</span>
        </div>
      </div>

      {loading && <p className="status-text">Caricamento…</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && !error && (
        <div className="category-cards">
          {categories.map((category) => {
            const eligibleCount = computePool(rosterPlayers, teamsByName, category, totalTeams).length
            const isEnrolled = enrolledIds.includes(category.id)
            const missing = Math.max(0, 7 - eligibleCount)
            const stats = categoryStats[category.id] ?? {}
            const activeCount = isEnrolled ? stats.activeCount ?? 0 : eligibleCount

            return (
              <div key={category.id} className="category-card card">
                <Link to={`/categories/${category.slug}`} className="category-card-link">
                  <div
                    className="category-card-colorhead"
                    style={{ background: `var(${getCategoryColorVar(category.slug)})` }}
                  >
                    <span className="category-card-name">{category.name}</span>
                    {gameweek && <span className="category-card-gw">GW {gameweek.number}</span>}
                  </div>

                  <div className="category-card-body">
                    <div className="category-card-score-block">
                      <span className="category-card-score">
                        {isEnrolled && stats.score != null ? stats.score.toFixed(1) : '—'}
                      </span>
                      <span className="category-card-score-label">punti</span>
                    </div>
                    {isEnrolled && stats.rank != null && (
                      <span className="category-card-rank">{stats.rank}°</span>
                    )}
                    {!isEnrolled && <span className="badge-tag">{participantCounts[category.id] ?? 0} iscritti</span>}
                  </div>

                  <div className="category-card-activity">
                    <div className="activity-bar">
                      {Array.from({ length: 7 }).map((_, i) => (
                        <span
                          key={i}
                          className={'activity-segment' + (i < activeCount ? ' filled' : '')}
                        />
                      ))}
                    </div>
                    <span className="activity-caption">
                      {activeCount}/7 giocatori attivi
                    </span>
                  </div>
                </Link>

                {(!isEnrolled || enrollErrors[category.slug]) && (
                  <div className="category-card-footer">
                    {!isEnrolled && missing > 0 && (
                      <p className="category-warning">Ti servono altri {missing} giocatori eleggibili</p>
                    )}

                    {enrollErrors[category.slug] && (
                      <p className="error-text">{enrollErrors[category.slug]}</p>
                    )}

                    {!isEnrolled && (
                      <button
                        type="button"
                        className="btn btn-primary btn-block"
                        disabled={enrollingSlug === category.slug}
                        onClick={() => handleEnroll(category)}
                      >
                        {enrollingSlug === category.slug ? 'Iscrizione…' : 'Iscriviti'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

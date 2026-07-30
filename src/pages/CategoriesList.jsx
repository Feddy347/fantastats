import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/useAuth'
import HomeTabs from '../components/HomeTabs'
import RewardsBanner from '../components/RewardsBanner'
import { buildTeamsByName, computePool } from '../lib/categoryPool'
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [enrollingSlug, setEnrollingSlug] = useState(null)
  const [enrollErrors, setEnrollErrors] = useState({})

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      const [categoriesRes, teamsRes, playersRes, rosterRes, enrollRes, countsRes] = await Promise.all([
        supabase.from('categories').select('*').eq('is_active', true).eq('is_event', false).order('id'),
        supabase.from('teams').select('*'),
        supabase.from('players').select('*'),
        supabase.from('user_players').select('player_id').eq('user_id', user.id),
        supabase.from('user_category_enrollments').select('category_id').eq('user_id', user.id),
        supabase.rpc('get_category_participant_counts'),
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

      const counts = {}
      ;(countsRes.data ?? []).forEach((row) => {
        counts[row.category_id] = row.participant_count
      })
      setParticipantCounts(counts)

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

      <RewardsBanner />

      <div className="summary-bar card">
        <div className="summary-item">
          <span className="summary-label">Crediti</span>
          <span className="summary-value">{profile?.credits ?? 0}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Giocatori in rosa</span>
          <span className="summary-value">{rosterPlayers.length}</span>
        </div>
      </div>

      {loading && <p className="status-text">Caricamento…</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && !error && (
        <div className="category-cards">
          {categories.map((category) => {
            const pool = computePool(players, teamsByName, category, totalTeams)
            const eligibleCount = computePool(rosterPlayers, teamsByName, category, totalTeams).length
            const isEnrolled = enrolledIds.includes(category.id)
            const missing = Math.max(0, 7 - eligibleCount)

            return (
              <div key={category.id} className="category-card card">
                <Link to={`/categories/${category.slug}`} className="category-card-link">
                  <div className="category-card-header">
                    <h2>{category.name}</h2>
                    {isEnrolled && <span className="badge-tag">Iscritto</span>}
                  </div>
                  <p className="category-description">{category.description}</p>
                  <div className="category-stats">
                    <span>{pool.length} giocatori nel pool</span>
                    <span>{participantCounts[category.id] ?? 0} partecipanti</span>
                  </div>
                </Link>

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
            )
          })}
        </div>
      )}
    </div>
  )
}

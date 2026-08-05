import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/useAuth'
import { getCurrentGameweek } from '../lib/gameweek'
import { usePageTitle } from '../hooks/usePageTitle'
import GameweekLeaderboard from '../components/GameweekLeaderboard'
import './LiveDetail.css'

export default function LiveCategoryDetail() {
  const { categorySlug } = useParams()
  const { user } = useAuth()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [category, setCategory] = useState(null)
  const [gameweek, setGameweek] = useState(null)
  const [myTotal, setMyTotal] = useState(0)
  const [myRank, setMyRank] = useState(null)

  usePageTitle(category?.name ?? 'Live')

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setError(null)

      const { data: categoryData } = await supabase
        .from('categories')
        .select('*')
        .eq('slug', categorySlug)
        .maybeSingle()

      if (cancelled) return
      if (!categoryData) {
        setError('Categoria non trovata.')
        setLoading(false)
        return
      }

      const gw = await getCurrentGameweek()
      if (cancelled) return
      if (!gw) {
        setError('Nessuna giornata disponibile.')
        setLoading(false)
        return
      }

      setCategory(categoryData)
      setGameweek(gw)

      if (gw.status === 'live') {
        const { data } = await supabase.rpc('get_live_scores', { p_user_id: user.id, p_gameweek_id: gw.id })
        const tile = (data ?? []).find((t) => t.category_id === categoryData.id)
        if (!cancelled) {
          setMyTotal(tile?.total_score ?? 0)
          setMyRank(tile?.rank ?? null)
        }
      }

      if (!cancelled) setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [categorySlug, user.id])

  if (loading) return <p className="status-text">Caricamento…</p>
  if (error) return <p className="error-text">{error}</p>

  return (
    <div className="live-detail-page">
      <Link to="/live" className="back-link">
        ‹ Live
      </Link>

      <div className="live-detail-header card">
        <h1>
          {category.is_reverse_scoring && <span aria-hidden="true">🔄 </span>}
          {category.name}
        </h1>
        {category.is_reverse_scoring && <span className="badge-tag reverse">Flop XI</span>}
        <div className="live-detail-stats">
          <div className="summary-item">
            <span className="summary-label">Punteggio</span>
            <span className="summary-value">{myTotal.toFixed(1)}</span>
          </div>
          {myRank != null && (
            <div className="summary-item">
              <span className="summary-label">Posizione</span>
              <span className="summary-value">{myRank}°</span>
            </div>
          )}
        </div>
      </div>

      <section>
        <h2>Classifica di giornata</h2>
        <GameweekLeaderboard
          categoryId={category.id}
          gameweek={gameweek}
          currentUserId={user.id}
          isReverse={category.is_reverse_scoring}
        />
      </section>
    </div>
  )
}

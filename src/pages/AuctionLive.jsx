import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { usePageTitle } from '../hooks/usePageTitle'
import './AuctionAdmin.css'

// Read-only spectator view. There's no persisted "currently up for bid"
// state (the admin only confirms a pick once it's final, via
// auction_assign_player), so the closest live signal is "most recent
// assignment" — everything else (budgets, roster progress) is exact.
export default function AuctionLive() {
  usePageTitle('Asta Live')
  const { id } = useParams()

  const [league, setLeague] = useState(null)
  const [members, setMembers] = useState([])
  const [log, setLog] = useState([])
  const [rosterCounts, setRosterCounts] = useState({})
  const [loading, setLoading] = useState(true)

  async function loadAll() {
    const [leagueRes, membersRes, logRes, rosterRes] = await Promise.all([
      supabase.from('leagues').select('*').eq('id', id).maybeSingle(),
      supabase.from('league_members').select('*, profiles(username)').eq('league_id', id),
      supabase
        .from('auction_log')
        .select('*, players(name, team), profiles(username)')
        .eq('league_id', id)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase.from('league_rosters').select('user_id').eq('league_id', id),
    ])

    setLeague(leagueRes.data ?? null)
    setMembers(membersRes.data ?? [])
    setLog(logRes.data ?? [])

    const counts = {}
    ;(rosterRes.data ?? []).forEach((r) => {
      counts[r.user_id] = (counts[r.user_id] ?? 0) + 1
    })
    setRosterCounts(counts)
    setLoading(false)
  }

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      await loadAll()
      if (cancelled) return
    }
    load()

    const channel = supabase
      .channel(`auction-live-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'auction_log', filter: `league_id=eq.${id}` },
        () => loadAll()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'league_rosters', filter: `league_id=eq.${id}` },
        () => loadAll()
      )
      .subscribe()

    return () => {
      cancelled = true
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (loading) return <p className="status-text">Caricamento…</p>
  if (!league) return <p className="error-text">Lega non trovata.</p>

  const latest = log[0]

  return (
    <div className="auction-page">
      <Link to={`/leagues/${id}`} className="back-link">
        ‹ {league.name}
      </Link>
      <h1>Asta live — {league.name}</h1>

      {latest && (
        <div className="card auction-card">
          <h2>Ultima assegnazione</h2>
          <p>
            <strong>{latest.players?.name}</strong> ({latest.players?.team}) → {latest.profiles?.username} per{' '}
            {latest.price} crediti
          </p>
        </div>
      )}

      <div className="auction-budgets card">
        <h2>Partecipanti</h2>
        <ul className="auction-budget-list">
          {members.map((m) => (
            <li key={m.id}>
              <span>{m.profiles?.username ?? m.team_name}</span>
              <span>
                {rosterCounts[m.user_id] ?? 0}/{league.roster_size}
              </span>
              <span className="auction-budget-credits">{m.league_credits} cr.</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="card auction-card">
        <h2>Assegnazioni recenti</h2>
        {log.length === 0 ? (
          <p className="status-text">Nessuna assegnazione ancora.</p>
        ) : (
          <ul className="auction-budget-list">
            {log.map((entry) => (
              <li key={entry.id}>
                <span>{entry.players?.name}</span>
                <span>{entry.profiles?.username}</span>
                <span className="auction-budget-credits">{entry.price} cr.</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

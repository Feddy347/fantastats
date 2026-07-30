import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/useAuth'
import '../components/ConfirmDialog.css'
import './RewardsBanner.css'

function rewardLabel(reward, playerName) {
  if (reward.reward_type === 'credits') return `${reward.reward_value} crediti`
  return playerName ? `Giocatore vinto: ${playerName}` : 'Giocatore vinto'
}

export default function RewardsBanner() {
  const { user, refreshProfile } = useAuth()
  const [rewards, setRewards] = useState([])
  const [playerNames, setPlayerNames] = useState({})
  const [open, setOpen] = useState(false)
  const [claimingId, setClaimingId] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data } = await supabase
        .from('rewards')
        .select('id, reward_type, reward_value, category_id, gameweek_id, categories(name), gameweeks(number)')
        .eq('user_id', user.id)
        .eq('claimed', false)
        .order('created_at', { ascending: false })

      if (cancelled) return

      const rows = data ?? []
      setRewards(rows)

      const playerIds = rows.filter((r) => r.reward_type === 'player').map((r) => r.reward_value)
      if (playerIds.length > 0) {
        const { data: players } = await supabase.from('players').select('id, name').in('id', playerIds)
        if (cancelled) return
        const map = {}
        ;(players ?? []).forEach((p) => {
          map[p.id] = p.name
        })
        setPlayerNames(map)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [user.id])

  async function handleClaim(reward) {
    setClaimingId(reward.id)
    const { error } = await supabase.from('rewards').update({ claimed: true }).eq('id', reward.id)
    setClaimingId(null)
    if (!error) {
      setRewards((prev) => prev.filter((r) => r.id !== reward.id))
      if (reward.reward_type === 'credits') await refreshProfile()
    }
  }

  if (rewards.length === 0) return null

  return (
    <>
      <button type="button" className="rewards-banner" onClick={() => setOpen(true)}>
        🏆 Hai {rewards.length} {rewards.length === 1 ? 'premio' : 'premi'} da riscuotere
      </button>

      {open && (
        <div className="confirm-backdrop" onClick={() => setOpen(false)}>
          <div className="confirm-dialog card" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>I tuoi premi</h2>
            <ul className="rewards-list">
              {rewards.map((r) => (
                <li key={r.id} className="rewards-list-item">
                  <div>
                    <div className="rewards-list-category">
                      {r.categories?.name} — GW{r.gameweeks?.number}
                    </div>
                    <div>{rewardLabel(r, playerNames[r.reward_value])}</div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={claimingId === r.id}
                    onClick={() => handleClaim(r)}
                  >
                    Riscuoti
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn-secondary btn-block" onClick={() => setOpen(false)}>
              Chiudi
            </button>
          </div>
        </div>
      )}
    </>
  )
}

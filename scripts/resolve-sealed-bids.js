// Resolves every sealed-bid session whose deadline has passed: highest
// bidder per player wins (ties broken by earliest bid), re-verifying the
// winner still has enough league credits and the player is still
// unassigned before committing. Manual for now, like consolidate-gameweek.js.
//
// Usage: node scripts/resolve-sealed-bids.js

import { getSupabaseAdmin } from './lib/env.js'

async function resolveLeagueSession(supabase, leagueId, deadline) {
  const { data: bids, error } = await supabase
    .from('sealed_bids')
    .select('*')
    .eq('league_id', leagueId)
    .eq('deadline', deadline)
    .eq('status', 'pending')

  if (error) throw error
  if (!bids || bids.length === 0) return { assigned: 0, lost: 0 }

  const byPlayer = new Map()
  bids.forEach((b) => {
    if (!byPlayer.has(b.player_id)) byPlayer.set(b.player_id, [])
    byPlayer.get(b.player_id).push(b)
  })

  let assigned = 0
  let lost = 0

  for (const [playerId, playerBids] of byPlayer) {
    playerBids.sort((a, b) => b.bid_amount - a.bid_amount || new Date(a.created_at) - new Date(b.created_at))

    let winner = null

    for (const candidate of playerBids) {
      const { data: alreadyOwned } = await supabase
        .from('league_rosters')
        .select('id')
        .eq('league_id', leagueId)
        .eq('player_id', playerId)
        .maybeSingle()

      if (alreadyOwned) break // someone else already got this player in the meantime

      const { data: member } = await supabase
        .from('league_members')
        .select('league_credits')
        .eq('league_id', leagueId)
        .eq('user_id', candidate.user_id)
        .maybeSingle()

      if (member && member.league_credits >= candidate.bid_amount) {
        winner = candidate
        break
      }
    }

    if (winner) {
      await supabase.from('league_rosters').insert({
        league_id: leagueId,
        user_id: winner.user_id,
        player_id: playerId,
        purchase_price: winner.bid_amount,
      })

      const { data: member } = await supabase
        .from('league_members')
        .select('league_credits')
        .eq('league_id', leagueId)
        .eq('user_id', winner.user_id)
        .maybeSingle()

      await supabase
        .from('league_members')
        .update({ league_credits: (member?.league_credits ?? 0) - winner.bid_amount })
        .eq('league_id', leagueId)
        .eq('user_id', winner.user_id)

      await supabase.from('sealed_bids').update({ status: 'won' }).eq('id', winner.id)
      assigned += 1
    }

    const loserIds = playerBids.filter((b) => !winner || b.id !== winner.id).map((b) => b.id)
    if (loserIds.length > 0) {
      await supabase.from('sealed_bids').update({ status: 'lost' }).in('id', loserIds)
      lost += loserIds.length
    }
  }

  return { assigned, lost }
}

async function main() {
  const supabase = getSupabaseAdmin()

  const { data: pendingBids, error } = await supabase
    .from('sealed_bids')
    .select('league_id, deadline')
    .eq('status', 'pending')
    .lte('deadline', new Date().toISOString())

  if (error) throw error

  const sessions = new Map()
  ;(pendingBids ?? []).forEach((row) => {
    sessions.set(`${row.league_id}::${row.deadline}`, { leagueId: row.league_id, deadline: row.deadline })
  })

  if (sessions.size === 0) {
    console.log('No expired sealed-bid sessions to resolve.')
    return
  }

  for (const { leagueId, deadline } of sessions.values()) {
    console.log(`Resolving league ${leagueId} session (deadline ${deadline})...`)
    const { assigned, lost } = await resolveLeagueSession(supabase, leagueId, deadline)
    console.log(`  Assigned ${assigned} player(s), ${lost} losing bid(s).`)
  }
}

main().catch((err) => {
  console.error('resolve-sealed-bids failed:', err.message || err)
  process.exit(1)
})

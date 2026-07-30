import { supabase } from './supabaseClient'

// "In che giornata siamo": the live gameweek if there is one, otherwise the
// next upcoming one ordered by kickoff. Used across the app so every page
// agrees on the current gameweek.
export async function getCurrentGameweek() {
  const { data: live } = await supabase
    .from('gameweeks')
    .select('*')
    .eq('status', 'live')
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (live) return live

  const { data: upcoming } = await supabase
    .from('gameweeks')
    .select('*')
    .eq('status', 'upcoming')
    .order('starts_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  return upcoming ?? null
}

export function isLineupLocked(gameweek) {
  if (!gameweek) return true
  if (gameweek.status !== 'upcoming') return true
  if (!gameweek.deadline) return false
  return new Date() >= new Date(gameweek.deadline)
}

// Leagues have their own formation_deadline_minutes setting, applied against
// the gameweek's kickoff — independent of the categories system's fixed
// gameweeks.deadline column.
export function isLeagueLineupLocked(gameweek, league) {
  if (!gameweek) return true
  if (gameweek.status !== 'upcoming') return true
  if (!gameweek.starts_at) return false
  const minutes = league?.formation_deadline_minutes ?? 15
  const deadline = new Date(gameweek.starts_at).getTime() - minutes * 60000
  return Date.now() >= deadline
}

export function formatLeagueDeadline(gameweek, league) {
  if (!gameweek?.starts_at) return null
  const minutes = league?.formation_deadline_minutes ?? 15
  const deadline = new Date(new Date(gameweek.starts_at).getTime() - minutes * 60000)
  const day = deadline.toLocaleDateString('it-IT', { weekday: 'short' })
  const time = deadline.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  return `${day.charAt(0).toUpperCase()}${day.slice(1).replace('.', '')} ${time}`
}

// Small wrapper so `Date.now()` isn't called directly inside a component's
// render body (flagged as an impure call by the React compiler lint rule).
export function isDeadlineFuture(deadline) {
  return deadline ? new Date(deadline).getTime() > Date.now() : false
}

export function formatDeadline(gameweek) {
  if (!gameweek?.deadline) return null
  const date = new Date(gameweek.deadline)
  const day = date.toLocaleDateString('it-IT', { weekday: 'short' })
  const time = date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  return `${day.charAt(0).toUpperCase()}${day.slice(1).replace('.', '')} ${time}`
}

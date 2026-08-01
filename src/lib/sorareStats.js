// Player profile page: a player's most recent Serie A match stats, fetched
// via the sorare-player-games Supabase Edge Function rather than calling
// Sorare directly from the browser. Sorare's GraphQL API sends no
// Access-Control-Allow-Origin header (confirmed live — neither an OPTIONS
// preflight nor a real POST gets one back), so a direct browser fetch is
// blocked by CORS; curl/Node aren't subject to CORS (browser-only), which
// is why every earlier server-side test worked while this page silently
// failed. See supabase/functions/sorare-player-games/index.ts for the
// server-side query this proxies (kept in sync manually).

import { supabase } from './supabaseClient'

// Returns up to `count` of the player's most recent Serie A appearances,
// most recent first: [{ gameId, date, homeTeam, awayTeam, homeScore,
// awayScore, live, stats }].
export async function fetchPlayerRecentSerieAGames(slug, count = 5) {
  const { data, error } = await supabase.functions.invoke('sorare-player-games', {
    body: { slug, count },
  })

  if (error) throw error
  return data?.games ?? []
}

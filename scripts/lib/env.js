// Shared Supabase admin client for server-side scripts. Scripts run under
// plain Node (not Vite), so they can't use src/lib/supabaseClient.js, which
// relies on import.meta.env.

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

export function getSupabaseAdmin() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      'Missing env vars. Make sure VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set (e.g. in .env).'
    )
    process.exit(1)
  }

  return createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } })
}

// Mirrors src/lib/gameweek.js's getCurrentGameweek(), against the admin client.
export async function getCurrentGameweekAdmin(supabase) {
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

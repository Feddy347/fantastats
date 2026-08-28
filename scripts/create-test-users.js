// Creates 9 test users in Supabase Auth (pre-confirmed, no verification
// email) plus their profiles, for local/manual testing of leagues/market
// flows. Idempotent: re-running skips users whose email already exists in
// auth.users and just re-syncs their profile's username/team_name.
//
// handle_new_user (supabase/migrations/20260805000000_profile_league_admin_fixes.sql)
// auto-creates the profiles row from raw_user_meta_data.username/team_name
// on auth.users insert, and profiles.credits defaults to 500 (see
// 20260729010000_categories_market.sql). Metadata is passed at creation time
// so the trigger does this in one shot; the explicit profiles update below
// is a safety net in case the trigger's on-conflict-do-nothing ever races
// with an existing row.
//
// Usage: node scripts/create-test-users.js

import fs from 'node:fs'
import { getSupabaseAdmin } from './lib/env.js'

const REPORT_PATH = 'data/test_users.csv'
const PASSWORD = 'TestFanta26!'

const USERS = [
  { email: 'schiaffield@test.fantastats', teamName: 'Schiaffield Wednesday', username: 'schiaffield' },
  { email: 'falarsenal@test.fantastats', teamName: 'Falarsenal', username: 'falarsenal' },
  { email: 'liverpollio@test.fantastats', teamName: 'Liverpollio', username: 'liverpollio' },
  { email: 'ostialiedholm@test.fantastats', teamName: 'Ostia Liedholm', username: 'ostialiedholm' },
  { email: 'ejaculazio@test.fantastats', teamName: 'Ejaculazio', username: 'ejaculazio' },
  { email: 'realcanil@test.fantastats', teamName: 'Real Canil', username: 'realcanil' },
  { email: 'rottenwreck@test.fantastats', teamName: 'Rotten Wreck Squad', username: 'rottenwreck' },
  { email: 'parmigian@test.fantastats', teamName: 'Parmigian Buongrado', username: 'parmigian' },
  { email: 'malencastro@test.fantastats', teamName: 'Malencastro', username: 'malencastro' },
]

function csvEscape(value) {
  const str = value == null ? '' : String(value)
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
  return str
}

// Admin listUsers has no email filter in this supabase-js version, so an
// "already registered" createUser error is resolved by paging through all
// users and matching client-side. Fine at test-user scale (<1000 users).
async function findUserByEmail(supabase, email) {
  let page = 1
  const perPage = 200
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (match) return match
    if (data.users.length < perPage) return null
    page += 1
  }
}

async function main() {
  const supabase = getSupabaseAdmin()
  const results = []

  for (const user of USERS) {
    let authUser
    const { data: created, error: createError } = await supabase.auth.admin.createUser({
      email: user.email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { username: user.username, team_name: user.teamName },
    })

    if (createError) {
      if (!/already been registered|already exists/i.test(createError.message)) throw createError
      console.warn(`[exists] ${user.email} already registered, reusing existing user`)
      authUser = await findUserByEmail(supabase, user.email)
      if (!authUser) throw new Error(`${user.email} reported as duplicate but not found via listUsers`)
    } else {
      authUser = created.user
      console.log(`[created] ${user.email} -> ${authUser.id}`)
    }

    // Safety net: make sure profiles reflects the intended username/team_name
    // even if the trigger's metadata read or on-conflict-do-nothing skipped it.
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ username: user.username, team_name: user.teamName })
      .eq('id', authUser.id)
    if (updateError) throw updateError

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('credits')
      .eq('id', authUser.id)
      .single()
    if (profileError) throw profileError

    results.push({
      email: user.email,
      teamName: user.teamName,
      username: user.username,
      userId: authUser.id,
      credits: profile.credits,
    })
  }

  console.log('\nRecap:')
  for (const r of results) {
    console.log(`  ${r.email} | team="${r.teamName}" | user_id=${r.userId} | credits=${r.credits}`)
  }

  const rows = [
    ['email', 'team_name', 'username', 'user_id', 'password'],
    ...results.map((r) => [r.email, r.teamName, r.username, r.userId, PASSWORD]),
  ]
  fs.writeFileSync(REPORT_PATH, rows.map((row) => row.map(csvEscape).join(',')).join('\n') + '\n', 'utf8')
  console.log(`\nSaved recap to ${REPORT_PATH}`)
}

main().catch((err) => {
  console.error('create-test-users failed:', err.message || err)
  process.exit(1)
})

import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabaseClient'
import { AuthContext } from './authContextBase'

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profileData, setProfileData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  const fetchProfileData = useCallback(async (userId) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    return data
  }, [])

  useEffect(() => {
    const userId = session?.user?.id
    if (!userId) return

    let cancelled = false

    fetchProfileData(userId).then((data) => {
      if (!cancelled) setProfileData(data)
    })

    return () => {
      cancelled = true
    }
  }, [session?.user?.id, fetchProfileData])

  const refreshProfile = useCallback(async () => {
    const userId = session?.user?.id
    if (!userId) return null
    const data = await fetchProfileData(userId)
    setProfileData(data)
    return data
  }, [session?.user?.id, fetchProfileData])

  const value = {
    session,
    user: session?.user ?? null,
    profile: session?.user ? profileData : null,
    loading,
    signOut: () => supabase.auth.signOut(),
    refreshProfile,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

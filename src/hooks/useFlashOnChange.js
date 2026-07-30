import { useEffect, useRef, useState } from 'react'

// Returns 'up' | 'down' | null for a brief window right after `value`
// changes, so the caller can flash a background color. Ignores the very
// first render (no prior value to compare against) and null/undefined.
export function useFlashOnChange(value) {
  const prevRef = useRef(value)
  const [flash, setFlash] = useState(null)

  useEffect(() => {
    const prev = prevRef.current
    prevRef.current = value

    if (prev == null || value == null || value === prev) return

    setFlash(value > prev ? 'up' : 'down')
    const timeout = setTimeout(() => setFlash(null), 500)
    return () => clearTimeout(timeout)
  }, [value])

  return flash
}

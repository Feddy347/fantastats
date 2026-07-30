// "Lautaro Martinez" -> "Martinez L." (Sorare-style abbreviation for tight spaces).
export function abbreviatePlayerName(fullName) {
  const parts = (fullName ?? '').trim().split(/\s+/)
  if (parts.length <= 1) return fullName ?? ''
  const surname = parts[parts.length - 1]
  const initial = parts[0][0]
  return `${surname} ${initial}.`
}

// Just the surname, capped for pitch chips where space is tight.
export function surnameOnly(fullName, maxLength = 10) {
  const parts = (fullName ?? '').trim().split(/\s+/)
  const surname = parts[parts.length - 1] ?? ''
  return surname.length > maxLength ? surname.slice(0, maxLength) : surname
}

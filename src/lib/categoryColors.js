// All category cards share a single color (green) — no more per-category
// distinction. Kept as a function (rather than inlining the var everywhere)
// so callers don't need to change if this ever comes back.
export function getCategoryColorVar() {
  return '--color-elite'
}

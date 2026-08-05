// All category cards share a single color (green), except Flop XI
// (reverse-scoring) categories, which get --color-hype (red) instead so
// they read as visually distinct from the rest at a glance.
export function getCategoryColorVar(isReverseScoring) {
  return isReverseScoring ? '--color-hype' : '--color-elite'
}

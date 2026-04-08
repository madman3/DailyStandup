/** Daily protein target (g) for chart reference line. Set VITE_PROTEIN_GOAL_GRAMS in Vercel. */
export function proteinGoalGrams() {
  const raw = import.meta.env.VITE_PROTEIN_GOAL_GRAMS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 150;
}

/**
 * Where to look for artwork for a game: SteamGridDB's grid (poster) search.
 *
 *   "The Last of Us - Part I"
 *     → https://www.steamgriddb.com/search/grids?term=The+Last+of+Us+-+Part+I
 */
export function posterSearchUrl(title: string): string | null {
  const term = title.trim()
  if (!term) return null
  return `https://www.steamgriddb.com/search/grids?${new URLSearchParams({ term })}`
}

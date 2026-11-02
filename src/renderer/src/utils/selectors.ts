import type { FilterKey, Game, Language, SortKey } from '@shared/types'

export function countByFilter(games: Game[]): Record<FilterKey, number> {
  const counts: Record<FilterKey, number> = {
    all: 0,
    installed: 0,
    notInstalled: 0,
    played: 0,
    unplayed: 0,
    favorite: 0,
    hidden: 0
  }
  for (const g of games) {
    // Hidden games belong to the private shelf alone — they never count
    // towards the visible library.
    if (g.hidden) {
      counts.hidden++
      continue
    }
    counts.all++
    if (g.installed) counts.installed++
    else counts.notInstalled++
    if (g.played) counts.played++
    else counts.unplayed++
    if (g.favorite) counts.favorite++
  }
  return counts
}

export function applyFilter(games: Game[], filter: FilterKey, query: string): Game[] {
  const q = query.trim().toLowerCase()
  return games.filter((g) => {
    // A hidden game only shows up in the private shelf.
    if (filter === 'hidden') {
      if (!g.hidden) return false
    } else if (g.hidden) {
      return false
    }
    switch (filter) {
      case 'installed':
        if (!g.installed) return false
        break
      case 'notInstalled':
        if (g.installed) return false
        break
      case 'played':
        if (!g.played) return false
        break
      case 'unplayed':
        if (g.played) return false
        break
      case 'favorite':
        if (!g.favorite) return false
        break
      default:
        break
    }
    if (!q) return true
    if (g.title.toLowerCase().includes(q)) return true
    if (g.tags.some((tag) => tag.toLowerCase().includes(q))) return true
    if (g.note.toLowerCase().includes(q)) return true
    return false
  })
}

const collators = new Map<string, Intl.Collator>()

/** Natural, language-aware title order: "Game 2" before "Game 10", 中文 by pinyin. */
function titleCollator(language: Language): Intl.Collator {
  const locale = language === 'zh' ? 'zh-CN' : 'en'
  let collator = collators.get(locale)
  if (!collator) {
    collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' })
    collators.set(locale, collator)
  }
  return collator
}

export function applySort(games: Game[], sort: SortKey, language: Language = 'en'): Game[] {
  const collator = titleCollator(language)
  const byTitle = (a: Game, b: Game): number => collator.compare(a.title, b.title)
  const list = [...games]
  // Every order falls back to the title, so ties never shuffle between renders.
  switch (sort) {
    case 'title':
      return list.sort(byTitle)
    case 'addedAt':
      return list.sort((a, b) => b.addedAt.localeCompare(a.addedAt) || byTitle(a, b))
    case 'lastPlayed':
      return list.sort((a, b) => (b.lastPlayedAt ?? '').localeCompare(a.lastPlayedAt ?? '') || byTitle(a, b))
    case 'playtime':
      return list.sort((a, b) => b.playtimeMinutes - a.playtimeMinutes || byTitle(a, b))
    case 'playCount':
      return list.sort((a, b) => b.playCount - a.playCount || byTitle(a, b))
    default:
      return list
  }
}

export function totalPlaytime(games: Game[]): number {
  return games.reduce((sum, g) => sum + g.playtimeMinutes, 0)
}

/** The games the owner can see — hidden ones stay out of the library. */
export function visibleGames(games: Game[]): Game[] {
  return games.filter((g) => !g.hidden)
}

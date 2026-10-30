import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useStorm, useT } from '../store/useStorm'
import { applyFilter, applySort } from '../utils/selectors'
import { wallContainer } from '../motion'
import { EyeOffIcon, GridIcon } from './icons'
import GameCard from './GameCard'
import EmptyState from './EmptyState'

export default function PosterWall(): React.JSX.Element {
  const games = useStorm((s) => s.games)
  const filter = useStorm((s) => s.filter)
  const sort = useStorm((s) => s.sort)
  const query = useStorm((s) => s.query)
  const setFilter = useStorm((s) => s.setFilter)
  const t = useT()

  const visible = useMemo(
    () => applySort(applyFilter(games, filter, query), sort),
    [games, filter, query, sort]
  )
  const hiddenCount = useMemo(() => games.filter((g) => g.hidden).length, [games])
  const privateView = filter === 'hidden'

  if (games.length === 0) return <EmptyState variant="empty" />
  if (visible.length === 0) {
    if (privateView) return <EmptyState variant="hidden" />
    // Every game is tucked away — point at the private shelf instead of
    // pretending the filters simply do not match.
    if (filter === 'all' && hiddenCount > 0) return <EmptyState variant="hidden-only" />
    return <EmptyState variant="no-match" />
  }

  return (
    <>
      {privateView && (
        <motion.div
          className="private-banner"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="private-banner-main">
            <span className="private-banner-icon">
              <EyeOffIcon size={16} />
            </span>
            <div className="private-banner-text">
              <span className="private-banner-title">{t('hidden.title')}</span>
              <span className="private-banner-sub">{t('hidden.subtitle')}</span>
            </div>
          </div>
          <button type="button" className="btn btn--ghost" onClick={() => setFilter('all')}>
            <GridIcon size={15} />
            {t('hidden.back')}
          </button>
        </motion.div>
      )}
      <motion.div className="wall" variants={wallContainer} initial="hidden" animate="show">
        {visible.map((game) => (
          <GameCard key={game.id} game={game} />
        ))}
      </motion.div>
    </>
  )
}

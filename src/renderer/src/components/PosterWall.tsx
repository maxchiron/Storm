import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { useStorm, useT } from '../store/useStorm'
import { applyFilter, applySort } from '../utils/selectors'
import { wallContainer } from '../motion'
import GameCard from './GameCard'
import EmptyState from './EmptyState'

export default function PosterWall(): React.JSX.Element {
  const games = useStorm((s) => s.games)
  const filter = useStorm((s) => s.filter)
  const sort = useStorm((s) => s.sort)
  const query = useStorm((s) => s.query)
  const t = useT()

  const visible = useMemo(
    () => applySort(applyFilter(games, filter, query), sort),
    [games, filter, query, sort]
  )

  if (games.length === 0) return <EmptyState variant="empty" />
  if (visible.length === 0) return <EmptyState variant="no-match" />

  return (
    <motion.div className="wall" variants={wallContainer} initial="hidden" animate="show">
      {visible.map((game) => (
        <GameCard key={game.id} game={game} />
      ))}
    </motion.div>
  )
}

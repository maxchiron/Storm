import { motion } from 'framer-motion'
import { useStorm, useT } from '../store/useStorm'
import { EASE } from '../motion'
import { PlusIcon, SearchIcon, SparkIcon } from './icons'

interface Props {
  variant: 'empty' | 'no-match'
}

export default function EmptyState({ variant }: Props): React.JSX.Element {
  const t = useT()
  const openForm = useStorm((s) => s.openForm)
  const setFilter = useStorm((s) => s.setFilter)
  const setQuery = useStorm((s) => s.setQuery)

  const isEmpty = variant === 'empty'

  return (
    <motion.div
      className="empty"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
    >
      <motion.div
        className="empty-art"
        animate={isEmpty ? { y: [0, -8, 0] } : { rotate: [0, 6, -6, 0] }}
        transition={isEmpty ? { duration: 5, repeat: Infinity, ease: 'easeInOut' } : { duration: 6, repeat: Infinity }}
      >
        {isEmpty ? <SparkIcon size={34} /> : <SearchIcon size={30} />}
      </motion.div>
      <h2 className="empty-title">{isEmpty ? t('empty.title') : t('empty.noMatch')}</h2>
      <p className="empty-sub">{isEmpty ? t('empty.subtitle') : t('empty.noMatchSub')}</p>
      {isEmpty ? (
        <motion.button
          type="button"
          className="btn btn--primary btn--lg"
          onClick={() => openForm()}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.97 }}
        >
          <PlusIcon size={17} />
          {t('empty.action')}
        </motion.button>
      ) : (
        <motion.button
          type="button"
          className="btn btn--ghost btn--lg"
          onClick={() => {
            setFilter('all')
            setQuery('')
          }}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.97 }}
        >
          {t('action.recheck')}
        </motion.button>
      )}
    </motion.div>
  )
}

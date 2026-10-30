import { motion } from 'framer-motion'
import { useStorm, useT } from '../store/useStorm'
import { EASE } from '../motion'
import { EyeOffIcon, PlusIcon, SearchIcon, SparkIcon } from './icons'

interface Props {
  variant: 'empty' | 'no-match' | 'hidden' | 'hidden-only'
}

export default function EmptyState({ variant }: Props): React.JSX.Element {
  const t = useT()
  const openForm = useStorm((s) => s.openForm)
  const setFilter = useStorm((s) => s.setFilter)
  const setQuery = useStorm((s) => s.setQuery)

  const isEmpty = variant === 'empty'
  const isHidden = variant === 'hidden' || variant === 'hidden-only'

  const title = isEmpty
    ? t('empty.title')
    : variant === 'no-match'
      ? t('empty.noMatch')
      : variant === 'hidden'
        ? t('empty.hiddenTitle')
        : t('empty.hiddenOnlyTitle')

  const subtitle = isEmpty
    ? t('empty.subtitle')
    : variant === 'no-match'
      ? t('empty.noMatchSub')
      : variant === 'hidden'
        ? t('empty.hiddenSub')
        : t('empty.hiddenOnlySub')

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
        {isEmpty ? <SparkIcon size={34} /> : isHidden ? <EyeOffIcon size={30} /> : <SearchIcon size={30} />}
      </motion.div>
      <h2 className="empty-title">{title}</h2>
      <p className="empty-sub">{subtitle}</p>
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
      ) : variant === 'hidden-only' ? (
        <motion.button
          type="button"
          className="btn btn--ghost btn--lg"
          onClick={() => setFilter('hidden')}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.97 }}
        >
          <EyeOffIcon size={16} />
          {t('empty.hiddenOnlyAction')}
        </motion.button>
      ) : variant === 'hidden' ? (
        <motion.button
          type="button"
          className="btn btn--ghost btn--lg"
          onClick={() => setFilter('all')}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.97 }}
        >
          {t('empty.hiddenAction')}
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

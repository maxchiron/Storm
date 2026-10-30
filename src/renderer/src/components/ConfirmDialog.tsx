import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStorm, useT } from '../store/useStorm'
import { SPRING_SOFT } from '../motion'
import { TrashIcon } from './icons'

export default function ConfirmDialog(): React.JSX.Element {
  const confirmId = useStorm((s) => s.confirmId)
  const games = useStorm((s) => s.games)
  const askDelete = useStorm((s) => s.askDelete)
  const toast = useStorm((s) => s.toast)
  const t = useT()

  const game = games.find((g) => g.id === confirmId) ?? null

  useEffect(() => {
    if (!confirmId) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') askDelete(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmId, askDelete])

  const remove = async (): Promise<void> => {
    if (!game) return
    await window.storm.deleteGame(game.id)
    askDelete(null)
    toast(t('toast.deleted'), 'success')
  }

  return (
    <AnimatePresence>
      {game && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) askDelete(null)
          }}
        >
          <motion.div
            className="modal modal--confirm"
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={SPRING_SOFT}
          >
            <h2 className="confirm-title">{t('toast.confirmDelete')}</h2>
            <p className="confirm-body">
              <strong>{game.title}</strong>
            </p>
            <div className="modal-foot">
              <button type="button" className="btn btn--ghost" onClick={() => askDelete(null)}>
                {t('action.cancel')}
              </button>
              <motion.button
                type="button"
                className="btn btn--danger"
                onClick={() => void remove()}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
              >
                <TrashIcon size={15} />
                {t('action.delete')}
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

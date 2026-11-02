import { AnimatePresence, motion } from 'framer-motion'
import { useStorm, useT } from '../store/useStorm'
import { SPRING_SOFT } from '../motion'
import { TrashIcon } from './icons'

export default function ConfirmDialog(): React.JSX.Element {
  const game = useStorm((s) => (s.confirmId ? (s.games.find((g) => g.id === s.confirmId) ?? null) : null))
  const askDelete = useStorm((s) => s.askDelete)
  const deleteGame = useStorm((s) => s.deleteGame)
  const t = useT()

  // Escape is handled in App, so it closes only this dialog and not the
  // detail page underneath it.
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
            role="alertdialog"
            aria-modal="true"
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
              <button type="button" className="btn btn--ghost" onClick={() => askDelete(null)} autoFocus>
                {t('action.cancel')}
              </button>
              <motion.button
                type="button"
                className="btn btn--danger"
                onClick={() => void deleteGame(game.id)}
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

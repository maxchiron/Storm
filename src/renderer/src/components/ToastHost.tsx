import { AnimatePresence, motion } from 'framer-motion'
import { useStorm } from '../store/useStorm'
import { SPRING_SOFT } from '../motion'
import { CheckIcon, CloseIcon } from './icons'

export default function ToastHost(): React.JSX.Element {
  const toasts = useStorm((s) => s.toasts)
  const dismiss = useStorm((s) => s.dismissToast)

  return (
    <div className="toast-host">
      <AnimatePresence initial={false}>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            className={`toast toast--${toast.type}`}
            layout
            initial={{ opacity: 0, x: 40, scale: 0.94 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 30, scale: 0.94 }}
            transition={SPRING_SOFT}
          >
            <span className="toast-icon">{toast.type === 'success' ? <CheckIcon size={14} /> : null}</span>
            <span className="toast-text">{toast.message}</span>
            <button type="button" className="icon-btn icon-btn--sm" onClick={() => dismiss(toast.id)}>
              <CloseIcon size={13} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStorm, useT } from '../store/useStorm'
import {
  acceptDrag,
  dragHasFiles,
  dragLooksLikeImage,
  gamePaths,
  hasImage,
  importImageFromSnapshot,
  snapshotTransfer
} from '../utils/transfer'
import { DropIcon, ImageIcon } from './icons'

type Hover = 'game' | 'poster' | null

/**
 * Drag-and-drop anywhere on the window.
 *
 *   game files (.exe / .lnk) → the add form opens, already filled in
 *                              (several files are added in one go)
 *   an image, detail page open → it becomes that game's poster
 *   an image, on the wall      → a new game starts with it as the poster
 *
 * The add form handles drops itself; while it is open this layer only makes
 * sure a stray drop never navigates the window away from the app.
 */
export default function DropLayer(): React.JSX.Element {
  const t = useT()
  const [hover, setHover] = useState<Hover>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    // A drag that started inside Storm (selected text, a path) is not a drop
    // from outside and is left to the browser.
    let internal = false
    const onDragStart = (): void => {
      internal = true
    }
    const onDragEnd = (): void => {
      internal = false
    }
    const clearSoon = (): void => {
      if (timer.current) window.clearTimeout(timer.current)
      // dragover repeats every few dozen ms while the pointer is over the
      // window; when it stops, the drag has left or been dropped.
      timer.current = window.setTimeout(() => setHover(null), 180)
    }

    const onDragOver = (e: DragEvent): void => {
      const dt = e.dataTransfer
      if (internal || !dt || (!dragHasFiles(dt) && !dragLooksLikeImage(dt))) return
      if (!acceptDrag(e)) return
      const s = useStorm.getState()
      if (s.formOpen || s.confirmId) return
      setHover(s.selectedId && dragLooksLikeImage(dt) ? 'poster' : 'game')
      clearSoon()
    }

    const onDrop = (e: DragEvent): void => {
      const dt = e.dataTransfer
      if (internal) {
        internal = false
        return
      }
      if (!dt || (!dragHasFiles(dt) && !dragLooksLikeImage(dt))) return
      e.preventDefault()
      setHover(null)
      const s = useStorm.getState()
      if (s.formOpen || s.confirmId) return
      const snap = snapshotTransfer(dt)
      void (async () => {
        const games = gamePaths(snap)
        if (games.length > 0) {
          await s.addGameFiles(games)
          return
        }
        if (hasImage(snap)) {
          const name = s.mediaResult(await importImageFromSnapshot('covers', snap))
          if (!name) return
          const target = s.selectedId ? useStorm.getState().games.find((g) => g.id === s.selectedId) : undefined
          if (target) {
            await window.storm.saveGame({ id: target.id, cover: name })
            s.toast(s.t('toast.posterUpdated'), 'success')
          } else {
            s.openForm(null, { cover: name })
          }
          return
        }
        s.toast(s.t('toast.notGameFile'), 'error')
      })()
    }

    window.addEventListener('dragstart', onDragStart)
    window.addEventListener('dragend', onDragEnd)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragstart', onDragStart)
      window.removeEventListener('dragend', onDragEnd)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  return (
    <AnimatePresence>
      {hover && (
        <motion.div
          className="drop-layer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <motion.div
            className="drop-card"
            initial={{ scale: 0.94, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.96, y: 6 }}
            transition={{ type: 'spring', stiffness: 380, damping: 28 }}
          >
            <span className="drop-icon">{hover === 'poster' ? <ImageIcon size={28} /> : <DropIcon size={28} />}</span>
            <span className="drop-title">{hover === 'poster' ? t('drop.posterTitle') : t('drop.title')}</span>
            <span className="drop-sub">{hover === 'poster' ? t('drop.posterSubtitle') : t('drop.subtitle')}</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

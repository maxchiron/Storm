import { useState } from 'react'
import { motion } from 'framer-motion'
import { useT } from '../store/useStorm'
import type { MediaKind } from '@shared/types'
import { bannerSrc } from '../utils/format'
import {
  acceptDrag,
  dragHasFiles,
  dragLooksLikeImage,
  gamePaths,
  hasImage,
  snapshotTransfer,
  type TransferSnapshot
} from '../utils/transfer'
import Poster from './Poster'
import { CloseIcon, DropIcon, ImageIcon } from './icons'

interface Props {
  kind: MediaKind
  value: string | null
  /** game title, for the placeholder poster */
  title: string
  busy: boolean
  layoutId?: string
  onPick: () => void
  onClear: () => void
  /** an image was dropped onto this slot */
  onImage: (snap: TransferSnapshot) => void
  /** a game file was dropped onto this slot instead of an image */
  onGameFiles: (paths: string[]) => void
  /** extra controls under the slot's buttons */
  footer?: React.ReactNode
}

/**
 * A poster or wallpaper slot in the add/edit form. Click to browse, drop an
 * image (from Explorer or straight out of a web page), or focus it and press
 * Ctrl+V — the form routes pastes to whichever slot has focus.
 */
export default function MediaSlot(props: Props): React.JSX.Element {
  const { kind, value, title, busy } = props
  const t = useT()
  const [over, setOver] = useState(false)
  const isPoster = kind === 'covers'
  const [bannerFailed, setBannerFailed] = useState<string | null>(null)
  const banner = bannerSrc(value)

  const onDragOver = (e: React.DragEvent): void => {
    if (!dragHasFiles(e.dataTransfer) && !dragLooksLikeImage(e.dataTransfer)) return
    if (!acceptDrag(e)) return
    e.stopPropagation()
    if (!over) setOver(true)
  }

  const onDragLeave = (e: React.DragEvent): void => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
  }

  const onDrop = (e: React.DragEvent): void => {
    if (!dragHasFiles(e.dataTransfer) && !dragLooksLikeImage(e.dataTransfer)) return
    e.preventDefault()
    e.stopPropagation()
    setOver(false)
    const snap = snapshotTransfer(e.dataTransfer)
    const games = gamePaths(snap)
    if (games.length > 0 && !hasImage(snap)) props.onGameFiles(games)
    else props.onImage(snap)
  }

  const frame = (
    <div
      className={`slot-frame${over ? ' is-over' : ''}${busy ? ' is-busy' : ''}`}
      data-slot={kind}
      tabIndex={0}
      role="button"
      aria-label={isPoster ? t('form.cover') : t('form.wallpaper')}
      onClick={props.onPick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          props.onPick()
        }
      }}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isPoster ? (
        <Poster title={title} cover={value} />
      ) : banner && bannerFailed !== banner ? (
        <img src={banner} alt="" draggable={false} onError={() => setBannerFailed(banner)} />
      ) : null}
      <div className={`slot-hint${value ? ' slot-hint--overlay' : ''}`}>
        {over ? <DropIcon size={22} /> : <ImageIcon size={isPoster ? 22 : 18} />}
        <span>{busy ? t('form.importing') : over ? t('form.dropRelease') : t('form.dropImage')}</span>
      </div>
    </div>
  )

  return (
    <div className={`media-preview${isPoster ? '' : ' media-preview--wide'}`}>
      <span className="field-label">{isPoster ? t('form.cover') : t('form.wallpaper')}</span>
      {isPoster ? (
        <motion.div className="media-poster" layoutId={props.layoutId}>
          {frame}
        </motion.div>
      ) : (
        <div className="media-banner">{frame}</div>
      )}
      <div className="media-actions">
        <button type="button" className="btn btn--soft btn--block" onClick={props.onPick} disabled={busy}>
          <ImageIcon size={15} />
          {value ? t('form.replaceImage') : t('form.pickImage')}
        </button>
        {value && (
          <button
            type="button"
            className="btn btn--soft btn--icon"
            onClick={props.onClear}
            title={t('form.removeImage')}
          >
            <CloseIcon size={15} />
          </button>
        )}
      </div>
      {props.footer}
    </div>
  )
}

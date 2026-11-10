import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStorm, useT } from '../store/useStorm'
import type { ScreenshotInfo } from '@shared/types'
import { formatDateTime } from '../utils/format'
import { acceleratorLabel } from '../utils/accelerator'
import { comboKeys } from '../utils/gamepad'
import { EASE } from '../motion'
import { CameraIcon } from '../components/icons'
import { useHostLayer } from './input'
import { HostHints, PadGlyph, type Hint } from './Hints'
import { bump, sound, useHost, visibleShots } from './state'

/** What the album shows: every screenshot, one game's, or those taken on the desktop. */
type Filter = 'all' | 'desktop' | string

const MIN_TILE = 300

/** Every screenshot, newest first, in a grid — LB / RB narrow it down to one game. */
export default function HostAlbum(): React.JSX.Element {
  const t = useT()
  const games = useStorm((s) => s.games)
  const language = useStorm((s) => s.settings.language)
  const shotVersion = useStorm((s) => s.shotVersion)
  const hotkey = useStorm((s) => s.settings.screenshotHotkey)
  const combo = useStorm((s) => s.settings.screenshotPadCombo)
  const [all, setAll] = useState<ScreenshotInfo[] | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [index, setIndex] = useState(0)
  const [columns, setColumns] = useState(5)
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    void window.storm.listAllScreenshots().then((found) => {
      if (alive) setAll(found)
    })
    return () => {
      alive = false
    }
  }, [shotVersion])

  const shots = useMemo(() => visibleShots(all ?? [], games), [all, games])

  // The filters: all, then each game that has screenshots (most recent first), then the desktop.
  const filters = useMemo<Filter[]>(() => {
    const ids: string[] = []
    let desktop = false
    for (const s of shots) {
      if (!s.gameId) desktop = true
      else if (!ids.includes(s.gameId) && games.some((g) => g.id === s.gameId)) ids.push(s.gameId)
    }
    return ['all', ...ids, ...(desktop ? ['desktop'] : [])]
  }, [shots, games])

  const shown = useMemo(
    () => (filter === 'all' ? shots : shots.filter((s) => (filter === 'desktop' ? !s.gameId : s.gameId === filter))),
    [shots, filter]
  )
  const current = Math.min(index, Math.max(0, shown.length - 1))

  const filterName = (f: Filter): string =>
    f === 'all'
      ? t('host.albumAll')
      : f === 'desktop'
        ? t('shot.desktop')
        : (games.find((g) => g.id === f)?.title ?? t('common.unknown'))

  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const measure = (): void => setColumns(Math.max(2, Math.floor(el.clientWidth / MIN_TILE)))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [current, filter])

  const open = (i: number): void => {
    if (!shown[i]) return
    sound('open')
    useHost.getState().openViewer(shown, i)
  }

  const back = (): void => {
    sound('back')
    useHost.getState().go('home')
  }

  const step = (delta: number): void => {
    const next = current + delta
    if (next < 0 || next >= shown.length) return bump()
    setIndex(next)
    sound('move')
  }

  useHostLayer((action) => {
    switch (action) {
      case 'b':
        return back()
      case 'a':
        return open(current)
      case 'left':
        return step(-1)
      case 'right':
        return step(1)
      case 'up':
        return step(-columns)
      case 'down':
        // The last row may be short: going down from above it lands on its last picture.
        if (
          current + columns >= shown.length &&
          Math.floor(current / columns) < Math.floor((shown.length - 1) / columns)
        ) {
          setIndex(shown.length - 1)
          sound('move')
          return
        }
        return step(columns)
      case 'lb':
      case 'rb': {
        if (filters.length < 2) return bump()
        const i = filters.indexOf(filter)
        const next = filters[(i + (action === 'lb' ? -1 : 1) + filters.length) % filters.length]
        setFilter(next)
        setIndex(0)
        sound('tab')
        return
      }
      default:
        return
    }
  })

  const focused = shown[current]
  const focusedGame = focused?.gameId ? games.find((g) => g.id === focused.gameId) : undefined
  const shortcut = [hotkey ? acceleratorLabel(hotkey) : null, combo.length ? comboKeys(combo).join(' + ') : null]
    .filter(Boolean)
    .join(' / ')

  const hints: Hint[] = [
    ...(shown.length > 0
      ? [{ buttons: ['a'] as Hint['buttons'], label: t('host.view'), onClick: () => open(current) }]
      : []),
    ...(filters.length > 1 ? [{ buttons: ['lb', 'rb'] as Hint['buttons'], label: t('host.filter') }] : []),
    { buttons: ['b'], label: t('host.back'), onClick: back }
  ]

  return (
    <motion.div
      className="hpage halbum"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16, transition: { duration: 0.2 } }}
      transition={{ duration: 0.35, ease: EASE }}
    >
      <div className="halbum-head">
        <div className="halbum-filter">
          {filters.length > 1 && <PadGlyph button="lb" />}
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={filter}
              className="halbum-filter-name"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.16 }}
            >
              {filterName(filter)}
            </motion.span>
          </AnimatePresence>
          {filters.length > 1 && <PadGlyph button="rb" />}
          <span className="halbum-count">{shown.length}</span>
        </div>
        <AnimatePresence mode="wait" initial={false}>
          {focused && (
            <motion.span
              key={focused.id}
              className="halbum-caption"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.14 }}
            >
              {focusedGame?.title ?? t('shot.desktop')} · {formatDateTime(focused.takenAt, language, t)}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="halbum-grid" ref={gridRef} style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {all !== null && shown.length === 0 && (
          <div className="halbum-empty">
            <CameraIcon size={36} />
            <span className="hrow-empty-title">{t('host.noShots')}</span>
            <span className="hrow-empty-hint">
              {shortcut ? t('host.noShotsHint', { shortcut }) : t('detail.noScreenshotsOff')}
            </span>
          </div>
        )}
        {shown.map((shot, i) => {
          const isFocus = i === current
          return (
            <motion.button
              key={shot.id}
              type="button"
              tabIndex={-1}
              data-index={i}
              className={`hshot hshot--grid${isFocus ? ' is-focus' : ''}`}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0, scale: isFocus ? 1.05 : 1 }}
              transition={{
                scale: { type: 'spring', stiffness: 380, damping: 30 },
                opacity: { duration: 0.3, delay: Math.min(i, 15) * 0.025 },
                y: { duration: 0.35, ease: EASE, delay: Math.min(i, 15) * 0.025 }
              }}
              onClick={() => (isFocus ? open(i) : setIndex(i))}
            >
              {shot.thumbUrl ? (
                <img src={shot.thumbUrl} alt="" draggable={false} loading="lazy" />
              ) : (
                <CameraIcon size={22} />
              )}
            </motion.button>
          )
        })}
      </div>

      <HostHints hints={hints} />
    </motion.div>
  )
}

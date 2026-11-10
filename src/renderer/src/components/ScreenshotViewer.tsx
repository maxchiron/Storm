import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, type Variants } from 'framer-motion'
import type { ScreenshotInfo } from '@shared/types'
import { useStorm, useT } from '../store/useStorm'
import { formatDateTime } from '../utils/format'
import { leftStick, rightStick, triggers, useHostLayer, type HostAction } from '../host/input'
import { HostHints } from '../host/Hints'
import { bump, sound } from '../host/state'
import { EASE } from '../motion'
import {
  CameraIcon,
  ChevronIcon,
  CloseIcon,
  ExpandIcon,
  ExternalIcon,
  ShrinkIcon,
  ZoomInIcon,
  ZoomOutIcon
} from './icons'

/**
 * Storm's own screenshot viewer, for the gallery on a game's page and for
 * host mode's album. Pictures open in Storm, never in another program.
 *
 *   mouse      wheel zooms at the pointer, drag pans, double-click toggles zoom
 *   keyboard   ← → previous / next, + − 0 zoom, F full screen, Esc closes
 *   controller LB RB (or ← → unzoomed) previous / next, RT LT zoom,
 *              sticks pan, A toggles zoom, Y hides the captions, B closes
 */

interface Props {
  shots: ScreenshotInfo[]
  index: number
  onClose: () => void
  /** Driven by the controller (host mode) rather than the mouse. */
  host?: boolean
}

const MAX_ZOOM = 6
const STEP_ZOOM = 2.5
const IDLE_MS = 2800

const slide: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 80, scale: 0.98 }),
  center: { opacity: 1, x: 0, scale: 1, transition: { duration: 0.34, ease: EASE } },
  exit: (dir: number) => ({ opacity: 0, x: dir * -80, scale: 0.98, transition: { duration: 0.24, ease: EASE } })
}

interface Size {
  w: number
  h: number
}

/** The picture's size when it fits the stage — small pictures are scaled up to fill it too. */
function fitted(natural: Size | null, stage: Size): Size {
  if (!natural || !natural.w || !natural.h || !stage.w || !stage.h) return { w: 0, h: 0 }
  const scale = Math.min(stage.w / natural.w, stage.h / natural.h)
  return { w: natural.w * scale, h: natural.h * scale }
}

function clampPan(pan: { x: number; y: number }, zoom: number, fit: Size, stage: Size): { x: number; y: number } {
  const maxX = Math.max(0, (fit.w * zoom - stage.w) / 2)
  const maxY = Math.max(0, (fit.h * zoom - stage.h) / 2)
  return { x: Math.min(maxX, Math.max(-maxX, pan.x)), y: Math.min(maxY, Math.max(-maxY, pan.y)) }
}

function Slide({
  shot,
  dir,
  stage,
  zoom,
  pan,
  dragging,
  onNatural
}: {
  shot: ScreenshotInfo
  dir: number
  stage: Size
  zoom: number
  pan: { x: number; y: number }
  dragging: boolean
  onNatural: (id: string, size: Size | null) => void
}): React.JSX.Element {
  const t = useT()
  const [natural, setNatural] = useState<Size | null>(null)
  const [failed, setFailed] = useState(false)
  const fit = fitted(natural, stage)

  return (
    <motion.div className="viewer-slide" custom={dir} variants={slide} initial="enter" animate="center" exit="exit">
      {!natural && !failed && (
        <div className="viewer-loading">
          {shot.thumbUrl && <img className="viewer-thumb" src={shot.thumbUrl} alt="" draggable={false} />}
          <span className="viewer-spinner" />
        </div>
      )}
      {failed ? (
        <div className="viewer-failed">
          <CameraIcon size={34} />
          <span>{t('viewer.failed')}</span>
        </div>
      ) : (
        <img
          className={`viewer-img${natural ? ' is-loaded' : ''}${dragging ? ' is-dragging' : ''}`}
          src={shot.url}
          alt=""
          draggable={false}
          style={{
            width: fit.w || undefined,
            height: fit.h || undefined,
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`
          }}
          onLoad={(e) => {
            const size = { w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }
            setNatural(size)
            onNatural(shot.id, size)
          }}
          onError={() => {
            setFailed(true)
            onNatural(shot.id, null)
          }}
        />
      )}
    </motion.div>
  )
}

export default function ScreenshotViewer({ shots, index: start, onClose, host = false }: Props): React.JSX.Element {
  const t = useT()
  const games = useStorm((s) => s.games)
  const language = useStorm((s) => s.settings.language)
  const [index, setIndex] = useState(() => Math.min(Math.max(0, start), Math.max(0, shots.length - 1)))
  const [dir, setDir] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [naturals, setNaturals] = useState<Record<string, Size | null>>({})
  const [stage, setStage] = useState<Size>({ w: 0, h: 0 })
  const [chrome, setChrome] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const idleTimer = useRef<number | null>(null)
  const drag = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(null)

  const shot = shots[index] as ScreenshotInfo | undefined
  const natural = shot ? (naturals[shot.id] ?? null) : null
  const fit = fitted(natural, stage)

  // Kept in refs as well, for the controller loop that runs every frame.
  const view = useRef({ zoom, pan, fit, stage })
  view.current = { zoom, pan, fit, stage }

  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = (): void => setStage({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /** Show the captions and controls, and hide them again once nothing happens for a while. */
  const poke = useCallback(() => {
    setChrome(true)
    if (idleTimer.current) window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => setChrome(false), IDLE_MS)
  }, [])

  useEffect(() => {
    poke()
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current)
    }
  }, [poke])

  const go = useCallback(
    (next: number): boolean => {
      if (next < 0 || next >= shots.length || next === index) return false
      setDir(next > index ? 1 : -1)
      setIndex(next)
      setZoom(1)
      setPan({ x: 0, y: 0 })
      return true
    },
    [index, shots.length]
  )

  const zoomTo = useCallback((next: number, at?: { x: number; y: number }) => {
    const { zoom: z, pan: p, fit: f, stage: s } = view.current
    const z2 = Math.min(MAX_ZOOM, Math.max(1, next))
    if (z2 === z) return
    // Keep the point under the pointer (or the middle) where it is.
    const c = at ?? { x: 0, y: 0 }
    const p2 = { x: c.x - ((c.x - p.x) * z2) / z, y: c.y - ((c.y - p.y) * z2) / z }
    setZoom(z2)
    setPan(z2 === 1 ? { x: 0, y: 0 } : clampPan(p2, z2, f, s))
  }, [])

  const panBy = useCallback((dx: number, dy: number) => {
    const { zoom: z, pan: p, fit: f, stage: s } = view.current
    if (z <= 1) return
    setPan(clampPan({ x: p.x + dx, y: p.y + dy }, z, f, s))
  }, [])

  const close = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    onClose()
  }, [onClose])

  // Neighbours load ahead, so stepping through is instant.
  useEffect(() => {
    for (const i of [index - 1, index + 1]) {
      const neighbour = shots[i]
      if (neighbour) new Image().src = neighbour.url
    }
  }, [index, shots])

  // Centre the current thumbnail by scrolling the strip itself. scrollIntoView would also scroll
  // the viewer (its blurred backdrop overflows it), pushing the picture left near the end.
  useEffect(() => {
    const strip = stripRef.current
    const thumb = strip?.querySelector<HTMLElement>(`[data-index="${index}"]`)
    if (!strip || !thumb) return
    const s = strip.getBoundingClientRect()
    const r = thumb.getBoundingClientRect()
    strip.scrollTo({ left: strip.scrollLeft + r.left - s.left - (strip.clientWidth - r.width) / 2, behavior: 'smooth' })
  }, [index])

  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement === rootRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void rootRef.current?.requestFullscreen().catch(() => undefined)
  }, [])

  /* ------------------------------------------------------- keyboard */

  useEffect(() => {
    if (host) return
    const onKey = (e: KeyboardEvent): void => {
      let handled = true
      switch (e.key) {
        case 'Escape':
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
          else if (view.current.zoom > 1) zoomTo(1)
          else close()
          break
        case 'ArrowLeft':
          go(index - 1)
          break
        case 'ArrowRight':
          go(index + 1)
          break
        case 'Home':
          go(0)
          break
        case 'End':
          go(shots.length - 1)
          break
        case '+':
        case '=':
          zoomTo(view.current.zoom * 1.4)
          break
        case '-':
          zoomTo(view.current.zoom / 1.4)
          break
        case '0':
          zoomTo(1)
          break
        case 'f':
        case 'F':
          toggleFullscreen()
          break
        default:
          handled = false
      }
      if (!handled) return
      // The detail page underneath must not see this Escape, nor the wall these arrows.
      e.preventDefault()
      e.stopPropagation()
      poke()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [host, index, shots.length, go, zoomTo, close, toggleFullscreen, poke])

  /* ----------------------------------------------------- controller */

  useHostLayer(
    (action: HostAction) => {
      const zoomed = view.current.zoom > 1
      const step = 90
      switch (action) {
        case 'left':
        case 'right':
          if (zoomed) panBy(action === 'left' ? step : -step, 0)
          else if (go(index + (action === 'left' ? -1 : 1))) sound('move')
          else bump()
          break
        case 'up':
        case 'down':
          if (zoomed) panBy(0, action === 'up' ? step : -step)
          break
        case 'lb':
        case 'rb':
          if (go(index + (action === 'lb' ? -1 : 1))) sound('move')
          else bump()
          break
        case 'a':
          zoomTo(zoomed ? 1 : STEP_ZOOM)
          sound('select')
          break
        case 'y':
          setChrome((v) => !v)
          if (idleTimer.current) window.clearTimeout(idleTimer.current)
          return
        case 'b':
          if (zoomed) {
            zoomTo(1)
            sound('back')
          } else {
            sound('back')
            close()
          }
          return
        default:
          break
      }
      poke()
    },
    { priority: 20, enabled: host }
  )

  // Triggers zoom and the sticks pan, smoothly, for as long as they are held.
  useEffect(() => {
    if (!host) return
    let frame = 0
    const tick = (): void => {
      frame = requestAnimationFrame(tick)
      const { left, right } = triggers()
      const amount = (right > 0.1 ? right : 0) - (left > 0.1 ? left : 0)
      if (amount !== 0) zoomTo(view.current.zoom * (1 + amount * 0.035))
      const l = leftStick()
      const r = rightStick()
      const x = Math.abs(l.x) > Math.abs(r.x) ? l.x : r.x
      const y = Math.abs(l.y) > Math.abs(r.y) ? l.y : r.y
      if (view.current.zoom > 1 && (x || y)) panBy(-x * 16, -y * 16)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [host, zoomTo, panBy])

  /* ---------------------------------------------------------- mouse */

  const pointAt = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const rect = stageRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 }
  }

  const onWheel = (e: React.WheelEvent): void => {
    if (!natural) return
    zoomTo(view.current.zoom * Math.exp(-e.deltaY * 0.0016), pointAt(e))
    poke()
  }

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return
    drag.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y, moved: false }
    if (zoom > 1) {
      e.currentTarget.setPointerCapture(e.pointerId)
      setDragging(true)
    }
  }

  const onPointerMove = (e: React.PointerEvent): void => {
    poke()
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true
    if (zoom > 1) setPan(clampPan({ x: d.panX + dx, y: d.panY + dy }, zoom, fit, stage))
  }

  const onPointerUp = (e: React.PointerEvent): void => {
    const d = drag.current
    drag.current = null
    setDragging(false)
    // A plain click on the dark around an unzoomed picture closes the viewer.
    if (d && !d.moved && zoom === 1 && !(e.target instanceof HTMLImageElement)) close()
  }

  const onNatural = useCallback((id: string, size: Size | null) => {
    setNaturals((all) => (all[id] === size ? all : { ...all, [id]: size }))
  }, [])

  const game = shot?.gameId ? games.find((g) => g.id === shot.gameId) : undefined
  const title = game?.title ?? t('shot.desktop')
  const hdr = shot ? /\.jxr$/i.test(shot.file) : false
  const actualSize = natural && fit.w ? natural.w / fit.w : 1
  const percent = Math.round((fit.w && natural ? (fit.w * zoom) / natural.w : 1) * 100)

  const hints = useMemo(
    () =>
      host
        ? [
            { buttons: ['lb', 'rb'] as const, label: t('viewer.prevNext') },
            { buttons: ['lt', 'rt'] as const, label: t('viewer.zoom') },
            { buttons: ['a'] as const, label: zoom > 1 ? t('viewer.fit') : t('viewer.zoomIn') },
            { buttons: ['y'] as const, label: t('viewer.captions') },
            { buttons: ['b'] as const, label: t('host.back'), onClick: close }
          ].map((h) => ({ ...h, buttons: [...h.buttons] }))
        : [],
    [host, t, zoom, close]
  )

  return createPortal(
    <motion.div
      ref={rootRef}
      className={`viewer${host ? ' viewer--host' : ''}${chrome ? '' : ' viewer--bare'}${zoom > 1 ? ' is-zoomed' : ''}`}
      role="dialog"
      aria-modal="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      onMouseMove={poke}
    >
      {shot?.thumbUrl && (
        <AnimatePresence initial={false}>
          <motion.div
            key={shot.id}
            className="viewer-ambient"
            style={{ backgroundImage: `url("${shot.thumbUrl}")` }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          />
        </AnimatePresence>
      )}

      <div
        ref={stageRef}
        className="viewer-stage"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null
          setDragging(false)
        }}
        onDoubleClick={(e) => {
          if (host || !natural) return
          zoomTo(zoom > 1 ? 1 : Math.max(STEP_ZOOM, actualSize), pointAt(e))
        }}
      >
        <AnimatePresence initial={false} custom={dir}>
          {shot && (
            <Slide
              key={shot.id}
              shot={shot}
              dir={dir}
              stage={stage}
              zoom={zoom}
              pan={pan}
              dragging={dragging}
              onNatural={onNatural}
            />
          )}
        </AnimatePresence>
      </div>

      <motion.header
        className="viewer-bar"
        animate={{ opacity: chrome ? 1 : 0, y: chrome ? 0 : -12 }}
        transition={{ duration: 0.22 }}
      >
        <div className="viewer-caption">
          <span className="viewer-title">{title}</span>
          <span className="viewer-meta">
            {shot && formatDateTime(shot.takenAt, language, t)}
            {natural && (
              <>
                <span className="viewer-dot">·</span>
                {natural.w} × {natural.h}
              </>
            )}
            {hdr && (
              <>
                <span className="viewer-dot">·</span>
                <span className="viewer-badge" title={t('viewer.hdrCopy')}>
                  HDR
                </span>
              </>
            )}
          </span>
        </div>
        <span className="viewer-count">
          {index + 1} / {shots.length}
        </span>
        {!host && (
          <div className="viewer-tools">
            <button
              type="button"
              className="viewer-btn"
              title={t('viewer.zoomOut')}
              disabled={zoom <= 1}
              onClick={() => zoomTo(zoom / 1.4)}
            >
              <ZoomOutIcon size={17} />
            </button>
            <button
              type="button"
              className="viewer-zoom"
              title={zoom > 1 ? t('viewer.fit') : t('viewer.actual')}
              onClick={() => zoomTo(zoom > 1 ? 1 : Math.max(1.01, actualSize))}
            >
              {percent}%
            </button>
            <button
              type="button"
              className="viewer-btn"
              title={t('viewer.zoomIn')}
              disabled={zoom >= MAX_ZOOM}
              onClick={() => zoomTo(zoom * 1.4)}
            >
              <ZoomInIcon size={17} />
            </button>
            <span className="viewer-sep" />
            {shot && (
              <button
                type="button"
                className="viewer-btn"
                title={t('action.reveal')}
                onClick={() => void useStorm.getState().revealPath(shot.file)}
              >
                <ExternalIcon size={16} />
              </button>
            )}
            <button
              type="button"
              className="viewer-btn"
              title={fullscreen ? t('viewer.exitFullscreen') : t('viewer.fullscreen')}
              onClick={toggleFullscreen}
            >
              {fullscreen ? <ShrinkIcon size={16} /> : <ExpandIcon size={16} />}
            </button>
            <button type="button" className="viewer-btn viewer-btn--close" title={t('action.close')} onClick={close}>
              <CloseIcon size={17} />
            </button>
          </div>
        )}
      </motion.header>

      {!host && shots.length > 1 && (
        <>
          <button
            type="button"
            className="viewer-nav viewer-nav--prev"
            aria-label={t('viewer.prev')}
            disabled={index === 0}
            onClick={() => go(index - 1)}
          >
            <ChevronIcon size={26} />
          </button>
          <button
            type="button"
            className="viewer-nav viewer-nav--next"
            aria-label={t('viewer.next')}
            disabled={index === shots.length - 1}
            onClick={() => go(index + 1)}
          >
            <ChevronIcon size={26} />
          </button>
        </>
      )}

      <motion.footer
        className="viewer-foot"
        animate={{ opacity: chrome ? 1 : 0, y: chrome ? 0 : 16 }}
        transition={{ duration: 0.22 }}
      >
        {shots.length > 1 && (
          <div className="viewer-strip" ref={stripRef}>
            {shots.map((s, i) => (
              <button
                key={s.id}
                type="button"
                tabIndex={-1}
                data-index={i}
                className={`viewer-thumbnail${i === index ? ' is-current' : ''}`}
                onClick={() => go(i)}
              >
                {s.thumbUrl ? (
                  <img src={s.thumbUrl} alt="" draggable={false} loading="lazy" />
                ) : (
                  <CameraIcon size={16} />
                )}
              </button>
            ))}
          </div>
        )}
        {host && <HostHints hints={hints} className="hhints--viewer" />}
      </motion.footer>
    </motion.div>,
    document.body
  )
}

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStorm, useT } from '../store/useStorm'
import type { HotkeyState } from '@shared/types'
import { acceleratorFromEvent, acceleratorKeys } from '../utils/accelerator'
import { buttonName, comboKeys, connectedPads, pressedButtons } from '../utils/gamepad'
import { GamepadIcon, KeyboardIcon } from './icons'

function Keys({ keys, live }: { keys: string[]; live?: boolean }): React.JSX.Element {
  return (
    <span className={`keys${live ? ' keys--live' : ''}`}>
      {keys.map((k, i) => (
        <span key={`${k}-${i}`} className="keys-item">
          {i > 0 && <span className="keys-plus">+</span>}
          <kbd className="kbd">{k}</kbd>
        </span>
      ))}
    </span>
  )
}

/** The global screenshot hotkey: shows the current one, records a new one. */
export function HotkeyField({
  value,
  state,
  onChange
}: {
  value: string
  state: HotkeyState
  onChange: (accelerator: string) => void
}): React.JSX.Element {
  const t = useT()
  const [recording, setRecording] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!recording) return
    setInvalid(false)
    // While recording, the live hotkey must not swallow the very key being recorded.
    void window.storm.suspendHotkey(true)
    const finish = (accelerator?: string): void => {
      setRecording(false)
      if (accelerator !== undefined) onChangeRef.current(accelerator)
    }
    const handle = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      const result = acceleratorFromEvent(e)
      if (result.kind === 'pending') return
      if (result.kind === 'cancel') finish()
      else if (result.kind === 'clear') finish('')
      else if (result.kind === 'invalid') setInvalid(true)
      else finish(result.accelerator)
    }
    // Windows delivers Print Screen as a key-up only.
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'PrintScreen') handle(e)
    }
    const onBlur = (): void => setRecording(false)
    window.addEventListener('keydown', handle, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', handle, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
      void window.storm.suspendHotkey(false)
    }
  }, [recording])

  return (
    <div className="shortcut-row">
      <span className="shortcut-icon">
        <KeyboardIcon size={18} />
      </span>
      <span className="shortcut-text">
        <span className="toggle-label">{t('settings.hotkey')}</span>
        <span className={`toggle-hint${invalid ? ' is-error' : ''}`}>
          {recording
            ? invalid
              ? t('settings.hotkeyNeedsModifier')
              : t('settings.recordingHint')
            : t('settings.hotkeyHint')}
        </span>
      </span>
      <span className="shortcut-value">
        {recording ? (
          <span className="recording">
            <span className="recording-dot" />
            {t('settings.recording')}
          </span>
        ) : value ? (
          <>
            <Keys keys={acceleratorKeys(value)} />
            <span className={`status-pill status-pill--${state}`}>{t(`settings.hotkey.${state}`)}</span>
          </>
        ) : (
          <span className="muted">{t('settings.off')}</span>
        )}
      </span>
      <span className="shortcut-actions">
        {recording ? (
          <button type="button" className="btn btn--soft" onClick={() => setRecording(false)}>
            {t('action.cancel')}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn--soft" onClick={() => setRecording(true)}>
              {t('settings.record')}
            </button>
            {value && (
              <button type="button" className="btn btn--soft" onClick={() => onChange('')}>
                {t('settings.turnOff')}
              </button>
            )}
          </>
        )}
      </span>
    </div>
  )
}

/** The controller combo: hold buttons together, release, done. */
export function PadComboField({
  value,
  onChange
}: {
  value: number[]
  onChange: (combo: number[]) => void
}): React.JSX.Element {
  const t = useT()
  const setPadRecording = useStorm((s) => s.setPadRecording)
  const [recording, setRecording] = useState(false)
  const [live, setLive] = useState<number[]>([])
  const [hasPad, setHasPad] = useState(false)
  const [needsTwo, setNeedsTwo] = useState(false)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!recording) return
    setPadRecording(true)
    // The main process watches controllers too; recording L3 + R3 must not take a picture.
    void window.storm.suspendHotkey(true, 'pad')
    setNeedsTwo(false)
    let best: number[] = []
    let holding = false
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      const pads = connectedPads()
      setHasPad(pads.length > 0)
      let pressed: number[] = []
      for (const pad of pads) {
        const buttons = pressedButtons(pad)
        if (buttons.length > pressed.length) pressed = buttons
      }
      setLive(pressed)
      if (pressed.length > 0) {
        holding = true
        if (pressed.length >= best.length) best = pressed
      } else if (holding) {
        holding = false
        // One button alone would fire every time it is pressed in a game.
        if (best.length >= 2) {
          setRecording(false)
          onChangeRef.current(best.slice(0, 4))
          return
        }
        best = []
        setNeedsTwo(true)
      }
      if (Date.now() - startedAt > 20_000) setRecording(false)
    }, 40)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setRecording(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('keydown', onKey, true)
      setPadRecording(false)
      void window.storm.suspendHotkey(false, 'pad')
      setLive([])
    }
  }, [recording, setPadRecording])

  return (
    <div className="shortcut-row">
      <span className="shortcut-icon">
        <GamepadIcon size={18} />
      </span>
      <span className="shortcut-text">
        <span className="toggle-label">{t('settings.padCombo')}</span>
        <span className={`toggle-hint${needsTwo ? ' is-error' : ''}`}>
          {recording
            ? needsTwo
              ? t('settings.padNeedsTwo')
              : hasPad
                ? t('settings.padRecording')
                : t('settings.padWaiting')
            : t('settings.padComboHint')}
        </span>
      </span>
      <span className="shortcut-value">
        <AnimatePresence mode="wait" initial={false}>
          {recording ? (
            <motion.span
              key="rec"
              className="recording"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <span className="recording-dot" />
              {live.length > 0 ? <Keys keys={live.map(buttonName)} live /> : t('settings.recording')}
            </motion.span>
          ) : value.length > 0 ? (
            <motion.span key="val" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Keys keys={comboKeys(value)} />
            </motion.span>
          ) : (
            <motion.span
              key="off"
              className="muted"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {t('settings.off')}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className="shortcut-actions">
        {recording ? (
          <button type="button" className="btn btn--soft" onClick={() => setRecording(false)}>
            {t('action.cancel')}
          </button>
        ) : (
          <>
            <button type="button" className="btn btn--soft" onClick={() => setRecording(true)}>
              {t('settings.record')}
            </button>
            {value.length > 0 && (
              <button type="button" className="btn btn--soft" onClick={() => onChange([])}>
                {t('settings.turnOff')}
              </button>
            )}
          </>
        )}
      </span>
    </div>
  )
}

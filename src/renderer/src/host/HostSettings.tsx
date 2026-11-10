import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStorm, useT } from '../store/useStorm'
import { ACCENTS } from '@shared/types'
import { THEMES } from '@shared/themes'
import type { AppSettings } from '@shared/types'
import type { TranslationKey } from '@shared/i18n'
import { EASE } from '../motion'
import { ChevronIcon } from '../components/icons'
import { useHostLayer } from './input'
import { HostHints, type Hint } from './Hints'
import { bump, sound, useHost } from './state'

interface Choice<T> {
  value: T
  label: string
  /** A colour to show next to the label (themes, accents). */
  swatch?: string
}

interface Row {
  key: string
  label: string
  hint?: string
  choices: Choice<unknown>[]
  value: unknown
  apply: (value: unknown) => Partial<AppSettings>
}

interface Section {
  title: string
  rows: Row[]
}

/**
 * Settings that make sense with a controller in hand: every one is a choice
 * between a few values, changed with ← →. Anything that needs typing, a file
 * dialog or a recorded shortcut stays in PC mode.
 */
export default function HostSettings(): React.JSX.Element {
  const t = useT()
  const settings = useStorm((s) => s.settings)
  const update = useStorm((s) => s.updateSettings)
  const [focus, setFocus] = useState(0)
  const [version, setVersion] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.storm.appVersion().then(setVersion)
  }, [])

  const sections = useMemo<Section[]>(() => {
    const onOff = (key: keyof AppSettings, label: TranslationKey, hint?: TranslationKey): Row => ({
      key,
      label: t(label),
      hint: hint ? t(hint) : undefined,
      choices: [
        { value: false, label: t('host.off') },
        { value: true, label: t('host.on') }
      ],
      value: settings[key],
      apply: (value) => ({ [key]: value }) as Partial<AppSettings>
    })
    const accents: Choice<unknown>[] = ACCENTS.map((a) => ({ value: a.color, label: a.label, swatch: a.color }))
    if (!ACCENTS.some((a) => a.color === settings.accent)) {
      accents.unshift({ value: settings.accent, label: t('settings.customAccent'), swatch: settings.accent })
    }
    return [
      {
        title: t('settings.appearance'),
        rows: [
          {
            key: 'language',
            label: t('settings.language'),
            choices: [
              { value: 'zh', label: '简体中文' },
              { value: 'en', label: 'English' }
            ],
            value: settings.language,
            apply: (language) => ({ language: language as AppSettings['language'] })
          },
          {
            key: 'appearance',
            label: t('settings.mode'),
            choices: [
              { value: 'dark', label: t('mode.dark') },
              { value: 'light', label: t('mode.light') },
              { value: 'system', label: t('mode.system') }
            ],
            value: settings.appearance,
            apply: (appearance) => ({ appearance: appearance as AppSettings['appearance'] })
          },
          {
            key: 'theme',
            label: t('settings.theme'),
            choices: THEMES.map((theme) => ({
              value: theme.id,
              label: t(`theme.${theme.id}` as TranslationKey),
              swatch: theme.accent
            })),
            value: settings.theme,
            // A theme brings its own accent along, as it does in PC mode.
            apply: (theme) => ({
              theme: theme as AppSettings['theme'],
              accent: THEMES.find((x) => x.id === theme)?.accent ?? settings.accent
            })
          },
          {
            key: 'accent',
            label: t('settings.accent'),
            choices: accents,
            value: settings.accent,
            apply: (accent) => ({ accent: accent as string })
          },
          onOff('reduceMotion', 'settings.reduceMotion')
        ]
      },
      {
        title: t('host.title'),
        rows: [
          onOff('hostSounds', 'host.sounds', 'host.soundsHint'),
          onOff('startInHostMode', 'host.startIn', 'host.startInHint')
        ]
      },
      {
        title: t('settings.screenshots'),
        rows: [
          onOff('screenshotOnlyWhilePlaying', 'settings.onlyWhilePlaying', 'settings.onlyWhilePlayingHint'),
          {
            key: 'screenshotFormat',
            label: t('settings.shotFormat'),
            choices: [
              { value: 'png', label: t('settings.shotFormatPng') },
              { value: 'jpg', label: t('settings.shotFormatJpg') }
            ],
            value: settings.screenshotFormat,
            apply: (v) => ({ screenshotFormat: v as AppSettings['screenshotFormat'] })
          },
          {
            key: 'screenshotHdr',
            label: t('settings.shotHdr'),
            hint: t(settings.screenshotHdr === 'jxr' ? 'settings.shotHdrJxrHint' : 'settings.shotHdrSdrHint'),
            choices: [
              { value: 'sdr', label: t('settings.shotHdrSdr') },
              { value: 'jxr', label: t('settings.shotHdrJxr') }
            ],
            value: settings.screenshotHdr,
            apply: (v) => ({ screenshotHdr: v as AppSettings['screenshotHdr'] })
          },
          onOff('screenshotSound', 'settings.shotSound'),
          onOff('screenshotNotify', 'settings.shotNotify')
        ]
      }
    ]
  }, [settings, t])

  const rows = sections.flatMap((s) => s.rows)
  const row = rows[Math.min(focus, rows.length - 1)]

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.is-focus')
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [focus])

  /** Step the focused setting through its choices; `wrap` for A, which cycles round. */
  const change = (target: Row, delta: number, wrap = false): void => {
    const i = Math.max(
      0,
      target.choices.findIndex((c) => c.value === target.value)
    )
    let next = i + delta
    if (wrap) next = (next + target.choices.length) % target.choices.length
    if (next < 0 || next >= target.choices.length) return bump()
    sound('tab')
    void update(target.apply(target.choices[next].value))
  }

  const back = (): void => {
    sound('back')
    useHost.getState().go('home')
  }

  useHostLayer((action) => {
    switch (action) {
      case 'up':
      case 'down': {
        const next = focus + (action === 'up' ? -1 : 1)
        if (next < 0 || next >= rows.length) return bump()
        setFocus(next)
        sound('move')
        return
      }
      case 'left':
        return change(row, -1)
      case 'right':
        return change(row, 1)
      case 'a':
        return change(row, 1, true)
      case 'b':
        return back()
      default:
        return
    }
  })

  const hints: Hint[] = [
    { buttons: ['dpad'], label: t('host.change') },
    { buttons: ['a'], label: t('host.next'), onClick: () => change(row, 1, true) },
    { buttons: ['b'], label: t('host.back'), onClick: back }
  ]

  let n = -1
  return (
    <motion.div
      className="hpage hsettings"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16, transition: { duration: 0.2 } }}
      transition={{ duration: 0.35, ease: EASE }}
    >
      <div className="hsettings-list" ref={listRef}>
        {sections.map((section) => (
          <section key={section.title} className="hsettings-section">
            <h3 className="hsection-title">{section.title}</h3>
            {section.rows.map((r) => {
              n++
              const index = n
              const isFocus = index === focus
              const choice = r.choices.find((c) => c.value === r.value) ?? r.choices[0]
              const at = r.choices.indexOf(choice)
              return (
                <motion.div
                  key={r.key}
                  className={`hset${isFocus ? ' is-focus' : ''}`}
                  animate={{ scale: isFocus ? 1.015 : 1 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  onMouseEnter={() => setFocus(index)}
                >
                  <div className="hset-text">
                    <span className="hset-label">{r.label}</span>
                    <AnimatePresence initial={false}>
                      {isFocus && r.hint && (
                        <motion.span
                          className="hset-hint"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.2 }}
                        >
                          {r.hint}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                  <div className="hset-value">
                    <button
                      type="button"
                      tabIndex={-1}
                      className="hset-arrow hset-arrow--left"
                      disabled={at <= 0}
                      onClick={() => change(r, -1)}
                    >
                      <ChevronIcon size={16} />
                    </button>
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.span
                        key={String(choice.value)}
                        className={`hset-choice${typeof choice.value === 'boolean' ? (choice.value ? ' is-on' : ' is-off') : ''}`}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{ duration: 0.16 }}
                      >
                        {choice.swatch && <i className="hset-swatch" style={{ background: choice.swatch }} />}
                        {choice.label}
                      </motion.span>
                    </AnimatePresence>
                    <button
                      type="button"
                      tabIndex={-1}
                      className="hset-arrow"
                      disabled={at >= r.choices.length - 1}
                      onClick={() => change(r, 1)}
                    >
                      <ChevronIcon size={16} />
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </section>
        ))}
        <p className="hsettings-about">
          {t('host.readOnly')}
          <span>
            Storm {t('common.version')} {version}
          </span>
        </p>
      </div>
      <HostHints hints={hints} />
    </motion.div>
  )
}

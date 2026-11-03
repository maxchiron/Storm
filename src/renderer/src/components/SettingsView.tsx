import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useStorm, useT } from '../store/useStorm'
import { ACCENTS, POSTER_SIZES } from '@shared/types'
import { THEMES } from '@shared/themes'
import type { AppearanceMode, AppSettings, Language, ScreenshotFormat, ScreenshotHdr } from '@shared/types'
import type { TranslationKey } from '@shared/i18n'
import { accentTokens, resolveMode } from '../utils/theme'
import { fadeUp, SPRING_SOFT } from '../motion'
import { HotkeyField, PadComboField } from './ShortcutFields'
import {
  CameraIcon,
  CheckIcon,
  ExternalIcon,
  FolderIcon,
  MonitorIcon,
  MoonIcon,
  RefreshIcon,
  SparkIcon,
  SunIcon
} from './icons'

function Toggle({
  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  hint?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={`toggle${checked ? ' is-on' : ''}`}
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
    >
      <span className="toggle-track">
        <motion.span className="toggle-thumb" layout transition={SPRING_SOFT} />
      </span>
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {hint && <span className="toggle-hint">{hint}</span>}
      </span>
    </button>
  )
}

function Segmented<T extends string | number>({
  id,
  value,
  options,
  onChange
}: {
  id: string
  value: T
  options: { value: T; label: string; icon?: React.JSX.Element }[]
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className={`segment${value === option.value ? ' is-active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {value === option.value && (
            <motion.span className="segment-bg" layoutId={`segment-${id}`} transition={SPRING_SOFT} />
          )}
          <span className="segment-label">
            {option.icon}
            {option.label}
          </span>
        </button>
      ))}
    </div>
  )
}

function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="settings-row">
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {hint && <span className="toggle-hint">{hint}</span>}
      </span>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}

export default function SettingsView(): React.JSX.Element {
  const settings = useStorm((s) => s.settings)
  const update = useStorm((s) => s.updateSettings)
  const dataDir = useStorm((s) => s.dataDir)
  const hotkey = useStorm((s) => s.hotkey)
  const toast = useStorm((s) => s.toast)
  const openFolder = useStorm((s) => s.openFolder)
  const t = useT()
  const [version, setVersion] = useState('')
  const [, setSystemTick] = useState(0)

  useEffect(() => {
    void window.storm.appVersion().then(setVersion)
  }, [])

  // The theme tiles preview the scheme actually on screen, "System" included.
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => setSystemTick((n) => n + 1)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  const mode = resolveMode(settings.appearance)

  const patch = (value: Partial<AppSettings>): void => void update(value)

  const doExport = async (): Promise<void> => {
    const path = await window.storm.exportLibrary()
    if (path) toast(t('toast.exported'), 'success')
  }

  const doImport = async (): Promise<void> => {
    try {
      const snapshot = await window.storm.importLibrary()
      if (snapshot) toast(t('toast.imported'), 'success')
    } catch {
      toast(t('toast.importFailed'), 'error')
    }
  }

  // A failure is reported through storm:screenshot-failed, like a shortcut's.
  const testShot = (): void => void window.storm.takeScreenshot()

  const isPreset = ACCENTS.some((a) => a.color === settings.accent)

  return (
    <div className="settings">
      <motion.div className="settings-inner" variants={fadeUp} initial="hidden" animate="show">
        <section className="panel settings-panel">
          <h3 className="panel-title">{t('settings.appearance')}</h3>

          <Row label={t('settings.mode')}>
            <Segmented<AppearanceMode>
              id="mode"
              value={settings.appearance}
              onChange={(appearance) => patch({ appearance })}
              options={[
                { value: 'dark', label: t('mode.dark'), icon: <MoonIcon size={14} /> },
                { value: 'light', label: t('mode.light'), icon: <SunIcon size={14} /> },
                { value: 'system', label: t('mode.system'), icon: <MonitorIcon size={14} /> }
              ]}
            />
          </Row>

          <div className="settings-block">
            <span className="toggle-label">{t('settings.theme')}</span>
            <div className="theme-grid">
              {THEMES.map((theme) => {
                const palette = mode === 'light' ? theme.light : theme.dark
                const accent = accentTokens(theme.accent, mode, palette.bg[1]).accent
                const active = settings.theme === theme.id
                return (
                  <motion.button
                    key={theme.id}
                    type="button"
                    className={`theme-tile${active ? ' is-active' : ''}`}
                    onClick={() => patch({ theme: theme.id, accent: theme.accent })}
                    whileHover={{ y: -3 }}
                    whileTap={{ scale: 0.97 }}
                    style={
                      {
                        '--tile-bg0': palette.bg[0],
                        '--tile-bg1': palette.bg[1],
                        '--tile-bg2': palette.bg[2],
                        '--tile-g1': palette.glow[0],
                        '--tile-g2': palette.glow[1],
                        '--tile-accent': accent
                      } as React.CSSProperties
                    }
                  >
                    <span className={`theme-preview theme-preview--${mode}`}>
                      <span className="tp-glow" />
                      <span className="tp-side">
                        <i />
                        <i />
                        <i />
                      </span>
                      <span className="tp-wall">
                        <i />
                        <i />
                        <i />
                      </span>
                      <span className="tp-button" />
                    </span>
                    <span className="theme-name">
                      {t(`theme.${theme.id}` as TranslationKey)}
                      {active && <CheckIcon size={13} />}
                    </span>
                  </motion.button>
                )
              })}
            </div>
          </div>

          <Row label={t('settings.accent')}>
            <div className="swatches">
              {ACCENTS.map((accent) => (
                <button
                  key={accent.id}
                  type="button"
                  className={`swatch${settings.accent === accent.color ? ' is-active' : ''}`}
                  style={{ '--swatch': accent.color } as React.CSSProperties}
                  title={accent.label}
                  aria-label={accent.label}
                  onClick={() => patch({ accent: accent.color })}
                >
                  {settings.accent === accent.color && <CheckIcon size={14} />}
                </button>
              ))}
              <label
                className={`swatch swatch--custom${isPreset ? '' : ' is-active'}`}
                title={t('settings.customAccent')}
                style={{ '--swatch': settings.accent } as React.CSSProperties}
              >
                <input
                  type="color"
                  value={settings.accent}
                  aria-label={t('settings.customAccent')}
                  onChange={(e) => patch({ accent: e.target.value })}
                />
                {!isPreset && <CheckIcon size={14} />}
              </label>
            </div>
          </Row>

          <Row label={t('settings.posterSize')}>
            <Segmented
              id="poster"
              value={settings.posterSize}
              onChange={(posterSize) => patch({ posterSize })}
              options={POSTER_SIZES.map((size) => ({ value: size, label: size.toUpperCase() }))}
            />
          </Row>

          <Row label={t('settings.language')}>
            <Segmented<Language>
              id="lang"
              value={settings.language}
              onChange={(language) => patch({ language })}
              options={[
                { value: 'zh', label: '简体中文' },
                { value: 'en', label: 'English' }
              ]}
            />
          </Row>
        </section>

        <section className="panel settings-panel">
          <div className="panel-head">
            <h3 className="panel-title">{t('settings.screenshots')}</h3>
            <button type="button" className="btn btn--soft" onClick={testShot}>
              <CameraIcon size={14} />
              {t('settings.testShot')}
            </button>
          </div>
          <div className="settings-rows">
            <HotkeyField
              value={settings.screenshotHotkey}
              state={hotkey}
              onChange={(screenshotHotkey) => patch({ screenshotHotkey })}
            />
            <PadComboField
              value={settings.screenshotPadCombo}
              onChange={(screenshotPadCombo) => patch({ screenshotPadCombo })}
            />
            <Toggle
              checked={settings.screenshotOnlyWhilePlaying}
              onChange={(v) => patch({ screenshotOnlyWhilePlaying: v })}
              label={t('settings.onlyWhilePlaying')}
              hint={t('settings.onlyWhilePlayingHint')}
            />
            <Row label={t('settings.shotFolder')}>
              <div className="path-inline">
                <span className="path-inline-value" title={settings.screenshotDir}>
                  {settings.screenshotDir || 'Pictures\\Storm'}
                </span>
                <button
                  type="button"
                  className="btn btn--soft"
                  onClick={() =>
                    void window.storm.pickScreenshotDir().then((dir) => dir && patch({ screenshotDir: dir }))
                  }
                >
                  {t('action.browse')}
                </button>
                <button
                  type="button"
                  className="btn btn--soft btn--icon"
                  title={t('action.openScreenshots')}
                  onClick={() => void openFolder('screenshots')}
                >
                  <FolderIcon size={15} />
                </button>
              </div>
            </Row>
            <Row label={t('settings.shotFormat')}>
              <Segmented<ScreenshotFormat>
                id="shot-format"
                value={settings.screenshotFormat}
                onChange={(screenshotFormat) => patch({ screenshotFormat })}
                options={[
                  { value: 'png', label: t('settings.shotFormatPng') },
                  { value: 'jpg', label: t('settings.shotFormatJpg') }
                ]}
              />
            </Row>
            <Row
              label={t('settings.shotHdr')}
              hint={t(settings.screenshotHdr === 'jxr' ? 'settings.shotHdrJxrHint' : 'settings.shotHdrSdrHint')}
            >
              <Segmented<ScreenshotHdr>
                id="shot-hdr"
                value={settings.screenshotHdr}
                onChange={(screenshotHdr) => patch({ screenshotHdr })}
                options={[
                  { value: 'sdr', label: t('settings.shotHdrSdr') },
                  { value: 'jxr', label: t('settings.shotHdrJxr') }
                ]}
              />
            </Row>
            <Toggle
              checked={settings.screenshotSound}
              onChange={(v) => patch({ screenshotSound: v })}
              label={t('settings.shotSound')}
            />
            <Toggle
              checked={settings.screenshotNotify}
              onChange={(v) => patch({ screenshotNotify: v })}
              label={t('settings.shotNotify')}
            />
          </div>
        </section>

        <section className="panel settings-panel">
          <h3 className="panel-title">{t('settings.behaviour')}</h3>
          <div className="settings-rows">
            <Toggle
              checked={settings.minimizeToTray}
              onChange={(v) => patch({ minimizeToTray: v })}
              label={t('settings.minimizeToTray')}
              hint={t('settings.minimizeToTrayHint')}
            />
            <Toggle
              checked={settings.confirmBeforeDelete}
              onChange={(v) => patch({ confirmBeforeDelete: v })}
              label={t('settings.confirmDelete')}
            />
            <Toggle
              checked={settings.reduceMotion}
              onChange={(v) => patch({ reduceMotion: v })}
              label={t('settings.reduceMotion')}
            />
            <Row label={t('settings.scanInterval')}>
              <Segmented<number>
                id="scan"
                value={settings.scanIntervalSeconds}
                onChange={(scanIntervalSeconds) => patch({ scanIntervalSeconds })}
                options={[5, 10, 30, 60].map((s) => ({ value: s, label: `${s}s` }))}
              />
            </Row>
          </div>
        </section>

        <section className="panel settings-panel">
          <h3 className="panel-title">{t('settings.data')}</h3>
          <div className="path-inline">
            <span className="path-inline-value" title={dataDir}>
              {dataDir}
            </span>
            <button
              type="button"
              className="btn btn--soft btn--icon"
              title={t('action.openData')}
              onClick={() => void openFolder('data')}
            >
              <FolderIcon size={15} />
            </button>
          </div>
          <div className="settings-actions">
            <motion.button
              type="button"
              className="btn btn--ghost"
              onClick={() => void doExport()}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
            >
              <ExternalIcon size={15} />
              {t('settings.export')}
            </motion.button>
            <motion.button
              type="button"
              className="btn btn--ghost"
              onClick={() => void doImport()}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
            >
              <RefreshIcon size={15} />
              {t('settings.import')}
            </motion.button>
            <motion.button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                void window.storm.recheck().then(() => toast(t('toast.rechecked'), 'info'))
              }}
              whileHover={{ y: -1 }}
              whileTap={{ scale: 0.97 }}
            >
              <SparkIcon size={15} />
              {t('action.recheck')}
            </motion.button>
          </div>
        </section>

        <section className="panel settings-panel">
          <h3 className="panel-title">{t('settings.about')}</h3>
          <p className="panel-hint panel-hint--flush">{t('settings.aboutText')}</p>
          <p className="panel-hint">
            {t('common.version')} {version}
          </p>
        </section>
      </motion.div>
    </div>
  )
}

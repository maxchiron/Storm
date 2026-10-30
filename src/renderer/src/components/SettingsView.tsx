import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useStorm, useT } from '../store/useStorm'
import { ACCENTS, POSTER_SIZES } from '@shared/types'
import type { AppSettings, Language, PosterSize, ThemeName } from '@shared/types'
import type { TranslationKey } from '@shared/i18n'
import { fadeUp, SPRING_SOFT } from '../motion'
import { CheckIcon, ExternalIcon, FolderIcon, RefreshIcon, SparkIcon } from './icons'

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
    <button type="button" className={`toggle${checked ? ' is-on' : ''}`} onClick={() => onChange(!checked)}>
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

export default function SettingsView(): React.JSX.Element {
  const settings = useStorm((s) => s.settings)
  const update = useStorm((s) => s.updateSettings)
  const dataDir = useStorm((s) => s.dataDir)
  const toast = useStorm((s) => s.toast)
  const t = useT()
  const [version, setVersion] = useState('')

  useEffect(() => {
    void window.storm.appVersion().then(setVersion)
  }, [])

  const patch = (value: Partial<AppSettings>): void => {
    void window.storm.updateSettings(value).then((next) => useStorm.getState().setSettings(next))
  }

  const doExport = async (): Promise<void> => {
    const path = await window.storm.exportLibrary()
    if (path) toast(t('toast.exported'), 'success')
  }

  const doImport = async (): Promise<void> => {
    const snapshot = await window.storm.importLibrary()
    if (snapshot) {
      useStorm.getState().setGames(snapshot.games)
      useStorm.getState().setSettings(snapshot.settings)
      toast(t('toast.imported'), 'success')
    }
  }

  return (
    <div className="settings">
      <motion.div className="settings-inner" variants={fadeUp} initial="hidden" animate="show">
        <section className="panel settings-panel">
          <h3 className="panel-title">{t('settings.language')}</h3>
          <div className="segmented">
            {(['zh', 'en'] as Language[]).map((lang) => (
              <button
                key={lang}
                type="button"
                className={`segment${settings.language === lang ? ' is-active' : ''}`}
                onClick={() => patch({ language: lang })}
              >
                {settings.language === lang && (
                  <motion.span className="segment-bg" layoutId="segment-lang" transition={SPRING_SOFT} />
                )}
                <span className="segment-label">{lang === 'zh' ? '简体中文' : 'English'}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel settings-panel">
          <h3 className="panel-title">{t('settings.theme')}</h3>
          <div className="segmented">
            {(['storm', 'midnight', 'obsidian'] as ThemeName[]).map((theme) => (
              <button
                key={theme}
                type="button"
                className={`segment${settings.theme === theme ? ' is-active' : ''}`}
                onClick={() => patch({ theme })}
              >
                {settings.theme === theme && (
                  <motion.span className="segment-bg" layoutId="segment-theme" transition={SPRING_SOFT} />
                )}
                <span className="segment-label">{t(`theme.${theme}` as TranslationKey)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel settings-panel">
          <h3 className="panel-title">{t('settings.accent')}</h3>
          <div className="swatches">
            {ACCENTS.map((accent) => (
              <button
                key={accent.id}
                type="button"
                className={`swatch${settings.accent === accent.color ? ' is-active' : ''}`}
                style={{ '--swatch': accent.color } as React.CSSProperties}
                title={accent.label}
                onClick={() => patch({ accent: accent.color })}
              >
                {settings.accent === accent.color && <CheckIcon size={14} />}
              </button>
            ))}
          </div>
        </section>

        <section className="panel settings-panel">
          <h3 className="panel-title">{t('settings.posterSize')}</h3>
          <div className="segmented">
            {POSTER_SIZES.map((size: PosterSize) => (
              <button
                key={size}
                type="button"
                className={`segment${settings.posterSize === size ? ' is-active' : ''}`}
                onClick={() => patch({ posterSize: size })}
              >
                {settings.posterSize === size && (
                  <motion.span className="segment-bg" layoutId="segment-poster" transition={SPRING_SOFT} />
                )}
                <span className="segment-label">{size.toUpperCase()}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel settings-panel">
          <h3 className="panel-title">{t('settings.behaviour')}</h3>
          <div className="settings-rows">
            <Toggle
              checked={settings.minimizeToTray}
              onChange={(v) => patch({ minimizeToTray: v })}
              label={t('settings.minimizeToTray')}
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
            <label className="field field--inline">
              <span className="field-label">{t('settings.scanInterval')}</span>
              <select
                className="input input--select"
                value={settings.scanIntervalSeconds}
                onChange={(e) => patch({ scanIntervalSeconds: Number(e.target.value) })}
              >
                <option value={5}>5s</option>
                <option value={10}>10s</option>
                <option value={30}>30s</option>
                <option value={60}>60s</option>
              </select>
            </label>
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
              className="btn btn--soft"
              title={t('action.openData')}
              onClick={() => void window.storm.openFolder('data')}
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
                void window.storm.recheck()
                toast(t('toast.rechecked'), 'info')
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
          <p className="panel-hint">{t('settings.aboutText')}</p>
          <p className="panel-hint">
            {t('common.version')} {version}
          </p>
        </section>
      </motion.div>
    </div>
  )
}

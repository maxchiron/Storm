import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useStorm, useT } from '../store/useStorm'
import { bannerSrc, coverSrc, hueFromString, initials } from '../utils/format'
import { EASE, SPRING_SOFT } from '../motion'
import { CheckIcon, CloseIcon, FolderIcon, ImageIcon, PencilIcon, PlusIcon } from './icons'

interface FormState {
  title: string
  cover: string | null
  banner: string | null
  exePath: string
  installPath: string
  savePath: string
  tags: string
  note: string
  played: boolean
  favorite: boolean
  hidden: boolean
}

const EMPTY: FormState = {
  title: '',
  cover: null,
  banner: null,
  exePath: '',
  installPath: '',
  savePath: '',
  tags: '',
  note: '',
  played: false,
  favorite: false,
  hidden: false
}

function dirnameOf(p: string): string {
  const idx = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'))
  return idx > 0 ? p.slice(0, idx) : p
}

export default function GameForm(): React.JSX.Element {
  const formOpen = useStorm((s) => s.formOpen)
  const editingId = useStorm((s) => s.editingId)
  const games = useStorm((s) => s.games)
  const closeForm = useStorm((s) => s.closeForm)
  const toast = useStorm((s) => s.toast)
  const t = useT()

  const editing = useMemo(() => games.find((g) => g.id === editingId) ?? null, [games, editingId])
  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!formOpen) return
    setForm(
      editing
        ? {
            title: editing.title,
            cover: editing.cover,
            banner: editing.banner,
            exePath: editing.exePath ?? '',
            installPath: editing.installPath ?? '',
            savePath: editing.savePath ?? '',
            tags: editing.tags.join(', '),
            note: editing.note,
            played: editing.played,
            favorite: editing.favorite,
            hidden: editing.hidden
          }
        : { ...EMPTY }
    )
  }, [formOpen, editing])

  useEffect(() => {
    if (!formOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closeForm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [formOpen, closeForm])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm((f) => ({ ...f, [key]: value }))

  const pickCover = async (): Promise<void> => {
    const name = await window.storm.pickImage('covers')
    if (name) set('cover', name)
  }

  const pickBanner = async (): Promise<void> => {
    const name = await window.storm.pickImage('banners')
    if (name) set('banner', name)
  }

  const pickExe = async (): Promise<void> => {
    const path = await window.storm.pickExe(form.exePath || undefined)
    if (!path) return
    setForm((f) => ({
      ...f,
      exePath: path,
      installPath: f.installPath || dirnameOf(path)
    }))
  }

  const pickInstall = async (): Promise<void> => {
    const path = await window.storm.pickDirectory(form.installPath || undefined)
    if (path) set('installPath', path)
  }

  const pickSave = async (): Promise<void> => {
    const path = await window.storm.pickDirectory(form.savePath || undefined)
    if (path) set('savePath', path)
  }

  const submit = async (): Promise<void> => {
    if (!form.title.trim()) {
      toast(t('form.name'), 'error')
      return
    }
    setSaving(true)
    try {
      await window.storm.saveGame({
        id: editing?.id,
        title: form.title.trim(),
        cover: form.cover,
        banner: form.banner,
        exePath: form.exePath.trim() || null,
        installPath: form.installPath.trim() || null,
        savePath: form.savePath.trim() || null,
        tags: form.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean),
        note: form.note,
        played: form.played,
        favorite: form.favorite,
        hidden: form.hidden
      })
      toast(editing ? t('toast.saved') : t('toast.created'), 'success')
      closeForm()
    } catch {
      toast(t('toast.launchFailed'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const hue = hueFromString(form.title || 'Storm')
  const cover = coverSrc(form.cover)
  const banner = bannerSrc(form.banner)

  return (
    <AnimatePresence>
      {formOpen && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeForm()
          }}
        >
          <motion.div
            className="modal modal--form"
            initial={{ opacity: 0, y: 28, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={SPRING_SOFT}
          >
            <header className="modal-head">
              <div className="modal-title">
                {editing ? <PencilIcon size={17} /> : <PlusIcon size={17} />}
                <h2>{editing ? t('form.editGame') : t('form.newGame')}</h2>
              </div>
              <button type="button" className="icon-btn" onClick={closeForm} aria-label={t('action.close')}>
                <CloseIcon size={16} />
              </button>
            </header>

            <div className="modal-body form-grid">
              <aside className="form-media">
                <div className="media-preview">
                  <motion.div
                    className="media-poster"
                    layoutId={editing ? `poster-${editing.id}` : undefined}
                    whileHover={{ y: -3 }}
                  >
                    {cover ? (
                      <img src={cover} alt="" />
                    ) : (
                      <div
                        className="card-fallback"
                        style={{
                          background: `linear-gradient(150deg, hsl(${hue} 62% 34%), hsl(${(hue + 48) % 360} 58% 18%))`
                        }}
                      >
                        <span className="card-fallback-text">{initials(form.title || '?')}</span>
                      </div>
                    )}
                  </motion.div>
                  <div className="media-actions">
                    <button type="button" className="btn btn--soft btn--block" onClick={() => void pickCover()}>
                      <ImageIcon size={15} />
                      {form.cover ? t('form.replaceImage') : t('form.pickImage')}
                    </button>
                    {form.cover && (
                      <button type="button" className="btn btn--soft btn--block" onClick={() => set('cover', null)}>
                        <CloseIcon size={15} />
                        {t('form.removeImage')}
                      </button>
                    )}
                  </div>
                </div>

                <div className="media-preview media-preview--wide">
                  <div className="media-banner">
                    {banner ? (
                      <img src={banner} alt="" />
                    ) : (
                      <span className="media-banner-empty">{t('form.wallpaper')}</span>
                    )}
                  </div>
                  <div className="media-actions">
                    <button type="button" className="btn btn--soft btn--block" onClick={() => void pickBanner()}>
                      <ImageIcon size={15} />
                      {form.banner ? t('form.replaceImage') : t('form.pickImage')}
                    </button>
                    {form.banner && (
                      <button type="button" className="btn btn--soft btn--block" onClick={() => set('banner', null)}>
                        <CloseIcon size={15} />
                        {t('form.removeImage')}
                      </button>
                    )}
                  </div>
                </div>
              </aside>

              <div className="form-fields">
                <label className="field">
                  <span className="field-label">{t('form.name')}</span>
                  <input
                    className="input"
                    value={form.title}
                    placeholder={t('form.namePlaceholder')}
                    onChange={(e) => set('title', e.target.value)}
                    autoFocus
                  />
                </label>

                <label className="field">
                  <span className="field-label">{t('form.exe')}</span>
                  <div className="input-row">
                    <input
                      className="input"
                      value={form.exePath}
                      placeholder="C:\\Games\\Game\\game.exe"
                      onChange={(e) => set('exePath', e.target.value)}
                    />
                    <button type="button" className="btn btn--soft" onClick={() => void pickExe()}>
                      {t('action.browse')}
                    </button>
                  </div>
                  <span className="field-hint">{t('form.hint.exe')}</span>
                </label>

                <label className="field">
                  <span className="field-label">{t('form.installPath')}</span>
                  <div className="input-row">
                    <input
                      className="input"
                      value={form.installPath}
                      placeholder="C:\\Games\\Game"
                      onChange={(e) => set('installPath', e.target.value)}
                    />
                    <button type="button" className="btn btn--soft" onClick={() => void pickInstall()}>
                      <FolderIcon size={15} />
                    </button>
                  </div>
                  <span className="field-hint">{t('form.hint.install')}</span>
                </label>

                <label className="field">
                  <span className="field-label">{t('form.savePath')}</span>
                  <div className="input-row">
                    <input
                      className="input"
                      value={form.savePath}
                      placeholder="C:\\Users\\You\\Saved Games"
                      onChange={(e) => set('savePath', e.target.value)}
                    />
                    <button type="button" className="btn btn--soft" onClick={() => void pickSave()}>
                      <FolderIcon size={15} />
                    </button>
                  </div>
                  <span className="field-hint">{t('form.hint.save')}</span>
                </label>

                <label className="field">
                  <span className="field-label">{t('form.tags')}</span>
                  <input
                    className="input"
                    value={form.tags}
                    placeholder={t('form.tagsPlaceholder')}
                    onChange={(e) => set('tags', e.target.value)}
                  />
                </label>

                <label className="field">
                  <span className="field-label">{t('form.note')}</span>
                  <textarea
                    className="input input--area"
                    value={form.note}
                    placeholder={t('form.notePlaceholder')}
                    rows={3}
                    onChange={(e) => set('note', e.target.value)}
                  />
                </label>

                <div className="field field--row">
                  <button
                    type="button"
                    className={`toggle${form.played ? ' is-on' : ''}`}
                    onClick={() => set('played', !form.played)}
                  >
                    <span className="toggle-track">
                      <motion.span className="toggle-thumb" layout transition={SPRING_SOFT} />
                    </span>
                    {t('form.played')}
                  </button>
                  <button
                    type="button"
                    className={`toggle${form.favorite ? ' is-on' : ''}`}
                    onClick={() => set('favorite', !form.favorite)}
                  >
                    <span className="toggle-track">
                      <motion.span className="toggle-thumb" layout transition={SPRING_SOFT} />
                    </span>
                    {t('form.favorite')}
                  </button>
                  <button
                    type="button"
                    className={`toggle toggle--private${form.hidden ? ' is-on' : ''}`}
                    onClick={() => set('hidden', !form.hidden)}
                  >
                    <span className="toggle-track">
                      <motion.span className="toggle-thumb" layout transition={SPRING_SOFT} />
                    </span>
                    {t('form.hidden')}
                  </button>
                </div>
                <span className="field-hint">{t('form.hint.hidden')}</span>
              </div>
            </div>

            <footer className="modal-foot">
              <button type="button" className="btn btn--ghost" onClick={closeForm}>
                {t('action.cancel')}
              </button>
              <motion.button
                type="button"
                className="btn btn--primary"
                onClick={() => void submit()}
                disabled={saving}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
              >
                <CheckIcon size={16} />
                {editing ? t('action.save') : t('action.create')}
              </motion.button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

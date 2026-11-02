import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { samePath, useStorm, useT } from '../store/useStorm'
import type { Game, GameDraft, GameFileResult, MediaKind, MediaResult } from '@shared/types'
import { baseName } from '../utils/format'
import {
  acceptDrag,
  dragHasFiles,
  dragLooksLikeImage,
  gamePaths,
  hasImage,
  imageUrl,
  importImageFromSnapshot,
  snapshotTransfer,
  type TransferSnapshot
} from '../utils/transfer'
import { SPRING_SOFT } from '../motion'
import MediaSlot from './MediaSlot'
import { BoltIcon, CheckIcon, CloseIcon, ExternalIcon, FolderIcon, PencilIcon, PlusIcon, SearchIcon } from './icons'

interface FormState {
  title: string
  cover: string | null
  banner: string | null
  exePath: string
  args: string
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
  args: '',
  installPath: '',
  savePath: '',
  tags: '',
  note: '',
  played: false,
  favorite: false,
  hidden: false
}

function fromGame(game: Game): FormState {
  return {
    title: game.title,
    cover: game.cover,
    banner: game.banner,
    exePath: game.exePath ?? '',
    args: game.args,
    installPath: game.installPath ?? '',
    savePath: game.savePath ?? '',
    tags: game.tags.join(', '),
    note: game.note,
    played: game.played,
    favorite: game.favorite,
    hidden: game.hidden
  }
}

/** Tags are separated by commas — including the full-width ones a Chinese IME types. */
function parseTags(value: string): string[] {
  const seen = new Set<string>()
  return value
    .split(/[,，、;；]/)
    .map((tag) => tag.trim())
    .filter((tag) => {
      const key = tag.toLowerCase()
      if (!tag || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

export default function GameForm(): React.JSX.Element {
  const formOpen = useStorm((s) => s.formOpen)
  const editingId = useStorm((s) => s.editingId)
  const formSeed = useStorm((s) => s.formSeed)
  const editingExists = useStorm((s) => !s.editingId || s.games.some((g) => g.id === s.editingId))
  const closeForm = useStorm((s) => s.closeForm)
  const toast = useStorm((s) => s.toast)
  const mediaResult = useStorm((s) => s.mediaResult)
  const t = useT()

  const [form, setForm] = useState<FormState>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState<MediaKind | null>(null)
  const [filledFrom, setFilledFrom] = useState<string | null>(null)
  const [dropActive, setDropActive] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  /** Images imported while the form was open; the unused ones are deleted on close. */
  const imported = useRef<Record<MediaKind, string[]>>({ covers: [], banners: [] })
  /** The title came from a dropped file and has not been typed over since. */
  const autoTitle = useRef(false)
  const dropTimer = useRef<number | null>(null)
  const editing = editingId !== null

  // Fill the form when it opens (or switches to another game) — and only
  // then. It used to refill on every library update, so a session ending or
  // an install-status change in the background wiped what you were typing.
  useEffect(() => {
    if (!formOpen) return
    const state = useStorm.getState()
    const game = state.editingId ? state.games.find((g) => g.id === state.editingId) : undefined
    imported.current = { covers: [], banners: [] }
    autoTitle.current = false
    setFilledFrom(null)
    setBusy(null)
    if (game) {
      setForm(fromGame(game))
      return
    }
    let next: FormState = { ...EMPTY }
    const seed = state.formSeed
    if (seed?.draft) {
      next = applyDraft(next, seed.draft, true)
      autoTitle.current = true
      setFilledFrom(baseName(seed.draft.source))
    }
    if (seed?.cover) {
      next.cover = seed.cover
      imported.current.covers.push(seed.cover)
    }
    setForm(next)
  }, [formOpen, editingId, formSeed])

  // The game being edited was deleted (from the tray, another window…).
  useEffect(() => {
    if (formOpen && !editingExists) closeForm()
  }, [formOpen, editingExists, closeForm])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => setForm((f) => ({ ...f, [key]: value }))

  function applyDraft(current: FormState, draft: GameDraft, takeTitle: boolean): FormState {
    return {
      ...current,
      title: takeTitle || !current.title.trim() ? draft.title : current.title,
      exePath: draft.exePath,
      args: draft.args,
      installPath: draft.installPath || current.installPath
    }
  }

  const applyGameFile = (result: GameFileResult | undefined): void => {
    if (!result) return
    if (!result.ok) {
      const key =
        result.error === 'BROKEN_SHORTCUT'
          ? 'toast.brokenShortcut'
          : result.error === 'NOT_FOUND'
            ? 'toast.exeNotFound'
            : 'toast.notGameFile'
      toast(t(key), 'error')
      return
    }
    const { draft } = result
    const duplicate = useStorm.getState().games.find((g) => g.id !== editingId && samePath(g.exePath, draft.exePath))
    if (duplicate) toast(t('toast.gameExists', { title: duplicate.title }), 'info')
    const takeTitle = !editing && autoTitle.current
    setForm((f) => {
      const next = applyDraft(f, draft, takeTitle)
      if (next.title === draft.title && !editing) autoTitle.current = true
      return next
    })
    setFilledFrom(baseName(draft.source))
  }

  const fillFromFiles = async (paths: string[]): Promise<void> => {
    const [result] = await window.storm.inspectGameFiles(paths.slice(0, 1))
    applyGameFile(result)
  }

  const acceptImage = (kind: MediaKind, result: MediaResult | null): void => {
    const name = mediaResult(result)
    if (!name) return
    imported.current[kind].push(name)
    set(kind === 'covers' ? 'cover' : 'banner', name)
  }

  const importInto = async (kind: MediaKind, snap: TransferSnapshot): Promise<void> => {
    setBusy(kind)
    try {
      const result = await importImageFromSnapshot(kind, snap)
      if (result === null) toast(t('toast.imageUnsupported'), 'error')
      else acceptImage(kind, result)
    } finally {
      setBusy(null)
    }
  }

  const pickImage = async (kind: MediaKind): Promise<void> => {
    setBusy(kind)
    try {
      acceptImage(kind, await window.storm.pickImage(kind))
    } finally {
      setBusy(null)
    }
  }

  /** Delete images imported for this form that did not end up being used. */
  const discardUnused = (keep: { cover: string | null; banner: string | null }): void => {
    for (const name of imported.current.covers) if (name !== keep.cover) void window.storm.discardImage('covers', name)
    for (const name of imported.current.banners)
      if (name !== keep.banner) void window.storm.discardImage('banners', name)
    imported.current = { covers: [], banners: [] }
  }

  const close = (): void => closeForm()

  // However the form closes — Cancel, Escape (handled in App, so only the
  // topmost layer closes), a click outside — images imported for it and not
  // saved are deleted. After a save, `submit` has already kept the used ones.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !formOpen) discardUnused({ cover: null, banner: null })
    wasOpen.current = formOpen
  }, [formOpen])

  // Ctrl+V: an image (copied in a browser, or an image file copied in
  // Explorer) goes to the focused slot — the poster unless the wallpaper slot
  // has focus. Plain text pasted into a text field stays plain text.
  useEffect(() => {
    if (!formOpen) return
    const onPaste = (e: ClipboardEvent): void => {
      const snap = snapshotTransfer(e.clipboardData)
      const target = e.target instanceof HTMLElement ? e.target : null
      const inText = !!target?.closest('input, textarea, [contenteditable="true"]')
      const hasFile = snap.files.length > 0
      if (inText && !hasFile) return
      const games = gamePaths(snap)
      if (games.length > 0 && !hasImage(snap)) {
        e.preventDefault()
        void fillFromFiles(games)
        return
      }
      if (!hasFile && !imageUrl(snap)) return
      e.preventDefault()
      const kind: MediaKind = target?.closest('[data-slot="banners"]') ? 'banners' : 'covers'
      void importInto(kind, snap)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  })

  // Dropping anywhere else on the form: a game file fills the form, an image
  // becomes the poster.
  const onFormDragOver = (e: React.DragEvent): void => {
    if (!dragHasFiles(e.dataTransfer) && !dragLooksLikeImage(e.dataTransfer)) return
    if (!acceptDrag(e)) return
    e.stopPropagation()
    setDropActive(true)
    if (dropTimer.current) window.clearTimeout(dropTimer.current)
    dropTimer.current = window.setTimeout(() => setDropActive(false), 180)
  }

  const onFormDrop = (e: React.DragEvent): void => {
    if (!dragHasFiles(e.dataTransfer) && !dragLooksLikeImage(e.dataTransfer)) return
    e.preventDefault()
    e.stopPropagation()
    setDropActive(false)
    const snap = snapshotTransfer(e.dataTransfer)
    const games = gamePaths(snap)
    if (games.length > 0) void fillFromFiles(games)
    else if (hasImage(snap)) void importInto('covers', snap)
    else toast(t('toast.notGameFile'), 'error')
  }

  const pickExe = async (): Promise<void> => {
    applyGameFile((await window.storm.pickExe(form.exePath || undefined)) ?? undefined)
  }

  // Opens SteamGridDB in the browser; the poster found there can be dragged
  // (or copied and pasted) straight back into the slot above.
  const findPoster = async (): Promise<void> => {
    const opened = await window.storm.searchPoster(form.title)
    if (!opened) toast(t('toast.browserFailed'), 'error')
  }

  const pickInstall = async (): Promise<void> => {
    const path = await window.storm.pickDirectory(form.installPath || undefined)
    if (path) set('installPath', path)
  }

  const pickSave = async (): Promise<void> => {
    const path = await window.storm.pickDirectory(form.savePath || undefined)
    if (path) set('savePath', path)
  }

  const submit = async (e?: React.FormEvent): Promise<void> => {
    e?.preventDefault()
    if (saving) return
    if (!form.title.trim()) {
      toast(t('form.nameRequired'), 'error')
      titleRef.current?.focus()
      return
    }
    setSaving(true)
    try {
      await window.storm.saveGame({
        id: editingId ?? undefined,
        title: form.title.trim(),
        cover: form.cover,
        banner: form.banner,
        exePath: form.exePath.trim() || null,
        args: form.args.trim(),
        installPath: form.installPath.trim() || null,
        savePath: form.savePath.trim() || null,
        tags: parseTags(form.tags),
        note: form.note,
        played: form.played,
        favorite: form.favorite,
        hidden: form.hidden
      })
      discardUnused({ cover: form.cover, banner: form.banner })
      toast(editing ? t('toast.saved') : t('toast.created'), 'success')
      closeForm()
    } catch {
      toast(t('toast.saveFailed'), 'error')
    } finally {
      setSaving(false)
    }
  }

  const toggles: { key: 'played' | 'favorite' | 'hidden'; label: string; className?: string }[] = [
    { key: 'played', label: t('form.played') },
    { key: 'favorite', label: t('form.favorite') },
    { key: 'hidden', label: t('form.hidden'), className: 'toggle--private' }
  ]

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
            if (e.target === e.currentTarget) close()
          }}
          onDragOver={onFormDragOver}
          onDragEnter={onFormDragOver}
          onDrop={onFormDrop}
        >
          <motion.form
            className={`modal modal--form${dropActive ? ' is-drop-target' : ''}`}
            initial={{ opacity: 0, y: 28, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={SPRING_SOFT}
            onSubmit={(e) => void submit(e)}
          >
            <header className="modal-head">
              <div className="modal-title">
                {editing ? <PencilIcon size={17} /> : <PlusIcon size={17} />}
                <h2>{editing ? t('form.editGame') : t('form.newGame')}</h2>
              </div>
              <button type="button" className="icon-btn" onClick={close} aria-label={t('action.close')}>
                <CloseIcon size={16} />
              </button>
            </header>

            <div className="modal-body form-grid">
              <aside className="form-media">
                <MediaSlot
                  kind="covers"
                  value={form.cover}
                  title={form.title}
                  busy={busy === 'covers'}
                  layoutId={editingId ? `poster-${editingId}` : undefined}
                  onPick={() => void pickImage('covers')}
                  onClear={() => set('cover', null)}
                  onImage={(snap) => void importInto('covers', snap)}
                  onGameFiles={(paths) => void fillFromFiles(paths)}
                  footer={
                    <>
                      <button
                        type="button"
                        className="btn btn--soft btn--block btn--find"
                        disabled={!form.title.trim()}
                        onClick={() => void findPoster()}
                      >
                        <SearchIcon size={14} />
                        {t('form.findPoster')}
                        <ExternalIcon size={13} className="btn-trail" />
                      </button>
                      <span className="field-hint slot-note">
                        {form.title.trim() ? t('form.findPosterHint') : t('form.findPosterNeedsTitle')}
                      </span>
                    </>
                  }
                />
                <MediaSlot
                  kind="banners"
                  value={form.banner}
                  title={form.title}
                  busy={busy === 'banners'}
                  onPick={() => void pickImage('banners')}
                  onClear={() => set('banner', null)}
                  onImage={(snap) => void importInto('banners', snap)}
                  onGameFiles={(paths) => void fillFromFiles(paths)}
                />
              </aside>

              <div className="form-fields">
                {filledFrom ? (
                  <div className="form-note form-note--accent">
                    <BoltIcon size={15} />
                    <span>{t('form.filledFrom', { file: filledFrom })}</span>
                  </div>
                ) : (
                  !editing &&
                  !form.exePath && (
                    <div className="form-note">
                      <BoltIcon size={15} />
                      <span>{t('form.dropGameTip')}</span>
                    </div>
                  )
                )}

                <label className="field">
                  <span className="field-label">{t('form.name')}</span>
                  <input
                    ref={titleRef}
                    className="input"
                    value={form.title}
                    placeholder={t('form.namePlaceholder')}
                    onChange={(e) => {
                      autoTitle.current = false
                      set('title', e.target.value)
                    }}
                    autoFocus
                  />
                </label>

                <div className="field">
                  <span className="field-label">{t('form.exe')}</span>
                  <div className="input-row">
                    <input
                      className="input input--mono"
                      value={form.exePath}
                      placeholder="C:\Games\Game\game.exe"
                      onChange={(e) => set('exePath', e.target.value)}
                      spellCheck={false}
                    />
                    <button type="button" className="btn btn--soft" onClick={() => void pickExe()}>
                      {t('action.browse')}
                    </button>
                  </div>
                  <span className="field-hint">{t('form.hint.exe')}</span>
                </div>

                <label className="field">
                  <span className="field-label">{t('form.args')}</span>
                  <input
                    className="input input--mono"
                    value={form.args}
                    placeholder={t('form.argsPlaceholder')}
                    onChange={(e) => set('args', e.target.value)}
                    spellCheck={false}
                  />
                  <span className="field-hint">{t('form.hint.args')}</span>
                </label>

                <div className="field">
                  <span className="field-label">{t('form.installPath')}</span>
                  <div className="input-row">
                    <input
                      className="input input--mono"
                      value={form.installPath}
                      placeholder="C:\Games\Game"
                      onChange={(e) => set('installPath', e.target.value)}
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      className="btn btn--soft"
                      onClick={() => void pickInstall()}
                      title={t('action.browse')}
                    >
                      <FolderIcon size={15} />
                    </button>
                  </div>
                  <span className="field-hint">{t('form.hint.install')}</span>
                </div>

                <div className="field">
                  <span className="field-label">{t('form.savePath')}</span>
                  <div className="input-row">
                    <input
                      className="input input--mono"
                      value={form.savePath}
                      placeholder="C:\Users\You\Saved Games"
                      onChange={(e) => set('savePath', e.target.value)}
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      className="btn btn--soft"
                      onClick={() => void pickSave()}
                      title={t('action.browse')}
                    >
                      <FolderIcon size={15} />
                    </button>
                  </div>
                  <span className="field-hint">{t('form.hint.save')}</span>
                </div>

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
                  {toggles.map((toggle) => (
                    <button
                      key={toggle.key}
                      type="button"
                      className={`toggle${toggle.className ? ` ${toggle.className}` : ''}${form[toggle.key] ? ' is-on' : ''}`}
                      onClick={() => set(toggle.key, !form[toggle.key])}
                      aria-pressed={form[toggle.key]}
                    >
                      <span className="toggle-track">
                        <motion.span className="toggle-thumb" layout transition={SPRING_SOFT} />
                      </span>
                      {toggle.label}
                    </button>
                  ))}
                </div>
                <span className="field-hint">{t('form.hint.hidden')}</span>
              </div>
            </div>

            <footer className="modal-foot">
              <button type="button" className="btn btn--ghost" onClick={close}>
                {t('action.cancel')}
              </button>
              <motion.button
                type="submit"
                className="btn btn--primary"
                disabled={saving || busy !== null}
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.97 }}
              >
                <CheckIcon size={16} />
                {editing ? t('action.save') : t('action.create')}
              </motion.button>
            </footer>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

import { useEffect, useState } from 'react'
import { useStorm, useT } from '../store/useStorm'
import { CloseWindowIcon, HostIcon, MaximizeIcon, MinimizeIcon, RestoreIcon } from './icons'

/**
 * Host mode / minimise / maximise / close. They float above every layer —
 * the detail page, the add-game form, the drop overlay — so the window can
 * always be managed without backing out of whatever is open.
 */
export default function WindowControls(): React.JSX.Element {
  const t = useT()
  const ready = useStorm((s) => s.ready)
  // An open form would lose what was typed into it; it has to be saved or closed first.
  const busy = useStorm((s) => s.formOpen)
  const setHostMode = useStorm((s) => s.setHostMode)
  const [state, setState] = useState<'maximized' | 'normal'>('normal')

  useEffect(() => {
    void window.storm.windowState().then(setState)
    return window.storm.on('storm:window-state', (payload) =>
      setState(payload === 'maximized' ? 'maximized' : 'normal')
    )
  }, [])

  return (
    <div className="window-controls">
      {ready && (
        <button
          type="button"
          className="win-btn win-btn--host"
          disabled={busy}
          onClick={() => void setHostMode(true)}
          aria-label={t('action.hostMode')}
          title={busy ? t('action.hostModeBusy') : t('action.hostModeHint')}
        >
          <HostIcon size={15} />
        </button>
      )}
      <button
        type="button"
        className="win-btn"
        onClick={() => void window.storm.windowAction('minimize')}
        aria-label={t('action.minimize')}
        title={t('action.minimize')}
      >
        <MinimizeIcon size={14} />
      </button>
      <button
        type="button"
        className="win-btn"
        onClick={() => void window.storm.windowAction('maximize')}
        aria-label={state === 'maximized' ? t('action.restore') : t('action.maximize')}
        title={state === 'maximized' ? t('action.restore') : t('action.maximize')}
      >
        {state === 'maximized' ? <RestoreIcon size={14} /> : <MaximizeIcon size={14} />}
      </button>
      <button
        type="button"
        className="win-btn win-btn--close"
        onClick={() => void window.storm.windowAction('close')}
        aria-label={t('action.close')}
        title={t('action.close')}
      >
        <CloseWindowIcon size={14} />
      </button>
    </div>
  )
}

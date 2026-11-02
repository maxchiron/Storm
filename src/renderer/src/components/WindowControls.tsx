import { useEffect, useState } from 'react'
import { useT } from '../store/useStorm'
import { CloseWindowIcon, MaximizeIcon, MinimizeIcon, RestoreIcon } from './icons'

/**
 * Minimise / maximise / close. They float above every layer — the detail
 * page, the add-game form, the drop overlay — so the window can always be
 * managed without backing out of whatever is open.
 */
export default function WindowControls(): React.JSX.Element {
  const t = useT()
  const [state, setState] = useState<'maximized' | 'normal'>('normal')

  useEffect(() => {
    void window.storm.windowState().then(setState)
    return window.storm.on('storm:window-state', (payload) =>
      setState(payload === 'maximized' ? 'maximized' : 'normal')
    )
  }, [])

  return (
    <div className="window-controls">
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

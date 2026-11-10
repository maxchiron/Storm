import { motion } from 'framer-motion'

/** A controller button as drawn in the hints (Xbox layout, which the standard mapping follows). */
export type PadButton =
  'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'lt' | 'rt' | 'menu' | 'view' | 'dpad' | 'lstick' | 'rstick'

export function PadGlyph({ button }: { button: PadButton }): React.JSX.Element {
  switch (button) {
    case 'a':
    case 'b':
    case 'x':
    case 'y':
      return <span className={`glyph glyph--face glyph--${button}`}>{button.toUpperCase()}</span>
    case 'lb':
    case 'rb':
    case 'lt':
    case 'rt':
      return <span className="glyph glyph--shoulder">{button.toUpperCase()}</span>
    case 'menu':
      return (
        <span className="glyph glyph--face glyph--system" aria-label="Menu">
          <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 3h8M2 6h8M2 9h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>
      )
    case 'view':
      return (
        <span className="glyph glyph--face glyph--system" aria-label="View">
          <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
            <rect x="1.5" y="1.5" width="6" height="5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
            <rect x="4.5" y="5.5" width="6" height="5" rx="1" fill="currentColor" />
          </svg>
        </span>
      )
    case 'dpad':
      return (
        <span className="glyph glyph--dpad" aria-label="D-pad">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path
              d="M6.5 1.5h5v5h5v5h-5v5h-5v-5h-5v-5h5z"
              fill="currentColor"
              stroke="currentColor"
              strokeWidth="0.6"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      )
    case 'lstick':
    case 'rstick':
      return <span className="glyph glyph--stick">{button === 'lstick' ? 'L' : 'R'}</span>
  }
}

export interface Hint {
  buttons: PadButton[]
  label: string
  /** Lets the hint be clicked, for whoever reaches for the mouse. */
  onClick?: () => void
}

/** The strip of button hints along the bottom of a host screen. */
export function HostHints({ hints, className }: { hints: Hint[]; className?: string }): React.JSX.Element {
  return (
    <motion.div
      className={`hhints${className ? ` ${className}` : ''}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.25 }}
    >
      {hints.map((hint) => (
        <button
          key={hint.label}
          type="button"
          tabIndex={-1}
          className="hhint"
          onClick={hint.onClick}
          disabled={!hint.onClick}
        >
          {hint.buttons.map((b) => (
            <PadGlyph key={b} button={b} />
          ))}
          <span className="hhint-label">{hint.label}</span>
        </button>
      ))}
    </motion.div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { coverSrc, hueFromString, initials } from '../utils/format'

interface Props {
  title: string
  cover: string | null | undefined
  imgClassName?: string
  lazy?: boolean
}

/**
 * A poster image, or a generated placeholder when there is none — or when
 * the file is missing (a library imported from another PC, a deleted file).
 */
export default function Poster({ title, cover, imgClassName, lazy }: Props): React.JSX.Element {
  const src = coverSrc(cover)
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  const hue = useMemo(() => hueFromString(title || 'Storm'), [title])

  if (src && !failed) {
    return (
      <img
        className={imgClassName}
        src={src}
        alt={title}
        loading={lazy ? 'lazy' : undefined}
        draggable={false}
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <div
      className="card-fallback"
      style={{
        background: `linear-gradient(150deg, hsl(${hue} 62% 34%), hsl(${(hue + 48) % 360} 58% 18%))`
      }}
    >
      <span className="card-fallback-text">{initials(title || '?')}</span>
    </div>
  )
}

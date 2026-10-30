import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 18, children, ...rest }: IconProps & { children: React.ReactNode }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const PlayIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor" stroke="none" />
  </Icon>
)

export const PauseIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" />
    <rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" />
  </Icon>
)

export const PlusIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const PencilIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M4 20h4l10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 16.5 4 20Z" />
    <path d="M14.5 6.5 17.5 9.5" />
  </Icon>
)

export const TrashIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
    <path d="M10 11v6M14 11v6" />
  </Icon>
)

export const FolderIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h9A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V7.5Z" />
  </Icon>
)

export const HeartIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M12 20s-7-4.35-7-9.5A3.9 3.9 0 0 1 12 8a3.9 3.9 0 0 1 7 2.5c0 5.15-7 9.5-7 9.5Z" />
  </Icon>
)

export const SearchIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Icon>
)

export const SettingsIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .32 1.77l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-1 1.47V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1.05-1.46 1.6 1.6 0 0 0-1.77.32l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.6 1.6 0 0 0 4.8 15a1.6 1.6 0 0 0-1.47-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.56 9a1.6 1.6 0 0 0-.32-1.77l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.6 1.6 0 0 0 9 4.8a1.6 1.6 0 0 0 1-1.47V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.6 1.6 0 0 0 19.2 9v.01a1.6 1.6 0 0 0 1.47 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
  </Icon>
)

export const GridIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
  </Icon>
)

export const ChevronIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="m9 5 7 7-7 7" />
  </Icon>
)

export const CloseIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M6 6 18 18M18 6 6 18" />
  </Icon>
)

export const CheckIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="m4.5 12.5 5 5 10-11" />
  </Icon>
)

export const ExternalIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M14 4h6v6" />
    <path d="M20 4 11 13" />
    <path d="M18 14v5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10" />
  </Icon>
)

export const CopyIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4.5A1.5 1.5 0 0 1 3 13.5v-9A1.5 1.5 0 0 1 4.5 3h9A1.5 1.5 0 0 1 15 4.5V5" />
  </Icon>
)

export const RefreshIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M20 11a8 8 0 1 0-.6 4" />
    <path d="M20 4v7h-7" />
  </Icon>
)

export const ImageIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="m4 17 5-4.5 3.5 3 3-2.5L20 17" />
  </Icon>
)

export const SparkIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M12 3.5 13.8 9l5.7 1.8-5.7 1.8L12 18.2l-1.8-5.6L4.5 10.8 10.2 9 12 3.5Z" />
  </Icon>
)

export const ClockIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Icon>
)

export const BoltIcon = (p: IconProps): React.JSX.Element => (
  <Icon {...p}>
    <path d="M13.5 2.5 4.8 13.2a.7.7 0 0 0 .55 1.13H10l-.5 7.2 8.7-10.7a.7.7 0 0 0-.55-1.13H13l.5-7.2Z" fill="currentColor" stroke="none" />
  </Icon>
)

export const MinimizeIcon = (p: IconProps): React.JSX.Element => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 14 14" aria-hidden="true" {...p}>
    <rect x="3" y="6.4" width="8" height="1.2" rx="0.6" fill="currentColor" />
  </svg>
)

export const MaximizeIcon = (p: IconProps): React.JSX.Element => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 14 14" aria-hidden="true" {...p}>
    <rect x="3.2" y="3.2" width="7.6" height="7.6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.2" />
  </svg>
)

export const RestoreIcon = (p: IconProps): React.JSX.Element => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 14 14" aria-hidden="true" {...p}>
    <rect x="2.4" y="4.4" width="7" height="7" rx="1.3" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <path d="M5 4.4V3.4A1 1 0 0 1 6 2.4h5.6A1 1 0 0 1 12.6 3.4V9a1 1 0 0 1-1 1h-1" fill="none" stroke="currentColor" strokeWidth="1.2" />
  </svg>
)

export const CloseWindowIcon = (p: IconProps): React.JSX.Element => (
  <svg width={p.size ?? 14} height={p.size ?? 14} viewBox="0 0 14 14" aria-hidden="true" {...p}>
    <path d="M3.4 3.4 10.6 10.6M10.6 3.4 3.4 10.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
)

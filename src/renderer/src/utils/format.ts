import type { Language } from '@shared/types'
import type { TranslationKey } from '@shared/i18n'

type T = (key: TranslationKey) => string

export function coverSrc(name: string | null | undefined): string | null {
  return name ? `storm://asset/covers/${encodeURIComponent(name)}` : null
}

/**
 * Shortens a long path from the middle, keeping the drive and the file name —
 * the two ends you actually need to recognise it.
 */
export function truncatePath(value: string, max = 64): string {
  if (value.length <= max) return value
  const head = Math.max(12, Math.floor(max * 0.4))
  const tail = Math.max(12, max - head - 1)
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

export function bannerSrc(name: string | null | undefined): string | null {
  return name ? `storm://asset/banners/${encodeURIComponent(name)}` : null
}

/** The last part of a path, whichever slash it uses. */
export function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p
}

/** Deterministic hue from a title, so placeholder posters look intentional. */
export function hueFromString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i++) hash = (hash * 31 + value.charCodeAt(i)) % 360
  return hash
}

export function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

export function formatPlaytime(minutes: number, t: T): string {
  if (!minutes || minutes < 1) return `0 ${t('common.minutes')}`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) return `${mins} ${t('common.minutes')}`
  if (mins === 0) return `${hours} ${t('common.hours')}`
  return `${hours} ${t('common.hours')} ${mins} ${t('common.minutes')}`
}

export function formatDate(iso: string | null, language: Language, t: T): string {
  if (!iso) return t('common.never')
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return t('common.unknown')
  try {
    return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    }).format(date)
  } catch {
    return date.toLocaleDateString()
  }
}

export function formatDateTime(iso: string | null, language: Language, t: T): string {
  if (!iso) return t('common.never')
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return t('common.unknown')
  try {
    return new Intl.DateTimeFormat(language === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date)
  } catch {
    return date.toLocaleString()
  }
}

/** Elapsed time of a live session, e.g. "1h 24m". */
export function formatElapsed(startedAt: string, t: T): string {
  const ms = Date.now() - new Date(startedAt).getTime()
  if (Number.isNaN(ms) || ms < 0) return `0 ${t('common.minutes')}`
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  if (hours === 0) return `${mins} ${t('common.minutes')}`
  return `${hours} ${t('common.hours')} ${mins} ${t('common.minutes')}`
}

/** "3 days ago", "yesterday", "just now" — or the date, once it is more than a few weeks back. */
export function formatRelative(iso: string | null, language: Language, t: T): string {
  if (!iso) return t('common.never')
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return t('common.unknown')
  const seconds = (Date.now() - then) / 1000
  if (seconds < 0 || seconds > 28 * 86400) return formatDate(iso, language, t)
  try {
    const rtf = new Intl.RelativeTimeFormat(language === 'zh' ? 'zh-CN' : 'en', { numeric: 'auto' })
    if (seconds < 60) return rtf.format(0, 'second')
    if (seconds < 3600) return rtf.format(-Math.floor(seconds / 60), 'minute')
    if (seconds < 86400) return rtf.format(-Math.floor(seconds / 3600), 'hour')
    if (seconds < 7 * 86400) return rtf.format(-Math.floor(seconds / 86400), 'day')
    return rtf.format(-Math.floor(seconds / (7 * 86400)), 'week')
  } catch {
    return formatDate(iso, language, t)
  }
}

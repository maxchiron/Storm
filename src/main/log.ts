import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/**
 * storm.log in the data folder, for what goes wrong out of sight — mostly the
 * screenshot shortcuts, which do their work behind a game where no toast can
 * be seen. One older generation is kept as storm.old.log.
 */

const MAX_BYTES = 512 * 1024

let file: string | null = null

function describe(detail: unknown): string {
  if (detail === undefined) return ''
  return `: ${detail instanceof Error ? detail.message : String(detail)}`
}

export function log(scope: string, message: string, detail?: unknown): void {
  const line = `${new Date().toISOString()} [${scope}] ${message}${describe(detail)}`
  if (!app.isPackaged) console.log(`[storm] ${line}`)
  try {
    file ??= path.join(app.getPath('userData'), 'storm.log')
    try {
      if (fs.statSync(file).size > MAX_BYTES) fs.renameSync(file, file.replace(/\.log$/, '.old.log'))
    } catch {
      /* no log yet */
    }
    fs.appendFileSync(file, `${line}\n`)
  } catch {
    /* logging never gets in the way */
  }
}

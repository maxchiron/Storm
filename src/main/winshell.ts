import { shell } from 'electron'
import { log } from './log'

/**
 * Starting a program the way a double-click in Explorer does — through the
 * shell rather than CreateProcess.
 *
 * CreateProcess (behind child_process.spawn) refuses anything that has to
 * run elevated, a game set to "Run this program as an administrator" above
 * all: it fails with ERROR_ELEVATION_REQUIRED where Explorer shows the UAC
 * prompt. The shell does the same as Explorer.
 *
 * Without arguments, Electron's shell.openPath is exactly that: ShellExecuteEx
 * with the program's own folder as the working directory, on a COM-ready
 * worker thread. It cannot pass arguments, so a game that has some goes
 * through ShellExecuteW itself, also off the main thread — a UAC prompt can
 * stay up for as long as the player likes without freezing Storm.
 */

const SW_SHOWNORMAL = 1

type AsyncCall = (...args: unknown[]) => void
let shellExecuteW: { async: AsyncCall } | null | undefined

function binding(): { async: AsyncCall } | null {
  if (shellExecuteW !== undefined) return shellExecuteW
  shellExecuteW = null
  if (process.platform !== 'win32') return shellExecuteW
  try {
    const koffi = require('koffi') as typeof import('koffi')
    shellExecuteW = koffi
      .load('shell32.dll')
      .func(
        'intptr_t __stdcall ShellExecuteW(void *hwnd, str16 lpOperation, str16 lpFile, str16 lpParameters, str16 lpDirectory, int nShowCmd)'
      ) as unknown as { async: AsyncCall }
  } catch (err) {
    log('launch', 'ShellExecuteW unavailable', err)
  }
  return shellExecuteW
}

/** One argument quoted for a Windows command line (the CommandLineToArgvW rules). */
export function quoteArg(arg: string): string {
  if (arg && !/[\s"]/.test(arg)) return arg
  // Backslashes are literal unless they precede a quote, so double the ones
  // that do — including the run at the end, which precedes the closing quote.
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`
}

/** Start a program through the shell; resolves to an error description, or '' once it has started. */
export async function shellStart(file: string, args: string[], directory: string): Promise<string> {
  if (args.length === 0) return shell.openPath(file)

  const fn = binding()
  if (!fn) return 'ShellExecuteW unavailable'
  const parameters = args.map(quoteArg).join(' ')
  const code = await new Promise<number>((resolve, reject) => {
    fn.async(null, 'open', file, parameters, directory, SW_SHOWNORMAL, (err: unknown, res: unknown) =>
      err ? reject(err) : resolve(Number(res))
    )
  }).catch((err: unknown) => {
    log('launch', 'ShellExecuteW failed', err)
    return 0
  })
  // Above 32 means started. 5 is "access denied" — also what declining the UAC prompt gives.
  return code > 32 ? '' : `ShellExecuteW returned ${code}`
}

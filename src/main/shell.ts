import { shell } from 'electron'
import path from 'node:path'
import fsp from 'node:fs/promises'

/** Open a folder in the OS file manager. */
export async function openFolder(target: string): Promise<boolean> {
  if (!target) return false
  try {
    const stat = await fsp.stat(target)
    if (!stat.isDirectory()) {
      return revealFile(target)
    }
  } catch {
    return false
  }
  const error = await shell.openPath(target)
  return !error
}

/** Show a file inside the OS file manager (selecting it). */
export async function revealFile(target: string): Promise<boolean> {
  if (!target) return false
  try {
    await fsp.stat(target)
  } catch {
    return false
  }
  shell.showItemInFolder(target)
  return true
}

/** Open a file with its default application. */
export async function openFile(target: string): Promise<boolean> {
  if (!target) return false
  try {
    await fsp.stat(target)
  } catch {
    return false
  }
  const error = await shell.openPath(target)
  return !error
}

export function dirnameOf(p: string): string {
  return path.dirname(p)
}

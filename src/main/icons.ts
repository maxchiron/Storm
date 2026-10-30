import { nativeImage } from 'electron'
import { encodePng } from './png'
import { renderBolt } from '@shared/bolt-renderer.js'

/** A native image of the Storm bolt in the given accent colour. */
export function createIcon(hex: string, size = 16): Electron.NativeImage {
  const png = encodePng(size, size, renderBolt(size, hex))
  const image = nativeImage.createFromBuffer(png)
  image.setTemplateImage(false)
  return image
}

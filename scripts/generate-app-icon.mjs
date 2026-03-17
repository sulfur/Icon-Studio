import fs from 'node:fs/promises'
import path from 'node:path'

import pngToIco from 'png-to-ico'
import sharp from 'sharp'

const projectRoot = process.cwd()
const sourceIconPath = path.join(projectRoot, 'web', 'public', 'favicon.png')
const buildDir = path.join(projectRoot, 'build')
const iconIcoPath = path.join(buildDir, 'icon.ico')
const iconPngPath = path.join(buildDir, 'icon.png')
const appIconPath = path.join(projectRoot, 'web', 'public', 'app-icon.png')
const trayIconPath = path.join(projectRoot, 'web', 'public', 'tray-icon.png')
const sizes = [16, 24, 32, 48, 64, 128, 256]

await fs.mkdir(buildDir, { recursive: true })

const sourceBuffer = await fs.readFile(sourceIconPath)
const trimmedSource = await sharp(sourceBuffer).trim().png().toBuffer()
const appSource = await sharp(trimmedSource)
  .resize(256, 256, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .png()
  .toBuffer()
const traySource = await sharp(trimmedSource)
  .resize(64, 64, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .sharpen({ sigma: 0.8 })
  .png()
  .toBuffer()
const pngBuffers = await Promise.all(
  sizes.map((size) =>
    sharp(trimmedSource)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer(),
  ),
)

const icoBuffer = await pngToIco(pngBuffers)

await fs.writeFile(iconIcoPath, icoBuffer)
await fs.writeFile(iconPngPath, appSource)
await fs.writeFile(appIconPath, appSource)
await fs.writeFile(trayIconPath, traySource)

console.log(`Generated ${iconIcoPath}`)

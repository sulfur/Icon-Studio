import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

import pngToIco from 'png-to-ico'
import sharp from 'sharp'

import { ICON_SIZES, ICONS_DIR } from './constants.js'

function sanitizeName(name, fallback) {
  const trimmed = String(name || '').trim()
  return trimmed || fallback
}

function parseIco(buffer) {
  if (buffer.length < 6) {
    throw new Error('The .ico file is not valid.')
  }

  const reserved = buffer.readUInt16LE(0)
  const type = buffer.readUInt16LE(2)
  const count = buffer.readUInt16LE(4)

  if (reserved !== 0 || type !== 1 || count < 1) {
    throw new Error('The uploaded file is not a valid .ico file.')
  }

  const sizes = new Set()

  for (let index = 0; index < count; index += 1) {
    const entryOffset = 6 + index * 16
    if (entryOffset + 15 >= buffer.length) {
      break
    }

    const width = buffer.readUInt8(entryOffset) || 256
    const height = buffer.readUInt8(entryOffset + 1) || 256

    if (width === height) {
      sizes.add(width)
    }
  }

  const uniqueSizes = Array.from(sizes).sort((left, right) => left - right)
  if (uniqueSizes.length < 2) {
    throw new Error('The .ico file must contain multiple dimensions.')
  }

  return uniqueSizes
}

async function buildMultiSizeIco(inputBuffer) {
  const rendered = await Promise.all(
    ICON_SIZES.map((size) =>
      sharp(inputBuffer, { failOn: 'none' })
        .resize(size, size, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer(),
    ),
  )

  return pngToIco(rendered)
}

export class IconService {
  getIconAbsolutePath(icon) {
    return path.join(ICONS_DIR, icon.fileName)
  }

  async createIcon({ name, file }) {
    if (!file?.buffer?.length) {
      throw new Error('No icon file was received.')
    }

    const extension = path.extname(file.originalname || '').toLowerCase()
    const id = randomUUID()
    const fileName = `${id}.ico`
    const targetPath = path.join(ICONS_DIR, fileName)

    let icoBuffer
    let sizes

    if (extension === '.ico') {
      sizes = parseIco(file.buffer)
      icoBuffer = file.buffer
    } else {
      sizes = [...ICON_SIZES]
      try {
        icoBuffer = await buildMultiSizeIco(file.buffer)
      } catch (error) {
        throw new Error(`Could not convert the image to .ico: ${error.message}`)
      }
    }

    await fs.writeFile(targetPath, icoBuffer)

    return {
      id,
      name: sanitizeName(name, path.parse(file.originalname || 'Icon').name),
      fileName,
      sourceName: file.originalname || fileName,
      createdAt: new Date().toISOString(),
      sizes,
    }
  }

  async deleteIcon(icon) {
    await fs.rm(this.getIconAbsolutePath(icon), { force: true })
  }
}

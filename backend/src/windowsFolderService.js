import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { DESKTOP_INI_MARKER, LEGACY_DESKTOP_INI_MARKERS } from './constants.js'

const execFileAsync = promisify(execFile)

function normalizeForIni(filePath) {
  return path.resolve(filePath).replaceAll('/', '\\')
}

function isPermissionError(error) {
  return error?.code === 'EPERM' || error?.code === 'EACCES'
}

export class WindowsFolderService {
  #refreshTimer = null

  async applyIconToFolder(folderPath, iconPath) {
    if (process.platform !== 'win32') {
      return {
        status: 'error',
        reason: 'This feature is only supported on Windows.',
      }
    }

    const desktopIniPath = path.join(folderPath, 'desktop.ini')
    const normalizedIconPath = normalizeForIni(iconPath)
    const desiredContents = [
      DESKTOP_INI_MARKER,
      '[.ShellClassInfo]',
      `IconResource=${normalizedIconPath},0`,
      'ConfirmFileOp=0',
      '',
    ].join('\r\n')

    let existingContents = null

    try {
      existingContents = await fs.readFile(desktopIniPath, 'utf8')
    } catch (error) {
      if (isPermissionError(error)) {
        return {
          status: 'skipped',
          reason: 'The folder desktop.ini is protected and cannot be updated.',
        }
      }

      if (error.code !== 'ENOENT') {
        throw error
      }
    }

    if (existingContents) {
      const isManaged = LEGACY_DESKTOP_INI_MARKERS.some((marker) =>
        existingContents.includes(marker),
      )
      const hasCustomIcon = /^(IconResource|IconFile)\s*=/im.test(existingContents)

      if (!isManaged && hasCustomIcon) {
        return {
          status: 'skipped',
          reason: 'The folder already has a custom desktop.ini file.',
        }
      }

      if (isManaged && existingContents.includes(`IconResource=${normalizedIconPath},0`)) {
        return {
          status: 'skipped',
          reason: 'The folder already points to this icon.',
        }
      }
    }

    try {
      if (existingContents !== null) {
        await execFileAsync('attrib', ['-h', '-s', '-r', desktopIniPath])
      }

      await fs.writeFile(desktopIniPath, desiredContents, 'utf8')
      await execFileAsync('attrib', ['+h', '+s', desktopIniPath])
      await execFileAsync('attrib', ['+r', folderPath])

      this.requestExplorerRefresh()

      return {
        status: 'applied',
        reason: 'Icon applied.',
      }
    } catch (error) {
      if (isPermissionError(error)) {
        return {
          status: 'skipped',
          reason: 'The folder desktop.ini is protected and cannot be updated.',
        }
      }

      return {
        status: 'error',
        reason: error instanceof Error ? error.message : 'Unable to update folder icon.',
      }
    }
  }

  requestExplorerRefresh() {
    if (this.#refreshTimer) {
      clearTimeout(this.#refreshTimer)
    }

    this.#refreshTimer = setTimeout(async () => {
      try {
        await execFileAsync('ie4uinit.exe', ['-show'])
      } catch {
        try {
          await execFileAsync('ie4uinit.exe', ['-ClearIconCache'])
        } catch {
          // If Explorer does not expose the helper, Windows refreshes on its own.
        }
      }
    }, 900)
  }
}

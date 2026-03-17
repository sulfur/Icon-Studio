import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

import { ROOT_DIR, STARTUP_REGISTRY_KEY, STARTUP_VALUE_NAME } from './constants.js'

const execFileAsync = promisify(execFile)

const DIRECTORY_PICKER_SCRIPT = `
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select a folder to monitor'
$dialog.UseDescriptionForTitle = $true
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
  Write-Output $dialog.SelectedPath
}
`

export async function pickDirectory() {
  if (process.platform !== 'win32') {
    throw new Error('Native folder selection is only available on Windows.')
  }

  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-Command', DIRECTORY_PICKER_SCRIPT],
    { windowsHide: false },
  )

  return stdout.trim() || null
}

function buildStartupCommand() {
  const desktopStartupCommand = String(process.env.ICON_STUDIO_RUN_AT_STARTUP_COMMAND || '').trim()
  if (desktopStartupCommand) {
    return desktopStartupCommand
  }

  const entryPoint = path.join(ROOT_DIR, 'src', 'index.js')

  if (path.basename(process.execPath).toLowerCase().startsWith('node')) {
    return `"${process.execPath}" "${entryPoint}"`
  }

  return `"${process.execPath}"`
}

export async function syncRunAtStartup(enabled) {
  if (process.platform !== 'win32') {
    if (enabled) {
      throw new Error('runAtStartup is only supported on Windows.')
    }

    return {
      supported: false,
      enabled: false,
    }
  }

  if (enabled) {
    await execFileAsync('reg.exe', [
      'ADD',
      STARTUP_REGISTRY_KEY,
      '/V',
      STARTUP_VALUE_NAME,
      '/T',
      'REG_SZ',
      '/D',
      buildStartupCommand(),
      '/F',
    ])
  } else {
    const startupValueExists = await execFileAsync('reg.exe', [
      'QUERY',
      STARTUP_REGISTRY_KEY,
      '/V',
      STARTUP_VALUE_NAME,
    ])
      .then(() => true)
      .catch(() => false)

    if (startupValueExists) {
      await execFileAsync('reg.exe', [
        'DELETE',
        STARTUP_REGISTRY_KEY,
        '/V',
        STARTUP_VALUE_NAME,
        '/F',
      ])
    }
  }

  return {
    supported: true,
    enabled,
  }
}

export function getDesktopIntegrationCapabilities() {
  const desktopShellEnabled = process.env.ICON_STUDIO_DESKTOP === '1'

  return {
    startMinimizedSupported: desktopShellEnabled,
    systemTraySupported: desktopShellEnabled,
  }
}

export async function getWindowsAttributes(targetPath) {
  if (process.platform !== 'win32') {
    return new Set()
  }

  try {
    const { stdout } = await execFileAsync('attrib', [targetPath])
    const flags = (stdout.trim().split(/\s+/)[0] || '').trim()
    return new Set(flags.split(''))
  } catch {
    return new Set()
  }
}

export async function shouldIgnorePath(targetPath, settings) {
  if (!settings?.ignoreHiddenItems) {
    return false
  }

  const baseName = path.basename(targetPath)
  if (baseName.startsWith('.')) {
    return true
  }

  const attributes = await getWindowsAttributes(targetPath)
  return attributes.has('H') || attributes.has('S')
}

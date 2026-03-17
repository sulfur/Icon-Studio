const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') {
    return
  }

  const productFilename = context.packager.appInfo.productFilename
  const executableName = `${productFilename}.exe`
  const executablePath = path.join(context.appOutDir, executableName)
  const iconPath = path.join(context.packager.projectDir, 'build', 'icon.ico')
  const rceditPath = path.join(
    context.packager.projectDir,
    'node_modules',
    'electron-winstaller',
    'vendor',
    'rcedit.exe',
  )
  const version = context.packager.appInfo.version

  await execFileAsync(rceditPath, [
    executablePath,
    '--set-icon',
    iconPath,
    '--set-file-version',
    version,
    '--set-product-version',
    version,
    '--set-version-string',
    'FileDescription',
    'Icon Studio',
    '--set-version-string',
    'ProductName',
    'Icon Studio',
    '--set-version-string',
    'CompanyName',
    'sulf',
    '--set-version-string',
    'InternalName',
    'Icon Studio',
    '--set-version-string',
    'OriginalFilename',
    'Icon Studio.exe',
    '--set-version-string',
    'LegalCopyright',
    'Copyright (c) 2026 sulf',
  ])
}

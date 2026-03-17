const path = require('node:path')
const fsSync = require('node:fs')
const fs = require('node:fs/promises')
const os = require('node:os')
const { spawn } = require('node:child_process')

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  ipcMain,
  dialog,
} = require('electron')

const BACKEND_PORT = 4000
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`
const WINDOW_MIN_WIDTH = 1280
const WINDOW_MIN_HEIGHT = 820
const DEFAULT_SETTINGS = {
  startMinimized: false,
}

const projectRoot = app.getAppPath()
const backendEntry = path.join(projectRoot, 'backend', 'src', 'index.js')
const backendCwd = path.join(projectRoot, 'backend')
const runtimeDataDir = app.isPackaged
  ? path.join(app.getPath('userData'), 'data')
  : path.join(projectRoot, 'backend', 'data')
const runtimeTempDir = app.isPackaged
  ? path.join(app.getPath('userData'), 'temp')
  : path.join(projectRoot, 'backend', 'temp')
const runtimeLogsDir = app.isPackaged
  ? path.join(app.getPath('userData'), 'logs')
  : path.join(projectRoot, 'desktop', 'logs')
const settingsFile = path.join(runtimeDataDir, 'settings.json')
const appIconPath = path.join(projectRoot, 'web', 'public', 'app-icon.png')
const trayIconPath = path.join(projectRoot, 'web', 'public', 'tray-icon.png')
const webDistDir = path.join(projectRoot, 'web', 'dist')
const preloadPath = path.join(__dirname, 'preload.cjs')
const backendLogPath = path.join(runtimeLogsDir, 'backend.log')

let backendProcess = null
let mainWindow = null
let tray = null
let isQuitting = false
let pendingNavigation = null
let backendLogStream = null

app.setAppUserModelId('com.sulf.iconstudio')
app.commandLine.appendSwitch('enable-transparent-visuals')
app.commandLine.appendSwitch('disable-http-cache')

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

function getRendererUrl() {
  return process.env.ICON_STUDIO_RENDERER_URL || BACKEND_URL
}

function getRendererLoadUrl() {
  const url = new URL(getRendererUrl())
  url.searchParams.set('shell', String(Date.now()))
  return url.toString()
}

function buildRunAtStartupCommand() {
  if (app.isPackaged) {
    return `"${process.execPath}" --launch-at-login`
  }

  return `"${process.execPath}" "${projectRoot}" --launch-at-login`
}

function createAppIcon() {
  const icon = nativeImage.createFromPath(appIconPath)
  return icon.isEmpty() ? undefined : icon
}

function createTrayIcon() {
  const icon = nativeImage.createFromPath(trayIconPath)
  if (icon.isEmpty()) {
    return createAppIcon()
  }

  if (process.platform === 'win32') {
    return icon.resize({ width: 28, height: 28, quality: 'best' })
  }

  return icon
}

async function readDesktopSettings() {
  try {
    await fs.mkdir(runtimeDataDir, { recursive: true })
    const raw = await fs.readFile(settingsFile, 'utf8')
    return {
      ...DEFAULT_SETTINGS,
      ...JSON.parse(raw),
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

async function waitForBackendReady(timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() <= deadline) {
    try {
      const response = await fetch(`${BACKEND_URL}/api/service/status`)
      if (response.ok) {
        return
      }
    } catch {
      // Backend is still booting.
    }

    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  throw new Error('The backend did not become ready in time.')
}

function appendDesktopLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`

  try {
    fsSync.mkdirSync(runtimeLogsDir, { recursive: true })
    fsSync.appendFileSync(backendLogPath, line)
  } catch {
    // Ignore logging failures.
  }
}

function resetBackendProcessState() {
  backendProcess = null

  if (backendLogStream) {
    backendLogStream.end()
    backendLogStream = null
  }
}

async function startBackend() {
  if (backendProcess && !backendProcess.killed) {
    return
  }

  await fs.mkdir(runtimeLogsDir, { recursive: true })
  backendLogStream = fsSync.createWriteStream(backendLogPath, { flags: 'a' })
  appendDesktopLog(`Starting backend from ${backendEntry}`)

  backendProcess = spawn(process.execPath, [backendEntry], {
    cwd: backendCwd,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      PORT: String(BACKEND_PORT),
      ICON_STUDIO_DESKTOP: '1',
      ICON_STUDIO_RUN_AT_STARTUP_COMMAND: buildRunAtStartupCommand(),
      ICON_STUDIO_DATA_DIR: runtimeDataDir,
      ICON_STUDIO_TEMP_DIR: runtimeTempDir,
      ICON_STUDIO_WEB_DIST_DIR: webDistDir,
    },
  })

  backendProcess.stdout?.pipe(backendLogStream, { end: false })
  backendProcess.stderr?.pipe(backendLogStream, { end: false })

  backendProcess.on('error', (error) => {
    appendDesktopLog(`Backend process error: ${error.message}`)
  })

  backendProcess.on('exit', (code, signal) => {
    appendDesktopLog(`Backend exited with code=${code ?? 'null'} signal=${signal ?? 'null'}`)
    resetBackendProcessState()
  })
}

async function stopBackend() {
  if (!backendProcess || backendProcess.killed) {
    return
  }

  const processToStop = backendProcess

  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (!processToStop.killed) {
        processToStop.kill('SIGKILL')
      }
    }, 4_000)

    processToStop.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })

    processToStop.kill('SIGTERM')
  })
}

async function ensureBackendReady() {
  const startupErrors = []

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      await startBackend()
      await waitForBackendReady()
      appendDesktopLog(`Backend ready on attempt ${attempt}`)
      return
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown backend startup failure.'
      startupErrors.push(`Attempt ${attempt}: ${message}`)
      appendDesktopLog(`Backend startup failed on attempt ${attempt}: ${message}`)
      await stopBackend().catch(() => {})
    }
  }

  throw new Error(startupErrors.join(' | '))
}

function showMainWindow() {
  if (!mainWindow) {
    return
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  }

  mainWindow.show()
  mainWindow.focus()
}

function sendNavigation(payload) {
  pendingNavigation = payload

  if (!mainWindow) {
    return
  }

  const dispatch = () => {
    mainWindow.webContents.send('desktop:navigate', payload)
    pendingNavigation = null
  }

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once('did-finish-load', dispatch)
    return
  }

  dispatch()
}

async function getServiceStatus() {
  try {
    const response = await fetch(`${BACKEND_URL}/api/service/status`)
    if (!response.ok) {
      return { running: false }
    }

    return await response.json()
  } catch {
    return { running: false }
  }
}

async function postServiceAction(action) {
  const response = await fetch(`${BACKEND_URL}/api/service/${action}`, {
    method: 'POST',
  })

  const payload = await response.json().catch(() => ({ running: false }))
  if (!response.ok) {
    throw new Error(payload.error || 'The service action failed.')
  }

  return payload
}

function emitWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return
  }

  mainWindow.webContents.send('desktop:window-state', {
    maximized: mainWindow.isMaximized(),
  })
}

function isWindows11() {
  if (process.platform !== 'win32') {
    return false
  }

  const [major, minor, build] = os.release().split('.').map(Number)
  return major === 10 && minor === 0 && build >= 22000
}

function createMainWindow(startMinimized) {
  mainWindow = new BrowserWindow({
    width: 1520,
    height: 960,
    minWidth: WINDOW_MIN_WIDTH,
    minHeight: WINDOW_MIN_HEIGHT,
    show: !startMinimized,
    frame: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    transparent: false,
    backgroundColor: '#111315',
    hasShadow: true,
    roundedCorners: true,
    autoHideMenuBar: true,
    icon: createAppIcon(),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isWindows11() && typeof mainWindow.setBackgroundMaterial === 'function') {
    mainWindow.setBackgroundMaterial('mica')
  }

  mainWindow.setMenuBarVisibility(false)

  mainWindow.on('close', (event) => {
    if (isQuitting) {
      return
    }

    event.preventDefault()
    mainWindow.hide()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    emitWindowState()

    if (pendingNavigation) {
      sendNavigation(pendingNavigation)
    }
  })

  mainWindow.on('maximize', emitWindowState)
  mainWindow.on('unmaximize', emitWindowState)

  void (async () => {
    await mainWindow.webContents.session.clearCache()
    await mainWindow.loadURL(getRendererLoadUrl())
  })()
}

async function buildTrayMenu() {
  const serviceStatus = await getServiceStatus()

  return Menu.buildFromTemplate([
    {
      label: 'Open Settings',
      click: () => {
        showMainWindow()
        sendNavigation({ view: 'settings', settingsTab: 'system' })
      },
    },
    {
      label: serviceStatus.running ? 'Pause Service' : 'Resume Service',
      click: async () => {
        const action = serviceStatus.running ? 'stop' : 'start'
        await postServiceAction(action)
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Icon Studio',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])
}

function createTray() {
  tray = new Tray(createTrayIcon())
  tray.setToolTip('Icon Studio')

  const openTrayMenu = async () => {
    if (!tray) {
      return
    }

    tray.popUpContextMenu(await buildTrayMenu())
  }

  tray.on('click', () => {
    void openTrayMenu()
  })
  tray.on('right-click', () => {
    void openTrayMenu()
  })
}

ipcMain.handle('desktop:hide-to-tray', () => {
  mainWindow?.hide()
})

ipcMain.handle('desktop:minimize', () => {
  mainWindow?.minimize()
})

ipcMain.handle('desktop:toggle-maximize', () => {
  if (!mainWindow) {
    return { maximized: false }
  }

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow.maximize()
  }

  return { maximized: mainWindow.isMaximized() }
})

ipcMain.handle('desktop:close-window', () => {
  mainWindow?.hide()
})

ipcMain.handle('desktop:get-window-state', () => ({
  maximized: mainWindow?.isMaximized() || false,
}))

ipcMain.handle('desktop:quit', () => {
  isQuitting = true
  app.quit()
})

app.on('second-instance', () => {
  showMainWindow()
})

app.on('before-quit', () => {
  isQuitting = true
})

app.whenReady().then(async () => {
  try {
    const settings = await readDesktopSettings()

    await ensureBackendReady()

    createMainWindow(Boolean(settings.startMinimized))
    createTray()

    if (process.argv.includes('--launch-at-login') && !settings.startMinimized) {
      showMainWindow()
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The backend could not be started.'
    appendDesktopLog(`Fatal startup error: ${message}`)
    dialog.showErrorBox('Icon Studio', `The backend could not be started.\n\n${message}`)
    app.exit(1)
  }
})

app.on('activate', () => {
  showMainWindow()
})

app.on('will-quit', async (event) => {
  event.preventDefault()
  await stopBackend()
  process.nextTick(() => {
    app.exit(0)
  })
})

import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { setTimeout as sleep } from 'node:timers/promises'

import cors from 'cors'
import express from 'express'
import multer from 'multer'

import { ConfigStore } from './configStore.js'
import { IconService } from './iconService.js'
import { EventRetentionService } from './retentionService.js'
import { SettingsStore, validateSettingsUpdate } from './settingsStore.js'
import {
  getDesktopIntegrationCapabilities,
  pickDirectory,
  shouldIgnorePath,
  syncRunAtStartup,
} from './systemService.js'
import { WEB_DIST_DIR } from './constants.js'
import { WatchManager } from './watchManager.js'
import { WindowsFolderService } from './windowsFolderService.js'

const PORT = Number(process.env.PORT || 4000)
const SERVICE_START_TIMEOUT_MS = 2_000
const require = createRequire(import.meta.url)
const { version: BACKEND_VERSION } = require('../package.json')

const store = new ConfigStore()
await store.load()

const settingsStore = new SettingsStore()
await settingsStore.load()

const iconService = new IconService()
const windowsFolderService = new WindowsFolderService()
const watchManager = new WatchManager({
  store,
  iconService,
  windowsFolderService,
  shouldIgnorePath,
})
const retentionService = new EventRetentionService({ store })

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
})

const app = express()
app.use(cors())
app.use(express.json({ limit: '1mb' }))

let serviceOperation = Promise.resolve()

function buildIconUsageMap(state) {
  const counts = new Map()

  for (const watch of state.watches) {
    if (watch.defaultIconId) {
      counts.set(watch.defaultIconId, (counts.get(watch.defaultIconId) || 0) + 1)
    }

    for (const rule of watch.rules) {
      if (!rule.iconId) {
        continue
      }

      counts.set(rule.iconId, (counts.get(rule.iconId) || 0) + 1)
    }
  }

  return counts
}

function buildStateResponse() {
  const state = store.getState()
  const usages = buildIconUsageMap(state)

  return {
    icons: state.icons.map((icon) => ({
      ...icon,
      previewUrl: `/api/icons/${icon.id}/file`,
      usageCount: usages.get(icon.id) || 0,
    })),
    watches: state.watches,
    events: state.events,
    runtime: {
      ...watchManager.getRuntime(),
      desktopIntegration: getDesktopIntegrationCapabilities(),
    },
    settings: settingsStore.getSettings(),
  }
}

function buildServiceStatus() {
  return watchManager.getServiceStatus(BACKEND_VERSION)
}

async function waitForServiceRunning(timeoutMs = SERVICE_START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() <= deadline) {
    if (buildServiceStatus().running) {
      return buildServiceStatus()
    }

    await sleep(100)
  }

  throw new Error('Service did not become healthy in time.')
}

async function runServiceOperation(task) {
  const operation = serviceOperation.then(task, task)
  serviceOperation = operation.catch(() => {})
  return operation
}

function summarizeScanResults(results) {
  return results.reduce(
    (summary, entry) => ({
      processed: summary.processed + entry.summary.processed,
      applied: summary.applied + entry.summary.applied,
      skipped: summary.skipped + entry.summary.skipped,
      noop: summary.noop + entry.summary.noop,
      error: summary.error + entry.summary.error,
    }),
    {
      processed: 0,
      applied: 0,
      skipped: 0,
      noop: 0,
      error: 0,
    },
  )
}

function buildSettingsChangeSummary(previousSettings, nextSettings) {
  const changedKeys = Object.keys(nextSettings).filter(
    (key) => previousSettings[key] !== nextSettings[key],
  )

  return changedKeys.length > 0 ? changedKeys.join(', ') : 'no fields'
}

async function ensureDirectoryPath(directoryPath) {
  const rawPath = String(directoryPath || '').trim()
  if (!rawPath) {
    throw new Error('Select a directory to monitor.')
  }

  const normalizedPath = path.resolve(rawPath)

  let stats
  try {
    stats = await fs.stat(normalizedPath)
  } catch {
    throw new Error('The selected directory does not exist.')
  }

  if (!stats.isDirectory()) {
    throw new Error('The selected path is not a directory.')
  }

  return normalizedPath
}

function assertIconExists(iconId, icons) {
  if (!iconId) {
    return null
  }

  const existing = icons.find((icon) => icon.id === iconId)
  if (!existing) {
    throw new Error('The selected icon does not exist.')
  }

  return iconId
}

function normalizeRules(rules, icons) {
  const entries = Array.isArray(rules) ? rules : []
  const seen = new Set()

  return entries
    .map((rule) => ({
      id: rule.id ? String(rule.id) : randomUUID(),
      keyword: String(rule.keyword || '').trim(),
      iconId: rule.iconId ? String(rule.iconId) : null,
    }))
    .filter((rule) => rule.keyword.length > 0 && rule.iconId)
    .map((rule) => {
      const normalizedKeyword = rule.keyword.toLowerCase()
      if (seen.has(normalizedKeyword)) {
        throw new Error(`The keyword "${rule.keyword}" has been defined more than once.`)
      }

      seen.add(normalizedKeyword)
      assertIconExists(rule.iconId, icons)
      return rule
    })
}

async function normalizeWatchPayload(body, existingWatch = null) {
  const state = store.getState()
  const directoryPath = await ensureDirectoryPath(body.directoryPath)
  const name = String(body.name || '').trim() || path.basename(directoryPath)
  const rules = normalizeRules(body.rules, state.icons)

  return {
    id: existingWatch?.id || randomUUID(),
    name,
    directoryPath,
    recursive: body.recursive !== false,
    enabled: body.enabled !== false,
    defaultIconId: assertIconExists(body.defaultIconId ? String(body.defaultIconId) : null, state.icons),
    rules,
    createdAt: existingWatch?.createdAt || new Date().toISOString(),
  }
}

const initialSettings = settingsStore.getSettings()
await syncRunAtStartup(initialSettings.runAtStartup)
await watchManager.applySettings(initialSettings)
await watchManager.start()
await retentionService.start(initialSettings)

if (initialSettings.reapplyOnStartup) {
  const startupScanSummary = summarizeScanResults(
    await watchManager.scanAll({ source: 'startup-reapply' }),
  )

  await store.appendEvent({
    level: 'info',
    message: `Startup reapply completed: ${startupScanSummary.applied} applied, ${startupScanSummary.skipped} skipped, ${startupScanSummary.noop} without a matching rule.`,
    source: 'startup',
  })
}

app.get('/api/state', (_request, response) => {
  response.json(buildStateResponse())
})

app.get('/api/settings', (_request, response) => {
  response.json(settingsStore.getSettings())
})

app.put('/api/settings', async (request, response, next) => {
  try {
    const previousSettings = settingsStore.getSettings()
    const nextSettings = validateSettingsUpdate(request.body, previousSettings)

    if (previousSettings.runAtStartup !== nextSettings.runAtStartup) {
      await syncRunAtStartup(nextSettings.runAtStartup)
    }

    const savedSettings = await settingsStore.save(nextSettings)
    await watchManager.applySettings(savedSettings, previousSettings)
    await retentionService.applySettings(savedSettings)

    if (
      previousSettings.startMinimized !== savedSettings.startMinimized &&
      savedSettings.startMinimized &&
      !getDesktopIntegrationCapabilities().startMinimizedSupported
    ) {
      await store.appendEvent({
        level: 'warning',
        message:
          'startMinimized was saved, but this backend build has no native desktop wrapper to hide the window to tray at launch.',
        source: 'settings',
      })
    }

    await store.appendEvent({
      level: 'info',
      message: `Updated application settings (${buildSettingsChangeSummary(previousSettings, savedSettings)}).`,
      source: 'settings',
    })

    response.json(savedSettings)
  } catch (error) {
    next(error)
  }
})

app.get('/api/settings/export', (_request, response) => {
  const state = store.getState()
  const exportPayload = {
    exportedAt: new Date().toISOString(),
    app: 'Icon Studio',
    settings: settingsStore.getSettings(),
    icons: state.icons,
    watches: state.watches,
    events: state.events,
  }

  response.setHeader('Content-Disposition', 'attachment; filename="icon-studio-export.json"')
  response.type('application/json')
  response.send(JSON.stringify(exportPayload, null, 2))
})

app.get('/api/service/status', (_request, response) => {
  try {
    response.json(buildServiceStatus())
  } catch {
    response.json({ running: false, version: BACKEND_VERSION })
  }
})

app.post('/api/service/start', async (_request, response) => {
  try {
    await runServiceOperation(async () => {
      if (buildServiceStatus().running) {
        response.status(409).json({ error: 'Service is already running.' })
        return
      }

      await watchManager.start()
      await waitForServiceRunning()
      await store.appendEvent({
        level: 'info',
        message: 'Monitoring service started.',
        source: 'service',
      })

      response.json(buildServiceStatus())
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to start the service.'
    response.status(500).json({ error: message })
  }
})

app.post('/api/service/restart', async (_request, response) => {
  try {
    await runServiceOperation(async () => {
      await watchManager.restart()
      await waitForServiceRunning()
      await store.appendEvent({
        level: 'info',
        message: 'Monitoring service restarted.',
        source: 'service',
      })

      response.json(buildServiceStatus())
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to restart the service.'
    response.status(500).json({ error: message })
  }
})

app.post('/api/service/stop', async (_request, response) => {
  try {
    await runServiceOperation(async () => {
      await watchManager.stop()
      await store.appendEvent({
        level: 'info',
        message: 'Monitoring service paused.',
        source: 'service',
      })

      response.json(buildServiceStatus())
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to stop the service.'
    response.status(500).json({ error: message })
  }
})

app.get('/api/icons/:iconId/file', (request, response) => {
  const icon = store.getState().icons.find((entry) => entry.id === request.params.iconId)
  if (!icon) {
    response.status(404).json({ error: 'Icon not found.' })
    return
  }

  response.type('image/x-icon')
  response.sendFile(iconService.getIconAbsolutePath(icon))
})

app.post('/api/icons', upload.single('icon'), async (request, response, next) => {
  try {
    if (!request.file) {
      response.status(400).json({ error: 'Select an icon file.' })
      return
    }

    const icon = await iconService.createIcon({
      name: request.body.name,
      file: request.file,
    })

    await store.update((draft) => {
      draft.icons = [icon, ...draft.icons]
      return draft
    })

    await store.appendEvent({
      level: 'info',
      message: `Added icon "${icon.name}" with ${icon.sizes.join(', ')} px.`,
      iconName: icon.name,
      source: 'ui',
    })

    response.status(201).json(buildStateResponse())
  } catch (error) {
    next(error)
  }
})

app.delete('/api/icons/:iconId', async (request, response, next) => {
  try {
    const state = store.getState()
    const icon = state.icons.find((entry) => entry.id === request.params.iconId)

    if (!icon) {
      response.status(404).json({ error: 'Icon not found.' })
      return
    }

    const usages = buildIconUsageMap(state)
    if ((usages.get(icon.id) || 0) > 0) {
      response.status(409).json({
        error: 'The icon is still used by one or more watchers.',
      })
      return
    }

    await iconService.deleteIcon(icon)
    await store.update((draft) => {
      draft.icons = draft.icons.filter((entry) => entry.id !== icon.id)
      return draft
    })

    await store.appendEvent({
      level: 'info',
      message: `Removed icon "${icon.name}".`,
      iconName: icon.name,
      source: 'ui',
    })

    response.json(buildStateResponse())
  } catch (error) {
    next(error)
  }
})

app.post('/api/watches', async (request, response, next) => {
  try {
    const watch = await normalizeWatchPayload(request.body)

    await store.update((draft) => {
      draft.watches = [watch, ...draft.watches]
      return draft
    })

    await store.appendEvent({
      level: 'info',
      message: `Created watcher "${watch.name}" for ${watch.directoryPath}.`,
      watchId: watch.id,
      watchName: watch.name,
      source: 'ui',
    })

    await watchManager.sync()
    response.status(201).json(buildStateResponse())
  } catch (error) {
    next(error)
  }
})

app.put('/api/watches/:watchId', async (request, response, next) => {
  try {
    const currentState = store.getState()
    const existingWatch = currentState.watches.find((watch) => watch.id === request.params.watchId)

    if (!existingWatch) {
      response.status(404).json({ error: 'Watcher not found.' })
      return
    }

    const watch = await normalizeWatchPayload(request.body, existingWatch)

    await store.update((draft) => {
      draft.watches = draft.watches.map((entry) => (entry.id === watch.id ? watch : entry))
      return draft
    })

    await store.appendEvent({
      level: 'info',
      message: `Updated watcher "${watch.name}".`,
      watchId: watch.id,
      watchName: watch.name,
      source: 'ui',
    })

    await watchManager.sync()
    response.json(buildStateResponse())
  } catch (error) {
    next(error)
  }
})

app.delete('/api/watches/:watchId', async (request, response, next) => {
  try {
    const currentState = store.getState()
    const watch = currentState.watches.find((entry) => entry.id === request.params.watchId)

    if (!watch) {
      response.status(404).json({ error: 'Watcher not found.' })
      return
    }

    await store.update((draft) => {
      draft.watches = draft.watches.filter((entry) => entry.id !== watch.id)
      return draft
    })

    await store.appendEvent({
      level: 'info',
      message: `Deleted watcher "${watch.name}".`,
      watchId: watch.id,
      watchName: watch.name,
      source: 'ui',
    })

    await watchManager.sync()
    response.json(buildStateResponse())
  } catch (error) {
    next(error)
  }
})

app.post('/api/watches/:watchId/rescan', async (request, response, next) => {
  try {
    const state = store.getState()
    const watch = state.watches.find((entry) => entry.id === request.params.watchId)

    if (!watch) {
      response.status(404).json({ error: 'Watcher not found.' })
      return
    }

    const summary = await watchManager.scanExisting(watch.id)
    await store.appendEvent({
      level: 'info',
      message: `Scan completed for "${watch.name}": ${summary.applied} applied, ${summary.skipped} skipped, ${summary.noop} without a matching rule.`,
      watchId: watch.id,
      watchName: watch.name,
      source: 'ui',
    })

    response.json({
      summary,
      ...buildStateResponse(),
    })
  } catch (error) {
    next(error)
  }
})

app.post('/api/system/pick-directory', async (_request, response, next) => {
  try {
    const selectedPath = await pickDirectory()
    response.json({ path: selectedPath })
  } catch (error) {
    next(error)
  }
})

try {
  const distIndex = path.join(WEB_DIST_DIR, 'index.html')
  await fs.access(distIndex)
  app.use(express.static(WEB_DIST_DIR))
  app.use((request, response, next) => {
    if (request.path.startsWith('/api/')) {
      next()
      return
    }

    response.sendFile(distIndex)
  })
} catch {
  // Frontend build is optional during development.
}

app.use((error, _request, response, _next) => {
  const message = error instanceof Error ? error.message : 'Internal server error.'
  response.status(400).json({ error: message })
})

const server = app.listen(PORT, () => {
  console.log(`Icon Studio backend running on http://localhost:${PORT}`)
})

async function shutdown(signal) {
  console.log(`Received ${signal}, closing watchers...`)
  retentionService.stop()
  await watchManager.shutdown()
  server.close(() => {
    process.exit(0)
  })
}

process.on('SIGINT', () => {
  void shutdown('SIGINT')
})

process.on('SIGTERM', () => {
  void shutdown('SIGTERM')
})

import fs from 'node:fs/promises'
import path from 'node:path'

import chokidar from 'chokidar'

import { DEFAULT_SETTINGS } from './constants.js'

function matchRule(folderName, rules) {
  const normalizedName = folderName.toLowerCase()

  const sortedRules = [...rules].sort((left, right) => {
    if (right.keyword.length !== left.keyword.length) {
      return right.keyword.length - left.keyword.length
    }

    return left.keyword.localeCompare(right.keyword)
  })

  return sortedRules.find((rule) => normalizedName.startsWith(rule.keyword.toLowerCase())) || null
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

function createSummary() {
  return {
    processed: 0,
    applied: 0,
    skipped: 0,
    noop: 0,
    error: 0,
  }
}

export class WatchManager {
  #watchers = new Map()
  #runtime = new Map()
  #settings = structuredClone(DEFAULT_SETTINGS)
  #pollTimer = null
  #pollInProgress = false
  #serviceRunning = false
  #serviceStartedAt = null

  constructor({ store, iconService, windowsFolderService, shouldIgnorePath }) {
    this.store = store
    this.iconService = iconService
    this.windowsFolderService = windowsFolderService
    this.shouldIgnorePath = shouldIgnorePath
  }

  async applySettings(settings, previousSettings = null) {
    this.#settings = settings

    if (!this.#serviceRunning) {
      return
    }

    const shouldRestartWatchers =
      !previousSettings ||
      previousSettings.pollingIntervalSeconds !== settings.pollingIntervalSeconds ||
      previousSettings.ignoreHiddenItems !== settings.ignoreHiddenItems

    if (shouldRestartWatchers) {
      await this.#restartWatchers()
    } else {
      await this.sync()
    }

    this.#restartPollingLoop()
  }

  async start() {
    if (this.#serviceRunning) {
      return
    }

    this.#serviceRunning = true
    this.#serviceStartedAt = Date.now()

    try {
      await this.sync()
      this.#restartPollingLoop()
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  async stop() {
    if (this.#pollTimer) {
      clearInterval(this.#pollTimer)
      this.#pollTimer = null
    }

    await Promise.all(Array.from(this.#watchers.values()).map((item) => item.instance.close()))
    this.#watchers.clear()
    this.#pollInProgress = false
    this.#serviceRunning = false
    this.#serviceStartedAt = null
    this.#markServiceStopped()
  }

  async restart() {
    await this.stop()
    await this.start()
  }

  async sync() {
    if (!this.#serviceRunning) {
      this.#markServiceStopped()
      return
    }

    const state = this.store.getState()
    const enabledWatches = new Map(
      state.watches
        .filter((watch) => watch.enabled)
        .map((watch) => [
          watch.id,
          `${path.resolve(watch.directoryPath)}|${watch.recursive ? 'recursive' : 'shallow'}`,
        ]),
    )

    for (const [watchId, activeWatcher] of this.#watchers.entries()) {
      if (enabledWatches.get(watchId) !== activeWatcher.signature) {
        await activeWatcher.instance.close()
        this.#watchers.delete(watchId)
      }
    }

    for (const watch of state.watches) {
      if (!watch.enabled) {
        this.#runtime.set(watch.id, {
          active: false,
          message: 'Watcher disabled',
        })
        continue
      }

      const signature = enabledWatches.get(watch.id)

      if (this.#watchers.get(watch.id)?.signature === signature) {
        continue
      }

      await this.#startWatch(watch, signature)
    }
  }

  async shutdown() {
    await this.stop()
  }

  getRuntime() {
    const state = this.store.getState()
    const watchers = state.watches.map((watch) => ({
      id: watch.id,
      active: this.#runtime.get(watch.id)?.active || false,
      message:
        this.#runtime.get(watch.id)?.message ||
        (watch.enabled ? 'Watcher active' : 'Watcher disabled'),
    }))

    return {
      platform: process.platform,
      windowsSupported: process.platform === 'win32',
      activeCount: watchers.filter((watch) => watch.active).length,
      watchers,
      monitoring: {
        pollingIntervalSeconds: this.#settings.pollingIntervalSeconds,
        ignoreHiddenItems: this.#settings.ignoreHiddenItems,
      },
    }
  }

  getServiceStatus(version) {
    if (!this.#serviceRunning || !this.#serviceStartedAt) {
      return version ? { running: false, version } : { running: false }
    }

    return {
      running: true,
      pid: process.pid,
      uptime: Math.max(0, Math.floor((Date.now() - this.#serviceStartedAt) / 1000)),
      version,
    }
  }

  async scanAll(options = {}) {
    const source = options.source || 'scan'
    const state = this.store.getState()
    const activeWatches = state.watches.filter((watch) => watch.enabled)
    const results = []

    for (const watch of activeWatches) {
      try {
        results.push({
          watchId: watch.id,
          watchName: watch.name,
          summary: await this.scanExisting(watch.id, { source }),
        })
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unexpected scan failure.'
        await this.store.appendEvent({
          level: 'error',
          message: `Scan failed for ${watch.name}: ${reason}`,
          watchId: watch.id,
          watchName: watch.name,
          source,
        })

        results.push({
          watchId: watch.id,
          watchName: watch.name,
          summary: {
            ...createSummary(),
            error: 1,
          },
        })
      }
    }

    return results
  }

  async scanExisting(watchId, options = {}) {
    const source = options.source || 'scan'
    const state = this.store.getState()
    const watch = state.watches.find((item) => item.id === watchId)

    if (!watch) {
      throw new Error('Watcher not found.')
    }

    const summary = createSummary()
    let directories = []

    try {
      directories = await this.#collectDirectories(watch.directoryPath, watch.recursive)
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unexpected directory enumeration failure.'
      await this.store.appendEvent({
        level: 'error',
        message: `Unable to enumerate folders for ${watch.name}: ${reason}`,
        watchId: watch.id,
        watchName: watch.name,
        source,
      })
      summary.error += 1
      return summary
    }

    for (const folderPath of directories) {
      summary.processed += 1
      const result = await this.applyFolderRule({
        watchId,
        folderPath,
        source,
      })

      if (result.status in summary) {
        summary[result.status] += 1
      }
    }

    return summary
  }

  async applyFolderRule({ watchId, folderPath, source = 'scan' }) {
    const state = this.store.getState()
    const watch = state.watches.find((item) => item.id === watchId)

    if (!watch) {
      return { status: 'error', reason: 'Watcher not found.' }
    }

    if (!(await pathExists(folderPath))) {
      return { status: 'error', reason: 'Folder not found.' }
    }

    if (await this.shouldIgnorePath(folderPath, this.#settings)) {
      return { status: 'noop', reason: 'The item is ignored by current settings.' }
    }

    let stats
    try {
      stats = await fs.lstat(folderPath)
    } catch (error) {
      return { status: 'error', reason: error.message }
    }

    if (!stats.isDirectory()) {
      return { status: 'noop', reason: 'The path is not a folder.' }
    }

    if (stats.isSymbolicLink()) {
      return { status: 'skipped', reason: 'Junctions and symlinks are not modified.' }
    }

    const folderName = path.basename(folderPath)
    const rule = matchRule(folderName, watch.rules)
    const iconId = rule?.iconId || watch.defaultIconId

    if (!iconId) {
      return { status: 'noop', reason: 'No icon is configured for this folder.' }
    }

    const icon = state.icons.find((item) => item.id === iconId)
    if (!icon) {
      return {
        status: 'error',
        reason: 'The configured icon no longer exists.',
      }
    }

    let result
    try {
      result = await this.windowsFolderService.applyIconToFolder(
        folderPath,
        this.iconService.getIconAbsolutePath(icon),
      )
    } catch (error) {
      result = {
        status: 'error',
        reason: error instanceof Error ? error.message : 'Unexpected folder update failure.',
      }
    }

    if (result.status === 'applied') {
      await this.store.appendEvent({
        level: 'success',
        message: rule
          ? `Applied icon "${icon.name}" to ${folderName} using keyword "${rule.keyword}".`
          : `Applied default icon "${icon.name}" to ${folderName}.`,
        folderPath,
        watchId: watch.id,
        watchName: watch.name,
        iconName: icon.name,
        source,
      })
    } else if (result.status === 'skipped' && source !== 'poll') {
      await this.store.appendEvent({
        level: 'warning',
        message: `Skipped folder ${folderName}: ${result.reason}`,
        folderPath,
        watchId: watch.id,
        watchName: watch.name,
        iconName: icon.name,
        source,
      })
    } else if (result.status === 'error') {
      await this.store.appendEvent({
        level: 'error',
        message: `Error on ${folderName}: ${result.reason}`,
        folderPath,
        watchId: watch.id,
        watchName: watch.name,
        iconName: icon.name,
        source,
      })
    }

    return {
      status: result.status,
      reason: result.reason,
      matchedRule: rule?.keyword || null,
      iconName: icon.name,
    }
  }

  async #collectDirectories(rootPath, recursive) {
    const queue = [rootPath]
    const result = []
    let isFirstLoop = true

    while (queue.length > 0) {
      const currentPath = queue.shift()
      let entries
      try {
        entries = await fs.readdir(currentPath, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) {
          continue
        }

        const fullPath = path.join(currentPath, entry.name)
        if (await this.shouldIgnorePath(fullPath, this.#settings)) {
          continue
        }

        result.push(fullPath)

        if (recursive) {
          queue.push(fullPath)
        }
      }

      if (!recursive && !isFirstLoop) {
        break
      }

      isFirstLoop = false
    }

    return result
  }

  async #restartWatchers() {
    await Promise.all(Array.from(this.#watchers.values()).map((item) => item.instance.close()))
    this.#watchers.clear()
    await this.sync()
  }

  #restartPollingLoop() {
    if (this.#pollTimer) {
      clearInterval(this.#pollTimer)
      this.#pollTimer = null
    }

    const intervalMs = this.#settings.pollingIntervalSeconds * 1000
    this.#pollTimer = setInterval(() => {
      void this.#runPollingScan()
    }, intervalMs)
  }

  async #runPollingScan() {
    if (this.#pollInProgress) {
      return
    }

    this.#pollInProgress = true

    try {
      await this.scanAll({ source: 'poll' })
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unexpected polling failure.'
      await this.store.appendEvent({
        level: 'error',
        message: `Polling scan failed: ${reason}`,
        source: 'poll',
      })
    } finally {
      this.#pollInProgress = false
    }
  }

  async #startWatch(watch, signature) {
    const resolvedPath = path.resolve(watch.directoryPath)

    try {
      const stats = await fs.stat(resolvedPath)
      if (!stats.isDirectory()) {
        throw new Error('The provided path is not a directory.')
      }
    } catch (error) {
      this.#runtime.set(watch.id, {
        active: false,
        message: `Watcher not started: ${error.message}`,
      })
      return
    }

    const watcher = chokidar.watch(resolvedPath, {
      ignoreInitial: true,
      depth: watch.recursive ? undefined : 0,
      awaitWriteFinish: {
        stabilityThreshold: 250,
        pollInterval: 100,
      },
      ignorePermissionErrors: true,
    })

    watcher.on('addDir', async (folderPath) => {
      if (path.resolve(folderPath) === resolvedPath) {
        return
      }

      if (await this.shouldIgnorePath(folderPath, this.#settings)) {
        return
      }

      await this.applyFolderRule({
        watchId: watch.id,
        folderPath,
        source: 'watcher',
      })
    })

    watcher.on('error', async (error) => {
      this.#runtime.set(watch.id, {
        active: false,
        message: `Watcher error: ${error.message}`,
      })
      await this.store.appendEvent({
        level: 'error',
        message: `Watcher error for ${watch.name}: ${error.message}`,
        watchId: watch.id,
        watchName: watch.name,
        source: 'watcher',
      })
    })

    this.#watchers.set(watch.id, {
      instance: watcher,
      signature,
    })

    this.#runtime.set(watch.id, {
      active: true,
      message: watch.recursive ? 'Watcher active (recursive)' : 'Watcher active',
    })
  }

  #markServiceStopped() {
    for (const watch of this.store.getState().watches) {
      this.#runtime.set(watch.id, {
        active: false,
        message: 'Service stopped',
      })
    }
  }
}

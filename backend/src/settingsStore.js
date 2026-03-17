import fs from 'node:fs/promises'

import { DATA_DIR, DEFAULT_SETTINGS, SETTINGS_FILE } from './constants.js'

const THEMES = new Set(['dark', 'light', 'system'])

function normalizeLoadedSettings(settings) {
  return {
    runAtStartup:
      typeof settings?.runAtStartup === 'boolean'
        ? settings.runAtStartup
        : DEFAULT_SETTINGS.runAtStartup,
    startMinimized:
      typeof settings?.startMinimized === 'boolean'
        ? settings.startMinimized
        : DEFAULT_SETTINGS.startMinimized,
    pollingIntervalSeconds:
      Number.isInteger(settings?.pollingIntervalSeconds) && settings.pollingIntervalSeconds > 0
        ? settings.pollingIntervalSeconds
        : DEFAULT_SETTINGS.pollingIntervalSeconds,
    reapplyOnStartup:
      typeof settings?.reapplyOnStartup === 'boolean'
        ? settings.reapplyOnStartup
        : DEFAULT_SETTINGS.reapplyOnStartup,
    ignoreHiddenItems:
      typeof settings?.ignoreHiddenItems === 'boolean'
        ? settings.ignoreHiddenItems
        : DEFAULT_SETTINGS.ignoreHiddenItems,
    theme: THEMES.has(settings?.theme) ? settings.theme : DEFAULT_SETTINGS.theme,
    logRetentionDays:
      Number.isInteger(settings?.logRetentionDays) && settings.logRetentionDays > 0
        ? settings.logRetentionDays
        : DEFAULT_SETTINGS.logRetentionDays,
  }
}

export function validateSettingsUpdate(payload, currentSettings = DEFAULT_SETTINGS) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Settings payload must be a JSON object.')
  }

  const candidate = {
    ...currentSettings,
    ...payload,
  }

  if (typeof candidate.runAtStartup !== 'boolean') {
    throw new Error('runAtStartup must be a boolean.')
  }

  if (typeof candidate.startMinimized !== 'boolean') {
    throw new Error('startMinimized must be a boolean.')
  }

  if (!Number.isInteger(candidate.pollingIntervalSeconds) || candidate.pollingIntervalSeconds < 1) {
    throw new Error('pollingIntervalSeconds must be an integer greater than or equal to 1.')
  }

  if (candidate.pollingIntervalSeconds > 3600) {
    throw new Error('pollingIntervalSeconds must be less than or equal to 3600.')
  }

  if (typeof candidate.reapplyOnStartup !== 'boolean') {
    throw new Error('reapplyOnStartup must be a boolean.')
  }

  if (typeof candidate.ignoreHiddenItems !== 'boolean') {
    throw new Error('ignoreHiddenItems must be a boolean.')
  }

  if (!THEMES.has(candidate.theme)) {
    throw new Error('theme must be one of: dark, light, system.')
  }

  if (!Number.isInteger(candidate.logRetentionDays) || candidate.logRetentionDays < 1) {
    throw new Error('logRetentionDays must be an integer greater than or equal to 1.')
  }

  if (candidate.logRetentionDays > 3650) {
    throw new Error('logRetentionDays must be less than or equal to 3650.')
  }

  return candidate
}

export class SettingsStore {
  #settings = structuredClone(DEFAULT_SETTINGS)
  #queue = Promise.resolve()

  async load() {
    await fs.mkdir(DATA_DIR, { recursive: true })

    try {
      const raw = await fs.readFile(SETTINGS_FILE, 'utf8')
      this.#settings = normalizeLoadedSettings(JSON.parse(raw))
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error
      }

      this.#settings = structuredClone(DEFAULT_SETTINGS)
      await fs.writeFile(SETTINGS_FILE, JSON.stringify(this.#settings, null, 2), 'utf8')
    }

    return this.getSettings()
  }

  getSettings() {
    return structuredClone(this.#settings)
  }

  async save(nextSettings) {
    const validatedSettings = validateSettingsUpdate(nextSettings, DEFAULT_SETTINGS)
    let snapshot

    this.#queue = this.#queue.then(async () => {
      this.#settings = validatedSettings
      await fs.writeFile(SETTINGS_FILE, JSON.stringify(this.#settings, null, 2), 'utf8')
      snapshot = this.getSettings()
    })

    await this.#queue
    return snapshot
  }

  async update(payload) {
    return this.save(validateSettingsUpdate(payload, this.#settings))
  }
}

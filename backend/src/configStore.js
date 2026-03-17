import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

import { DATA_DIR, DEFAULT_STATE, ICONS_DIR, MAX_EVENTS, STATE_FILE, TEMP_DIR } from './constants.js'

function normalizeRule(rule) {
  return {
    id: String(rule.id || randomUUID()),
    keyword: String(rule.keyword || '').trim(),
    iconId: rule.iconId ? String(rule.iconId) : null,
  }
}

function normalizeWatch(watch) {
  return {
    id: String(watch.id || randomUUID()),
    name: String(watch.name || '').trim(),
    directoryPath: String(watch.directoryPath || '').trim(),
    defaultIconId: watch.defaultIconId ? String(watch.defaultIconId) : null,
    recursive: watch.recursive !== false,
    enabled: watch.enabled !== false,
    createdAt: watch.createdAt || new Date().toISOString(),
    rules: Array.isArray(watch.rules) ? watch.rules.map(normalizeRule) : [],
  }
}

function normalizeIcon(icon) {
  return {
    id: String(icon.id || randomUUID()),
    name: String(icon.name || '').trim(),
    fileName: String(icon.fileName || '').trim(),
    sourceName: String(icon.sourceName || '').trim(),
    createdAt: icon.createdAt || new Date().toISOString(),
    sizes: Array.isArray(icon.sizes) ? icon.sizes.filter(Number.isFinite).sort((a, b) => a - b) : [],
  }
}

function normalizeEvent(event) {
  return {
    id: String(event.id || randomUUID()),
    level: event.level || 'info',
    message: String(event.message || '').trim(),
    timestamp: event.timestamp || new Date().toISOString(),
    folderPath: event.folderPath ? String(event.folderPath) : undefined,
    watchId: event.watchId ? String(event.watchId) : undefined,
    watchName: event.watchName ? String(event.watchName) : undefined,
    iconName: event.iconName ? String(event.iconName) : undefined,
    source: event.source ? String(event.source) : undefined,
  }
}

function normalizeState(state) {
  return {
    icons: Array.isArray(state?.icons) ? state.icons.map(normalizeIcon) : [],
    watches: Array.isArray(state?.watches) ? state.watches.map(normalizeWatch) : [],
    events: Array.isArray(state?.events)
      ? state.events.map(normalizeEvent).slice(0, MAX_EVENTS)
      : [],
  }
}

export class ConfigStore {
  #state = structuredClone(DEFAULT_STATE)
  #queue = Promise.resolve()

  async load() {
    await fs.mkdir(DATA_DIR, { recursive: true })
    await fs.mkdir(ICONS_DIR, { recursive: true })
    await fs.mkdir(TEMP_DIR, { recursive: true })

    try {
      const raw = await fs.readFile(STATE_FILE, 'utf8')
      this.#state = normalizeState(JSON.parse(raw))
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error
      }

      this.#state = structuredClone(DEFAULT_STATE)
      await fs.writeFile(STATE_FILE, JSON.stringify(this.#state, null, 2), 'utf8')
    }

    return this.getState()
  }

  getState() {
    return structuredClone(this.#state)
  }

  async update(mutator) {
    let snapshot
    this.#queue = this.#queue.then(async () => {
      const draft = this.getState()
      const nextState = (await mutator(draft)) || draft
      this.#state = normalizeState(nextState)
      await fs.writeFile(STATE_FILE, JSON.stringify(this.#state, null, 2), 'utf8')
      snapshot = this.getState()
    })

    await this.#queue
    return snapshot
  }

  async appendEvent(event) {
    const record = normalizeEvent(event)

    await this.update((draft) => {
      draft.events = [record, ...draft.events].slice(0, MAX_EVENTS)
      return draft
    })

    return record
  }

  async pruneEventsOlderThan(days) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    let removed = 0

    await this.update((draft) => {
      const nextEvents = draft.events.filter((event) => {
        const timestamp = Date.parse(event.timestamp)
        if (Number.isNaN(timestamp)) {
          return true
        }

        return timestamp >= cutoff
      })

      removed = draft.events.length - nextEvents.length
      draft.events = nextEvents
      return draft
    })

    return removed
  }
}

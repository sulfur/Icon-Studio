import { RETENTION_INTERVAL_MS } from './constants.js'

export class EventRetentionService {
  #timer = null
  #retentionDays = null

  constructor({ store }) {
    this.store = store
  }

  async start(settings) {
    await this.applySettings(settings, { runImmediately: true })
  }

  async applySettings(settings, options = {}) {
    this.#retentionDays = settings.logRetentionDays

    if (this.#timer) {
      clearInterval(this.#timer)
    }

    if (options.runImmediately) {
      await this.runNow()
    }

    this.#timer = setInterval(() => {
      void this.runNow()
    }, RETENTION_INTERVAL_MS)
  }

  async runNow() {
    if (!this.#retentionDays) {
      return 0
    }

    return this.store.pruneEventsOlderThan(this.#retentionDays)
  }

  stop() {
    if (this.#timer) {
      clearInterval(this.#timer)
      this.#timer = null
    }
  }
}

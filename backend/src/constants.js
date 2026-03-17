import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const ROOT_DIR = path.resolve(__dirname, '..')
export const DATA_DIR = process.env.ICON_STUDIO_DATA_DIR
  ? path.resolve(process.env.ICON_STUDIO_DATA_DIR)
  : path.join(ROOT_DIR, 'data')
export const ICONS_DIR = path.join(DATA_DIR, 'icons')
export const TEMP_DIR = process.env.ICON_STUDIO_TEMP_DIR
  ? path.resolve(process.env.ICON_STUDIO_TEMP_DIR)
  : path.join(ROOT_DIR, 'temp')
export const STATE_FILE = path.join(DATA_DIR, 'app-state.json')
export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')
export const WEB_DIST_DIR = process.env.ICON_STUDIO_WEB_DIST_DIR
  ? path.resolve(process.env.ICON_STUDIO_WEB_DIST_DIR)
  : path.resolve(ROOT_DIR, '..', 'web', 'dist')
export const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256]
export const DESKTOP_INI_MARKER = '; Managed by Icon Studio'
export const LEGACY_DESKTOP_INI_MARKERS = [
  DESKTOP_INI_MARKER,
  '; Managed by Folder Icon Studio',
]
export const MAX_EVENTS = 200
export const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000
export const STARTUP_REGISTRY_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
export const STARTUP_VALUE_NAME = 'IconStudio'

export const DEFAULT_STATE = {
  icons: [],
  watches: [],
  events: [],
}

export const DEFAULT_SETTINGS = {
  runAtStartup: false,
  startMinimized: false,
  pollingIntervalSeconds: 5,
  reapplyOnStartup: false,
  ignoreHiddenItems: false,
  theme: 'dark',
  logRetentionDays: 30,
}

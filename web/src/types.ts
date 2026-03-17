export type IconRecord = {
  id: string
  name: string
  fileName: string
  sourceName: string
  createdAt: string
  sizes: number[]
  previewUrl: string
  usageCount: number
}

export type KeywordRule = {
  id: string
  keyword: string
  iconId: string | null
}

export type WatchRecord = {
  id: string
  name: string
  directoryPath: string
  defaultIconId: string | null
  recursive: boolean
  enabled: boolean
  createdAt: string
  rules: KeywordRule[]
}

export type ActivityEvent = {
  id: string
  level: 'info' | 'success' | 'warning' | 'error'
  message: string
  timestamp: string
  folderPath?: string
  watchId?: string
  watchName?: string
  iconName?: string
  source?: string
}

export type RuntimeWatch = {
  id: string
  active: boolean
  message: string
}

export type RuntimeState = {
  platform: string
  windowsSupported: boolean
  activeCount: number
  watchers: RuntimeWatch[]
}

export type AppSettings = {
  // System
  runAtStartup: boolean
  startMinimized: boolean
  // Monitoring
  pollingIntervalSeconds: number
  reapplyOnStartup: boolean
  ignoreHiddenItems: boolean
  // Application
  theme: 'dark' | 'light' | 'system'
  logRetentionDays: number
}

export type AppState = {
  icons: IconRecord[]
  watches: WatchRecord[]
  events: ActivityEvent[]
  runtime: RuntimeState
  settings: AppSettings
}

export type WatchFormRule = {
  id: string
  keyword: string
  iconId: string
}

export type WatchFormValues = {
  name: string
  directoryPath: string
  defaultIconId: string
  recursive: boolean
  enabled: boolean
  rules: WatchFormRule[]
}

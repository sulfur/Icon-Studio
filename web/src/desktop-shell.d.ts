export {}

declare global {
  interface Window {
    iconStudioDesktop?: {
      isDesktop: boolean
      hideToTray: () => Promise<void>
      minimize: () => Promise<void>
      toggleMaximize: () => Promise<{ maximized: boolean }>
      closeWindow: () => Promise<void>
      getWindowState: () => Promise<{ maximized: boolean }>
      quit: () => Promise<void>
      onNavigate: (
        callback: (payload: { view?: 'dashboard' | 'monitors' | 'library' | 'activity' | 'settings'; settingsTab?: 'system' | 'monitoring' | 'maintenance' | 'service' }) => void,
      ) => () => void
      onWindowState: (
        callback: (payload: { maximized: boolean }) => void,
      ) => () => void
    }
  }
}

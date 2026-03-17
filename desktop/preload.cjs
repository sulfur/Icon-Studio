const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('iconStudioDesktop', {
  isDesktop: true,
  hideToTray: () => ipcRenderer.invoke('desktop:hide-to-tray'),
  minimize: () => ipcRenderer.invoke('desktop:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('desktop:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('desktop:close-window'),
  getWindowState: () => ipcRenderer.invoke('desktop:get-window-state'),
  quit: () => ipcRenderer.invoke('desktop:quit'),
  onNavigate: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('desktop:navigate', listener)

    return () => {
      ipcRenderer.removeListener('desktop:navigate', listener)
    }
  },
  onWindowState: (callback) => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('desktop:window-state', listener)

    return () => {
      ipcRenderer.removeListener('desktop:window-state', listener)
    }
  },
})

const { contextBridge, ipcRenderer } = require("electron")

contextBridge.exposeInMainWorld("electronAPI", {
  // Main window API
  updateTray: (state) => ipcRenderer.send("update-tray", state),
  getApiUrl: () => ipcRenderer.invoke("get-api-url"),
  getPlatform: () => ipcRenderer.invoke("get-platform"),
  isDev: () => ipcRenderer.invoke("is-dev"),
  onNavigate: (callback) => ipcRenderer.on("navigate", (_event, path) => callback(path)),
  onCompose: (callback) => ipcRenderer.on("compose", () => callback()),
  onFocusSearch: (callback) => ipcRenderer.on("focus-search", () => callback()),
  onSelectAlias: (callback) => ipcRenderer.on("select-alias", (_event, handle) => callback(handle)),
  onOpenMessage: (callback) => ipcRenderer.on("open-message", (_event, payload) => callback(payload)),
  onRefreshInbox: (callback) => ipcRenderer.on("refresh-inbox", () => callback()),

  // Tray panel API (called from tray.html)
  selectAliasFromTray: (handle) => ipcRenderer.send("tray-select-alias", handle),
  openMessageFromTray: (payload) => ipcRenderer.send("tray-open-message", payload),
  composeFromTray: () => ipcRenderer.send("tray-compose"),
  focusSearchFromTray: () => ipcRenderer.send("tray-search"),
  openInboxFromTray: () => ipcRenderer.send("tray-open-inbox"),
  refreshFromTray: () => ipcRenderer.send("tray-refresh"),
  quitFromTray: () => ipcRenderer.send("tray-quit"),

  // Tray panel receives state
  onTrayState: (callback) => ipcRenderer.on("tray-state", (_event, state) => callback(state)),

  // Force sign-in navigation from renderer
  forceSignIn: () => ipcRenderer.send("force-sign-in"),

  // Update checker
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  getUpdateResult: () => ipcRenderer.invoke("get-update-result"),
  openVerifiedUpdate: () => ipcRenderer.invoke("open-verified-update"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  onUpdateAvailable: (callback) => ipcRenderer.on("update-available", (_event, result) => callback(result)),
  onUpdateCheckResult: (callback) => ipcRenderer.on("update-check-result", (_event, result) => callback(result)),
})

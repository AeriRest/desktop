const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, protocol, net, screen } = require("electron")
const path = require("path")
const {
  attachNavigationGuards,
  openExternalHttps,
  resolveAppProtocolPath,
} = require("./electron/security")

const isDev = !app.isPackaged
const API_URL = process.env.API_URL || "https://api.aeri.rest"
const NEXT_PORT = 3000
const navOptions = { isDev, nextPort: NEXT_PORT }
const electronDir = path.join(__dirname, "electron")

if (!isDev) {
  protocol.registerSchemesAsPrivileged([
    { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ])
}

let mainWindow = null
let trayPanel = null
let tray = null
let isQuitting = false
let trayState = {
  totalUnread: 0,
  recentMessages: [],
  aliases: [],
  accountEmail: "",
  plan: "",
  connected: true,
  reconnecting: false,
}

const TRAY_ICON_SIZE = 22

function trayIconPath(unread) {
  return path.join(electronDir, unread ? "trayUnread.png" : "trayTemplate.png")
}

function createTrayIcon(_badge) {
  const image = nativeImage.createFromPath(trayIconPath(false))
  if (image.isEmpty()) {
    console.error("[aeri] tray icon failed to load:", trayIconPath(false))
  }
  const sized = image.resize({ width: TRAY_ICON_SIZE, height: TRAY_ICON_SIZE })
  if (process.platform === "darwin") {
    sized.setTemplateImage(true)
  }
  return sized
}

function updateTray(state) {
  if (!tray) return
  trayState = { ...trayState, ...state }
  const icon = createTrayIcon(trayState.totalUnread)
  tray.setImage(icon)
  tray.setTitle("")
  tray.setToolTip(
    trayState.totalUnread > 0
      ? `aeri — ${trayState.totalUnread} unread`
      : "aeri — No unread messages"
  )
  if (trayPanel && !trayPanel.isDestroyed()) {
    trayPanel.webContents.send("tray-state", trayState)
  }
}

function createTrayPanel() {
  if (trayPanel && !trayPanel.isDestroyed()) {
    trayPanel.focus()
    return
  }

  const trayIconBounds = tray.getBounds()
  const display = screen.getDisplayMatching(trayIconBounds)
  const screenBounds = display.bounds
  const panelWidth = 300
  const panelHeight = 520
  const margin = 8

  let x = trayIconBounds.x + trayIconBounds.width / 2 - panelWidth / 2
  let y = trayIconBounds.y + trayIconBounds.height + margin

  if (y + panelHeight > screenBounds.y + screenBounds.height) {
    y = trayIconBounds.y - panelHeight - margin
  }
  if (x + panelWidth > screenBounds.x + screenBounds.width) {
    x = screenBounds.x + screenBounds.width - panelWidth - margin
  }
  if (x < screenBounds.x) {
    x = screenBounds.x + margin
  }

  trayPanel = new BrowserWindow({
    x: Math.round(x),
    y: Math.round(y),
    width: panelWidth,
    height: panelHeight,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    movable: false,
    focusable: true,
    hasShadow: true,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(electronDir, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  if (process.platform === "darwin") trayPanel.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  attachNavigationGuards(trayPanel.webContents, navOptions)
  trayPanel.webContents.setWindowOpenHandler(({ url: linkUrl }) => {
    openExternalHttps(shell, linkUrl)
    return { action: "deny" }
  })

  trayPanel.loadFile(path.join(electronDir, "tray.html"))

  trayPanel.once("ready-to-show", () => {
    trayPanel.show()
    trayPanel.webContents.send("tray-state", trayState)
  })

  trayPanel.on("blur", () => {
    if (trayPanel && !trayPanel.isDestroyed()) {
      trayPanel.hide()
    }
  })

  trayPanel.on("closed", () => { trayPanel = null })
}

function closeTrayPanel() {
  if (trayPanel && !trayPanel.isDestroyed()) {
    trayPanel.hide()
    trayPanel.close()
    trayPanel = null
  }
}

function focusMainWindow() {
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
  }
}

function createMainWindow() {
  const isMacOS = process.platform === "darwin"

  const windowOptions = {
    width: 1120,
    height: 720,
    minWidth: 680,
    minHeight: 480,
    backgroundColor: "#09090b",
    show: false,
    webPreferences: {
      preload: path.join(electronDir, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: true,
    },
  }

  if (isMacOS) {
    windowOptions.titleBarStyle = "hiddenInset"
    windowOptions.trafficLightPosition = { x: 14, y: 18 }
    windowOptions.vibrancy = "under-window"
    windowOptions.visualEffectState = "active"
  }

  mainWindow = new BrowserWindow(windowOptions)

  attachNavigationGuards(mainWindow.webContents, navOptions)
  mainWindow.webContents.setWindowOpenHandler(({ url: linkUrl }) => {
    openExternalHttps(shell, linkUrl)
    return { action: "deny" }
  })

  if (isDev) {
    mainWindow.loadURL(`http://localhost:${NEXT_PORT}`)
    mainWindow.webContents.openDevTools({ mode: "detach" })
  } else {
    mainWindow.loadURL("app://localhost/index.html")
  }

  mainWindow.once("ready-to-show", () => mainWindow.show())

  mainWindow.on("close", (event) => {
    if (!isQuitting && process.platform === "darwin") {
      event.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.on("closed", () => { mainWindow = null })

  if (!isDev) {
    mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
      console.error(`[aeri] Failed to load: ${validatedURL} — ${errorCode} ${errorDescription}`)
    })
    mainWindow.webContents.on("render-process-gone", (_event, details) => {
      console.error(`[aeri] Renderer crashed: ${details.reason}`, details)
    })
    mainWindow.webContents.on("unresponsive", () => {
      console.warn("[aeri] Renderer became unresponsive")
    })
    mainWindow.webContents.on("console-message", (_event, level, message) => {
      if (level >= 2) console.error(`[aeri:renderer] ${message}`)
    })
  }
}

function setupMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: "aeri",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "message",
      submenu: [
        {
          label: "new message",
          accelerator: "CmdOrCtrl+N",
          click: () => {
            focusMainWindow()
            if (mainWindow) mainWindow.webContents.send("compose")
          },
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    {
      label: "edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "selectAll" },
      ],
    },
    {
      label: "view",
      submenu: [
        {
          label: "inbox",
          accelerator: "CmdOrCtrl+1",
          click: () => {
            focusMainWindow()
            if (mainWindow) mainWindow.webContents.send("navigate", "/inbox")
          },
        },
        {
          label: "sent",
          accelerator: "CmdOrCtrl+2",
          click: () => {
            focusMainWindow()
            if (mainWindow) mainWindow.webContents.send("navigate", "/inbox")
          },
        },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
        { type: "separator" },
        { role: "window" },
      ],
    },
  ]))
}

app.whenReady().then(() => {
  // Keep aeri in the Dock and Cmd+Tab switcher (not a menu-bar-only agent).
  if (process.platform === "darwin") {
    app.setActivationPolicy("regular")
    app.dock?.show()
  }

  if (!isDev) {
    const outDir = path.join(__dirname, "out")
    protocol.handle("app", (request) => {
      const filePath = resolveAppProtocolPath(outDir, request.url)
      if (!filePath) {
        return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } })
      }
      return net.fetch(`file://${filePath}`)
    })
  }

  if (process.platform === "darwin") setupMenu()
  else Menu.setApplicationMenu(null)
  createMainWindow()

  const icon = createTrayIcon(0)
  tray = new Tray(icon)
  tray.setTitle("")
  tray.setToolTip("aeri — No unread messages")

  tray.on("click", () => {
    if (trayPanel && !trayPanel.isDestroyed()) {
      closeTrayPanel()
    } else {
      createTrayPanel()
    }
  })

  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow()
    else focusMainWindow()
  })
})

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit() })
app.on("before-quit", () => { isQuitting = true })

// IPC
ipcMain.on("update-tray", (_event, state) => updateTray(state))
ipcMain.handle("get-api-url", () => API_URL)
ipcMain.handle("get-platform", () => process.platform)
ipcMain.handle("is-dev", () => isDev)

// Tray panel IPC
ipcMain.on("tray-select-alias", (_event, handle) => {
  closeTrayPanel()
  if (mainWindow) {
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send("select-alias", handle)
  }
})

ipcMain.on("tray-compose", () => {
  closeTrayPanel()
  focusMainWindow()
  if (mainWindow) mainWindow.webContents.send("compose")
})

ipcMain.on("tray-search", () => {
  closeTrayPanel()
  focusMainWindow()
  if (mainWindow) mainWindow.webContents.send("focus-search")
})

ipcMain.on("tray-open-inbox", () => {
  closeTrayPanel()
  focusMainWindow()
  if (mainWindow) mainWindow.webContents.send("navigate", "/inbox")
})

ipcMain.on("tray-refresh", () => {
  if (mainWindow) mainWindow.webContents.send("refresh-inbox")
})

ipcMain.on("tray-quit", () => {
  isQuitting = true
  app.quit()
})

ipcMain.on("force-sign-in", () => {
  if (mainWindow) {
    mainWindow.loadURL(isDev ? `http://localhost:${NEXT_PORT}/sign-in` : "app://localhost/sign-in")
  }
})

const path = require("path")
const fs = require("fs")

function isAllowedNavigationUrl(urlString, { isDev = false, nextPort = 3000 } = {}) {
  let url
  try {
    url = new URL(urlString)
  } catch {
    return false
  }
  if (url.protocol === "app:") return true
  if (!isDev) return false
  if (url.protocol !== "http:" && url.protocol !== "https:") return false
  const host = url.hostname
  if (host !== "localhost" && host !== "127.0.0.1") return false
  if (url.port && url.port !== String(nextPort) && url.port !== "") return false
  return true
}

function isAllowedExternalUrl(urlString) {
  let url
  try {
    url = new URL(urlString)
  } catch {
    return false
  }
  return url.protocol === "https:"
}

function resolveAppProtocolPath(outDir, requestUrl) {
  const root = path.resolve(outDir)
  let pathname
  try {
    pathname = decodeURIComponent(new URL(requestUrl).pathname)
  } catch {
    return null
  }
  const relative = pathname.replace(/^\/+/, "")
  if (!relative) {
    const indexPath = path.join(root, "index.html")
    return fs.existsSync(indexPath) ? indexPath : null
  }
  const segments = relative.split(/[/\\]/).filter(Boolean)
  if (segments.some((s) => s === ".." || path.isAbsolute(s))) return null
  let filePath = path.resolve(root, ...segments)
  if (filePath !== root && !filePath.startsWith(root + path.sep)) return null
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html")
    if (filePath !== root && !filePath.startsWith(root + path.sep)) return null
  }
  if (!fs.existsSync(filePath)) {
    const fallback = path.join(root, "index.html")
    if (!fallback.startsWith(root + path.sep) && fallback !== root) return null
    return fs.existsSync(fallback) ? fallback : null
  }
  if (filePath !== root && !filePath.startsWith(root + path.sep)) return null
  return filePath
}

function attachNavigationGuards(webContents, options = {}) {
  const check = (event, url) => {
    if (!isAllowedNavigationUrl(url, options)) {
      event.preventDefault()
    }
  }
  webContents.on("will-navigate", check)
  webContents.on("will-redirect", check)
}

function openExternalHttps(shell, urlString) {
  if (!isAllowedExternalUrl(urlString)) return false
  shell.openExternal(urlString)
  return true
}

module.exports = {
  isAllowedNavigationUrl,
  isAllowedExternalUrl,
  resolveAppProtocolPath,
  attachNavigationGuards,
  openExternalHttps,
}

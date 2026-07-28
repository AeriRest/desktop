const crypto = require("crypto")
const fs = require("fs")
const path = require("path")

const CHECKSUMS_NAME = "SHA256SUMS"
const SIGNATURE_NAME = "SHA256SUMS.sig"
const DEFAULT_PUBLIC_KEY_PATH = path.join(__dirname, "keys", "update-ed25519.pub.pem")

function loadUpdatePublicKey(keyPath = DEFAULT_PUBLIC_KEY_PATH) {
  return fs.readFileSync(keyPath, "utf8")
}

function parseSha256Sums(text) {
  const map = new Map()
  if (typeof text !== "string") return map
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(trimmed)
    if (!match) continue
    const digest = match[1].toLowerCase()
    const fileName = path.basename(match[2].trim())
    if (fileName) map.set(fileName, digest)
  }
  return map
}

function sha256Hex(data) {
  return crypto.createHash("sha256").update(data).digest("hex")
}

function verifyEd25519Signature(message, signature, publicKeyPem) {
  if (!Buffer.isBuffer(message)) message = Buffer.from(message)
  if (!Buffer.isBuffer(signature)) signature = Buffer.from(signature)
  if (!publicKeyPem || signature.length !== 64) return false
  try {
    return crypto.verify(null, message, publicKeyPem, signature)
  } catch {
    return false
  }
}

function findAssetByName(assets, name) {
  if (!Array.isArray(assets)) return null
  const lower = String(name).toLowerCase()
  return assets.find((a) => String(a?.name || "").toLowerCase() === lower) || null
}

function pickPlatformArtifact(assets, platform = process.platform) {
  if (!Array.isArray(assets)) return null
  if (platform === "darwin") {
    return assets.find((a) => /\.dmg$/i.test(a?.name || "")) || null
  }
  if (platform === "win32") {
    return assets.find((a) => /\.exe$/i.test(a?.name || "")) || null
  }
  return null
}

function isTrustedGithubDownloadUrl(urlString, repo) {
  let url
  try {
    url = new URL(urlString)
  } catch {
    return false
  }
  if (url.protocol !== "https:") return false
  const host = url.hostname.toLowerCase()
  if (host === "github.com") {
    const prefix = `/${repo}/releases/download/`
    return url.pathname.startsWith(prefix) || url.pathname.startsWith(prefix.toLowerCase())
  }
  if (host === "objects.githubusercontent.com" || host.endsWith(".githubusercontent.com")) {
    return true
  }
  return false
}

function verifyChecksumsDocument({ checksumsText, signature, publicKeyPem }) {
  if (typeof checksumsText !== "string" || !checksumsText.trim()) {
    return { ok: false, reason: "missing-checksums" }
  }
  if (!verifyEd25519Signature(checksumsText, signature, publicKeyPem)) {
    return { ok: false, reason: "invalid-signature" }
  }
  const checksums = parseSha256Sums(checksumsText)
  if (checksums.size === 0) {
    return { ok: false, reason: "empty-checksums" }
  }
  return { ok: true, checksums }
}

function verifyArtifactListing({ checksums, artifactName }) {
  if (!(checksums instanceof Map)) {
    return { ok: false, reason: "missing-checksums" }
  }
  const base = path.basename(artifactName || "")
  const expectedSha256 = checksums.get(base)
  if (!expectedSha256) {
    return { ok: false, reason: "artifact-not-listed" }
  }
  return { ok: true, expectedSha256, artifactName: base }
}

function verifyArtifactBytes({ data, expectedSha256 }) {
  if (!expectedSha256 || !/^[a-f0-9]{64}$/.test(expectedSha256)) {
    return { ok: false, reason: "missing-expected-hash" }
  }
  const actual = sha256Hex(data)
  if (actual !== expectedSha256.toLowerCase()) {
    return { ok: false, reason: "hash-mismatch", actualSha256: actual }
  }
  return { ok: true, sha256: actual }
}

async function verifyReleaseUpdateIntegrity({
  assets,
  platform,
  repo,
  publicKeyPem,
  fetchBuffer,
}) {
  const artifact = pickPlatformArtifact(assets, platform)
  if (!artifact?.name || !artifact?.browser_download_url) {
    return { ok: false, reason: "missing-artifact", artifact: null }
  }
  if (!isTrustedGithubDownloadUrl(artifact.browser_download_url, repo)) {
    return { ok: false, reason: "untrusted-download-url", artifact }
  }

  const sumsAsset = findAssetByName(assets, CHECKSUMS_NAME)
  const sigAsset = findAssetByName(assets, SIGNATURE_NAME)
  if (!sumsAsset?.browser_download_url || !sigAsset?.browser_download_url) {
    return { ok: false, reason: "missing-signature-assets", artifact }
  }
  if (
    !isTrustedGithubDownloadUrl(sumsAsset.browser_download_url, repo) ||
    !isTrustedGithubDownloadUrl(sigAsset.browser_download_url, repo)
  ) {
    return { ok: false, reason: "untrusted-signature-url", artifact }
  }

  let checksumsText
  let signature
  try {
    const sumsBuf = await fetchBuffer(sumsAsset.browser_download_url)
    const sigBuf = await fetchBuffer(sigAsset.browser_download_url)
    checksumsText = Buffer.from(sumsBuf).toString("utf8")
    signature = Buffer.from(sigBuf)
  } catch {
    return { ok: false, reason: "fetch-failed", artifact }
  }

  const doc = verifyChecksumsDocument({ checksumsText, signature, publicKeyPem })
  if (!doc.ok) {
    return { ok: false, reason: doc.reason, artifact }
  }

  const listing = verifyArtifactListing({ checksums: doc.checksums, artifactName: artifact.name })
  if (!listing.ok) {
    return { ok: false, reason: listing.reason, artifact }
  }

  return {
    ok: true,
    artifact,
    expectedSha256: listing.expectedSha256,
    downloadUrl: artifact.browser_download_url,
  }
}

module.exports = {
  CHECKSUMS_NAME,
  SIGNATURE_NAME,
  DEFAULT_PUBLIC_KEY_PATH,
  loadUpdatePublicKey,
  parseSha256Sums,
  sha256Hex,
  verifyEd25519Signature,
  findAssetByName,
  pickPlatformArtifact,
  isTrustedGithubDownloadUrl,
  verifyChecksumsDocument,
  verifyArtifactListing,
  verifyArtifactBytes,
  verifyReleaseUpdateIntegrity,
}

const { describe, it } = require("node:test")
const assert = require("node:assert/strict")
const fs = require("fs")
const os = require("os")
const path = require("path")
const {
  isAllowedNavigationUrl,
  isAllowedExternalUrl,
  isBlockedUnsignedUpdateAssetUrl,
  resolveAppProtocolPath,
} = require("./security")

describe("isAllowedNavigationUrl", () => {
  it("allows app:// always", () => {
    assert.equal(isAllowedNavigationUrl("app://localhost/index.html"), true)
    assert.equal(isAllowedNavigationUrl("app://localhost/sign-in", { isDev: false }), true)
  })

  it("blocks http in production", () => {
    assert.equal(isAllowedNavigationUrl("http://localhost:3000/", { isDev: false }), false)
    assert.equal(isAllowedNavigationUrl("https://evil.example/", { isDev: false }), false)
  })

  it("allows localhost only in dev", () => {
    assert.equal(isAllowedNavigationUrl("http://localhost:3000/", { isDev: true, nextPort: 3000 }), true)
    assert.equal(isAllowedNavigationUrl("http://127.0.0.1:3000/sign-in", { isDev: true }), true)
    assert.equal(isAllowedNavigationUrl("http://evil.example/", { isDev: true }), false)
    assert.equal(isAllowedNavigationUrl("file:///etc/passwd", { isDev: true }), false)
  })
})

describe("isAllowedExternalUrl", () => {
  it("allows only https", () => {
    assert.equal(isAllowedExternalUrl("https://aeri.rest/docs"), true)
    assert.equal(isAllowedExternalUrl("http://aeri.rest/docs"), false)
    assert.equal(isAllowedExternalUrl("mailto:user@example.com"), false)
    assert.equal(isAllowedExternalUrl("javascript:alert(1)"), false)
    assert.equal(isAllowedExternalUrl("not-a-url"), false)
  })
})

describe("isBlockedUnsignedUpdateAssetUrl", () => {
  it("blocks GitHub release installers opened without verification", () => {
    assert.equal(
      isBlockedUnsignedUpdateAssetUrl(
        "https://github.com/aerirest/desktop/releases/download/v1.0.0/aeri-1.0.0-arm64.dmg",
      ),
      true,
    )
    assert.equal(
      isBlockedUnsignedUpdateAssetUrl(
        "https://objects.githubusercontent.com/github-production-release-asset-2e65be/1/aeri.exe",
      ),
      true,
    )
    assert.equal(
      isBlockedUnsignedUpdateAssetUrl("https://github.com/aerirest/desktop/releases/tag/v1.0.0"),
      false,
    )
    assert.equal(isBlockedUnsignedUpdateAssetUrl("https://aeri.rest/docs"), false)
  })
})

describe("resolveAppProtocolPath", () => {
  it("resolves files under outDir and rejects traversal", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "aeri-out-"))
    try {
      fs.writeFileSync(path.join(outDir, "index.html"), "<html></html>")
      fs.mkdirSync(path.join(outDir, "inbox"))
      fs.writeFileSync(path.join(outDir, "inbox", "index.html"), "<html>inbox</html>")

      assert.equal(
        resolveAppProtocolPath(outDir, "app://localhost/index.html"),
        path.join(outDir, "index.html"),
      )
      assert.equal(
        resolveAppProtocolPath(outDir, "app://localhost/inbox"),
        path.join(outDir, "inbox", "index.html"),
      )

      const normalized = resolveAppProtocolPath(outDir, "app://localhost/../etc/passwd")
      assert.ok(normalized === null || normalized.startsWith(outDir + path.sep))
      assert.notEqual(normalized, "/etc/passwd")

      assert.equal(resolveAppProtocolPath(outDir, "app://localhost/..%2F..%2Fetc%2Fpasswd"), null)
      assert.equal(resolveAppProtocolPath(outDir, "app://localhost/%2e%2e%2f%2e%2e%2fetc%2fpasswd"), null)

      const urlNormalized = resolveAppProtocolPath(outDir, "app://localhost/foo/%2e%2e/%2e%2e/etc/passwd")
      assert.ok(urlNormalized === null || urlNormalized.startsWith(outDir + path.sep))
      assert.notEqual(urlNormalized, "/etc/passwd")
    } finally {
      fs.rmSync(outDir, { recursive: true, force: true })
    }
  })
})

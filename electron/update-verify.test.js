const { describe, it } = require("node:test")
const assert = require("node:assert/strict")
const crypto = require("crypto")
const {
  parseSha256Sums,
  sha256Hex,
  verifyEd25519Signature,
  verifyChecksumsDocument,
  verifyArtifactListing,
  verifyArtifactBytes,
  isTrustedGithubDownloadUrl,
  pickPlatformArtifact,
  verifyReleaseUpdateIntegrity,
} = require("./update-verify")

function makeKeyPair() {
  return crypto.generateKeyPairSync("ed25519")
}

describe("parseSha256Sums", () => {
  it("parses GNU coreutils style lines", () => {
    const text = [
      "# comment",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa  aeri-1.0.0-arm64.dmg",
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb *aeri-1.0.0-Setup-x64.exe",
      "",
      "not-a-valid-line",
    ].join("\n")
    const map = parseSha256Sums(text)
    assert.equal(map.get("aeri-1.0.0-arm64.dmg"), "a".repeat(64))
    assert.equal(map.get("aeri-1.0.0-Setup-x64.exe"), "b".repeat(64))
    assert.equal(map.size, 2)
  })
})

describe("verifyEd25519Signature", () => {
  it("accepts valid signatures and rejects tampering", () => {
    const { publicKey, privateKey } = makeKeyPair()
    const pub = publicKey.export({ type: "spki", format: "pem" })
    const message = Buffer.from("SHA256SUMS contents\n", "utf8")
    const signature = crypto.sign(null, message, privateKey)
    assert.equal(verifyEd25519Signature(message, signature, pub), true)
    assert.equal(verifyEd25519Signature("tampered", signature, pub), false)
    assert.equal(verifyEd25519Signature(message, Buffer.alloc(64), pub), false)
  })
})

describe("verifyChecksumsDocument", () => {
  it("requires a valid ed25519 signature over checksums text", () => {
    const { publicKey, privateKey } = makeKeyPair()
    const pub = publicKey.export({ type: "spki", format: "pem" })
    const checksumsText = `${"c".repeat(64)}  aeri.dmg\n`
    const signature = crypto.sign(null, Buffer.from(checksumsText, "utf8"), privateKey)
    const ok = verifyChecksumsDocument({ checksumsText, signature, publicKeyPem: pub })
    assert.equal(ok.ok, true)
    assert.equal(ok.checksums.get("aeri.dmg"), "c".repeat(64))

    const bad = verifyChecksumsDocument({
      checksumsText: `${"d".repeat(64)}  aeri.dmg\n`,
      signature,
      publicKeyPem: pub,
    })
    assert.equal(bad.ok, false)
    assert.equal(bad.reason, "invalid-signature")
  })
})

describe("verifyArtifactListing and verifyArtifactBytes", () => {
  it("requires listed artifact and matching hash", () => {
    const checksums = parseSha256Sums(`${"e".repeat(64)}  aeri.dmg\n`)
    const listed = verifyArtifactListing({ checksums, artifactName: "aeri.dmg" })
    assert.equal(listed.ok, true)
    assert.equal(listed.expectedSha256, "e".repeat(64))

    const missing = verifyArtifactListing({ checksums, artifactName: "other.dmg" })
    assert.equal(missing.ok, false)

    const payload = Buffer.from("hello-update")
    const digest = sha256Hex(payload)
    assert.equal(verifyArtifactBytes({ data: payload, expectedSha256: digest }).ok, true)
    assert.equal(verifyArtifactBytes({ data: payload, expectedSha256: "f".repeat(64) }).ok, false)
  })
})

describe("isTrustedGithubDownloadUrl", () => {
  it("allows only https GitHub release download hosts for the repo", () => {
    assert.equal(
      isTrustedGithubDownloadUrl(
        "https://github.com/aerirest/desktop/releases/download/v1.0.0/aeri.dmg",
        "aerirest/desktop",
      ),
      true,
    )
    assert.equal(
      isTrustedGithubDownloadUrl(
        "https://objects.githubusercontent.com/github-production-release-asset-2e65be/123/aeri.dmg",
        "aerirest/desktop",
      ),
      true,
    )
    assert.equal(
      isTrustedGithubDownloadUrl(
        "https://evil.example/aeri.dmg",
        "aerirest/desktop",
      ),
      false,
    )
    assert.equal(
      isTrustedGithubDownloadUrl(
        "http://github.com/aerirest/desktop/releases/download/v1.0.0/aeri.dmg",
        "aerirest/desktop",
      ),
      false,
    )
    assert.equal(
      isTrustedGithubDownloadUrl(
        "https://github.com/evil/repo/releases/download/v1.0.0/aeri.dmg",
        "aerirest/desktop",
      ),
      false,
    )
  })
})

describe("verifyReleaseUpdateIntegrity", () => {
  it("verifies signed checksums before recommending a download URL", async () => {
    const { publicKey, privateKey } = makeKeyPair()
    const pub = publicKey.export({ type: "spki", format: "pem" })
    const checksumsText = `${"a".repeat(64)}  aeri-1.0.11-arm64.dmg\n`
    const signature = crypto.sign(null, Buffer.from(checksumsText, "utf8"), privateKey)
    const assets = [
      {
        name: "aeri-1.0.11-arm64.dmg",
        browser_download_url: "https://github.com/aerirest/desktop/releases/download/v1.0.11/aeri-1.0.11-arm64.dmg",
      },
      {
        name: "SHA256SUMS",
        browser_download_url: "https://github.com/aerirest/desktop/releases/download/v1.0.11/SHA256SUMS",
      },
      {
        name: "SHA256SUMS.sig",
        browser_download_url: "https://github.com/aerirest/desktop/releases/download/v1.0.11/SHA256SUMS.sig",
      },
    ]
    const byUrl = {
      [assets[1].browser_download_url]: Buffer.from(checksumsText, "utf8"),
      [assets[2].browser_download_url]: signature,
    }
    const result = await verifyReleaseUpdateIntegrity({
      assets,
      platform: "darwin",
      repo: "aerirest/desktop",
      publicKeyPem: pub,
      fetchBuffer: async (url) => byUrl[url],
    })
    assert.equal(result.ok, true)
    assert.equal(result.downloadUrl, assets[0].browser_download_url)
    assert.equal(result.expectedSha256, "a".repeat(64))

    const unsigned = await verifyReleaseUpdateIntegrity({
      assets: [assets[0]],
      platform: "darwin",
      repo: "aerirest/desktop",
      publicKeyPem: pub,
      fetchBuffer: async () => Buffer.alloc(0),
    })
    assert.equal(unsigned.ok, false)
    assert.equal(unsigned.reason, "missing-signature-assets")
  })

  it("picks platform artifacts", () => {
    const assets = [
      { name: "aeri.dmg", browser_download_url: "https://github.com/aerirest/desktop/releases/download/v1/aeri.dmg" },
      { name: "aeri.exe", browser_download_url: "https://github.com/aerirest/desktop/releases/download/v1/aeri.exe" },
    ]
    assert.equal(pickPlatformArtifact(assets, "darwin").name, "aeri.dmg")
    assert.equal(pickPlatformArtifact(assets, "win32").name, "aeri.exe")
  })
})

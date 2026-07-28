# Security

Desktop client hardening notes for Electron, credentials, and update integrity.

## Electron (Fix 6)

- `webSecurity: true` on every `BrowserWindow` (main and tray).
- `sandbox: true` on every `BrowserWindow`.
- Navigation is restricted via `will-navigate` / `will-redirect`: only `app://` is allowed in production; in development, `http(s)://localhost` / `127.0.0.1` on the Next.js port is also allowed.
- The `app://` protocol handler resolves paths under the packaged `out/` directory only. Path segments containing `..` are rejected; resolved paths that escape `outDir` return 404.
- `shell.openExternal` is limited to `https:` URLs (no `http:`, `mailto:`, or other schemes).
- GitHub release installer URLs (`.dmg` / `.exe` / similar under `releases/download` or `*.githubusercontent.com`) cannot be opened via `openExternal`. Installers must go through the verified update path.

Shared helpers live in `electron/security.js` and are covered by `npm test`.

## Credentials (Fix 7)

- Login keys (`aerimail_account_code`) are never written to `localStorage`.
- Session persistence uses only `aeri_session_token`.
- Logout and auth-failure paths clear the session token and any legacy account-code key left from older builds.
- `getStoredAccountCode` / `storeAccountCode` are no-ops that do not persist the login key.

## Update integrity (Fix 8)

The desktop client checks GitHub Releases for newer versions, but it does **not** open or install an update unless integrity verification succeeds.

### What the app verifies

1. Fetches `SHA256SUMS` and `SHA256SUMS.sig` from the same GitHub release as the installer.
2. Verifies the ed25519 detached signature of `SHA256SUMS` with the public key bundled at `electron/keys/update-ed25519.pub.pem`.
3. Confirms the platform artifact (`.dmg` / `.exe`) is listed in `SHA256SUMS`.
4. On download: fetches the artifact, checks its SHA-256 against the signed checksums entry, then opens the verified local file with `shell.openPath` (never a raw unverified download URL).

If signature assets are missing or invalid, the UI still shows that an update exists, but download stays disabled (`integrityVerified: false`).

Helpers: `electron/update-verify.js`.

### Operator release signing

Generate an ed25519 keypair once (keep the private key offline / in release secrets; never commit it):

```bash
openssl genpkey -algorithm ed25519 -out update-ed25519.priv.pem
openssl pkey -in update-ed25519.priv.pem -pubout -out electron/keys/update-ed25519.pub.pem
```

If you rotate the private key, replace `electron/keys/update-ed25519.pub.pem` and ship a new app build before signing releases with the new key.

After building installers into a directory (for example `dist-electron/`):

```bash
node scripts/sign-release.js --dir dist-electron --key /path/to/update-ed25519.priv.pem
```

Upload these release assets together:

- the `.dmg` / `.exe` installer(s)
- `SHA256SUMS`
- `SHA256SUMS.sig` (raw 64-byte ed25519 signature over the exact `SHA256SUMS` bytes)

`SHA256SUMS` format (GNU coreutils style):

```
<sha256>  aeri-1.0.11-arm64.dmg
<sha256>  aeri-1.0.11-Setup-x64.exe
```

### Limitations

- This protects against tampered GitHub release assets when the signing key remains private. It is **not** Apple Developer ID code signing or notarization.
- Gatekeeper may still quarantine or block unsigned / ad-hoc-signed macOS builds. Users may still need `xattr -cr /Applications/aeri.app` until Developer ID + notarization is configured.
- Windows SmartScreen may similarly warn on unsigned `.exe` builds.
- electron-updater / Sparkle-style auto-apply is not used; the flow downloads, verifies, then opens the installer for the user.

## Verification (Fix 10)

```bash
npm test
```

Runs unit tests for navigation allowlists, HTTPS-only external opens, blocked unsigned installer URLs, `app://` path traversal rejection, session-storage credential rules, and update checksum/signature helpers.

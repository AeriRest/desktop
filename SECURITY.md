# Security

Desktop client hardening notes for Electron and credential handling.

## Electron (Fix 6)

- `webSecurity: true` on every `BrowserWindow` (main and tray).
- `sandbox: true` on every `BrowserWindow`.
- Navigation is restricted via `will-navigate` / `will-redirect`: only `app://` is allowed in production; in development, `http(s)://localhost` / `127.0.0.1` on the Next.js port is also allowed.
- The `app://` protocol handler resolves paths under the packaged `out/` directory only. Path segments containing `..` are rejected; resolved paths that escape `outDir` return 404.
- `shell.openExternal` is limited to `https:` URLs (no `http:`, `mailto:`, or other schemes).

Shared helpers live in `electron/security.js` and are covered by `npm test`.

## Credentials (Fix 7)

- Login keys (`aerimail_account_code`) are never written to `localStorage`.
- Session persistence uses only `aeri_session_token`.
- Logout and auth-failure paths clear the session token and any legacy account-code key left from older builds.
- `getStoredAccountCode` / `storeAccountCode` are no-ops that do not persist the login key.

## Verification (Fix 10)

```bash
npm test
```

Runs unit tests for navigation allowlists, HTTPS-only external opens, `app://` path traversal rejection, and session-storage credential rules.

# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in the Aeri desktop app, please report it privately.

**Do not** disclose in public GitHub issues, forums, or social media.

- **Email:** security@aeri.rest
- **Ticket:** aeri.rest/tickets

### Response timeline

- **Acknowledgement:** Within 48 hours
- **Fix:** Severity-dependent, typically within 14 days for critical issues.

## Security features

- `webSecurity: true` — Chromium web security enforced
- `contextIsolation: true` — Renderer isolated from Node.js
- `sandbox: true` — Renderer sandboxed
- Path traversal protection in custom `app://` protocol handler
- macOS hardened runtime enabled

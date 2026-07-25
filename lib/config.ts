const PROD_API_BASE = "https://api.aeri.rest/api/v1"

/** Same-origin `/api/v1` under Next/Electron or `app://localhost` (proxied). Direct calls use the real API. */
export function getApiBase(): string {
  if (typeof window !== "undefined") {
    const { protocol, hostname } = window.location
    if (
      (protocol === "http:" || protocol === "https:" || protocol === "app:") &&
      (hostname === "localhost" || hostname === "127.0.0.1")
    ) {
      return "/api/v1"
    }
  }
  return process.env.NEXT_PUBLIC_API_BASE || PROD_API_BASE
}

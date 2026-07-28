import type {
  Account,
  Alias,
  AliasAvailabilityResponse,
  AliasListResponse,
  Message,
  MessageListResponse,
  BillingStatus,
  SendMessageRequest,
  Draft,
  DraftListResponse,
  BlockedSenderListResponse,
  AccountSettings,
  BulkMessageRequest,
  CustomDomain,
  DomainListResponse,
  TotpSetupResponse,
  TotpStatusResponse,
} from "@/lib/types/api"

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = "ApiError"
  }
}

export function isAuthError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 401
}

export function getApiErrorDetail(error: unknown, fallback: string): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "Request timed out. The mail server may be unreachable — try again in a moment."
  }
  if (!(error instanceof ApiError)) return fallback
  const body = error.body
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail
    if (typeof detail === "string" && detail.trim()) return detail
  }
  return fallback
}

const SEND_REQUEST_TIMEOUT_MS = 45_000

import { getApiBase } from "@/lib/config"
import { getSessionToken } from "@/lib/session-storage"

function getApiBaseUrl(): string {
  return getApiBase()
}

function getAuthToken(): string | null {
  if (typeof window === "undefined") return null
  return getSessionToken(localStorage)
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${getApiBaseUrl()}${path}`
  const headers = new Headers(options.headers)
  const token = getAuthToken()
  if (token) headers.set("Authorization", `Bearer ${token}`)
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  const response = await fetch(url, { ...options, headers })

  if (!response.ok) {
    let body: unknown
    try { body = await response.json() } catch { body = undefined }
    const detail = body && typeof body === "object" && "detail" in body
      ? String((body as Record<string, unknown>).detail)
      : undefined
    throw new ApiError(
      detail ?? `API request failed: ${response.status} ${response.statusText}`,
      response.status,
      body,
    )
  }

  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function checkHealth(): Promise<{ status: string }> {
  return apiFetch("/health")
}

export async function getMe(): Promise<Account> {
  return apiFetch("/auth/me")
}

export async function listAliases(): Promise<AliasListResponse> {
  return apiFetch("/aliases")
}

export async function listMessages(options?: {
  view?: "inbox" | "starred" | "archive" | "sent" | "trash"
  alias?: string
  search?: string
  unread?: boolean
  has_attachment?: boolean
}): Promise<MessageListResponse> {
  const params = new URLSearchParams()
  if (options?.view) params.set("view", options.view)
  if (options?.alias) params.set("alias", options.alias)
  if (options?.search) params.set("search", options.search)
  if (options?.unread !== undefined) params.set("unread", String(options.unread))
  if (options?.has_attachment !== undefined) params.set("has_attachment", String(options.has_attachment))
  const query = params.toString()
  return apiFetch(`/messages${query ? `?${query}` : ""}`)
}

export async function markMessagesRead(options?: { alias?: string }): Promise<{ updated: number }> {
  return apiFetch("/messages/mark-read", {
    method: "POST",
    body: JSON.stringify(options?.alias ? { alias: options.alias } : {}),
  })
}

export async function patchMessage(
  messageId: string,
  patch: { read?: boolean; starred?: boolean; archived?: boolean; restore?: boolean; snoozed_until?: string | null },
): Promise<Message> {
  return apiFetch(`/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  })
}

export async function deleteMessage(messageId: string): Promise<void> {
  return apiFetch(`/messages/${messageId}`, { method: "DELETE" })
}

export async function sendMessage(body: SendMessageRequest): Promise<Message> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SEND_REQUEST_TIMEOUT_MS)
  try {
    return await apiFetch("/messages/send", {
      method: "POST",
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function bulkUpdateMessages(body: BulkMessageRequest): Promise<{ updated: number }> {
  return apiFetch("/messages/bulk", {
    method: "POST",
    body: JSON.stringify(body),
  })
}

export async function emptyTrash(): Promise<{ deleted: number }> {
  return apiFetch("/messages/empty-trash", { method: "POST" })
}

export async function listDrafts(): Promise<DraftListResponse> {
  return apiFetch("/drafts")
}

export async function upsertDraft(
  body: { from_alias?: string | null; to_address?: string | null; subject?: string; body?: string; body_html?: string | null },
  draftId?: string,
): Promise<Draft> {
  if (draftId) {
    return apiFetch(`/drafts/${draftId}`, { method: "PATCH", body: JSON.stringify(body) })
  }
  return apiFetch("/drafts", { method: "POST", body: JSON.stringify(body) })
}

export async function deleteDraft(draftId: string): Promise<void> {
  return apiFetch(`/drafts/${draftId}`, { method: "DELETE" })
}

export async function blockSender(address: string, options?: { fromAlias?: string }): Promise<{ id: string; address: string }> {
  return apiFetch("/blocked-senders", {
    method: "POST",
    body: JSON.stringify({ address, from_alias: options?.fromAlias ?? null }),
  })
}

export async function patchAlias(aliasId: string, patch: { label?: string; icon?: string; expiry?: string; notes?: string | null; burn_at?: string | null }): Promise<Alias> {
  return apiFetch(`/aliases/${aliasId}`, { method: "PATCH", body: JSON.stringify(patch) })
}

export async function burnAlias(aliasId: string): Promise<void> {
  return apiFetch(`/aliases/${aliasId}`, { method: "DELETE" })
}

export async function getBillingStatus(): Promise<BillingStatus> {
  return apiFetch("/billing/status")
}

export async function devActivatePro(secret: string): Promise<BillingStatus> {
  return apiFetch("/billing/dev-activate", { method: "POST", body: JSON.stringify({ secret }) })
}

export async function getAccountSettings(): Promise<AccountSettings> {
  return apiFetch("/account/settings")
}

export async function patchAccountSettings(patch: Partial<AccountSettings>): Promise<AccountSettings> {
  return apiFetch("/account/settings", { method: "PATCH", body: JSON.stringify(patch) })
}

export async function createAlias(body: { local_part?: string; domain: string; label?: string; icon?: string; expiry?: string }): Promise<Alias> {
  return apiFetch("/aliases", { method: "POST", body: JSON.stringify(body) })
}

export async function listDomains(): Promise<DomainListResponse> {
  return apiFetch("/domains")
}

export async function checkAliasAvailability(
  localPart: string,
  domain: string,
): Promise<AliasAvailabilityResponse> {
  const params = new URLSearchParams({ local_part: localPart, domain })
  return apiFetch(`/aliases/availability?${params}`)
}

export async function getTotalUnread(): Promise<number> {
  const data = await listAliases()
  return data.aliases.reduce((sum, alias) => sum + alias.unread, 0)
}

export function attachmentDownloadUrl(messageId: string, attachmentId: string): string {
  return `${getApiBaseUrl()}/messages/${messageId}/attachments/${attachmentId}`
}

export async function setupTotp(): Promise<TotpSetupResponse> {
  return apiFetch("/totp/setup", { method: "POST" })
}

export async function enableTotp(code: string): Promise<{ enabled: boolean }> {
  return apiFetch("/totp/enable", {
    method: "POST",
    body: JSON.stringify({ code }),
  })
}

export async function disableTotp(code: string): Promise<{ enabled: boolean }> {
  return apiFetch("/totp/disable", { method: "POST", body: JSON.stringify({ code }) })
}

export async function getTotpStatus(): Promise<TotpStatusResponse> {
  return apiFetch("/totp/status")
}

export { ApiError }

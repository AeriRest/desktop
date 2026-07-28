"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { getApiBase } from "@/lib/config"
import { clearSessionStorage, getSessionToken } from "@/lib/session-storage"
import { type RealtimeEvent } from "@/lib/realtime"
const MAX_RETRIES = 10
const BASE_RETRY_MS = 3000
const MAX_RETRY_MS = 60000

export type RealtimeHandlers = {
  onInboxChanged?: () => void
  onAliasesChanged?: () => void
  onBillingChanged?: () => void
}

export function useRealtime({ onInboxChanged, onAliasesChanged, onBillingChanged }: RealtimeHandlers) {
  const [connected, setConnected] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)

  const handlersRef = useRef({ onInboxChanged, onAliasesChanged, onBillingChanged })
  useEffect(() => {
    handlersRef.current = { onInboxChanged, onAliasesChanged, onBillingChanged }
  }, [onInboxChanged, onAliasesChanged, onBillingChanged])

  const dispatch = useCallback((event: RealtimeEvent) => {
    if (event === "connected") return
    if (event === "inbox.changed") handlersRef.current.onInboxChanged?.()
    if (event === "aliases.changed") handlersRef.current.onAliasesChanged?.()
    if (event === "billing.changed") handlersRef.current.onBillingChanged?.()
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    let cancelled = false
    let abortController: AbortController | null = null
    let retryTimer: ReturnType<typeof window.setTimeout> | undefined
    let retries = 0

    function getToken(): string | null {
      return getSessionToken(localStorage)
    }

    function isTokenExpired(token: string | null): boolean {
      if (!token) return true
      try {
        const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")
        const payload = JSON.parse(atob(base64))
        return Date.now() >= (payload.exp || 0) * 1000
      } catch {
        return true
      }
    }

    function expireSession() {
      console.log("[aeri] session expired, clearing token and navigating to sign-in")
      clearSessionStorage(localStorage)
      setConnected(false)
      setReconnecting(false)
      if (window.electronAPI?.forceSignIn) {
        window.electronAPI.forceSignIn()
      } else {
        window.location.href = "/sign-in"
      }
    }

    async function openSse() {
      if (cancelled) return
      const token = getToken()
      if (!token || isTokenExpired(token)) {
        expireSession()
        return
      }

      abortController = new AbortController()
      try {
        const res = await fetch(`${getApiBase()}/events/stream`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: abortController.signal,
        })

        if (!res.ok) {
          console.log(`[aeri] SSE stream returned ${res.status}`)
          abortController = null
          if (res.status === 401) {
            expireSession()
            return
          }
          retries++
          if (cancelled) return
          if (retries >= MAX_RETRIES) {
            console.log("[aeri] SSE gave up after max retries")
            setConnected(false)
            setReconnecting(false)
            return
          }
          const delay = Math.min(BASE_RETRY_MS * Math.pow(1.5, retries - 1), MAX_RETRY_MS)
          setReconnecting(true)
          retryTimer = window.setTimeout(connect, delay)
          return
        }

        retries = 0
        setConnected(true)
        setReconnecting(false)
        console.log("[aeri] SSE stream connected")

        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (!cancelled) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""
          let eventType = ""
          for (const line of lines) {
            if (line.startsWith("event:")) {
              eventType = line.slice(6).trim()
            } else if (line.startsWith("data:")) {
              const data = line.slice(5).trim()
              if (eventType === "connected") continue
              if (eventType === "inbox.changed" || eventType === "aliases.changed" || eventType === "billing.changed" || eventType === "new_message") {
                dispatch(eventType === "new_message" ? "inbox.changed" : eventType as RealtimeEvent)
              }
              eventType = ""
            } else if (line.trim() === "") {
              eventType = ""
            }
          }
        }
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === "AbortError")) return
        console.log("[aeri] SSE stream error:", err)
      } finally {
        abortController = null
      }

      if (cancelled) return
      retries++
      const currentToken = getToken()
      if (!currentToken || isTokenExpired(currentToken)) {
        expireSession()
        return
      }
      if (retries >= MAX_RETRIES) {
        console.log("[aeri] SSE gave up after max retries")
        setConnected(false)
        setReconnecting(false)
        return
      }
      const delay = Math.min(BASE_RETRY_MS * Math.pow(1.5, retries - 1), MAX_RETRY_MS)
      setReconnecting(true)
      retryTimer = window.setTimeout(connect, delay)
    }

    function connect() {
      if (abortController) { abortController.abort(); abortController = null }
      if (retryTimer) window.clearTimeout(retryTimer)
      const token = getToken()
      if (!token || isTokenExpired(token)) {
        expireSession()
        return
      }
      openSse()
    }

    connect()
    return () => {
      cancelled = true
      if (retryTimer) window.clearTimeout(retryTimer)
      if (abortController) abortController.abort()
      setConnected(false)
      setReconnecting(false)
    }
  }, [dispatch])

  return { connected, reconnecting }
}

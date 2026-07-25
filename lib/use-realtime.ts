"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { getApiBase } from "@/lib/config"
import { type RealtimeEvent } from "@/lib/realtime"
const MAX_RETRIES = 10
const BASE_RETRY_MS = 3000
const MAX_RETRY_MS = 60000

const SSE_DEBOUNCE_MS = 500

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

  const debounceTimersRef = useRef<Record<string, number | undefined>>({})

  const dispatch = useCallback((event: RealtimeEvent) => {
    if (event === "connected") return

    const handler =
      event === "inbox.changed" ? handlersRef.current.onInboxChanged
      : event === "aliases.changed" ? handlersRef.current.onAliasesChanged
      : event === "billing.changed" ? handlersRef.current.onBillingChanged
      : null

    if (!handler) return

    if (debounceTimersRef.current[event]) {
      window.clearTimeout(debounceTimersRef.current[event])
    }
    debounceTimersRef.current[event] = window.setTimeout(() => {
      delete debounceTimersRef.current[event]
      handler()
    }, SSE_DEBOUNCE_MS)
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    let cancelled = false
    let abortController: AbortController | null = null
    let retryTimer: number | undefined
    let retries = 0

    const getToken = (): string | null => localStorage.getItem("aeri_session_token")

    function expireSession() {
      localStorage.removeItem("aeri_session_token")
      setConnected(false)
      setReconnecting(false)
      if (window.electronAPI?.forceSignIn) {
        window.electronAPI.forceSignIn()
      } else {
        window.location.href = "/sign-in"
      }
    }

    function computeRetryDelay() {
      return Math.min(BASE_RETRY_MS * Math.pow(1.5, retries), MAX_RETRY_MS)
    }

    function scheduleReconnect() {
      if (cancelled || retries >= MAX_RETRIES) {
        setConnected(false)
        setReconnecting(false)
        return
      }
      setReconnecting(true)
      retryTimer = window.setTimeout(connect, computeRetryDelay())
    }

    async function openSse(token: string) {
      if (cancelled) return

      abortController = new AbortController()
      try {
        const res = await fetch(`${getApiBase()}/events/stream`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: abortController.signal,
        })

        if (!res.ok) {
          abortController = null
          if (res.status === 401) {
            expireSession()
            return
          }
          retries++
          scheduleReconnect()
          return
        }

        retries = 0
        setConnected(true)
        setReconnecting(false)

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
              if (eventType === "connected") { eventType = ""; continue }
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
      } finally {
        abortController = null
      }

      if (cancelled) return
      const currentToken = getToken()
      if (!currentToken) {
        expireSession()
        return
      }
      retries++
      scheduleReconnect()
    }

    function connect() {
      if (abortController) { abortController.abort(); abortController = null }
      if (retryTimer) window.clearTimeout(retryTimer)
      const token = getToken()
      if (!token) {
        expireSession()
        return
      }
      openSse(token)
    }

    connect()
    return () => {
      cancelled = true
      if (retryTimer) window.clearTimeout(retryTimer)
      if (abortController) abortController.abort()

      for (const key of Object.keys(debounceTimersRef.current)) {
        if (debounceTimersRef.current[key]) {
          window.clearTimeout(debounceTimersRef.current[key])
        }
      }
      debounceTimersRef.current = {}

      setConnected(false)
      setReconnecting(false)
    }
  }, [dispatch])

  return { connected, reconnecting }
}

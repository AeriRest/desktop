"use client"

import { useCallback, useEffect, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import { Icon } from "@/components/icon"
import { morphEase } from "@/lib/motion"
import { cn } from "@/lib/utils"
import type { UpdateCheckResult } from "@/lib/electron"

export function UpdateNotification() {
  const reduced = useReducedMotion()
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [checking, setChecking] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [noUpdateMessage, setNoUpdateMessage] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI) return

    window.electronAPI.onUpdateAvailable((result) => {
      setUpdateResult(result)
      setDismissed(false)
      setDownloadError(null)
    })

    window.electronAPI.onUpdateCheckResult((result) => {
      setUpdateResult(result)
      setDismissed(false)
      setDownloadError(null)
      if (result && !result.updateAvailable) {
        setNoUpdateMessage(true)
        setTimeout(() => setNoUpdateMessage(false), 4000)
      }
    })

    window.electronAPI.getUpdateResult().then((result) => {
      if (result?.updateAvailable) {
        setUpdateResult(result)
      }
    })
  }, [])

  const handleCheck = useCallback(async () => {
    if (typeof window === "undefined" || !window.electronAPI) return
    setChecking(true)
    setNoUpdateMessage(false)
    setDownloadError(null)
    try {
      const result = await window.electronAPI.checkForUpdates()
      if (result) {
        setUpdateResult(result)
        if (!result.updateAvailable) {
          setNoUpdateMessage(true)
          setTimeout(() => setNoUpdateMessage(false), 4000)
        }
      }
    } catch {
      /* ignore */
    } finally {
      setChecking(false)
    }
  }, [])

  const handleDownload = useCallback(async () => {
    if (typeof window === "undefined" || !window.electronAPI) return
    if (!updateResult?.integrityVerified) {
      setDownloadError("Update signature missing or invalid")
      return
    }
    setDownloading(true)
    setDownloadError(null)
    try {
      const result = await window.electronAPI.openVerifiedUpdate()
      if (!result?.ok) {
        setDownloadError(result?.error || "Download failed")
      }
    } catch {
      setDownloadError("Download failed")
    } finally {
      setDownloading(false)
    }
  }, [updateResult])

  const updateAvailable = updateResult?.updateAvailable && !dismissed
  const canDownload = Boolean(updateResult?.integrityVerified && updateResult?.downloadUrl)

  return (
    <>
      {updateAvailable && (
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0.01 : 0.24, ease: morphEase }}
          onClick={handleDownload}
          disabled={!canDownload || downloading}
          className={cn(
            "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] transition-colors",
            canDownload
              ? "border-accent/25 bg-accent/10 text-accent hover:bg-accent/20"
              : "border-border/40 bg-muted/30 text-muted-foreground/50 cursor-not-allowed",
          )}
          title={
            canDownload
              ? `Download verified v${updateResult?.latestVersion}`
              : downloadError || updateResult?.verificationError || "Update available but not signed"
          }
        >
          <Icon
            icon={downloading ? "ph:spinner" : canDownload ? "ph:arrow-circle-down" : "ph:warning-circle"}
            className={cn("size-3", downloading && "animate-spin")}
          />
          {downloading
            ? "Verifying…"
            : canDownload
              ? `Update v${updateResult?.latestVersion}`
              : `Update v${updateResult?.latestVersion} (unverified)`}
        </motion.button>
      )}

      {!updateAvailable && (
        <button
          type="button"
          onClick={handleCheck}
          disabled={checking}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition-colors cursor-pointer",
            noUpdateMessage
              ? "text-green-500/70"
              : "text-muted-foreground/30 hover:text-muted-foreground/60",
          )}
        >
          <Icon
            icon={checking ? "ph:spinner" : noUpdateMessage ? "ph:check-circle" : "ph:arrows-clockwise"}
            className={cn("size-3", checking && "animate-spin")}
          />
          {checking ? "Checking…" : noUpdateMessage ? "Up to date" : "Check for updates"}
        </button>
      )}
    </>
  )
}

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Icon } from "@/components/icon"
import { ApiError, deleteDraft, getApiErrorDetail, listDrafts, sendMessage, upsertDraft } from "@/lib/api"
import {
  formatAttachmentSize,
  MAX_COMPOSE_ATTACHMENTS,
  readFileAsBase64,
  validatePendingAttachments,
  type PendingAttachment,
} from "@/lib/attachments"
import { htmlToPlainText } from "@/lib/html-plain"
import { emitSendToast } from "@/components/send-toast"
import { cn } from "@/lib/utils"

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const SECURE_MAX_VIEW_OPTIONS = [1, 2, 3, 5, 10] as const
const SECURE_EXPIRY_OPTIONS = [
  { value: 1, label: "1 hour" },
  { value: 24, label: "24 hours" },
  { value: 168, label: "7 days" },
  { value: 720, label: "30 days" },
] as const

export type ReplyContext = {
  to: string
  subject: string
  inReplyTo: string
  references: string
  fromAlias?: string
  forwardBody?: string
  mode?: "reply" | "forward"
}

type ComposePanelProps = {
  fromAddresses: string[]
  defaultFrom?: string
  replyTo?: ReplyContext | null
  canSend: boolean
  canSendHtml?: boolean
  canUseSecureLink?: boolean
  onClose: () => void
  onUpgrade: () => void
  onSent?: (fromAlias: string) => void
  className?: string
}

function replySubject(subject: string) {
  return subject.match(/^re:\s/i) ? subject : `Re: ${subject}`
}

export function ComposePanel({
  fromAddresses,
  defaultFrom,
  replyTo,
  canSend,
  canSendHtml = false,
  canUseSecureLink = false,
  onClose,
  onUpgrade,
  onSent,
  className,
}: ComposePanelProps) {
  const toRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [fromAlias, setFromAlias] = useState("")
  const [to, setTo] = useState("")
  const [cc, setCc] = useState("")
  const [bcc, setBcc] = useState("")
  const [showCcBcc, setShowCcBcc] = useState(false)
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [htmlMode, setHtmlMode] = useState(false)
  const [secureLink, setSecureLink] = useState(false)
  const [secureMaxViews, setSecureMaxViews] = useState<number>(1)
  const [secureExpiresHours, setSecureExpiresHours] = useState<number>(168)
  const [securePassword, setSecurePassword] = useState("")
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const draftIdRef = useRef<string | null>(null)
  const draftReadyRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const lastSavedRef = useRef<string>("")

  useEffect(() => {
    let cancelled = false
    draftReadyRef.current = false

    async function initCompose() {
      const preferredFrom =
        replyTo?.fromAlias && fromAddresses.includes(replyTo.fromAlias)
          ? replyTo.fromAlias
          : defaultFrom && fromAddresses.includes(defaultFrom)
            ? defaultFrom
            : fromAddresses[0] ?? ""

      lastSavedRef.current = ""

      if (replyTo) {
        draftIdRef.current = null
        setFromAlias(preferredFrom)
        setTo(replyTo.to ?? "")
        setCc("")
        setBcc("")
        setShowCcBcc(false)
        setSubject(
          replyTo.mode === "forward"
            ? (replyTo.subject.match(/^fwd:\s/i) ? replyTo.subject : `Fwd: ${replyTo.subject}`)
            : replySubject(replyTo.subject),
        )
        setBody(replyTo.forwardBody ?? "")
        setHtmlMode(false)
        setSecureLink(false)
        setSecureMaxViews(1)
        setSecureExpiresHours(168)
        setSecurePassword("")
        setAttachments([])
        setError(null)
        draftReadyRef.current = true
        return
      }

      try {
        const data = await listDrafts()
        if (cancelled) return
        const draft = data.drafts[0]
        if (draft) {
          draftIdRef.current = draft.id
          setFromAlias(
            draft.from_alias && fromAddresses.includes(draft.from_alias)
              ? draft.from_alias
              : preferredFrom,
          )
          setTo(draft.to_address ?? "")
          setCc(draft.cc ?? "")
          setBcc(draft.bcc ?? "")
          setShowCcBcc(Boolean(draft.cc || draft.bcc))
          setSubject(draft.subject ?? "")
          setBody(draft.body_html ?? draft.body ?? "")
          setHtmlMode(Boolean(draft.body_html))
          setSecureLink(false)
          setSecureMaxViews(1)
          setSecureExpiresHours(168)
          setSecurePassword("")
          setAttachments([])
          setError(null)
          draftReadyRef.current = true
          return
        }
      } catch {
        /* fall through to blank compose */
      }

      draftIdRef.current = null
      setFromAlias(preferredFrom)
      setTo("")
      setCc("")
      setBcc("")
      setShowCcBcc(false)
      setSubject("")
      setBody("")
      setHtmlMode(false)
      setSecureLink(false)
      setSecureMaxViews(1)
      setSecureExpiresHours(168)
      setSecurePassword("")
      setAttachments([])
      setError(null)
      draftReadyRef.current = true
    }

    void initCompose()
    const timer = window.setTimeout(() => toRef.current?.focus(), 50)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [defaultFrom, fromAddresses, replyTo])

  useEffect(() => {
    if (!draftReadyRef.current || replyTo) return
    if (!to.trim() && !subject.trim() && !body.trim()) return

    const payload = JSON.stringify({
      from_alias: fromAlias || null,
      to_address: to || null,
      cc: cc || null,
      bcc: bcc || null,
      subject,
      body: htmlMode ? htmlToPlainText(body.trim()) : body,
      body_html: htmlMode ? body : null,
    })

    if (payload === lastSavedRef.current) return

    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(() => {
      void upsertDraft(
        {
          from_alias: fromAlias || null,
          to_address: to || null,
          cc: cc || null,
          bcc: bcc || null,
          subject,
          body: htmlMode ? htmlToPlainText(body.trim()) : body,
          body_html: htmlMode ? body : null,
        },
        draftIdRef.current ?? undefined,
      )
        .then((saved) => {
          draftIdRef.current = saved.id
          lastSavedRef.current = payload
        })
        .catch(() => undefined)
    }, 1500)

    return () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [body, bcc, cc, fromAlias, htmlMode, replyTo, subject, to])

  const validateForm = useCallback((): string | null => {
    if (!fromAlias.trim()) {
      return fromAddresses.length === 0
        ? "No alias available to send from."
        : "Choose a From address."
    }
    const toTrim = to.trim()
    if (!toTrim) return "Enter a recipient."
    if (!EMAIL_RE.test(toTrim)) return "Enter a valid email address."
    if (!subject.trim()) return "Enter a subject."
    if (!body.trim()) return "Write a message."
    if (secureLink && securePassword.trim() && securePassword.trim().length < 4) {
      return "Secure link password must be at least 4 characters."
    }
    const attachmentError = validatePendingAttachments(attachments)
    if (attachmentError) return attachmentError
    return null
  }, [attachments, body, fromAddresses.length, fromAlias, secureLink, securePassword, subject, to])

  const handleFilesSelected = useCallback(async (fileList: FileList | null) => {
    if (!fileList?.length) return

    const next: PendingAttachment[] = [...attachments]
    for (const file of Array.from(fileList)) {
      if (next.length >= MAX_COMPOSE_ATTACHMENTS) {
        setError(`At most ${MAX_COMPOSE_ATTACHMENTS} attachments allowed.`)
        break
      }
      next.push({
        id: crypto.randomUUID(),
        file,
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        size: file.size,
      })
    }

    const validationError = validatePendingAttachments(next)
    if (validationError) {
      setError(validationError)
      return
    }

    setAttachments(next)
    setError(null)
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
    }
  }, [attachments])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id))
    setError(null)
  }, [])

  const attemptSend = useCallback(async () => {
    const validationError = validateForm()
    if (validationError) {
      setError(validationError)
      return
    }

    if (!canSend) {
      onUpgrade()
      return
    }

    if (secureLink && !canUseSecureLink) {
      setError("Cipher subscription required for secure links.")
      return
    }

    setLoading(true)
    setError(null)
    emitSendToast({ kind: "sending" })
    try {
      const trimmedBody = body.trim()
      const payload = {
        from_alias: fromAlias.trim(),
        to: to.trim(),
        subject: subject.trim(),
        in_reply_to: replyTo?.inReplyTo ?? null,
        references: replyTo?.references ?? null,
      }

      const ccList = cc
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
      const bccList = bcc
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)

      const secureOptions = secureLink
        ? {
            secure_link: true,
            secure_max_views: secureMaxViews,
            secure_expires_hours: secureExpiresHours,
            secure_password: securePassword.trim() || null,
          }
        : { secure_link: false }

      const attachmentPayload =
        attachments.length > 0
          ? await Promise.all(
              attachments.map(async (attachment) => ({
                filename: attachment.filename,
                content_type: attachment.contentType,
                content_base64: await readFileAsBase64(attachment.file),
              })),
            )
          : null

      if (htmlMode && canSendHtml) {
        await sendMessage({
          ...payload,
          cc: ccList.length ? ccList : null,
          bcc: bccList.length ? bccList : null,
          body: htmlToPlainText(trimmedBody),
          body_html: trimmedBody,
          attachments: attachmentPayload,
          ...secureOptions,
        })
      } else {
        await sendMessage({
          ...payload,
          cc: ccList.length ? ccList : null,
          bcc: bccList.length ? bccList : null,
          body: trimmedBody,
          attachments: attachmentPayload,
          ...secureOptions,
        })
      }
      const draftId = draftIdRef.current
      if (draftId) {
        void deleteDraft(draftId).catch(() => undefined)
        draftIdRef.current = null
      }
      emitSendToast({ kind: "sent" })
      onSent?.(fromAlias.trim())
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        emitSendToast({ kind: "dismiss" })
        onUpgrade()
        return
      }
      const fallback =
        err instanceof ApiError && err.status === 429
          ? "Daily send limit reached. Try again tomorrow."
          : err instanceof ApiError && err.status === 503
            ? "Outbound mail is not configured on this server."
            : "Could not send message."
      const detail = getApiErrorDetail(err, fallback)
      emitSendToast({ kind: "error", detail })
      setError(detail)
    } finally {
      setLoading(false)
    }
  }, [
    attachments,
    bcc,
    body,
    canSend,
    canSendHtml,
    canUseSecureLink,
    cc,
    fromAlias,
    htmlMode,
    onClose,
    onSent,
    onUpgrade,
    replyTo,
    secureExpiresHours,
    secureLink,
    secureMaxViews,
    securePassword,
    subject,
    to,
    validateForm,
  ])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        void attemptSend()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [attemptSend, onClose])

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    void attemptSend()
  }

  const localFrom = (handle: string) => handle.split("@")[0] || handle
  const secureExpiryLabel =
    SECURE_EXPIRY_OPTIONS.find((option) => option.value === secureExpiresHours)?.label ?? "7 days"

  return (
    <form
      onSubmit={handleSubmit}
      className={cn("flex min-h-0 flex-1 flex-col bg-background", className)}
    >
      <header className="flex items-center gap-2 border-b border-border/50 px-3 py-2.5 sm:px-4">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <Icon icon="ph:arrow-left" className="size-4" aria-hidden />
          <span className="hidden sm:inline">Discard</span>
        </button>

        <div className="min-w-0 flex-1 text-center sm:text-left">
          <p className="truncate text-[13px] font-medium tracking-tight">
            {replyTo?.mode === "forward" ? "Forward" : replyTo ? "Reply" : "New message"}
          </p>
        </div>

        <button
          type="submit"
          disabled={loading || fromAddresses.length === 0}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors",
            "bg-accent text-accent-foreground hover:bg-accent/90",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {loading ? (
            <>
              <Icon icon="ph:spinner" className="size-3.5 animate-spin" aria-hidden />
              Sending
            </>
          ) : canSend ? (
            <>
              <Icon icon="ph:paper-plane-tilt" className="size-3.5" aria-hidden />
              Send
            </>
          ) : (
            "Upgrade"
          )}
        </button>
      </header>

      {!canSend && (
        <div className="border-b border-border/40 px-4 py-2.5 text-[12px] text-muted-foreground">
          Sending requires{" "}
          <button
            type="button"
            onClick={onUpgrade}
            className="font-medium text-accent underline-offset-2 hover:underline"
          >
            Pro
          </button>
          . Free accounts can receive mail only.
        </div>
      )}

      <div className="shrink-0 border-b border-border/40">
        <FieldRow label="From">
          {fromAddresses.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">No aliases loaded</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {fromAddresses.map((handle) => {
                const active = handle === fromAlias
                return (
                  <button
                    key={handle}
                    type="button"
                    onClick={() => {
                      setFromAlias(handle)
                      setError(null)
                    }}
                    className={cn(
                      "rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors",
                      active
                        ? "border-accent/40 bg-accent/10 text-foreground"
                        : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
                    )}
                  >
                    {localFrom(handle)}
                  </button>
                )
              })}
            </div>
          )}
        </FieldRow>

        <FieldRow label="To">
          <input
            ref={toRef}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={to}
            onChange={(event) => {
              setTo(event.target.value)
              setError(null)
            }}
            placeholder="recipient@example.com"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/45"
          />
        </FieldRow>

        <FieldRow label="Subject">
          <input
            type="text"
            value={subject}
            onChange={(event) => {
              setSubject(event.target.value)
              setError(null)
            }}
            placeholder="Subject"
            className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/45"
          />
        </FieldRow>

        {!showCcBcc ? (
          <div className="px-4 py-2">
            <button
              type="button"
              onClick={() => setShowCcBcc(true)}
              className="text-[11px] text-muted-foreground hover:text-foreground"
            >
              Add Cc / Bcc
            </button>
          </div>
        ) : (
          <>
            <FieldRow label="Cc">
              <input
                type="text"
                value={cc}
                onChange={(event) => {
                  setCc(event.target.value)
                  setError(null)
                }}
                placeholder="cc@example.com"
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/45"
              />
            </FieldRow>
            <FieldRow label="Bcc">
              <input
                type="text"
                value={bcc}
                onChange={(event) => {
                  setBcc(event.target.value)
                  setError(null)
                }}
                placeholder="bcc@example.com"
                className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/45"
              />
            </FieldRow>
          </>
        )}
      </div>

      {secureLink && (
        <div className="space-y-3 border-b border-border/40 px-4 py-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Recipients get a link only — the body stays on our servers until the view limit is
            reached or the link expires ({secureExpiryLabel}). Attached files can each be
            downloaded once from the secure page.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Max views
              </span>
              <select
                value={secureMaxViews}
                onChange={(event) => {
                  setSecureMaxViews(Number(event.target.value))
                  setError(null)
                }}
                className="w-full rounded-lg border border-border/60 bg-background px-2.5 py-2 text-[12px] outline-none focus:border-accent/40"
              >
                {SECURE_MAX_VIEW_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value === 1 ? "1 (one-time)" : value}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Expires after
              </span>
              <select
                value={secureExpiresHours}
                onChange={(event) => {
                  setSecureExpiresHours(Number(event.target.value))
                  setError(null)
                }}
                className="w-full rounded-lg border border-border/60 bg-background px-2.5 py-2 text-[12px] outline-none focus:border-accent/40"
              >
                {SECURE_EXPIRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="block space-y-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Link password (optional)
            </span>
            <input
              type="password"
              value={securePassword}
              onChange={(event) => {
                setSecurePassword(event.target.value)
                setError(null)
              }}
              placeholder="Require a password to reveal"
              autoComplete="new-password"
              className="w-full rounded-lg border border-border/60 bg-background px-2.5 py-2 text-[12px] outline-none placeholder:text-muted-foreground/45 focus:border-accent/40"
            />
          </label>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-border/40 px-4 py-3">
          {attachments.map((attachment) => (
            <div
              key={attachment.id}
              className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/60 bg-background/60 px-2.5 py-1"
            >
              <Icon icon="ph:paperclip" className="size-3 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate font-mono text-[11px]">{attachment.filename}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {formatAttachmentSize(attachment.size)}
              </span>
              <button
                type="button"
                onClick={() => removeAttachment(attachment.id)}
                className="inline-flex shrink-0 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${attachment.filename}`}
              >
                <Icon icon="ph:x" className="size-3" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        value={body}
        onChange={(event) => {
          setBody(event.target.value)
          setError(null)
        }}
        placeholder={htmlMode ? "Write HTML…" : "Write your message…"}
        className={cn(
          "min-h-0 flex-1 resize-none bg-transparent px-4 py-4 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/45",
          htmlMode && "font-mono text-[12px]",
        )}
      />

      <footer className="flex items-center justify-between gap-3 border-t border-border/40 px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              void handleFilesSelected(event.target.files)
            }}
          />
          <button
            type="button"
            disabled={attachments.length >= MAX_COMPOSE_ATTACHMENTS}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider transition-colors",
              attachments.length >= MAX_COMPOSE_ATTACHMENTS
                ? "cursor-not-allowed border-border/40 text-muted-foreground/50"
                : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
            )}
            title="Attach files (10 MB each, 25 MB total)"
          >
            <Icon icon="ph:paperclip" className="size-3" aria-hidden />
            Attach
          </button>
          {canUseSecureLink ? (
            <button
              type="button"
              onClick={() => {
                setSecureLink((current) => !current)
                setError(null)
              }}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider transition-colors",
                secureLink
                  ? "border-accent/40 bg-accent/10 text-foreground"
                  : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
              )}
              aria-pressed={secureLink}
            >
              <Icon icon="ph:lock-key" className="size-3" aria-hidden />
              Secure link
            </button>
          ) : canSend ? (
            <p className="text-[10px] text-muted-foreground">
              <Icon icon="ph:lock-key" className="mr-1 inline size-3 align-[-2px]" aria-hidden />
              Secure links are a{" "}
              <Link href="https://aeri.rest/compare" target="_blank" rel="noopener noreferrer" className="text-foreground underline-offset-2 hover:underline">
                Cipher
              </Link>{" "}
              feature.
            </p>
          ) : null}
          {canSendHtml && (
            <button
              type="button"
              onClick={() => {
                setHtmlMode((current) => !current)
                setError(null)
              }}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider transition-colors",
                htmlMode
                  ? "border-accent/40 bg-accent/10 text-foreground"
                  : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              <Icon icon="ph:code" className="size-3" aria-hidden />
              HTML
            </button>
          )}
          <p className="text-[10px] text-muted-foreground/70">
            <kbd className="font-mono">⌘</kbd>
            <kbd className="font-mono">↵</kbd> send · <kbd className="font-mono">esc</kbd> discard
          </p>
        </div>
        {error && (
          <p className="truncate text-[11px] text-destructive" role="alert">
            {error}
          </p>
        )}
      </footer>
    </form>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 border-b border-border/30 px-4 py-2.5 last:border-b-0">
      <span className="w-12 shrink-0 pt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

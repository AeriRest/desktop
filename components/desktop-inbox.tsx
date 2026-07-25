"use client"

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence, LayoutGroup } from "motion/react"
import { Icon } from "@/components/icon"
import {
  listAliases,
  listMessages,
  burnAlias,
  markMessagesRead,
  patchMessage,
  deleteMessage,
  blockSender,
  bulkUpdateMessages,
  getAccountSettings,
  getMe,
  getBillingStatus,
  emptyTrash,
  isAuthError,
} from "@/lib/api"
import { canBlacklistOnAlias, canSendFromAlias, sendableAliases } from "@/lib/alias-permissions"
import { BRAND_NAME } from "@/lib/brand"
import { AeriLogo } from "@/components/aeri-logo"
import { canSendHtml as planCanSendHtml, canUseSecureLink as planCanUseSecureLink, hasProBenefits } from "@/lib/plan-access"
import { useRealtime } from "@/lib/use-realtime"
import type { Message as ApiMessage } from "@/lib/types/api"
import { senderDisplayName, senderColor, type DemoAlias, type DemoMessage, type InboxView, type ListDensity, type MessageKind } from "@/lib/demo-inbox"
import { formatMessageListTime, formatWhen } from "@/lib/format-time"
import { FREE_ALIAS_LIMIT } from "@/lib/plans"

import { cn } from "@/lib/utils"
import { MessageBody } from "@/components/message-body"
import { ComposePanel, type ReplyContext } from "@/components/compose-modal"
import { SendToastHost } from "@/components/send-toast"
import { UpgradeModal } from "@/components/upgrade-modal"
import { ConfirmModal } from "@/components/confirm-modal"
import { SecurityModal } from "@/components/security-modal"
import { UpdateNotification } from "@/components/update-notification"
import { CreateAliasModal } from "@/components/create-alias-modal"
import { Checkbox } from "@/components/ui/checkbox"
import { KeyboardShortcutsOverlay } from "@/components/keyboard-shortcuts-overlay"

function toDemoMessage(message: ApiMessage): DemoMessage {
  return {
    id: message.id, from: message.from, senderName: message.sender_name, envelopeSender: message.envelope_sender,
    to: message.to, subject: message.subject, preview: message.preview, body: message.body, bodyHtml: message.body_html,
    receivedAt: message.received_at, unread: message.unread, alias: message.alias, kind: message.kind as MessageKind,
    starred: message.starred, direction: message.direction, deliveryStatus: message.delivery_status,
    deleted: message.deleted, hasAttachments: message.has_attachments, messageIdHeader: message.message_id_header,
    referencesHeader: message.references_header,
    attachments: message.attachments?.map((a) => ({ id: a.id, filename: a.filename, contentType: a.content_type, size: a.size })),
  }
}

function buildReplyContext(message: DemoMessage): ReplyContext {
  const mid = message.messageIdHeader || `<${message.id}@aeri.rest>`
  const refs = message.referencesHeader ? `${message.referencesHeader} ${mid}` : mid
  return { to: message.from, subject: message.subject, inReplyTo: mid, references: refs.trim(), fromAlias: message.alias, mode: "reply" }
}

function buildForwardContext(message: DemoMessage): ReplyContext {
  const quoted = ["", "---------- Forwarded message ----------", `From: ${message.from}`, `Subject: ${message.subject}`, "", message.body].join("\n")
  return { to: "", subject: message.subject, inReplyTo: message.messageIdHeader || "", references: message.referencesHeader || "", fromAlias: message.alias, forwardBody: quoted, mode: "forward" }
}

const ease = [0.32, 0.72, 0, 1] as const
const morph = { layout: { duration: 0.25, ease }, duration: 0.22, ease } as const

const VIEWS: { id: InboxView; label: string; icon: string }[] = [
  { id: "inbox", label: "Inbox", icon: "ph:tray" },
  { id: "sent", label: "Sent", icon: "ph:paper-plane-tilt" },
  { id: "starred", label: "Starred", icon: "ph:star" },
  { id: "archive", label: "Archive", icon: "ph:archive" },
  { id: "trash", label: "Trash", icon: "ph:trash" },
]

type InboxProps = { primaryAlias: string; domain: string }

function SenderAvatar({ message }: { message: DemoMessage }) {
  const color = senderColor(message.from)
  const initial = senderDisplayName(message.from, message.senderName).charAt(0).toUpperCase()
  return <span className={`flex size-8 shrink-0 items-center justify-center rounded-full ${color} font-mono text-[11px] font-medium text-white`}>{initial}</span>
}

function handleAuthFailure(router: ReturnType<typeof useRouter>) {
  localStorage.removeItem("aeri_session_token")
  if (window.electronAPI?.forceSignIn) window.electronAPI.forceSignIn()
  else router.replace("/sign-in")
}

/* ─── Memoized message list item ─── */

interface MessageListItemProps {
  message: DemoMessage
  active: boolean
  selected: boolean
  showCheckbox: boolean
  listDensity: ListDensity
  onOpen: (message: DemoMessage) => void
  onToggleSelect: (id: string) => void
}

const MessageListItem = memo(function MessageListItem({ message, active, selected, showCheckbox, listDensity, onOpen, onToggleSelect }: MessageListItemProps) {
  const unread = message.unread
  const starred = Boolean(message.starred)
  const handleOpen = useCallback(() => onOpen(message), [message, onOpen])
  const handleToggle = useCallback(() => onToggleSelect(message.id), [message.id, onToggleSelect])
  return (
    <li className="group border-b border-border/30 last:border-b-0">
      <div className={cn("flex w-full items-start gap-2 px-2 text-left transition-colors", active ? "bg-secondary/40" : "hover:bg-secondary/20", listDensity === "compact" ? "py-2" : "py-3")}>
        <Checkbox checked={selected} onCheckedChange={handleToggle} className={cn("mt-2.5 opacity-0 transition-opacity group-hover:opacity-100", (selected || showCheckbox) && "opacity-100")} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} />
        <button type="button" onClick={handleOpen} className="flex min-w-0 flex-1 gap-3 pr-2 text-left">
          <SenderAvatar message={message} />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className={cn("truncate text-[13px]", unread ? "font-medium text-foreground" : "text-muted-foreground")}>
                {message.direction === "sent" ? `To: ${message.to ?? message.from}` : senderDisplayName(message.from, message.senderName)}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {starred && <Icon icon="ph:star-fill" className="size-2.5 text-accent" />}
                <span className="text-[10px] tabular-nums text-muted-foreground">{formatMessageListTime(message.receivedAt)}</span>
              </span>
            </span>
            <span className={cn("mt-0.5 block truncate text-[13px]", unread ? "text-foreground" : "text-muted-foreground/90")}>{message.subject}</span>
            <span className="mt-0.5 flex items-center gap-2">
              {message.deliveryStatus === "pending" && <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-1.5 py-px text-[9px] uppercase text-amber-600">Pending</span>}
              {message.deliveryStatus === "failed" && <span className="rounded-full border border-destructive/30 bg-destructive/10 px-1.5 py-px text-[9px] uppercase text-destructive">Failed</span>}
              {message.hasAttachments && <Icon icon="ph:paperclip" className="size-2.5 text-muted-foreground/50" />}
              <span className="block truncate text-[11px] text-muted-foreground/70">{message.preview}</span>
            </span>
          </span>
        </button>
      </div>
    </li>
  )
})

/* ─── Alias Dropdown ─── */

interface AliasDropdownProps {
  aliases: DemoAlias[]
  selectedAlias: string | null
  activeAliasLabel: string
  plan: string
  view: InboxView
  onSelect: (handle: string) => void
  onCreateNew: () => void
  onUpgrade: () => void
}

function AliasDropdown({ aliases, selectedAlias, activeAliasLabel, plan, view, onSelect, onCreateNew, onUpgrade }: AliasDropdownProps) {
  const [open, setOpen] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  const handleCopy = useCallback(async (e: React.MouseEvent, handle: string, id: string) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(handle)
      setCopiedId(id)
      window.setTimeout(() => setCopiedId(null), 1600)
    } catch { /* ignore */ }
  }, [])

  const handleSelect = useCallback((handle: string) => {
    onSelect(handle)
    setOpen(false)
  }, [onSelect])

  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" onClick={() => setOpen(!open)} className="flex items-center gap-1.5 rounded-lg px-2 py-2 text-[12px] transition-colors hover:bg-secondary/50">
        <span className="font-mono text-muted-foreground">{activeAliasLabel}</span>
        <Icon icon={open ? "ph:caret-up" : "ph:caret-down"} className="size-3 text-muted-foreground/60" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }} className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl border border-border/60 bg-popover shadow-xl shadow-black/20">
            <div className="border-b border-border/40 px-3 py-2 flex items-center justify-between">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Aliases</p>
              <button
                type="button"
                onClick={() => { setOpen(false); onCreateNew() }}
                className="inline-flex items-center gap-1 rounded-full border border-border/60 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-accent/25 hover:text-foreground"
              >
                <Icon icon="ph:plus" className="size-3" />
                New
              </button>
            </div>
            <div className="max-h-64 overflow-y-auto p-1">
              {aliases.map((alias) => {
                const active = alias.handle === selectedAlias
                const local = alias.handle.split("@")[0]
                return (
                  <div key={alias.id} className="group/alias flex w-full items-center gap-0.5">
                    <button type="button" onClick={() => handleSelect(alias.handle)}
                      className={cn("flex min-w-0 flex-1 items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12px] transition-colors", active ? "bg-secondary/60 text-foreground" : "text-muted-foreground hover:bg-secondary/30 hover:text-foreground")}>
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-mono text-[11px]">{local}</span>
                        {alias.shared && <span className="shrink-0 rounded-full border border-accent/25 bg-accent/10 px-1.5 py-px text-[8px] uppercase tracking-wide text-accent">Shared</span>}
                      </span>
                      <span className="flex items-center gap-1.5">
                        {alias.unread > 0 && <span className="font-mono text-[10px] text-accent">{alias.unread}</span>}
                        {active && <Icon icon="ph:check" className="size-3 text-accent" />}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleCopy(e, alias.handle, alias.id)}
                      className="shrink-0 rounded-md p-1 text-muted-foreground/40 opacity-0 transition-opacity hover:bg-secondary/50 hover:text-foreground group-hover/alias:opacity-100"
                      title="Copy address"
                    >
                      <Icon icon={copiedId === alias.id ? "ph:check" : "ph:copy"} className="size-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ─── Status Footer ─── */

interface StatusFooterProps {
  realtimeReconnecting: boolean
  aliasesCount: number
  totalUnread: number
  accountEmail: string
  plan: string
  onSecurity: () => void
  onLogout: () => void
}

const StatusFooter = memo(function StatusFooter({ realtimeReconnecting, aliasesCount, totalUnread, accountEmail, plan, onSecurity, onLogout }: StatusFooterProps) {
  return (
    <footer className="flex shrink-0 items-center gap-3 border-t border-border/50 px-4 py-1.5">
      <AeriLogo className="h-2.5 w-auto text-muted-foreground/50" />
      <div className="h-2.5 w-px bg-border/40" />
      <div className="flex items-center gap-1.5">
        <span className={cn("size-1.5 rounded-full", realtimeReconnecting ? "bg-amber-500" : "bg-green-500")} />
        <span className="text-[10px] text-muted-foreground">{realtimeReconnecting ? "Reconnecting…" : "Connected"}</span>
      </div>
      <div className="h-2.5 w-px bg-border/40" />
      <span className="text-[10px] text-muted-foreground">{aliasesCount} alias{aliasesCount !== 1 ? "es" : ""}</span>
      {totalUnread > 0 && <><div className="h-2.5 w-px bg-border/40" /><span className="text-[10px] text-accent">{totalUnread} unread</span></>}
      <div className="flex-1" />
      <UpdateNotification />
      {accountEmail && <span className="text-[10px] text-muted-foreground/60">{accountEmail}</span>}
      <button type="button" onClick={onSecurity} className="text-[10px] text-muted-foreground/40 transition-colors hover:text-muted-foreground/80 cursor-pointer">Security</button>
      <button onClick={onLogout} className="text-[10px] text-muted-foreground/40 hover:text-muted-foreground/80 transition-colors cursor-pointer">Logout</button>
      {plan !== "free" && <span className="rounded-full border border-accent/25 bg-accent/10 px-1.5 py-px text-[8px] uppercase tracking-wide text-accent">{plan}</span>}
    </footer>
  )
})

/* ─── Message Detail Panel ─── */

interface MessageDetailPanelProps {
  selected: DemoMessage
  effectiveCanSend: boolean
  onToggleStar: (id: string) => void
  onArchive: (id: string) => void
  onDelete: (id: string) => void
  onReply: () => void
  onForward: () => void
  onBlockSender: (from: string) => void
}

const MessageDetailPanel = memo(function MessageDetailPanel({
  selected,
  effectiveCanSend,
  onToggleStar,
  onArchive,
  onDelete,
  onReply,
  onForward,
  onBlockSender,
}: MessageDetailPanelProps) {
  const handleStar = useCallback(() => onToggleStar(selected.id), [selected.id, onToggleStar])
  const handleArchive = useCallback(() => onArchive(selected.id), [selected.id, onArchive])
  const handleDelete = useCallback(() => onDelete(selected.id), [selected.id, onDelete])
  const handleBlock = useCallback(() => onBlockSender(selected.from), [selected.from, onBlockSender])

  return (
    <motion.article key={selected.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2, ease }} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-center gap-1 border-b border-border/40 px-4 py-2">
        <button type="button" title="Star" onClick={handleStar} className={cn("inline-flex size-7 items-center justify-center rounded-full transition-colors", selected.starred ? "text-accent" : "text-muted-foreground hover:text-foreground")}><Icon icon={selected.starred ? "ph:star-fill" : "ph:star"} className="size-4" /></button>
        <button type="button" title="Archive" onClick={handleArchive} className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"><Icon icon="ph:archive" className="size-4" /></button>
        <button type="button" title="Delete" onClick={handleDelete} className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-destructive"><Icon icon="ph:trash" className="size-4" /></button>
        <div className="mx-0.5 h-3 w-px bg-border/40" />
        <button type="button" title="Reply" onClick={onReply} disabled={!effectiveCanSend} className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"><Icon icon="ph:arrow-bend-up-left" className="size-4" /></button>
        <button type="button" title="Forward" onClick={onForward} disabled={!effectiveCanSend} className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"><Icon icon="ph:arrow-bend-down-right" className="size-4" /></button>
        <div className="flex-1" />
        <button type="button" title="Block sender" onClick={handleBlock} className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"><Icon icon="ph:prohibit" className="size-4" /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        <div className="flex items-start gap-3">
          <SenderAvatar message={selected} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-medium tracking-tight">{selected.subject}</h2>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {senderDisplayName(selected.from, selected.senderName)} &lt;{selected.from}&gt;
              {selected.alias && <span className="ml-2 text-muted-foreground/60">to {selected.alias}</span>}
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/60">{formatWhen(selected.receivedAt)}</p>
          </div>
        </div>
        <MessageBody body={selected.body} bodyHtml={selected.bodyHtml} className="mt-4" />
        {selected.attachments && selected.attachments.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {selected.attachments.map((att) => (
              <a key={att.id} href={`https://api.aeri.rest/api/v1/messages/${selected.id}/attachments/${att.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/60 px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-accent/30 hover:text-foreground">
                <Icon icon="ph:paperclip" className="size-3" /> <span className="font-mono">{att.filename}</span>
              </a>
            ))}
          </div>
        )}
      </div>
    </motion.article>
  )
})

/* ─── Inbox Toolbar ─── */

interface InboxToolbarProps {
  view: InboxView
  filterUnread: boolean
  filterAttachments: boolean
  selectedIds: Set<string>
  messagesCount: number
  onToggleFilterUnread: () => void
  onToggleFilterAttachments: () => void
  onMarkAllRead: () => void
  onEmptyTrash: () => void
  onBulkMarkRead: () => void
  onBulkStar: () => void
  onBulkArchive: () => void
  onBulkRestore: () => void
  onBulkDelete: () => void
  onClearSelection: () => void
}

const InboxToolbar = memo(function InboxToolbar({
  view,
  filterUnread,
  filterAttachments,
  selectedIds,
  messagesCount,
  onToggleFilterUnread,
  onToggleFilterAttachments,
  onMarkAllRead,
  onEmptyTrash,
  onBulkMarkRead,
  onBulkStar,
  onBulkArchive,
  onBulkRestore,
  onBulkDelete,
}: InboxToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border/30 px-4 py-2">
      <button type="button" onClick={onToggleFilterUnread} className={cn("rounded-full border px-2.5 py-0.5 text-[10px]", filterUnread ? "border-accent/40 bg-accent/10 text-accent" : "border-border/60 text-muted-foreground")}>Unread</button>
      <button type="button" onClick={onToggleFilterAttachments} className={cn("rounded-full border px-2.5 py-0.5 text-[10px]", filterAttachments ? "border-accent/40 bg-accent/10 text-accent" : "border-border/60 text-muted-foreground")}>Attachments</button>
      <div className="flex-1" />
      {view === "inbox" && <button type="button" onClick={onMarkAllRead} className="text-[10px] text-muted-foreground transition-colors hover:text-foreground">Mark all read</button>}
      {view === "trash" && messagesCount > 0 && <button type="button" onClick={onEmptyTrash} className="text-[10px] text-destructive transition-colors hover:text-destructive">Empty trash</button>}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">{selectedIds.size} selected</span>
          <button type="button" onClick={onBulkMarkRead} className="text-[10px] text-muted-foreground hover:text-foreground">Mark read</button>
          <button type="button" onClick={onBulkStar} className="text-[10px] text-muted-foreground hover:text-foreground">Star</button>
          {view === "trash" ? (
            <button type="button" onClick={onBulkRestore} className="text-[10px] text-muted-foreground hover:text-foreground">Restore</button>
          ) : (
            <button type="button" onClick={onBulkArchive} className="text-[10px] text-muted-foreground hover:text-foreground">Archive</button>
          )}
          <button type="button" onClick={onBulkDelete} className="text-[10px] text-destructive hover:text-destructive">Delete</button>
        </div>
      )}
    </div>
  )
})

/* ─── Main Inbox ─── */

export function DesktopInbox({ primaryAlias, domain }: InboxProps) {
  const router = useRouter()
  const [aliases, setAliases] = useState<DemoAlias[]>([])
  const [messages, setMessages] = useState<DemoMessage[]>([])
  const [view, setView] = useState<InboxView>("inbox")
  const [selectedAlias, setSelectedAlias] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [aliasLoading, setAliasLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [composeOpen, setComposeOpen] = useState(false)
  const [replyTo, setReplyTo] = useState<ReplyContext | null>(null)
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [canSend, setCanSend] = useState(false)
  const [canSendHtml, setCanSendHtml] = useState(false)
  const [canUseSecureLink, setCanUseSecureLink] = useState(false)
  const [canBlockSenders, setCanBlockSenders] = useState(false)
  const [maxAliases, setMaxAliases] = useState<number | null>(FREE_ALIAS_LIMIT)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [filterUnread, setFilterUnread] = useState(false)
  const [filterAttachments, setFilterAttachments] = useState(false)
  const [listDensity, setListDensity] = useState<ListDensity>("comfortable")
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [securityOpen, setSecurityOpen] = useState(false)
  const [createAliasOpen, setCreateAliasOpen] = useState(false)
  const [burnAliasTarget, setBurnAliasTarget] = useState<DemoAlias | null>(null)
  const [burningAliasId, setBurningAliasId] = useState<string | null>(null)
  const [accountEmail, setAccountEmail] = useState("")
  const [plan, setPlan] = useState("free")
  const [isWin32, setIsWin32] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const messagesLoadEpochRef = useRef(0)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const messagesRef = useRef(messages)
  useEffect(() => { messagesRef.current = messages }, [messages])
  const selectedAliasRef = useRef(selectedAlias)
  selectedAliasRef.current = selectedAlias
  const canBlockSendersRef = useRef(canBlockSenders)
  canBlockSendersRef.current = canBlockSenders
  const selectedIdRef = useRef(selectedId)
  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])
  const composeOpenRef = useRef(composeOpen)
  composeOpenRef.current = composeOpen
  const viewRef = useRef(view)
  viewRef.current = view

  useEffect(() => {
    try {
      (window as any).electronAPI?.getPlatform().then((p: string) => {
        setIsWin32(p === "win32")
      })
    } catch { /* ignore */ }
  }, [])

  const loadAliases = useCallback(async () => {
    const data = await listAliases()
    const mapped = (data.aliases ?? []).map((alias) => ({
      id: alias.id, handle: alias.handle, label: alias.label, icon: alias.icon,
      unread: alias.unread, expiresAt: alias.expires_at, shared: alias.shared,
      isOwner: alias.is_owner ?? true, permissions: alias.permissions ?? [],
    }))
    setAliases(mapped)
    if (mapped.length > 0) setSelectedAlias((cur) => cur && mapped.some((a) => a.handle === cur) ? cur : mapped[0].handle)
  }, [])

  const loadMessages = useCallback(async () => {
    const epoch = ++messagesLoadEpochRef.current
    const data = await listMessages({ view, alias: selectedAlias || undefined, search: debouncedSearch.trim() || undefined, unread: filterUnread || undefined, has_attachment: filterAttachments || undefined })
    if (epoch !== messagesLoadEpochRef.current) return
    setMessages(data.messages.map(toDemoMessage))
  }, [view, selectedAlias, debouncedSearch, filterUnread, filterAttachments])

  const refreshInbox = useCallback(async () => {
    setRefreshing(true)
    try { await Promise.all([loadAliases(), loadMessages()]) }
    catch (err) { if (isAuthError(err)) handleAuthFailure(router) }
    finally { setRefreshing(false) }
  }, [loadAliases, loadMessages, router])

  const refreshCanSend = useCallback(async () => {
    try { const account = await getMe(); setCanSend(account.can_send); setAccountEmail(account.primary_alias || ""); return account.can_send }
    catch { setCanSend(false); return false }
  }, [])

  const refreshBilling = useCallback(async () => {
    try {
      const billing = await getBillingStatus()
      const paid = hasProBenefits(billing)
      setCanBlockSenders(billing.can_block_senders ?? paid)
      setCanSendHtml(planCanSendHtml(billing))
      setCanUseSecureLink(planCanUseSecureLink(billing))
      setMaxAliases(billing.max_aliases ?? (paid ? null : FREE_ALIAS_LIMIT))
      setPlan(billing.plan || "free")
    } catch { setCanBlockSenders(false); setCanSendHtml(false); setCanUseSecureLink(false); setMaxAliases(FREE_ALIAS_LIMIT) }
  }, [])

  const refreshInboxQuiet = useCallback(() => {
    void loadMessages().catch((err) => { if (isAuthError(err)) handleAuthFailure(router) })
    void loadAliases().catch((err) => { if (isAuthError(err)) handleAuthFailure(router) })
  }, [loadAliases, loadMessages, router])

  const { reconnecting: realtimeReconnecting } = useRealtime({
    onInboxChanged: refreshInboxQuiet,
    onAliasesChanged: () => { void loadAliases().catch(() => {}) },
    onBillingChanged: () => { void refreshBilling(); void refreshCanSend() },
  })

  useEffect(() => { void refreshCanSend(); void refreshBilling() }, [refreshCanSend, refreshBilling])
  useEffect(() => { getAccountSettings().then((s) => { setListDensity(s.list_density) }).catch(() => {}) }, [])

  useEffect(() => {
    let cancelled = false
    setAliasLoading(true)
    loadAliases().catch((err) => { if (!cancelled) { if (isAuthError(err)) { handleAuthFailure(router); return } } }).finally(() => { if (!cancelled) setAliasLoading(false) })
    return () => { cancelled = true }
  }, [loadAliases, router])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    loadMessages().catch((err) => { if (!cancelled) { if (isAuthError(err)) { handleAuthFailure(router); return }; setError("Could not load messages.") } }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [loadMessages, router])

  const selected = useMemo(() => messages.find((m) => m.id === selectedId) ?? null, [messages, selectedId])
  const totalUnread = useMemo(() => aliases.reduce((sum, a) => sum + a.unread, 0), [aliases])
  const activeAliasMeta = aliases.find((a) => a.handle === selectedAlias) ?? aliases[0] ?? null
  const effectiveCanSend = activeAliasMeta ? canSendFromAlias(activeAliasMeta, canSend) : canSend
  const sendableFrom = useMemo(() => sendableAliases(aliases, canSend).map((a) => a.handle), [aliases, canSend])
  const activeAliasLabel = selectedAlias ?? `${primaryAlias}@${domain}`

  const showUpgrade = useCallback(() => { setComposeOpen(false); setUpgradeOpen(true) }, [])

  const handleLogout = useCallback(() => {
    localStorage.removeItem("aeri_session_token")
    localStorage.removeItem("aerimail_account_code")
    if (window.electronAPI?.forceSignIn) window.electronAPI.forceSignIn()
    else window.location.href = "/sign-in"
  }, [])

  const handleSelectAlias = useCallback((handle: string) => {
    setSelectedAlias(handle)
    setSelectedId(null)
    setView("inbox")
  }, [])

  /* ─── Tray update — computed only when messages change, not every render ─── */

  const trayDataRef = useRef<{
    totalUnread: number
    recent: { id: string; alias: string; from: string; senderName: string; subject: string; receivedAt: string; unread: boolean }[]
    accountEmail: string
    plan: string
    connected: boolean
    reconnecting: boolean
  } | null>(null)

  const trayData = useMemo(() => {
    const recent = [...messages]
      .sort((a, b) => {
        if (a.unread !== b.unread) return a.unread ? -1 : 1
        return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime()
      })
      .slice(0, 6)
      .map((m) => ({
        id: m.id, alias: m.alias, from: m.from,
        senderName: senderDisplayName(m.from, m.senderName),
        subject: m.subject, receivedAt: m.receivedAt, unread: m.unread,
      }))
    const data = { totalUnread, recent, accountEmail, plan, connected: !realtimeReconnecting, reconnecting: realtimeReconnecting }
    trayDataRef.current = data
    return data
  }, [messages, totalUnread, accountEmail, plan, realtimeReconnecting])

  useEffect(() => {
    if (typeof window === "undefined") return
    document.title = totalUnread > 0 ? `(${totalUnread}) ${BRAND_NAME}` : BRAND_NAME
    if (window.electronAPI) {
      window.electronAPI.updateTray({
        totalUnread: trayData.totalUnread,
        recentMessages: trayData.recent,
        accountEmail: trayData.accountEmail,
        plan: trayData.plan,
        connected: trayData.connected,
        reconnecting: trayData.reconnecting,
      })
    }
  }, [trayData, totalUnread])

  const refreshCanSendRef = useRef(refreshCanSend)
  refreshCanSendRef.current = refreshCanSend
  const loadAliasesRef = useRef(loadAliases)
  loadAliasesRef.current = loadAliases
  const loadMessagesRef = useRef(loadMessages)
  loadMessagesRef.current = loadMessages
  const refreshInboxRef = useRef(refreshInbox)
  refreshInboxRef.current = refreshInbox
  const routerRef = useRef(router)
  routerRef.current = router

  /* ─── IPC listeners — registered once with stable refs ─── */

  useEffect(() => {
    if (typeof window === "undefined" || !window.electronAPI) return
    window.electronAPI.onNavigate((p: string) => { if (p === "/inbox") routerRef.current.replace("/inbox") })
    window.electronAPI.onCompose?.(() => { void refreshCanSendRef.current().then(() => { setReplyTo(null); setSelectedId(null); setComposeOpen(true) }) })
    window.electronAPI.onFocusSearch?.(() => searchRef.current?.focus())
    window.electronAPI.onSelectAlias?.((handle: string) => { setSelectedAlias(handle); setView("inbox"); setSelectedId(null) })
    window.electronAPI.onOpenMessage?.((payload: string | Record<string, unknown>) => {
      const messageId = typeof payload === "string" ? payload : ((payload as Record<string, unknown>).id as string)
      const alias = typeof payload === "object" && payload ? (payload as Record<string, unknown>).alias as string | undefined : undefined
      if (!messageId) return
      setComposeOpen(false)
      setReplyTo(null)
      setFilterUnread(false)
      setFilterAttachments(false)
      setSearch("")
      setDebouncedSearch("")
      setView("inbox")
      if (alias) setSelectedAlias(alias)
      setSelectedId(messageId)
      const target = messagesRef.current.find((m) => m.id === messageId)
      if (target?.unread) {
        void patchMessage(messageId, { read: true })
          .then((updated) => {
            setMessages((prev) => prev.map((m) => (m.id === updated.id ? toDemoMessage(updated) : m)))
            void loadAliasesRef.current()
          })
          .catch(() => {})
      }
    })
    window.electronAPI.onRefreshInbox?.(() => { void refreshInboxRef.current() })
  }, [])

  /* ─── Keyboard handler with stable refs ─── */

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable
      if (typing || composeOpenRef.current) return
      if (event.key === "?") { event.preventDefault(); setShortcutsOpen(true); return }
      if (event.key === "/") { event.preventDefault(); searchRef.current?.focus(); return }
      const msgs = messagesRef.current
      const active = msgs.find((m) => m.id === selectedIdRef.current)
      if (!active) return
      if (event.key === "j" || event.key === "k") {
        event.preventDefault()
        const i = msgs.findIndex((m) => m.id === active.id)
        const next = msgs[event.key === "j" ? i + 1 : i - 1]
        if (next) void openMessageRef.current(next)
        return
      }
      if (event.key === "r") { event.preventDefault(); setReplyTo(buildReplyContext(active)); setComposeOpen(true); return }
      if (event.key === "e" && viewRef.current !== "trash") { event.preventDefault(); void archiveMessageRef.current(active.id) }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])

  /* ─── Actions ─── */

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }, [])

  const openMessage = useCallback(async (message: DemoMessage) => {
    setComposeOpen(false); setReplyTo(null); setSelectedId(message.id)
    if (!message.unread) return
    try { const updated = await patchMessage(message.id, { read: true }); setMessages((prev) => prev.map((m) => m.id === updated.id ? toDemoMessage(updated) : m)); void loadAliasesRef.current() } catch {}
  }, [])

  const onToggleStar = useCallback(async (id: string) => {
    const current = messagesRef.current.find((m) => m.id === id)
    if (!current) return
    try { const updated = await patchMessage(id, { starred: !current.starred }); setMessages((prev) => prev.map((m) => m.id === updated.id ? toDemoMessage(updated) : m)) } catch {}
  }, [])

  const onArchive = useCallback(async (id: string) => {
    try { await patchMessage(id, { archived: true }); setMessages((prev) => prev.filter((m) => m.id !== id)); if (selectedIdRef.current === id) setSelectedId(null); void loadAliasesRef.current() } catch {}
  }, [])

  const onDelete = useCallback(async (id: string) => {
    setActionError(null)
    try { await deleteMessage(id); setMessages((prev) => prev.filter((m) => m.id !== id)); if (selectedIdRef.current === id) setSelectedId(null); void loadAliasesRef.current() } catch { setActionError("Could not delete message.") }
  }, [])

  const onBlockSender = useCallback(async (from: string) => {
    if (!canBlockSendersRef.current) { setActionError("Blocking requires Pro."); setUpgradeOpen(true); return }
    setActionError(null)
    try { await blockSender(from, { fromAlias: selectedAliasRef.current ?? undefined }); setMessages((prev) => prev.filter((m) => m.from !== from)); if (messagesRef.current.find((m) => m.id === selectedIdRef.current)?.from === from) setSelectedId(null); void loadAliasesRef.current() } catch { setActionError("Could not block sender.") }
  }, [])

  const onMarkAllRead = useCallback(async () => {
    if (!selectedAliasRef.current) return
    try { await markMessagesRead({ alias: selectedAliasRef.current }); setMessages((prev) => prev.map((m) => ({ ...m, unread: false }))); void loadAliasesRef.current() } catch {}
  }, [])

  const handleCompose = useCallback(() => {
    void refreshCanSend().then(() => {
      setReplyTo(null)
      setSelectedId(null)
      setComposeOpen(true)
    })
  }, [refreshCanSend])

  const handleReply = useCallback(() => {
    if (!selected) return
    setReplyTo(buildReplyContext(selected))
    setComposeOpen(true)
  }, [selected])

  const handleForward = useCallback(() => {
    if (!selected) return
    setReplyTo(buildForwardContext(selected))
    setComposeOpen(true)
  }, [selected])

  const selectedIdsRef = useRef(selectedIds)
  selectedIdsRef.current = selectedIds

  const handleToggleFilterUnread = useCallback(() => setFilterUnread((c) => !c), [])
  const handleToggleFilterAttachments = useCallback(() => setFilterAttachments((c) => !c), [])
  const handleClearSelection = useCallback(() => setSelectedIds(new Set()), [])

  const handleBulkMarkRead = useCallback(async () => {
    const ids = [...selectedIdsRef.current]
    try { await bulkUpdateMessages({ message_ids: ids, read: true }); setSelectedIds(new Set()); void loadMessagesRef.current(); void loadAliasesRef.current() } catch {}
  }, [])

  const handleBulkStar = useCallback(async () => {
    const ids = [...selectedIdsRef.current]
    try { await bulkUpdateMessages({ message_ids: ids, starred: true }); setSelectedIds(new Set()); void loadMessagesRef.current(); void loadAliasesRef.current() } catch {}
  }, [])

  const handleBulkArchive = useCallback(async () => {
    const ids = [...selectedIdsRef.current]
    try { await bulkUpdateMessages({ message_ids: ids, archived: true }); setSelectedIds(new Set()); void loadMessagesRef.current(); void loadAliasesRef.current() } catch {}
  }, [])

  const handleBulkRestore = useCallback(async () => {
    const ids = [...selectedIdsRef.current]
    try { await bulkUpdateMessages({ message_ids: ids, restore: true }); setSelectedIds(new Set()); void loadMessagesRef.current(); void loadAliasesRef.current() } catch {}
  }, [])

  const handleBulkDelete = useCallback(async () => {
    const ids = [...selectedIdsRef.current]
    try { await bulkUpdateMessages({ message_ids: ids, delete: true }); setSelectedIds(new Set()); void loadMessagesRef.current(); void loadAliasesRef.current() } catch {}
  }, [])

  const handleEmptyTrash = useCallback(async () => {
    try { await emptyTrash(); setMessages([]); setSelectedId(null); void loadAliasesRef.current() } catch {}
  }, [])

  const handleCreateAlias = useCallback(() => setCreateAliasOpen(true), [])
  const handleUpgradeFromCreate = useCallback(() => { setCreateAliasOpen(false); setUpgradeOpen(true) }, [])
  const handleSecurity = useCallback(() => setSecurityOpen(true), [])
  const handleCloseCompose = useCallback(() => { setComposeOpen(false); setReplyTo(null) }, [])
  const handleSent = useCallback((fromAlias: string) => {
    setCanSend(true); setComposeOpen(false); setReplyTo(null); setSelectedId(null)
    if (fromAlias) setSelectedAlias(fromAlias)
    setView("sent")
    window.setTimeout(() => { void loadMessagesRef.current().catch(() => {}) }, 4000)
  }, [])
  const handleRefresh = useCallback(() => { void refreshInbox() }, [refreshInbox])
  const handleViewChange = useCallback((v: InboxView) => { setView(v); setSelectedId(null) }, [])
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => setDebouncedSearch(value), 300)
  }, [])
  const handleClearSearch = useCallback(() => { setSearch(""); setDebouncedSearch("") }, [])

  const openMessageRef = useRef<(message: DemoMessage) => void>(() => {})
  openMessageRef.current = openMessage
  const archiveMessageRef = useRef<(id: string) => void>(() => {})
  archiveMessageRef.current = onArchive

  if ((loading || aliasLoading) && messages.length === 0 && aliases.length === 0) {
    return <div className="flex flex-1 items-center justify-center"><div className="size-5 animate-spin rounded-full border-2 border-accent border-t-transparent" /></div>
  }

  if (error && messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm text-muted-foreground">{error}</p>
        <button type="button" onClick={() => { setLoading(true); setError(null); void Promise.all([loadAliases(), loadMessages()]).finally(() => setLoading(false)) }} className="text-sm text-accent hover:underline">Retry</button>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">

      {/* ── Header bar: alias dropdown + tabs + search + compose ── */}
      <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border/50 pl-[var(--header-left-pad,72px)] pr-3">
        <AliasDropdown
          aliases={aliases}
          selectedAlias={selectedAlias}
          activeAliasLabel={activeAliasLabel}
          plan={plan}
          view={view}
          onSelect={handleSelectAlias}
          onCreateNew={handleCreateAlias}
          onUpgrade={handleUpgradeFromCreate}
        />

        <nav className="flex items-center gap-0.5">
          <LayoutGroup id="desktop-view-tabs">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" onClick={() => handleViewChange(v.id)}
                className={cn("relative flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] transition-colors", view === v.id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {view === v.id && <motion.span layoutId="desktop-view-tab" transition={morph} className="absolute inset-0 rounded-lg bg-secondary/50" />}
                <Icon icon={v.icon} className="relative size-3.5" />
                <span className="relative hidden sm:inline">{v.label}</span>
              </button>
            ))}
          </LayoutGroup>
        </nav>

        <div className="flex-1" />

        <label className="relative flex min-w-0 items-center gap-2 rounded-full border border-border/60 bg-background/50 px-3 py-1.5 focus-within:border-accent/30">
          <Icon icon="ph:magnifying-glass" className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search"
            className="w-28 bg-transparent text-[12px] outline-none placeholder:text-muted-foreground/50 sm:w-40"
          />
          {search && <button type="button" onClick={handleClearSearch} className="text-muted-foreground hover:text-foreground"><Icon icon="ph:x" className="size-3" /></button>}
        </label>

        <button type="button" onClick={handleCompose} disabled={sendableFrom.length === 0}
          className="flex shrink-0 items-center gap-1.5 rounded-full border border-accent/30 bg-accent/[0.1] px-3 py-1.5 text-[12px] font-medium text-accent transition-colors hover:bg-accent/[0.16] disabled:cursor-not-allowed disabled:opacity-40">
          <Icon icon="ph:pencil-simple-line" className="size-3.5" />
          <span className="hidden sm:inline">Compose</span>
        </button>

        <button type="button" onClick={handleRefresh} disabled={refreshing} className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50" title="Refresh">
          <Icon icon="ph:arrow-clockwise" className={cn("size-3.5", refreshing && "animate-spin")} />
        </button>
      </header>

      {/* ── Toolbar: filters + alias info + bulk actions ── */}
      <InboxToolbar
        view={view}
        filterUnread={filterUnread}
        filterAttachments={filterAttachments}
        selectedIds={selectedIds}
        messagesCount={messages.length}
        onToggleFilterUnread={handleToggleFilterUnread}
        onToggleFilterAttachments={handleToggleFilterAttachments}
        onMarkAllRead={onMarkAllRead}
        onEmptyTrash={handleEmptyTrash}
        onBulkMarkRead={handleBulkMarkRead}
        onBulkStar={handleBulkStar}
        onBulkArchive={handleBulkArchive}
        onBulkRestore={handleBulkRestore}
        onBulkDelete={handleBulkDelete}
        onClearSelection={handleClearSelection}
      />

      {actionError && <p className="border-b border-border/40 px-4 py-2 text-[11px] text-destructive" role="alert">{actionError}</p>}

      {/* ── Main: message list + detail panel ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ul className={cn("min-h-0 shrink-0 overflow-y-auto border-r border-border/40 transition-all duration-300", selected || composeOpen ? "w-[min(22rem,35%)]" : "w-full")}>
          {messages.length === 0 ? (
            <li className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
              <Icon icon="ph:tray" className="size-5 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">{search ? "No matches" : "Nothing here"}</p>
            </li>
          ) : messages.map((message) => (
            <MessageListItem
              key={message.id}
              message={message}
              active={selectedId === message.id}
              selected={selectedIds.has(message.id)}
              showCheckbox={selectedIds.size > 0}
              listDensity={listDensity}
              onOpen={openMessage}
              onToggleSelect={toggleSelected}
            />
          ))}
        </ul>

        {(!isWin32 || selected || composeOpen) && <div className="hidden min-h-0 min-w-0 flex-1 md:flex md:flex-col">
          <AnimatePresence mode="wait">
            {composeOpen ? (
              <motion.div key="compose" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.22, ease }} className="flex min-h-0 flex-1 flex-col">
                <ComposePanel fromAddresses={sendableFrom} defaultFrom={selectedAlias ?? undefined} replyTo={replyTo} canSend={effectiveCanSend} canSendHtml={canSendHtml} canUseSecureLink={canUseSecureLink}
                  onClose={handleCloseCompose} onUpgrade={showUpgrade}
                  onSent={handleSent} />
              </motion.div>
            ) : selected ? (
              <MessageDetailPanel
                selected={selected}
                effectiveCanSend={effectiveCanSend}
                onToggleStar={onToggleStar}
                onArchive={onArchive}
                onDelete={onDelete}
                onReply={handleReply}
                onForward={handleForward}
                onBlockSender={onBlockSender}
              />
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-1 items-center justify-center text-sm text-muted-foreground/60">Select a message</motion.div>
            )}
          </AnimatePresence>
        </div>}
      </div>

      <StatusFooter
        realtimeReconnecting={realtimeReconnecting}
        aliasesCount={aliases.length}
        totalUnread={totalUnread}
        accountEmail={accountEmail}
        plan={plan}
        onSecurity={handleSecurity}
        onLogout={handleLogout}
      />

      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} onUpgraded={() => { setCanSend(true); setUpgradeOpen(false) }} />
      <SecurityModal open={securityOpen} onClose={() => setSecurityOpen(false)} />
      <CreateAliasModal
        open={createAliasOpen}
        onClose={() => setCreateAliasOpen(false)}
        onCreated={() => { void loadAliases() }}
        defaultDomain="aeri.rest"
        canCustomize={plan !== "free"}
        onUpgrade={handleUpgradeFromCreate}
      />
      <ConfirmModal open={Boolean(burnAliasTarget)} onClose={() => setBurnAliasTarget(null)} onConfirm={async () => {
        if (!burnAliasTarget) return; setBurningAliasId(burnAliasTarget.id); setActionError(null)
        try { await burnAlias(burnAliasTarget.id); const burnedHandle = burnAliasTarget.handle; setAliases((prev) => prev.filter((a) => a.id !== burnAliasTarget.id)); if (selectedAlias === burnedHandle) { const remaining = aliases.filter((a) => a.id !== burnAliasTarget.id); setSelectedAlias(remaining[0]?.handle ?? null); setSelectedId(null) } setBurnAliasTarget(null) }
        catch { setActionError("Could not burn alias.") } finally { setBurningAliasId(null) }
      }} loading={Boolean(burningAliasId)} title="Burn alias?" description="Permanently destroy this alias. Senders will get a hard bounce." confirmLabel="Burn" variant="destructive" icon="ph:fire" highlight={burnAliasTarget?.handle} />
      <KeyboardShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <SendToastHost />
    </div>
  )
}

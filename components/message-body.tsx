"use client"

import { useMemo, useState, type ReactNode } from "react"
import DOMPurify, { type Config } from "dompurify"
import { Icon } from "@/components/icon"
import { emailHtmlPaperClassName } from "@/lib/email-html-paper"
import { cn } from "@/lib/utils"

const URL_PATTERN = /(https?:\/\/[^\s<]+[^\s<.,;:!?)"'\]])/gi

const SANITIZE_CONFIG: Config = {
  USE_PROFILES: { html: true },
  ADD_ATTR: [
    "target",
    "width",
    "height",
    "align",
    "valign",
    "bgcolor",
    "border",
    "cellpadding",
    "cellspacing",
    "colspan",
    "rowspan",
  ],
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button"],
}

let domPurifyHooksInstalled = false
let blockRemoteImages = true

function isRemoteUrl(value: string): boolean {
  const trimmed = value.trim().toLowerCase()
  return trimmed.startsWith("http://") || trimmed.startsWith("https://")
}

function srcsetHasRemoteUrl(value: string): boolean {
  return value.split(",").some((part) => {
    const url = part.trim().split(/\s+/)[0] ?? ""
    return isRemoteUrl(url)
  })
}

function styleHasRemoteUrl(value: string): boolean {
  return /url\(\s*['"]?https?:/i.test(value)
}

function htmlMayHaveRemoteImages(html: string): boolean {
  const lower = html.toLowerCase()
  return (
    lower.includes('src="http') ||
    lower.includes("src='http") ||
    (lower.includes("srcset=") && (lower.includes("http://") || lower.includes("https://"))) ||
    lower.includes("url(http") ||
    lower.includes("url(https")
  )
}

function ensureDomPurifyHooks() {
  if (typeof window === "undefined" || domPurifyHooksInstalled) return

  DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
    if (!blockRemoteImages) return

    const name = data.attrName.toLowerCase()
    if (name === "src" && isRemoteUrl(data.attrValue)) {
      data.attrValue = ""
      data.keepAttr = false
      return
    }
    if (name === "srcset" && srcsetHasRemoteUrl(data.attrValue)) {
      data.attrValue = ""
      data.keepAttr = false
      return
    }
    if (name === "style" && styleHasRemoteUrl(data.attrValue)) {
      data.attrValue = ""
      data.keepAttr = false
    }
  })

  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (!blockRemoteImages || node.tagName !== "IMG") return

    const src = node.getAttribute("src")?.trim() ?? ""
    const srcset = node.getAttribute("srcset")?.trim() ?? ""
    const blocked =
      (src && isRemoteUrl(src)) || (srcset && srcsetHasRemoteUrl(srcset))

    if (!blocked) return

    const placeholder = document.createElement("p")
    placeholder.className = "text-xs text-muted-foreground"
    placeholder.textContent = "[Remote image blocked]"
    node.replaceWith(placeholder)
  })

  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank")
      node.setAttribute("rel", "noopener noreferrer")
    }
    if (node.tagName === "IMG" && !blockRemoteImages) {
      node.setAttribute("loading", "lazy")
    }
  })

  domPurifyHooksInstalled = true
}

function linkifyText(text: string) {
  const nodes: ReactNode[] = []
  let lastIndex = 0

  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0]
    const index = match.index ?? 0
    if (index > lastIndex) {
      nodes.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex, index)}</span>)
    }
    nodes.push(
      <a
        key={`u-${index}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent underline underline-offset-2 hover:text-accent/80"
      >
        {url}
      </a>,
    )
    lastIndex = index + url.length
  }

  if (lastIndex < text.length) {
    nodes.push(<span key={`t-${lastIndex}`}>{text.slice(lastIndex)}</span>)
  }

  return nodes.length > 0 ? nodes : text
}

const plainBodyClassName = cn(
  "mt-6 text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap break-words",
  "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:text-accent/80",
)

type MessageBodyProps = {
  body: string
  bodyHtml?: string | null
  className?: string
}

export function MessageBody({ body, bodyHtml, className }: MessageBodyProps) {
  const [imagesLoaded, setImagesLoaded] = useState(false)
  const hasRemoteHtml = Boolean(bodyHtml?.trim() && htmlMayHaveRemoteImages(bodyHtml))

  const sanitizedHtml = useMemo(() => {
    if (!bodyHtml?.trim()) return null
    ensureDomPurifyHooks()
    blockRemoteImages = !imagesLoaded
    const clean = String(DOMPurify.sanitize(bodyHtml, SANITIZE_CONFIG)).trim()
    return clean || null
  }, [bodyHtml, imagesLoaded])

  return (
    <div className={className}>
      {hasRemoteHtml && !imagesLoaded && (
        <button
          type="button"
          onClick={() => setImagesLoaded(true)}
          className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-accent/30 hover:text-foreground"
        >
          <Icon icon="ph:image" className="size-3.5" aria-hidden />
          Load images
        </button>
      )}
      {sanitizedHtml ? (
        <div
          className={emailHtmlPaperClassName}
          dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
        />
      ) : (
        <div className={plainBodyClassName}>{linkifyText(body)}</div>
      )}
    </div>
  )
}

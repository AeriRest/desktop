"use client"

import { useMemo, useState, type ReactNode } from "react"
import DOMPurify, { type Config, type UponSanitizeAttributeHookEvent } from "dompurify"
import { Icon } from "@/components/icon"
import { cn } from "@/lib/utils"

const URL_PATTERN = /(https?:\/\/[^\s<]+[^\s<.,;:!?)"'\]])/gi

const SANITIZE_CONFIG: Config = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ["target"],
  FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button"],
}

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

function sanitizeHtml(html: string, allowRemoteImages: boolean): string {
  if (typeof window === "undefined") return ""

  const uponSanitizeAttr = (_node: Element, data: UponSanitizeAttributeHookEvent) => {
    if (allowRemoteImages) return
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
  }

  const afterSanitizeAttrs = (node: Element) => {
    if (!allowRemoteImages && node.tagName === "IMG") {
      const src = node.getAttribute("src")?.trim() ?? ""
      const srcset = node.getAttribute("srcset")?.trim() ?? ""
      const blocked = (src && isRemoteUrl(src)) || (srcset && srcsetHasRemoteUrl(srcset))
      if (blocked) {
        const placeholder = document.createElement("p")
        placeholder.className = "text-xs text-muted-foreground"
        placeholder.textContent = "[Remote image blocked]"
        node.replaceWith(placeholder)
      }
      return
    }
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank")
      node.setAttribute("rel", "noopener noreferrer")
    }
    if (node.tagName === "IMG" && allowRemoteImages) {
      node.setAttribute("loading", "lazy")
    }
  }

  DOMPurify.addHook("uponSanitizeAttribute", uponSanitizeAttr)
  DOMPurify.addHook("afterSanitizeAttributes", afterSanitizeAttrs)

  const result = String(DOMPurify.sanitize(html, SANITIZE_CONFIG)).trim()

  DOMPurify.removeHook("uponSanitizeAttribute")
  DOMPurify.removeHook("afterSanitizeAttributes")

  return result || ""
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

const bodyClassName = cn(
  "mt-6 text-sm leading-relaxed text-muted-foreground",
  "[&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:text-accent/80",
  "[&_img]:my-2 [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md",
  "[&_p]:mb-3 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
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
    return sanitizeHtml(bodyHtml, imagesLoaded)
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
        <div className={bodyClassName} dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
      ) : (
        <div className={cn(bodyClassName, "whitespace-pre-wrap")}>{linkifyText(body)}</div>
      )}
    </div>
  )
}

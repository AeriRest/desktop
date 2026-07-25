"use client"

import { useEffect, useRef, useState } from "react"
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react"
import { Icon } from "@/components/icon"
import {
  ApiError,
  checkAliasAvailability,
  createAlias,
  getApiErrorDetail,
  listDomains,
} from "@/lib/api"
import {
  activeCustomDomainOptions,
  type AliasDomainOption,
} from "@/lib/alias-domain-options"
import {
  ALIAS_EXPIRY_OPTIONS,
  DEFAULT_TEMPORARY_EXPIRY,
  TEMPORARY_ALIAS_EXPIRY_OPTIONS,
  type AliasExpiry,
  type AliasExpiryOption,
} from "@/lib/alias-expiry"
import { CustomSelect } from "@/components/custom-select"
import { BUILTIN_DOMAINS } from "@/lib/brand"
import { morphEase } from "@/lib/motion"
import { ALIAS_TEMPLATES } from "@/lib/alias-templates"
import { cn } from "@/lib/utils"

const ease = morphEase
const morph = {
  layout: { duration: 0.48, ease },
  duration: 0.4,
  ease,
} as const

export type { AliasDomainOption } from "@/lib/alias-domain-options"

type CreateAliasModalProps = {
  open: boolean
  onClose: () => void
  onCreated: (handle: string) => void
  defaultDomain: string
  canCustomize: boolean
  onUpgrade?: () => void
  extraDomains?: AliasDomainOption[]
}

type AliasMode = "custom" | "temporary"

const MODE_TABS: { id: AliasMode; label: string; icon: string }[] = [
  { id: "custom", label: "Custom name", icon: "ph:at" },
  { id: "temporary", label: "Temporary mail", icon: "ph:hourglass-medium" },
]

function sanitizeAlias(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 24)
}

function isValidAliasLocalPart(value: string) {
  return value.length >= 2 && /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(value)
}

type Availability = "idle" | "checking" | "available" | "taken" | "invalid" | "reserved"

function ExpiryPicker({
  value,
  onChange,
  options,
  disabled,
}: {
  value: AliasExpiry
  onChange: (next: AliasExpiry) => void
  options: AliasExpiryOption[]
  disabled?: boolean
}) {
  const reduced = useReducedMotion()

  return (
    <LayoutGroup id="alias-expiry">
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = value === option.value
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                "relative inline-flex items-center gap-1.5 rounded-full border border-transparent px-2.5 py-1 text-[11px] transition-colors",
                active
                  ? "text-accent"
                  : "text-muted-foreground hover:text-foreground",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              {active && (
                <motion.span
                  layoutId="alias-expiry-active"
                  transition={reduced ? { duration: 0.01 } : morph}
                  className="absolute inset-0 rounded-full border border-accent/35 bg-accent/[0.08]"
                />
              )}
              <Icon icon={option.icon} className="relative size-3 shrink-0" aria-hidden />
              <span className="relative">{option.shortLabel}</span>
            </button>
          )
        })}
      </div>
    </LayoutGroup>
  )
}

export function CreateAliasModal({
  open,
  onClose,
  onCreated,
  defaultDomain,
  canCustomize,
  onUpgrade,
  extraDomains,
}: CreateAliasModalProps) {
  const reduced = useReducedMotion()
  const requestId = useRef(0)
  const domainFetchId = useRef(0)
  const modeDirection = useRef(1)
  const [domain, setDomain] = useState(defaultDomain)
  const [mode, setMode] = useState<AliasMode>(canCustomize ? "custom" : "temporary")
  const [expiry, setExpiry] = useState<AliasExpiry>(DEFAULT_TEMPORARY_EXPIRY)
  const [alias, setAlias] = useState("")
  const [availability, setAvailability] = useState<Availability>("idle")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resolvedExtraDomains, setResolvedExtraDomains] = useState<AliasDomainOption[]>(extraDomains ?? [])
  const [templateId, setTemplateId] = useState<string | null>(null)

  const isTemporary = mode === "temporary" || !canCustomize
  const showCustomName = canCustomize && mode === "custom"

  const domainOptions: AliasDomainOption[] = [
    ...BUILTIN_DOMAINS.map((entry) => ({
      value: entry.value,
      label: entry.label,
      hint: "tag" in entry ? (entry.tag as string) : undefined,
    })),
    ...resolvedExtraDomains,
  ]

  const cleaned = sanitizeAlias(alias)
  const aliasValid = isValidAliasLocalPart(cleaned)

  function switchMode(next: AliasMode) {
    modeDirection.current = next === "temporary" ? 1 : -1
    setMode(next)
    if (next === "temporary") {
      setExpiry(DEFAULT_TEMPORARY_EXPIRY)
    }
  }

  useEffect(() => {
    if (extraDomains && extraDomains.length > 0) {
      setResolvedExtraDomains(extraDomains)
    }
  }, [extraDomains])

  useEffect(() => {
    if (!open) return
    setDomain(defaultDomain)
    setMode(canCustomize ? "custom" : "temporary")
    setExpiry(DEFAULT_TEMPORARY_EXPIRY)
    setAlias("")
    setAvailability("idle")
    setError(null)

    const fetchId = ++domainFetchId.current
    void listDomains()
      .then((data) => {
        if (domainFetchId.current !== fetchId) return
        setResolvedExtraDomains(activeCustomDomainOptions(data.domains))
      })
      .catch(() => {
        // Keep the last known domain list on refresh failure.
      })
  }, [open, defaultDomain, canCustomize])

  useEffect(() => {
    if (!open || !showCustomName) return

    if (!aliasValid) {
      setAvailability(cleaned.length === 0 ? "idle" : "invalid")
      return
    }

    const current = ++requestId.current
    setAvailability("checking")
    const timer = window.setTimeout(() => {
      void checkAliasAvailability(cleaned, domain)
        .then((result) => {
          if (requestId.current !== current) return
          if (!result.available) {
            if (result.reason === "invalid") {
              setAvailability("invalid")
            } else if (result.reason === "reserved") {
              setAvailability("reserved")
            } else {
              setAvailability("taken")
            }
            return
          }
          setAvailability("available")
        })
        .catch(() => {
          if (requestId.current !== current) return
          setAvailability("idle")
        })
    }, 320)

    return () => window.clearTimeout(timer)
  }, [open, showCustomName, cleaned, aliasValid, domain])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !loading) onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [open, loading, onClose])

  async function handleCreate() {
    setLoading(true)
    setError(null)
    try {
      const template = ALIAS_TEMPLATES.find((entry) => entry.id === templateId)
      const created = await createAlias({
        local_part: showCustomName ? cleaned : undefined,
        domain,
        label: template?.label,
        icon: template?.icon,
        expiry: isTemporary && expiry !== "never" ? expiry : "never",
      })
      onCreated(created.handle)
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        const detail = getApiErrorDetail(err, "Upgrade required.")
        setError(detail)
        if (onUpgrade && /upgrade|pro/i.test(detail)) onUpgrade()
        return
      }
      setError(getApiErrorDetail(err, "Could not create alias."))
    } finally {
      setLoading(false)
    }
  }

  const canSubmit = showCustomName ? aliasValid && availability === "available" : true

  const expiryOptions =
    canCustomize && mode === "temporary"
      ? TEMPORARY_ALIAS_EXPIRY_OPTIONS
      : canCustomize
        ? []
        : ALIAS_EXPIRY_OPTIONS

  const selectedExpiry = expiryOptions.find((option) => option.value === expiry)

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center">
          <motion.button
            type="button"
            aria-label="Close dialog"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduced ? 0.01 : 0.2, ease }}
            className="absolute inset-0 bg-background/90"
            onClick={() => !loading && onClose()}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-alias-title"
            layout
            initial={{ opacity: 0, y: reduced ? 0 : 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: reduced ? 0 : 6 }}
            transition={{ duration: reduced ? 0.01 : 0.28, ease }}
            className="relative w-full max-w-sm rounded-2xl border border-border/50 bg-background px-5 py-5 sm:px-6"
          >
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div
                key={mode}
                layout
                initial={{ opacity: 0, y: reduced ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduced ? 0 : -4 }}
                transition={morph}
                className="flex items-start gap-3"
              >
                <motion.span
                  layout
                  className={cn(
                    "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border",
                    isTemporary
                      ? "border-amber-500/25 bg-amber-500/[0.08] text-amber-500/90"
                      : "border-accent/25 bg-accent/[0.08] text-accent",
                  )}
                >
                  <Icon
                    icon={isTemporary ? "ph:hourglass-medium" : "ph:at"}
                    className="size-4"
                    aria-hidden
                  />
                </motion.span>
                <div className="min-w-0 flex-1">
                  <h2 id="create-alias-title" className="text-[15px] font-medium tracking-tight">
                    {isTemporary ? "Temporary mail" : "New alias"}
                  </h2>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                    {isTemporary
                      ? "Get a fully random address that auto-deletes when the timer runs out."
                      : "Pick a name and domain for your new address."}
                  </p>
                </div>
              </motion.div>
            </AnimatePresence>

            {canCustomize && (
              <LayoutGroup id="create-alias-mode">
                <nav
                  className="mt-4 flex gap-1 rounded-full border border-border/50 bg-background/40 p-0.5"
                  aria-label="Alias type"
                >
                  {MODE_TABS.map((tab) => {
                    const active = mode === tab.id
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => switchMode(tab.id)}
                        disabled={loading}
                        className={cn(
                          "relative flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors",
                          active
                            ? "text-accent"
                            : "text-muted-foreground hover:text-foreground",
                          loading && "opacity-50",
                        )}
                      >
                        {active && (
                          <motion.span
                            layoutId="create-alias-tab-active"
                            transition={reduced ? { duration: 0.01 } : morph}
                            className="absolute inset-0 rounded-full border border-accent/35 bg-accent/[0.08]"
                          />
                        )}
                        <Icon icon={tab.icon} className="relative size-3.5 shrink-0" aria-hidden />
                        <span className="relative">{tab.label}</span>
                      </button>
                    )
                  })}
                </nav>
              </LayoutGroup>
            )}

            <motion.div layout transition={morph} className="mt-4 space-y-3">
              <label className="block">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Domain
                </span>
                <CustomSelect
                  className="mt-1.5"
                  value={domain}
                  onChange={setDomain}
                  disabled={loading}
                  mono
                  ariaLabel="Mail domain"
                  options={domainOptions}
                />
              </label>

              <motion.div layout transition={morph} className="overflow-hidden">
                <AnimatePresence mode="popLayout" initial={false} custom={modeDirection.current}>
                  {showCustomName ? (
                    <motion.label
                      key="custom-alias"
                      layout
                      custom={modeDirection.current}
                      initial={{
                        opacity: 0,
                        x: reduced ? 0 : modeDirection.current * 18,
                      }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{
                        opacity: 0,
                        x: reduced ? 0 : modeDirection.current * -18,
                      }}
                      transition={morph}
                      className="block"
                    >
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        Alias
                      </span>
                      <div className="mt-1.5 flex items-center overflow-hidden rounded-xl border border-border/50 bg-background/40 focus-within:border-accent/30">
                        <input
                          value={alias}
                          onChange={(event) => {
                            setAlias(sanitizeAlias(event.target.value))
                            setError(null)
                          }}
                          placeholder="my-shop"
                          disabled={loading}
                          className="min-w-0 flex-1 bg-transparent px-2.5 py-2 font-mono text-[12px] outline-none"
                          autoFocus
                        />
                        <span className="shrink-0 pr-2.5 font-mono text-[11px] text-muted-foreground">
                          @{domain}
                        </span>
                      </div>
                      {cleaned.length > 0 && (
                        <p
                          className={cn(
                            "mt-1.5 text-[11px]",
                            availability === "available" && "text-accent",
                            availability === "taken" && "text-destructive",
                            availability === "invalid" && "text-destructive",
                            availability === "reserved" && "text-destructive",
                            availability === "checking" && "text-muted-foreground",
                          )}
                        >
                          {availability === "checking" && "Checking availability…"}
                          {availability === "available" && "Available"}
                          {availability === "taken" && "Already taken"}
                          {availability === "invalid" && "Use 2–24 letters, numbers, or hyphens"}
                          {availability === "reserved" && "This alias is reserved"}
                        </p>
                      )}
                    </motion.label>
                  ) : (
                    <motion.div
                      key="temporary-alias"
                      layout
                      custom={modeDirection.current}
                      initial={{
                        opacity: 0,
                        x: reduced ? 0 : modeDirection.current * 18,
                      }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{
                        opacity: 0,
                        x: reduced ? 0 : modeDirection.current * -18,
                      }}
                      transition={morph}
                      className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] px-3 py-3"
                    >
                      <div className="flex items-start gap-2.5">
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-amber-500/25 bg-amber-500/[0.1] text-amber-500/90">
                          <Icon icon="ph:shuffle" className="size-3.5" aria-hidden />
                        </span>
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium text-foreground/90">
                            Randomized address
                          </p>
                          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                            A name like{" "}
                            <span className="font-mono text-foreground/80">ghost-mail-a3f2</span>{" "}
                            will be assigned on{" "}
                            <span className="font-mono text-foreground/80">@{domain}</span>.
                          </p>
                          {!canCustomize && onUpgrade && (
                            <button
                              type="button"
                              onClick={onUpgrade}
                              className="mt-2 text-[12px] font-medium text-accent underline-offset-2 hover:underline"
                            >
                              Upgrade to Pro for custom names
                            </button>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>

              {isTemporary && (
                <div className="mt-4">
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Template
                  </span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {ALIAS_TEMPLATES.map((template) => {
                      const active = templateId === template.id
                      return (
                        <button
                          key={template.id}
                          type="button"
                          disabled={loading}
                          onClick={() => {
                            setTemplateId(template.id)
                            setExpiry(template.expiry)
                          }}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                            active
                              ? "border-accent/40 bg-accent/10 text-accent"
                              : "border-border/60 text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <Icon icon={template.icon} className="size-3" aria-hidden />
                          {template.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <AnimatePresence initial={false} mode="popLayout">
                {expiryOptions.length > 0 && (
                  <motion.div
                    key="expiry-picker"
                    layout
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={morph}
                    className="overflow-hidden"
                  >
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      Auto-delete
                    </span>
                    <div className="mt-1.5">
                      <ExpiryPicker
                        value={expiry}
                        onChange={setExpiry}
                        options={expiryOptions}
                        disabled={loading}
                      />
                    </div>
                    <AnimatePresence mode="wait" initial={false}>
                      {expiry !== "never" && selectedExpiry && (
                        <motion.p
                          key={expiry}
                          layout
                          initial={{ opacity: 0, y: reduced ? 0 : 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: reduced ? 0 : -4 }}
                          transition={{ duration: 0.24, ease }}
                          className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground"
                        >
                          <Icon
                            icon={selectedExpiry.icon}
                            className="size-3 shrink-0 text-amber-500/80"
                            aria-hidden
                          />
                          Burns after {selectedExpiry.label.toLowerCase()}.
                        </motion.p>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>

            {error && (
              <p className="mt-3 text-[12px] text-destructive" role="alert">
                {error}
              </p>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={loading || !canSubmit}
                className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 px-3.5 py-1.5 text-[13px] font-medium text-accent transition-colors hover:bg-accent/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? (
                  <Icon icon="ph:spinner" className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Icon
                    icon={isTemporary ? "ph:hourglass-medium" : "ph:plus"}
                    className="size-3.5"
                    aria-hidden
                  />
                )}
                {isTemporary ? "Generate temporary address" : "Create alias"}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

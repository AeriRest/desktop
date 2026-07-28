type UpdateCheckResult = {
  currentVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  downloadUrl: string | null
  releaseNotes: string | null
  releaseUrl: string | null
  integrityVerified: boolean
  verificationError: string | null
  expectedSha256: string | null
  artifactName: string | null
}

type OpenVerifiedUpdateResult = {
  ok: boolean
  error?: string
  path?: string
}

interface ElectronAPI {
  updateTray: (state: Record<string, unknown>) => void
  getApiUrl: () => Promise<string>
  getPlatform: () => Promise<string>
  isDev: () => Promise<boolean>
  getAppVersion: () => Promise<string>
  onNavigate: (callback: (path: string) => void) => void
  onCompose: (callback: () => void) => void
  onFocusSearch: (callback: () => void) => void
  onSelectAlias: (callback: (handle: string) => void) => void
  onOpenMessage: (callback: (payload: Record<string, unknown>) => void) => void
  onRefreshInbox: (callback: () => void) => void
  forceSignIn: () => void
  checkForUpdates: () => Promise<UpdateCheckResult | null>
  getUpdateResult: () => Promise<UpdateCheckResult | null>
  openVerifiedUpdate: () => Promise<OpenVerifiedUpdateResult>
  onUpdateAvailable: (callback: (result: UpdateCheckResult) => void) => void
  onUpdateCheckResult: (callback: (result: UpdateCheckResult) => void) => void
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}

export type { ElectronAPI, OpenVerifiedUpdateResult, UpdateCheckResult }

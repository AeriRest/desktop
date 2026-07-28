type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const SESSION_TOKEN_KEY: string
export const LEGACY_ACCOUNT_CODE_KEY: string
export function getSessionToken(storage: StorageLike): string | null
export function setSessionToken(storage: StorageLike, token: string): void
export function clearLegacyAccountCode(storage: StorageLike): void
export function clearSessionStorage(storage: StorageLike): void
export function getStoredAccountCode(storage: StorageLike): null
export function storeAccountCode(storage: StorageLike, code: string): void

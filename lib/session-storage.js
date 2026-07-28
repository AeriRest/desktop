const SESSION_TOKEN_KEY = "aeri_session_token"
const LEGACY_ACCOUNT_CODE_KEY = "aerimail_account_code"

function getSessionToken(storage) {
  return storage.getItem(SESSION_TOKEN_KEY)
}

function setSessionToken(storage, token) {
  storage.setItem(SESSION_TOKEN_KEY, token)
}

function clearLegacyAccountCode(storage) {
  storage.removeItem(LEGACY_ACCOUNT_CODE_KEY)
}

function clearSessionStorage(storage) {
  storage.removeItem(SESSION_TOKEN_KEY)
  clearLegacyAccountCode(storage)
}

function getStoredAccountCode(_storage) {
  return null
}

function storeAccountCode(_storage, _code) {}

module.exports = {
  SESSION_TOKEN_KEY,
  LEGACY_ACCOUNT_CODE_KEY,
  getSessionToken,
  setSessionToken,
  clearLegacyAccountCode,
  clearSessionStorage,
  getStoredAccountCode,
  storeAccountCode,
}

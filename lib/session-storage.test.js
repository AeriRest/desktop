const { describe, it } = require("node:test")
const assert = require("node:assert/strict")
const {
  SESSION_TOKEN_KEY,
  LEGACY_ACCOUNT_CODE_KEY,
  getSessionToken,
  setSessionToken,
  clearLegacyAccountCode,
  clearSessionStorage,
  getStoredAccountCode,
  storeAccountCode,
} = require("./session-storage.js")

function memoryStorage(initial = {}) {
  const data = { ...initial }
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null
    },
    setItem(key, value) {
      data[key] = String(value)
    },
    removeItem(key) {
      delete data[key]
    },
    _data: data,
  }
}

describe("session-storage", () => {
  it("persists only the session token", () => {
    const storage = memoryStorage()
    setSessionToken(storage, "tok-1")
    assert.equal(getSessionToken(storage), "tok-1")
    assert.equal(storage._data[SESSION_TOKEN_KEY], "tok-1")
    assert.equal(storage._data[LEGACY_ACCOUNT_CODE_KEY], undefined)
  })

  it("never persists account codes", () => {
    const storage = memoryStorage()
    storeAccountCode(storage, "1234 5678 9012 3456 7890 1234")
    assert.equal(getStoredAccountCode(storage), null)
    assert.equal(storage._data[LEGACY_ACCOUNT_CODE_KEY], undefined)
  })

  it("clears legacy account code without dropping the session token", () => {
    const storage = memoryStorage({
      [SESSION_TOKEN_KEY]: "tok-1",
      [LEGACY_ACCOUNT_CODE_KEY]: "legacy-code",
    })
    clearLegacyAccountCode(storage)
    assert.equal(getSessionToken(storage), "tok-1")
    assert.equal(storage._data[LEGACY_ACCOUNT_CODE_KEY], undefined)
  })

  it("clears session token and legacy account code on logout", () => {
    const storage = memoryStorage({
      [SESSION_TOKEN_KEY]: "tok-1",
      [LEGACY_ACCOUNT_CODE_KEY]: "legacy-code",
    })
    clearSessionStorage(storage)
    assert.equal(getSessionToken(storage), null)
    assert.equal(storage._data[LEGACY_ACCOUNT_CODE_KEY], undefined)
  })
})

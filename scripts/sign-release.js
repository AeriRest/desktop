#!/usr/bin/env node
const crypto = require("crypto")
const fs = require("fs")
const path = require("path")
const { sha256Hex } = require("../electron/update-verify.js")

function usage() {
  console.error(`Usage:
  node scripts/sign-release.js --dir <artifacts-dir> --key <private-pem-path>

Creates SHA256SUMS and SHA256SUMS.sig (ed25519 detached) for .dmg/.exe files in <artifacts-dir>.
Private key must be PKCS8 PEM (openssl genpkey -algorithm ed25519).`)
  process.exit(1)
}

function parseArgs(argv) {
  const out = { dir: null, key: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") out.dir = argv[++i]
    else if (argv[i] === "--key") out.key = argv[++i]
    else if (argv[i] === "--help" || argv[i] === "-h") usage()
  }
  if (!out.dir || !out.key) usage()
  return out
}

function main() {
  const { dir, key } = parseArgs(process.argv.slice(2))
  const absDir = path.resolve(dir)
  const keyPem = fs.readFileSync(path.resolve(key), "utf8")
  const entries = fs.readdirSync(absDir)
    .filter((name) => /\.(dmg|exe)$/i.test(name))
    .sort()
  if (entries.length === 0) {
    console.error("No .dmg or .exe files found in", absDir)
    process.exit(1)
  }

  const lines = []
  for (const name of entries) {
    const data = fs.readFileSync(path.join(absDir, name))
    lines.push(`${sha256Hex(data)}  ${name}`)
  }
  const checksumsText = lines.join("\n") + "\n"
  const sumsPath = path.join(absDir, "SHA256SUMS")
  const sigPath = path.join(absDir, "SHA256SUMS.sig")
  fs.writeFileSync(sumsPath, checksumsText, "utf8")
  const signature = crypto.sign(null, Buffer.from(checksumsText, "utf8"), keyPem)
  fs.writeFileSync(sigPath, signature)
  console.log("Wrote", sumsPath)
  console.log("Wrote", sigPath)
  console.log("Upload both files with the release assets.")
}

main()

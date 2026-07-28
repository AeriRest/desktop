# aeri desktop

Native macOS desktop client for [aeri](https://aeri.rest) — anonymous, private email.

Built with Electron + Next.js + React 19 + Tailwind CSS.

## Install

Download the latest `.dmg` from [Releases](https://github.com/aerirest/desktop/releases) and drag **aeri** into Applications.

If macOS says the app is **damaged** (unsigned build / Gatekeeper quarantine), clear the quarantine flag once:

```bash
xattr -cr /Applications/aeri.app
```

Then open **aeri** again from Applications (or Spotlight).

## Development

```bash
npm install
npm run dev
```

This starts the Next.js dev server on `localhost:3000` and launches Electron pointing at it.

## Build

```bash
npm run build
```

Produces an Apple Silicon DMG in `dist-electron/` (`aeri-1.0.4-arm64.dmg`). The app is deep ad-hoc signed so the bundle is not “linker-only” broken; full Developer ID + notarization is still required to skip Gatekeeper on download without `xattr`.

## Tech stack

- **Electron 35** — desktop shell, tray, system integration
- **Next.js 16** — static export served via custom `app://` protocol
- **React 19** + **Motion** — UI and animations
- **Tailwind CSS 4** — styling with CSS variable theming

See [SECURITY.md](./SECURITY.md) for Electron hardening and credential storage rules.

## Tests

```bash
npm test
```

## Project structure

```
electron/          Electron main process + preload
app/               Next.js pages (onboarding, sign-in, inbox)
components/        UI components (inbox, compose, modals)
lib/               API client, auth, types, utilities
public/            Static assets (icon)
build/             macOS entitlements for packaging
```

## License

Private — [cwelmail](https://github.com/aerirest)

# Agent Note: sharp under Electron on Linux crashes development Hosts

Status: implemented

English | [中文](2026-10-25-linux-desktop-sharp-electron.zh.md)

## Problem

Attaching any image in a Linux desktop development launch killed the Host child process with SIGSEGV. Coredumps showed the fault inside `@img/sharp-linux-x64`'s prebuilt binding, on a libuv worker, calling a null pointer during `metadata()` — the first call `dsh-attachment-local` makes when admitting an image. The Host runs as the Electron binary in Node mode (`ELECTRON_RUN_AS_NODE=1`, `apps/desktop/src/node-environment.ts`), and sharp's own `[SharpElectronLinux]` warning names exactly this incompatibility. The image bytes were irrelevant: a one-line `sharp(file).metadata()` under Electron reproduced the crash deterministically, while the same sharp worked under plain Node.

## Decision

Linux development launches resolve sharp from a source-built tree linked against the system libvips instead of the workspace's prebuilt `@img` binaries.

- `apps/desktop/scripts/prepare-sharp-electron.ts` stages the pinned sharp (pin read from `dsh-attachment-local`), compiles it with `SHARP_FORCE_GLOBAL_LIBVIPS=1`, assembles a self-contained tree at `apps/desktop/.desktop-build/development/sharp-electron`, caches it by sharp pin, Electron Node version, and platform, and smoke-tests the crash path under Electron on every launch.
- `apps/desktop-host/src/sharp-electron.ts` installs a `node:module` `registerHooks` resolver — the `office-engine.ts` pattern — that redirects every resolution landing inside the workspace `node_modules/sharp` tree, whether a bare specifier, a subpath, or an already-resolved path (`require.resolve` output bypasses specifier matching), to the prepared tree on Linux under Electron, and fails loudly at Host startup when the tree is missing. macOS and Windows are untouched: their `@img` prebuilts work, and no Linux packaging target exists.

Evidence that picked system libvips: a freshly compiled binding linked against the prebuilt `@img/sharp-libvips-linux-x64` shared objects still segfaulted under Electron, so the incompatibility lives in the bundled libvips/glib objects, not the binding build. The same build linked against distro libvips 8.18.7 survived the full normalize path (metadata, raw decode, JPEG ladder, WebP) under Electron and under plain Node.

## Consequences

Linux desktop development requires libvips with headers (8.18.7 or newer) and a C++ toolchain, documented in the development guide prerequisites and the Desktop README. The prepared tree is dev-only: packaged runtimes, CI lanes, web, CLI, and plain-Node tests keep the prebuilt workspace sharp. First preparation downloads build dependencies and compiles once (~2 minutes); later launches reuse the cache and only re-run the smoke check. Encoded output bytes on a Linux desktop dev machine can differ from other platforms because the libvips build differs; snapshot and unit coverage run under plain Node with the workspace sharp and are unaffected.

## Alternatives considered

**Rebuild the binding against Electron headers.** N-API keeps the binding portable, and a fresh binding against the bundled libvips objects still crashed, so headers were not the failure surface.

**Run the Linux development Host under the primary-runtime's plain Node.** Zero compilation, but it would stop exercising Electron RunAsNode on the only platform where development launches run against that runtime's quirks.

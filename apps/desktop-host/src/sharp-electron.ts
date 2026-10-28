/** Resolve sharp from the Electron-compatible build prepared for Linux development launches. */

import { existsSync } from 'node:fs'
import { registerHooks, type ModuleHooks } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Runtime facts that decide whether the prepared sharp build applies. */
export interface SharpElectronEnvironment {
  readonly platform: NodeJS.Platform
  readonly electronVersion: string | undefined
}

/** Path segment every resolution of the workspace sharp package ends up under. */
const RESOLVED_SHARP_MARKER = '/node_modules/sharp/'

/**
 * Directory of the prepared tree beside a development runtime's project directory.
 * @param runtimeDir - Prepared dsh runtime directory handed to the Host.
 * @returns Location the desktop development launcher prepares.
 */
export function sharpElectronDirectory(runtimeDir: string): string {
  return join(runtimeDir, '..', 'sharp-electron')
}

/**
 * Keep the attachment runtime's sharp from loading the prebuilt `@img` binding, which crashes
 * under Electron's Linux runtime (ELECTRON_RUN_AS_NODE): every resolution landing inside the
 * workspace `node_modules/sharp` tree — bare, subpath, or already-resolved path, since
 * `require.resolve` bypasses hooks — redirects to the source-built tree linked against the
 * system libvips. Hooks apply only to this thread; worker threads must install their own resolver.
 * @param runtimeDir - Prepared dsh runtime directory handed to the Host.
 * @param environment - Runtime facts, injectable for tests.
 * @returns Installed resolver for the Host lifetime, or undefined where the prebuilt binding is safe.
 */
export function installSharpElectronResolution(
  runtimeDir: string,
  environment: SharpElectronEnvironment = { platform: process.platform, electronVersion: process.versions.electron },
): ModuleHooks | undefined {
  if (environment.platform !== 'linux' || environment.electronVersion === undefined) return undefined
  const replacement = sharpElectronDirectory(runtimeDir)
  if (!existsSync(join(replacement, 'package.json'))) {
    throw new Error(`desktop development on Linux resolves sharp from ${replacement}, which is missing; launch through the desktop development launcher after installing libvips with headers, or remove the launcher's Electron binary from this runtime`)
  }
  const destination = pathToFileURL(replacement).href
  return registerHooks({
    resolve(specifier, context, nextResolve) {
      const resolved = nextResolve(specifier, context)
      if (!resolved.url.startsWith('file:')) return resolved
      const marker = resolved.url.indexOf(RESOLVED_SHARP_MARKER)
      if (marker === -1) return resolved
      return { ...resolved, url: `${destination}/${resolved.url.slice(marker + RESOLVED_SHARP_MARKER.length)}` }
    },
  })
}

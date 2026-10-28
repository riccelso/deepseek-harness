/** Build the Electron-compatible sharp tree that Linux desktop development launches resolve. */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, delimiter, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Inputs recorded in the prepared tree; a mismatch against the launch inputs forces a rebuild. */
export interface SharpElectronManifest {
  readonly sharpVersion: string
  readonly electronNodeVersion: string
  readonly platformArch: string
}

/** Prepared-tree facts, kept beside the build for diagnostics. */
export interface SharpElectronBuildRecord extends SharpElectronManifest {
  readonly libvipsVersion: string
}

/** Name of the prepared tree beside a development runtime's project directory. */
export const SHARP_ELECTRON_DIRECTORY_NAME = 'sharp-electron'
/** Name of the manifest written into a prepared tree. */
export const SHARP_ELECTRON_MANIFEST_NAME = 'build-manifest.json'

const BUILD_DEV_DEPENDENCIES = ['node-addon-api', 'node-gyp'] as const
const RUNTIME_DEPENDENCIES = ['semver', 'detect-libc', '@img'] as const
const SMOKE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')

interface StagedSharpManifest {
  readonly name: string
  readonly version: string
  readonly dependencies: Record<string, string>
  readonly devDependencies: Record<string, string>
  readonly optionalDependencies: Record<string, string>
  readonly config: { readonly libvips: string }
}

/**
 * Read the exact sharp version the attachment runtime pins.
 * @param dependencies - Dependencies of the attachment-local package manifest.
 * @returns The pinned sharp version.
 */
export function sharpElectronPin(dependencies: Record<string, string>): string {
  const pin = dependencies.sharp
  if (pin === undefined || !/^\d+\.\d+\.\d+$/u.test(pin)) {
    throw new Error(`desktop development: sharp-electron requires an exact sharp pin in @deepseek-ai/dsh-attachment-local dependencies, found ${JSON.stringify(pin)}`)
  }
  return pin
}

/**
 * Reduce a published sharp manifest to the build it stages: the source-build toolchain as the only
 * development dependencies, every other field untouched because the node-gyp build reads
 * `optionalDependencies` and `config.libvips` from it.
 * @param manifest - Parsed manifest of the resolved sharp package.
 * @returns A pruned copy for the staging directory.
 */
export function pruneSharpStagedManifest(manifest: StagedSharpManifest): StagedSharpManifest {
  const devDependencies: Record<string, string> = {}
  for (const name of BUILD_DEV_DEPENDENCIES) {
    const version = manifest.devDependencies[name]
    if (version === undefined) {
      throw new Error(`desktop development: sharp-electron needs ${name} in sharp's devDependencies to build from source`)
    }
    devDependencies[name] = version
  }
  return { ...manifest, devDependencies }
}

/**
 * Whether a recorded manifest still covers the current launch inputs.
 * @param recorded - Manifest parsed from a prepared tree, when present.
 * @param expected - Inputs of the launch being prepared.
 * @returns Whether the prepared tree needs no rebuild.
 */
export function sharpElectronManifestMatches(
  recorded: Partial<SharpElectronManifest> | undefined,
  expected: SharpElectronManifest,
): boolean {
  return recorded !== undefined
    && recorded.sharpVersion === expected.sharpVersion
    && recorded.electronNodeVersion === expected.electronNodeVersion
    && recorded.platformArch === expected.platformArch
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    const compared = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (compared !== 0) return compared
  }
  return 0
}

function minimumLibvipsVersion(constraint: string): string {
  const match = /^>=(\d+\.\d+\.\d+)$/u.exec(constraint)
  if (match === null) {
    throw new Error(`desktop development: sharp-electron cannot read sharp's libvips requirement ${JSON.stringify(constraint)}`)
  }
  return match[1]!
}

function systemLibvipsVersion(): string {
  const probe = spawnSync('pkg-config', ['--modversion', 'vips-cpp'], { encoding: 'utf8' })
  return probe.status === 0 ? probe.stdout.trim() : ''
}

function electronNodeVersion(electron: string): string {
  const probe = spawnSync(electron, ['-p', 'process.versions.node'], {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  if (probe.status !== 0) throw new Error('desktop development: sharp-electron cannot read the Electron Node version')
  return probe.stdout.trim()
}

function run(command: string, args: readonly string[], cwd: string, environment: NodeJS.ProcessEnv = process.env): void {
  const result = spawnSync(command, args, { cwd, env: environment, stdio: 'inherit' })
  if (result.error !== undefined) throw new Error(`desktop development: sharp-electron cannot run ${command}: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`desktop development: sharp-electron ${command} ${args.join(' ')} failed with exit ${String(result.status ?? result.signal)}`)
  }
}

function smokeSharpElectron(output: string, electron: string): void {
  const script = `
    const sharp = require(${JSON.stringify(join(output, 'dist', 'index.cjs'))})
    const png = Buffer.from(${JSON.stringify(SMOKE_PNG_BASE64)}, 'base64')
    ;(async () => {
      const metadata = await sharp(png).metadata()
      await sharp(png).raw().toBuffer()
      await sharp(png).jpeg({ quality: 85 }).toBuffer()
      console.log('sharp-electron smoke ok', metadata.format, metadata.width + 'x' + metadata.height)
    })().catch((error) => { console.error(error); process.exit(1) })
  `
  const result = spawnSync(electron, ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  })
  if (result.status === 0) return
  const detail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  throw new Error(`desktop development: the prepared sharp is not usable under Electron (exit ${String(result.status ?? result.signal)}); delete ${output} to force a rebuild${detail === '' ? '' : `: ${detail}`}`)
}

function assemblePreparedTree(stage: string, output: string, record: SharpElectronBuildRecord): void {
  mkdirSync(output, { recursive: true })
  for (const entry of ['dist', 'LICENSE', 'package.json']) cpSync(join(stage, entry), join(output, entry), { recursive: true })
  const binding = join(stage, 'src', 'build', 'Release', `sharp-${record.platformArch}-${record.sharpVersion}.node`)
  if (!existsSync(binding)) throw new Error('desktop development: sharp-electron build produced no native binding')
  cpSync(binding, join(output, 'src', 'build', 'Release', basename(binding)))
  for (const name of RUNTIME_DEPENDENCIES) {
    if (!existsSync(join(stage, 'node_modules', name))) {
      throw new Error(`desktop development: sharp-electron staging is missing the ${name} runtime dependency`)
    }
    cpSync(join(stage, 'node_modules', name), join(output, 'node_modules', name), { recursive: true })
  }
  writeFileSync(join(output, SHARP_ELECTRON_MANIFEST_NAME), `${JSON.stringify(record, null, 2)}\n`)
}

/**
 * Build, cache, and verify the sharp tree that Linux desktop development hosts resolve instead of
 * the workspace's prebuilt `@img` binaries, which crash under Electron's Linux runtime. The
 * binding links the system libvips, the one combination the crash diagnosis proved survives
 * `ELECTRON_RUN_AS_NODE`.
 * @param options - Output and scratch directories plus the Electron executable of the launch.
 * @returns Resolves after the prepared tree satisfies the smoke check under Electron.
 */
export async function prepareSharpElectron(options: {
  readonly output: string
  readonly scratch: string
  readonly electron: string
}): Promise<void> {
  if (process.platform !== 'linux') throw new Error('desktop development: sharp-electron prepares Linux development launches only')
  const require = createRequire(import.meta.url)
  const attachmentDependencies = JSON.parse(readFileSync(
    join(REPOSITORY_ROOT, 'packages', 'attachment', 'attachment-local', 'package.json'), 'utf8',
  )) as { dependencies: Record<string, string> }
  const sharpVersion = sharpElectronPin(attachmentDependencies.dependencies)
  const sourceEntry = require.resolve('sharp')
  const source = dirname(dirname(sourceEntry))
  const sourceManifestPath = join(source, 'package.json')
  const sourceManifest = JSON.parse(readFileSync(sourceManifestPath, 'utf8')) as StagedSharpManifest
  if (sourceManifest.version !== sharpVersion) {
    throw new Error(`desktop development: sharp-electron found sharp ${sourceManifest.version} in the workspace but the attachment runtime pins ${sharpVersion}`)
  }
  const expected: SharpElectronManifest = {
    sharpVersion,
    electronNodeVersion: electronNodeVersion(options.electron),
    platformArch: `${process.platform}-${process.arch}`,
  }
  const manifestPath = join(options.output, SHARP_ELECTRON_MANIFEST_NAME)
  const recorded = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8')) as Partial<SharpElectronBuildRecord>
    : undefined
  const bindingPath = join(options.output, 'src', 'build', 'Release', `sharp-${expected.platformArch}-${expected.sharpVersion}.node`)
  if (sharpElectronManifestMatches(recorded, expected) && existsSync(bindingPath)) {
    smokeSharpElectron(options.output, options.electron)
    return
  }

  const libvipsVersion = systemLibvipsVersion()
  const minimum = minimumLibvipsVersion(sourceManifest.config.libvips)
  if (libvipsVersion === '' || compareVersions(libvipsVersion, minimum) < 0) {
    throw new Error(`desktop development: sharp-electron links the system libvips and found ${libvipsVersion === '' ? 'none' : libvipsVersion}; install libvips with headers (${minimum} or newer), e.g. pacman -S libvips or apt install libvips-dev`)
  }

  console.log(`desktop development: building sharp ${sharpVersion} against system libvips ${libvipsVersion} for Electron`)
  rmSync(options.scratch, { recursive: true, force: true })
  const stage = join(options.scratch, 'stage')
  cpSync(source, stage, { recursive: true, filter: path => !relative(source, path).startsWith('node_modules') })
  const stagedManifest = pruneSharpStagedManifest(sourceManifest)
  writeFileSync(join(stage, 'package.json'), `${JSON.stringify(stagedManifest, null, 2)}\n`)

  run('npm', ['install', '--ignore-scripts', '--omit=optional', '--no-package-lock', '--loglevel=error'], stage)
  run(process.execPath, ['install/build.js'], stage, {
    ...process.env,
    SHARP_FORCE_GLOBAL_LIBVIPS: '1',
    PATH: `${join(stage, 'node_modules', '.bin')}${delimiter}${process.env.PATH ?? ''}`,
  })

  const stagedOutput = join(options.scratch, 'output')
  assemblePreparedTree(stage, stagedOutput, { ...expected, libvipsVersion })
  rmSync(options.output, { recursive: true, force: true })
  renameSync(stagedOutput, options.output)
  smokeSharpElectron(options.output, options.electron)
}

if (import.meta.main) {
  const electron: unknown = createRequire(import.meta.url)('electron')
  if (typeof electron !== 'string') throw new Error('desktop development: electron executable is unavailable')
  await prepareSharpElectron({
    output: join(APP_ROOT, '.desktop-build', 'development', SHARP_ELECTRON_DIRECTORY_NAME),
    scratch: join(APP_ROOT, '.desktop-build', 'tmp', 'sharp-electron'),
    electron,
  })
}

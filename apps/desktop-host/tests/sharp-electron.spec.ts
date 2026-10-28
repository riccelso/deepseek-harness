import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire, type ModuleHooks } from 'node:module'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { installSharpElectronResolution, sharpElectronDirectory } from '../src/sharp-electron.ts'

const roots: string[] = []
const hooks: ModuleHooks[] = []
afterEach(() => {
  for (const hook of hooks.splice(0)) hook.deregister()
  const cache = createRequire(import.meta.url).cache
  for (const path of Object.keys(cache)) {
    if (roots.some(root => path.startsWith(root + sep))) Reflect.deleteProperty(cache, path)
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const electron = { platform: 'linux' as const, electronVersion: '44.7.0' }

function packageDir(base: string, name: string, extras: readonly string[] = []): string {
  mkdirSync(join(base, 'dist', 'sub'), { recursive: true })
  writeFileSync(join(base, 'package.json'), JSON.stringify({ name, version: '0.35.5', main: 'dist/index.cjs' }))
  writeFileSync(join(base, 'dist', 'index.cjs'), `module.exports = { origin: ${JSON.stringify(base)} }`)
  for (const extra of extras) {
    writeFileSync(join(base, extra), `module.exports = { origin: ${JSON.stringify(base)} }`)
  }
  return base
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'desktop-sharp-electron-'))
  roots.push(root)
  const runtime = join(root, 'development', 'project')
  const consumer = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-attachment-local')
  const consumerDependencies = join(consumer, 'node_modules')
  const workspace = join(root, 'workspace', 'node_modules')
  mkdirSync(consumerDependencies, { recursive: true })
  packageDir(join(workspace, 'sharp'), 'sharp', ['dist/sub/marker.cjs'])
  packageDir(join(workspace, 'sharp2'), 'sharp2')
  packageDir(sharpElectronDirectory(runtime), 'sharp', ['dist/sub/marker.cjs'])
  symlinkSync(join(workspace, 'sharp'), join(consumerDependencies, 'sharp'), 'dir')
  symlinkSync(join(workspace, 'sharp2'), join(consumerDependencies, 'sharp2'), 'dir')
  const require: (specifier: string) => { origin: string } = createRequire(join(consumer, 'package.json'))
  return { root, runtime, workspace, require }
}

it('resolves sharp and its subpaths to the prepared tree', () => {
  const f = fixture()
  hooks.push(installSharpElectronResolution(f.runtime, electron)!)
  expect(f.require('sharp').origin).toBe(sharpElectronDirectory(f.runtime))
  expect(f.require('sharp/dist/sub/marker.cjs').origin).toBe(sharpElectronDirectory(f.runtime))
})

it('resolves an absolute sharp entry to the prepared tree', () => {
  const f = fixture()
  hooks.push(installSharpElectronResolution(f.runtime, electron)!)
  expect(f.require(join(f.workspace, 'sharp', 'dist', 'index.cjs')).origin).toBe(sharpElectronDirectory(f.runtime))
})

it('leaves unrelated and sharp-suffixed packages at their own locations', () => {
  const f = fixture()
  hooks.push(installSharpElectronResolution(f.runtime, electron)!)
  expect(f.require('sharp2').origin).toBe(join(f.workspace, 'sharp2'))
})

it('stays inactive off Linux or outside Electron', () => {
  const f = fixture()
  expect(installSharpElectronResolution(f.runtime, { platform: 'darwin', electronVersion: '44.7.0' })).toBeUndefined()
  expect(installSharpElectronResolution(f.runtime, { platform: 'linux', electronVersion: undefined })).toBeUndefined()
  expect(f.require('sharp').origin).toBe(join(f.workspace, 'sharp'))
})

it('fails loudly when Linux Electron has no prepared tree', () => {
  const f = fixture()
  rmSync(sharpElectronDirectory(f.runtime), { recursive: true })
  expect(() => installSharpElectronResolution(f.runtime, electron)).toThrow('which is missing')
})

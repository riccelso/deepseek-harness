import { expect, it } from 'vitest'
import { pruneSharpStagedManifest, sharpElectronManifestMatches, sharpElectronPin } from '../scripts/prepare-sharp-electron.ts'

const stagedManifest = {
  name: 'sharp',
  version: '0.35.5',
  dependencies: { '@img/colour': '^1.1.0', 'detect-libc': '^2.1.2', semver: '^7.8.5' },
  devDependencies: { 'node-addon-api': '^8.9.2', 'node-gyp': '^12.4.0', tsd: '^0.33.0' },
  optionalDependencies: { '@img/sharp-linux-x64': '0.35.5' },
  config: { libvips: '>=8.18.7' },
}

it('reads the exact attachment sharp pin', () => {
  expect(sharpElectronPin({ sharp: '0.35.5', semver: '^7.8.5' })).toBe('0.35.5')
})

it('rejects pins that are not exact versions', () => {
  expect(() => sharpElectronPin({})).toThrow('exact sharp pin')
  for (const pin of ['^0.35.5', '0.35.x', 'latest']) {
    expect(() => sharpElectronPin({ sharp: pin })).toThrow('exact sharp pin')
  }
})

it('reduces the staged manifest to the source-build toolchain', () => {
  const pruned = pruneSharpStagedManifest(stagedManifest)
  expect(pruned.devDependencies).toEqual({ 'node-addon-api': '^8.9.2', 'node-gyp': '^12.4.0' })
  expect(pruned.dependencies).toBe(stagedManifest.dependencies)
  expect(pruned.optionalDependencies).toBe(stagedManifest.optionalDependencies)
  expect(pruned.config).toEqual({ libvips: '>=8.18.7' })
  expect(pruned.version).toBe('0.35.5')
})

it('requires both build dependencies in the published manifest', () => {
  const withoutGyp = { ...stagedManifest, devDependencies: { 'node-addon-api': '^8.9.2' } }
  expect(() => pruneSharpStagedManifest(withoutGyp)).toThrow("sharp's devDependencies")
})

it('matches a recorded manifest only field for field', () => {
  const expected = { sharpVersion: '0.35.5', electronNodeVersion: '24.21.0', platformArch: 'linux-x64' }
  expect(sharpElectronManifestMatches(expected, expected)).toBe(true)
  expect(sharpElectronManifestMatches(undefined, expected)).toBe(false)
  for (const field of ['sharpVersion', 'electronNodeVersion', 'platformArch'] as const) {
    expect(sharpElectronManifestMatches({ ...expected, [field]: 'different' }, expected)).toBe(false)
  }
})

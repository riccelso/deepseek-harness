// @vitest-environment jsdom
/** Picked-file drafts: admitted types, size cap, nameless files, and preview URLs. */
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { fileToImageDraft, MAX_IMAGE_DRAFTS } from '../src/client/images.ts'

beforeAll(() => {
  // jsdom ships neither Object-URL static; drafts only need round-trip identity.
  if (typeof URL.createObjectURL !== 'function') URL.createObjectURL = vi.fn(() => 'blob:draft')
  if (typeof URL.revokeObjectURL !== 'function') URL.revokeObjectURL = vi.fn()
})

const created: string[] = []
const originalCreate = URL.createObjectURL
afterEach(() => {
  for (const url of created) URL.revokeObjectURL(url)
  created.length = 0
})

function imageFile(name: string, bytes = new Uint8Array([1, 2, 3]), type = 'image/png'): File {
  const file = new File([bytes], name, { type })
  const url = URL.createObjectURL(file)
  created.push(url)
  return file
}

it('reads a named image into a sendable draft with a preview URL', async () => {
  const draft = await fileToImageDraft(imageFile('shot.png'))
  expect(draft).toMatchObject({ mediaType: 'image/png', name: 'shot.png', data: 'AQID' })
  expect(draft.url).toBeTruthy()
})

it('omits the name field for a nameless pick and rejects other types', async () => {
  const unnamed = await fileToImageDraft(imageFile(''))
  expect('name' in unnamed).toBe(false)
  await expect(fileToImageDraft(imageFile('note.txt', new Uint8Array([1]), 'text/plain'))).rejects.toThrow('unsupported image type')
})

it('rejects files over the size cap before reading them', async () => {
  const file = imageFile('big.png')
  Object.defineProperty(file, 'size', { value: 20 * 1024 * 1024 + 1 })
  await expect(fileToImageDraft(file)).rejects.toThrow('exceeds 20 MiB')
})

it('exposes the composer draft cap', () => {
  expect(MAX_IMAGE_DRAFTS).toBeGreaterThan(0)
  expect(originalCreate).toBe(URL.createObjectURL)
})

/** Draft image attachments for side questions, ready for the JSON Remote carrier. */

/** Image media types the Host attachment store admits. */
export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

/** One admitted image media type. */
export type BtwImageMediaType = typeof IMAGE_MEDIA_TYPES[number]

/** One picked image: the wire payload plus a preview URL owned by this window. */
export interface BtwImageDraft {
  readonly mediaType: BtwImageMediaType
  /** Canonical base64 payload, exactly as the Remote sends it. */
  readonly data: string
  readonly name?: string
  /** Object URL for the composer thumbnail; revoked when the draft is dropped. */
  readonly url: string
}

/** Largest single image this composer offers the Host (the store re-validates). */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

/** Cap on drafts waiting in one composer. */
export const MAX_IMAGE_DRAFTS = 9

function base64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(text)
}

/**
 * Read one picked file into a sendable draft with a preview URL.
 * @param file - a user-picked image file.
 * @returns the draft for the composer.
 * @throws when the type is not an admitted image or the file is too large.
 */
export async function fileToImageDraft(file: File): Promise<BtwImageDraft> {
  const mediaType = (IMAGE_MEDIA_TYPES as readonly string[]).includes(file.type) ? file.type as BtwImageMediaType : undefined
  if (mediaType === undefined) throw new Error(`unsupported image type "${file.type}"`)
  if (file.size > MAX_IMAGE_BYTES) throw new Error('image exceeds 20 MiB')
  const buffer = await file.arrayBuffer()
  return {
    mediaType,
    data: base64(new Uint8Array(buffer)),
    ...file.name.length === 0 ? {} : { name: file.name },
    url: URL.createObjectURL(file),
  }
}

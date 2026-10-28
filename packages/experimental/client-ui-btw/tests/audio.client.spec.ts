// @vitest-environment jsdom
/** Microphone capture: failure kinds, the recording round trip, and resource release. */
import { afterEach, expect, it, vi } from 'vitest'
import { Recording, RecordingError, audioBase64, encodeWave } from '../src/client/audio.ts'

afterEach(() => { vi.unstubAllGlobals() })

/** Install one controllable capture device; onstop fires only when flushed. */
function device(options: { permissionError?: Error; recorderError?: boolean; noChunks?: boolean } = {}) {
  const trackStop = vi.fn()
  const closed = vi.fn(async () => {})
  const decoding = vi.fn(async () => ({ duration: 2 }))
  const rendering = vi.fn(async () => ({ getChannelData: () => new Float32Array([0.5, -0.5]) }))
  class RecorderStub {
    static last: RecorderStub | undefined
    state = 'recording'
    mimeType = 'audio/webm'
    ondataavailable?: (event: { data: Blob }) => void
    onstop?: () => void
    onerror?: () => void
    constructor() { RecorderStub.last = this }
    start(): void {
      if (options.noChunks === true) return
      this.ondataavailable?.({ data: new Blob(['partial']) })
      this.ondataavailable?.({ data: new Blob([]) })
    }
    stop(): void { this.state = 'inactive' }
  }
  vi.stubGlobal('MediaRecorder', RecorderStub)
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => {
        if (options.permissionError !== undefined) throw options.permissionError
        return { getTracks: () => [{ stop: trackStop }] }
      },
    },
  })
  vi.stubGlobal('AudioContext', class {
    state = 'running'
    decodeAudioData = decoding
    close = closed
  })
  vi.stubGlobal('OfflineAudioContext', class {
    constructor(readonly channels: number, readonly length: number, readonly rate: number) {}
    createBufferSource() { return { connect: () => {}, start: () => {} } }
    startRendering = rendering
  })
  return { trackStop, closed, decoding, rendering, capture: () => RecorderStub.last }
}

it('encodes bounded PCM samples and base64 across chunk boundaries', () => {
  const bytes = encodeWave(new Float32Array([-2, -0.5, 0, 0.5, 2]))
  const view = new DataView(bytes.buffer)
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
  expect(view.getUint32(24, true)).toBe(16000)
  expect(view.getUint32(40, true)).toBe(10)
  expect([0, 1, 2, 3, 4].map(i => view.getInt16(44 + i * 2, true))).toEqual([-32768, -16384, 0, 16384, 32767])
  const large = encodeWave(new Float32Array(17000))
  expect(atob(audioBase64(large))).toEqual(String.fromCharCode(...large))
})

it('reports unavailable capture and denied permission', async () => {
  vi.stubGlobal('navigator', {})
  await expect(new Recording().start()).rejects.toMatchObject({ kind: 'unavailable' })
  device()
  vi.stubGlobal('MediaRecorder', undefined)
  await expect(new Recording().start()).rejects.toMatchObject({ kind: 'unavailable' })
  const denied = device({ permissionError: new DOMException('denied', 'NotAllowedError') })
  vi.stubGlobal('MediaRecorder', denied.capture)
  await expect(new Recording().start()).rejects.toMatchObject({ kind: 'permission' })
  device({ permissionError: new Error('device lost') })
  await expect(new Recording().start()).rejects.toThrow('device lost')
  expect(new RecordingError('empty').message).toBe('empty')
})

it('releases a grant that settles after cancellation', async () => {
  const grant = Promise.withResolvers<{ getTracks: () => { stop: () => void }[] }>()
  const stop = vi.fn()
  device()
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => grant.promise } })
  const recording = new Recording()
  const acquiring = recording.start()
  await recording.dispose()
  grant.resolve({ getTracks: () => [{ stop }] })
  await expect(acquiring).rejects.toMatchObject({ kind: 'cancelled' })
  expect(stop).toHaveBeenCalledOnce()
})

it('flushes final bytes, bounds overshoot, and closes resources once', async () => {
  const d = device()
  const recording = new Recording()
  await recording.start()
  const stopping = recording.stop(1)
  // The final chunk arrives with the stop event; flush it and settle onstop.
  const recorder = d.capture()!
  recorder.ondataavailable?.({ data: new Blob(['final audio']) })
  recorder.onstop?.()
  const result = await stopping
  expect(d.decoding).toHaveBeenCalled()
  expect(d.rendering).toHaveBeenCalled()
  expect(result).toEqual(encodeWave(new Float32Array([0.5, -0.5])))
  expect(d.trackStop).toHaveBeenCalled()
  expect(d.closed).toHaveBeenCalledOnce()
  await recording.dispose()
  expect(d.closed).toHaveBeenCalledOnce()
})

it('fails empty when capture never started, the recorder errors, or no bytes arrived', async () => {
  await expect(new Recording().stop(120)).rejects.toMatchObject({ kind: 'empty' })
  const d = device()
  const recording = new Recording()
  await recording.start()
  const stopping = recording.stop(120)
  d.capture()!.onerror?.()
  await expect(stopping).rejects.toMatchObject({ kind: 'empty' })
  expect(d.trackStop).toHaveBeenCalled()
})

it('releases resources when recorder construction fails', async () => {
  device()
  vi.stubGlobal('MediaRecorder', function RecorderBoom() { throw new Error('recorder unavailable') })
  const recording = new Recording()
  await expect(recording.start()).rejects.toThrow('recorder unavailable')
})

it('fails empty without recorder bytes and stops a live recorder on dispose', async () => {
  const d = device({ noChunks: true })
  const quiet = new Recording()
  await quiet.start()
  const stopping = quiet.stop(120)
  d.capture()!.onstop?.()
  await expect(stopping).rejects.toMatchObject({ kind: 'empty' })
  device()
  const recording = new Recording()
  await recording.start()
  await recording.dispose()
  await expect(recording.stop(120)).rejects.toMatchObject({ kind: 'empty' })
})

it('discards a decoding result that finishes after cancellation', async () => {
  const d = device()
  const decoded = Promise.withResolvers<{ duration: number }>()
  d.decoding.mockReturnValueOnce(decoded.promise)
  const recording = new Recording()
  await recording.start()
  const stopping = recording.stop(120)
  const recorder = d.capture()!
  recorder.ondataavailable?.({ data: new Blob(['final audio']) })
  recorder.onstop?.()
  await vi.waitFor(() => { expect(d.decoding).toHaveBeenCalledOnce() })
  await recording.dispose()
  decoded.resolve({ duration: 2 })
  await expect(stopping).rejects.toMatchObject({ kind: 'cancelled' })
  expect(d.rendering).not.toHaveBeenCalled()
})

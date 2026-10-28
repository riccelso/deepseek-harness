/** Browser microphone capture for voice side questions, adapted from client-ui-voice-input. */

/** Capture failure; the caller shows the kind beside a localized prefix. */
export class RecordingError extends Error {
  constructor(readonly kind: 'unavailable' | 'permission' | 'empty' | 'cancelled') { super(kind); this.name = 'RecordingError' }
}

/**
 * Encode mono floating-point samples as the canonical PCM16 WAV the Host accepts.
 * @param samples - native-resampled 16 kHz mono samples.
 * @returns complete little-endian WAV bytes.
 */
export function encodeWave(samples: Float32Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const text = (at: number, value: string): void => { for (let i = 0; i < value.length; i++) bytes[at + i] = value.charCodeAt(i) }
  text(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (const [i, sample] of samples.entries()) {
    const value = Math.max(-1, Math.min(1, sample))
    view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
  }
  return bytes
}

/**
 * Encode the binary recording for the JSON Remote carrier.
 * @param bytes - complete recording.
 * @returns base64 with no data URL prefix.
 */
export function audioBase64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(text)
}

/** One microphone recording, from acquisition to a resampled WAV. */
export class Recording {
  private stream: MediaStream | undefined
  private recorder: MediaRecorder | undefined
  private context: AudioContext | undefined
  private chunks: Blob[] = []
  private readonly lifetime = new AbortController()

  /**
   * Acquire the microphone and start capture.
   * @throws RecordingError when capture is unavailable, permission is denied, or cancelled.
   */
  async start(): Promise<void> {
    const devices = (navigator as Partial<Navigator>).mediaDevices
    if (!devices || typeof MediaRecorder === 'undefined') throw new RecordingError('unavailable')
    let stream: MediaStream
    try {
      stream = await devices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') throw new RecordingError('permission')
      throw error
    }
    if (this.lifetime.signal.aborted) {
      stream.getTracks().forEach((track) => { track.stop() })
      throw new RecordingError('cancelled')
    }
    this.stream = stream
    try {
      this.context = new AudioContext()
      this.recorder = new MediaRecorder(stream)
      this.recorder.ondataavailable = (event) => {
        if (!this.lifetime.signal.aborted && event.data.size > 0) this.chunks.push(event.data)
      }
      this.recorder.start()
    } catch (error) {
      await this.dispose()
      throw error
    }
  }

  /**
   * Finish capture and resample to 16 kHz mono.
   * @param maxDurationSeconds - truncate timer overshoot to the Host limit.
   * @returns complete WAV bytes.
   */
  async stop(maxDurationSeconds: number): Promise<Uint8Array<ArrayBuffer>> {
    const recorder = this.recorder
    const context = this.context
    if (!recorder || !context || recorder.state !== 'recording') {
      await this.dispose()
      throw new RecordingError('empty')
    }
    try {
      await new Promise<void>((resolve, reject) => {
        recorder.onstop = () => { resolve() }
        recorder.onerror = () => { reject(new RecordingError('empty')) }
        recorder.stop()
      })
      this.stream?.getTracks().forEach((track) => { track.stop() })
      this.lifetime.signal.throwIfAborted()
      const blob = new Blob(this.chunks, { type: recorder.mimeType })
      if (blob.size === 0) throw new RecordingError('empty')
      const decoded = await context.decodeAudioData(await blob.arrayBuffer())
      this.lifetime.signal.throwIfAborted()
      const offline = new OfflineAudioContext(1, Math.max(1, Math.floor(Math.min(decoded.duration, maxDurationSeconds) * 16000)), 16000)
      const source = offline.createBufferSource()
      source.buffer = decoded
      source.connect(offline.destination)
      source.start()
      const resampled = await offline.startRendering()
      this.lifetime.signal.throwIfAborted()
      return encodeWave(resampled.getChannelData(0))
    } finally {
      await this.dispose()
    }
  }

  /** Release every resource this recording holds. */
  async dispose(): Promise<void> {
    this.lifetime.abort(new RecordingError('cancelled'))
    if (this.recorder?.state === 'recording') this.recorder.stop()
    this.stream?.getTracks().forEach((track) => { track.stop() })
    this.stream = undefined
    const context = this.context
    this.context = undefined
    this.chunks = []
    if (context && context.state !== 'closed') await context.close()
  }
}

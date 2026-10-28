// @vitest-environment jsdom
/** Tab body rendering: cards, per-card actions, composer wiring, empty state, and restored-tab ensure. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { BtwTabPanel, clipboardImageFiles } from '../src/client/BtwTabPanel.tsx'
import type { BtwCard, BtwPanelEntry, BtwTabPanelProps } from '../src/client/BtwTabPanel.tsx'

const t = (key: string): string => key

beforeAll(() => {
  // jsdom models no scrolling geometry; the body only ever asks the transcript
  // to settle at its end, which is a no-op here.
  if (typeof Element.prototype.scrollTo !== 'function') Element.prototype.scrollTo = () => {}
  // jsdom ships no async clipboard; the copy action only needs its promise.
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: () => Promise.resolve() },
    configurable: true,
  })
  if (typeof URL.revokeObjectURL !== 'function') URL.revokeObjectURL = () => {}
})

afterEach(() => { cleanup() })

function card(overrides: Partial<BtwCard> & Pick<BtwCard, 'id'>): BtwCard {
  return { question: 'q', status: 'done', ...overrides }
}

function entry(overrides: Partial<BtwPanelEntry> = {}): BtwPanelEntry {
  return {
    question: '', cards: [], dropped: 0, loaded: false, images: [], ...overrides,
  }
}

function renderPanel(state: BtwPanelEntry | undefined, speechReady = vi.fn(() => false), transcribe = vi.fn(async () => 'heard words')) {
  const ensure = vi.fn()
  const setQuestion = vi.fn()
  const ask = vi.fn()
  const cancel = vi.fn()
  const discard = vi.fn()
  const insertIntoConversation = vi.fn()
  const clearHistory = vi.fn()
  const addImage = vi.fn()
  const removeImage = vi.fn()
  const close = vi.fn()
  const snapshot: Record<string, BtwPanelEntry> = state === undefined ? {} : { s1: state }
  const props = {
    sessionId: 's1',
    useTabInfo: () => ({ tab: { actions: { close } } }),
    usePanels: (select: (panels: Readonly<Record<string, BtwPanelEntry>>) => unknown) => select(snapshot),
    ensure, setQuestion, ask, cancel, discard, insertIntoConversation, clearHistory,
    addImage, removeImage, speechReady, transcribe, t,
  } as BtwTabPanelProps
  render(<BtwTabPanel {...props} />)
  return { ensure, setQuestion, ask, cancel, discard, insertIntoConversation, clearHistory,
    addImage, removeImage, speechReady, transcribe, close, props }
}

describe('btw tab body', () => {
  it('renders settled cards with token cost, the evicted note, and clear', () => {
    renderPanel(entry({
      cards: [
        card({ id: 'a', question: 'q1', answer: 'a1', tokens: 7 }),
        card({ id: 'b', question: 'q2', answer: 'a2', imageCount: 2 }),
      ],
      dropped: 3,
    }))
    expect(screen.getByText('q1')).toBeDefined()
    expect(screen.getByText('a1')).toBeDefined()
    expect(screen.getByText('q2')).toBeDefined()
    expect(screen.getByText('a2')).toBeDefined()
    expect(screen.getByText('panel.tokens')).toBeDefined()
    expect(screen.getByText('panel.images')).toBeDefined()
    expect(screen.getByText('panel.evicted')).toBeDefined()
    expect(screen.getByRole('button', { name: 'panel.clear' })).toBeDefined()
  })

  it('offers copy, insert, and discard on a settled card', async () => {
    const spy = renderPanel(entry({ cards: [card({ id: 'a', question: 'q1', answer: 'the answer' })] }))
    fireEvent.click(screen.getByRole('button', { name: 'panel.insert' }))
    expect(spy.insertIntoConversation).toHaveBeenCalledWith('s1', 'the answer')
    fireEvent.click(screen.getByRole('button', { name: 'panel.discard' }))
    expect(spy.discard).toHaveBeenCalledWith('s1', 'a')
    fireEvent.click(screen.getByRole('button', { name: 'panel.copy' }))
    expect(await screen.findByRole('button', { name: 'panel.copied' })).toBeDefined()
  })

  it('cancels one generating card while the composer keeps asking', () => {
    const spy = renderPanel(entry({
      question: 'next?',
      cards: [card({ id: 'wip', question: 'wip question', status: 'generating' })],
    }))
    expect(screen.getByRole('status').textContent).toBe('panel.pending')
    fireEvent.click(screen.getByRole('button', { name: 'panel.cancel' }))
    expect(spy.cancel).toHaveBeenCalledWith('s1', 'wip')
    const input = screen.getByPlaceholderText('panel.placeholder')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(spy.ask).toHaveBeenCalledWith('s1', 'next?')
  })

  it('marks a cancelled card and discards it', () => {
    const spy = renderPanel(entry({ cards: [card({ id: 'c', question: 'gone', status: 'cancelled' })] }))
    expect(screen.getByText('panel.cancelled')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'panel.discard' }))
    expect(spy.discard).toHaveBeenCalledWith('s1', 'c')
  })

  it('shows one card failure with its discard action', () => {
    const spy = renderPanel(entry({ cards: [card({ id: 'e', question: 'broke', status: 'error', error: 'boom' })] }))
    expect(screen.getByRole('alert').textContent).toBe('boom')
    fireEvent.click(screen.getByRole('button', { name: 'panel.discard' }))
    expect(spy.discard).toHaveBeenCalledWith('s1', 'e')
  })

  it('asks the draft on Enter, edits through setQuestion, and closes on Escape', () => {
    const spy = renderPanel(entry({ question: 'why?' }))
    const input = screen.getByPlaceholderText('panel.placeholder')
    fireEvent.change(input, { target: { value: 'edited' } })
    expect(spy.setQuestion).toHaveBeenCalledWith('s1', 'edited')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(spy.ask).toHaveBeenCalledWith('s1', 'why?')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(spy.close).toHaveBeenCalledTimes(1)
  })

  it('renders the empty state without asking the Host', () => {
    const spy = renderPanel(entry())
    expect(screen.getByText('panel.empty')).toBeDefined()
    expect(spy.ensure).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'panel.clear' })).toBeNull()
  })

  it('ensures history for a restored tab that has no store entry', () => {
    const spy = renderPanel(undefined)
    expect(screen.getByText('panel.empty')).toBeDefined()
    expect(spy.ensure).toHaveBeenCalledWith('s1')
  })

  it('renders queued image thumbnails and removes one through its action', () => {
    const spy = renderPanel(entry({
      question: 'what is this?',
      images: [
        { mediaType: 'image/png', data: 'aGk=', name: 'shot.png', url: 'blob:one' },
        { mediaType: 'image/png', data: 'aGk=', name: 'shot2.png', url: 'blob:two' },
      ],
    }))
    expect(screen.getByAltText('shot.png')).toBeDefined()
    expect(screen.getByAltText('shot2.png')).toBeDefined()
    fireEvent.click(screen.getAllByRole('button', { name: 'panel.removeImage' })[0]!)
    expect(spy.removeImage).toHaveBeenCalledWith('s1', 'blob:one')
  })

  it('extracts image files from clipboard data and ignores text-only pastes', () => {
    const imageFile = new File([new Uint8Array([137, 80, 78, 71])], 'pasted.png', { type: 'image/png' })
    const data = {
      files: [] as File[],
      items: [
        { kind: 'file', type: 'image/png', getAsFile: () => imageFile },
        { kind: 'string', type: 'text/plain', getAsFile: () => null },
      ],
    } as never
    const files = clipboardImageFiles(data)
    expect(files).toHaveLength(1)
    expect(files[0]!.name).toBe('pasted.png')
    expect(clipboardImageFiles(null)).toEqual([])
    expect(clipboardImageFiles(undefined)).toEqual([])
    const textOnly = { files: [] as File[], items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] } as never
    expect(clipboardImageFiles(textOnly)).toEqual([])
  })

  it('renders through a paste without clipboard data', () => {
    renderPanel(entry({ question: 'draft' }))
    const input = screen.getByPlaceholderText('panel.placeholder')
    expect(() => { fireEvent.paste(input) }).not.toThrow()
    expect(screen.getByDisplayValue('draft')).toBeDefined()
  })

  it('hides the mic without speech', () => {
    renderPanel(entry({ cards: [card({ id: 'a', question: 'q1', answer: 'a1' })] }))
    expect(screen.getByText('q1')).toBeDefined()
    const buttons = screen.getAllByRole('button')
    expect(buttons.some(button => button.getAttribute('aria-label') === 'panel.mic.record')).toBe(false)
  })
})

/** Install one controllable microphone; recorders capture themselves for flushing. */
function micDevice(options: { startError?: Error } = {}) {
  const recorders: { state: string; ondataavailable?: (event: { data: Blob }) => void; onstop?: () => void }[] = []
  class Recorder {
    state = 'recording'
    ondataavailable?: (event: { data: Blob }) => void
    onstop?: () => void
    start(): void { recorders.push(this) }
    stop(): void { this.state = 'inactive' }
  }
  vi.stubGlobal('MediaRecorder', Recorder)
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: async () => {
        if (options.startError !== undefined) throw options.startError
        return { getTracks: () => [{ stop: vi.fn() }] }
      },
    },
  })
  vi.stubGlobal('AudioContext', class {
    state = 'running'
    decodeAudioData = vi.fn(async () => ({ duration: 2 }))
    close = vi.fn(async () => {})
  })
  vi.stubGlobal('OfflineAudioContext', class {
    createBufferSource() { return { connect: () => {}, start: () => {} } }
    startRendering = vi.fn(async () => ({ getChannelData: () => new Float32Array([0.5]) }))
  })
  return recorders
}

describe('btw tab voice input', () => {
  // Microphone fixtures replace global devices; every test restores them.
  afterEach(() => { vi.unstubAllGlobals() })

  beforeAll(() => {
    if (typeof URL.createObjectURL !== 'function') {
      URL.createObjectURL = vi.fn(() => 'blob:voice')
      URL.revokeObjectURL = vi.fn()
    }
  })

  it('records a question, transcribes it into an empty draft, and appends to one with text', async () => {
    const recorders = micDevice()
    const spy = renderPanel(entry({ question: '' }), vi.fn(() => true), vi.fn(async () => 'heard words'))
    fireEvent.click(screen.getByRole('button', { name: 'panel.mic.record' }))
    const stop = await screen.findByRole('button', { name: 'panel.mic.stop' })
    expect(recorders).toHaveLength(1)
    fireEvent.click(stop)
    recorders[0]!.ondataavailable?.({ data: new Blob(['audio']) })
    recorders[0]!.onstop?.()
    await waitFor(() => { expect(spy.setQuestion).toHaveBeenLastCalledWith('s1', 'heard words') })
    expect(spy.transcribe).toHaveBeenCalledOnce()
  })

  it('appends the transcription after an existing draft', async () => {
    const recorders = micDevice()
    const spy = renderPanel(entry({ question: 'earlier' }), vi.fn(() => true), vi.fn(async () => 'more'))
    fireEvent.click(screen.getByRole('button', { name: 'panel.mic.record' }))
    const stop = await screen.findByRole('button', { name: 'panel.mic.stop' })
    fireEvent.click(stop)
    recorders[0]!.ondataavailable?.({ data: new Blob(['audio']) })
    recorders[0]!.onstop?.()
    await waitFor(() => { expect(spy.setQuestion).toHaveBeenLastCalledWith('s1', 'earlier\nmore') })
  })

  it('surfaces a failed recording', async () => {
    micDevice({ startError: new DOMException('denied', 'NotAllowedError') })
    renderPanel(entry({}), vi.fn(() => true))
    fireEvent.click(screen.getByRole('button', { name: 'panel.mic.record' }))
    expect(await screen.findByText(/permission/u)).toBeDefined()
  })

  it('surfaces a failed transcription without touching the draft', async () => {
    const recorders = micDevice()
    const spy = renderPanel(entry({}), vi.fn(() => true), vi.fn(async () => { throw new Error('engine cold') }))
    fireEvent.click(screen.getByRole('button', { name: 'panel.mic.record' }))
    const stop = await screen.findByRole('button', { name: 'panel.mic.stop' })
    fireEvent.click(stop)
    recorders[0]!.ondataavailable?.({ data: new Blob(['audio']) })
    recorders[0]!.onstop?.()
    expect(await screen.findByText(/engine cold/u)).toBeDefined()
    expect(spy.setQuestion).not.toHaveBeenCalled()
  })

  it('queues picked image files through the hidden input and rejects failing reads', async () => {
    const spy = renderPanel(entry({}))
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const good = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })
    fireEvent.change(input, { target: { files: [good] } })
    await waitFor(() => { expect(spy.addImage).toHaveBeenCalledWith('s1', expect.objectContaining({ name: 'shot.png' })) })
    const bad = new File([new Uint8Array([1])], 'note.txt', { type: 'text/plain' })
    fireEvent.change(input, { target: { files: [bad] } })
    expect(await screen.findByRole('alert')).toBeDefined()
  })

  it('falls back to the clipboard files list when items carry no files', async () => {
    const spy = renderPanel(entry({ question: 'draft' }))
    const imageFile = new File([new Uint8Array([1])], 'listed.png', { type: 'image/png' })
    fireEvent.paste(screen.getByPlaceholderText('panel.placeholder'), {
      clipboardData: { files: [imageFile], items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] },
    })
    await waitFor(() => { expect(spy.addImage).toHaveBeenCalledWith('s1', expect.objectContaining({ name: 'listed.png' })) })
  })

  it('ignores a pick event with no file list', () => {
    const spy = renderPanel(entry({ question: 'draft' }))
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: null } })
    expect(spy.addImage).not.toHaveBeenCalled()
  })

  it('resets the copied marker after its timeout', async () => {
    renderPanel(entry({ cards: [card({ id: 'a', question: 'q1', answer: 'the answer' })] }))
    fireEvent.click(screen.getByRole('button', { name: 'panel.copy' }))
    expect(await screen.findByRole('button', { name: 'panel.copied' })).toBeDefined()
    await new Promise((resolve) => { setTimeout(resolve, 1700) })
    expect(screen.getByRole('button', { name: 'panel.copy' })).toBeDefined()
  }, 5000)

  it('picks pasted images and defers to text-only pastes', async () => {
    const spy = renderPanel(entry({ question: 'draft' }))
    const imageFile = new File([new Uint8Array([1])], 'pasted.png', { type: 'image/png' })
    fireEvent.paste(screen.getByPlaceholderText('panel.placeholder'), {
      clipboardData: { files: [] as File[], items: [{ kind: 'file', type: 'image/png', getAsFile: () => imageFile }] },
    })
    await waitFor(() => { expect(spy.addImage).toHaveBeenCalledWith('s1', expect.objectContaining({ name: 'pasted.png' })) })
    const textOnly = { files: [] as File[], items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] }
    fireEvent.paste(screen.getByPlaceholderText('panel.placeholder'), { clipboardData: textOnly })
    expect(spy.addImage).toHaveBeenCalledTimes(1)
  })
})

// @vitest-environment jsdom
/** Find bar behavior: count, navigation, toggles, validation, and persistence. */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { EMPTY_CHAT_SNAPSHOT } from '../src/client/contract/snapshot.ts'
import type { ChatSnapshot } from '../src/client/contract/snapshot.ts'
import { FindBar } from '../src/client/chat/FindBar.tsx'
import type { SavedChatFind } from '../src/client/contract/slots.ts'
import type { ChatConversationViewNode } from '../src/client/contract/chat-nodes.ts'

const SESSION = 's1' as SessionId

function node(id: string, kind: string, data: unknown): ChatConversationViewNode {
  return {
    key: id, id, kind, target: 'chat', anchorSeq: 1,
    location: { kind: 'unresolved' }, visibility: 'visible', data,
  }
}

const nodes = new Map<string, ChatConversationViewNode>([
  ['a', node('a', 'user', { content: [{ type: 'text', text: 'alpha token beta token' }] })],
  ['b', node('b', 'user', { content: [{ type: 'text', text: 'gamma token' }] })],
  ['c', node('c', 'user', { content: [{ type: 'text', text: 'delta' }] })],
])

const nodeStore = { ...EMPTY_CHAT_SNAPSHOT.nodes, get: (key: string) => nodes.get(key) }
const chatSource = createSnapshotStore<ChatSnapshot>({
  ...EMPTY_CHAT_SNAPSHOT, order: ['a', 'b', 'c'], nodes: nodeStore,
})
const useChat = bindSnapshotSelector(chatSource)

const t = (id: string): string => id

function mountBar(overrides: Partial<Parameters<typeof FindBar>[0]> = {}) {
  const saved = new Map<SessionId, SavedChatFind>()
  const readSaved = (id: SessionId): SavedChatFind | undefined => saved.get(id)
  const saveSaved = (id: SessionId, state: SavedChatFind): void => { saved.set(id, state) }
  const close = vi.fn()
  const view = render(<FindBar
    useChat={useChat}
    containerRef={{ current: null }}
    sessionId={SESSION}
    t={t}
    close={close}
    readSaved={readSaved}
    saveSaved={saveSaved}
    {...overrides}
  />)
  return { view, close, saved, readSaved, saveSaved }
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(cleanup)

describe('FindBar', () => {
  it('shows the live count and updates it per keystroke', () => {
    mountBar()
    const input = screen.getByRole('textbox', { name: 'find.placeholder' })
    expect(screen.queryByText('1/3')).toBeNull()
    fireEvent.change(input, { target: { value: 'token' } })
    expect(screen.getByText('1/3')).toBeTruthy()
    fireEvent.change(input, { target: { value: 'alpha' } })
    expect(screen.getByText('1/1')).toBeTruthy()
  })

  it('reports no results without throwing', () => {
    mountBar()
    fireEvent.change(screen.getByRole('textbox', { name: 'find.placeholder' }), { target: { value: 'zzz' } })
    expect(screen.getByText('find.noResults')).toBeTruthy()
  })

  it('reports an invalid regex inline', () => {
    mountBar()
    const input = screen.getByRole('textbox', { name: 'find.placeholder' })
    fireEvent.change(input, { target: { value: '([' } })
    fireEvent.click(screen.getByRole('button', { name: 'find.useRegex' }))
    expect(screen.getByRole('alert').textContent).toBe('find.invalidRegex')
  })

  it('navigates with Enter and Shift+Enter and wraps around', () => {
    mountBar()
    const input = screen.getByRole('textbox', { name: 'find.placeholder' })
    fireEvent.change(input, { target: { value: 'token' } })
    expect(screen.getByText('1/3')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByText('2/3')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(screen.getByText('1/3')).toBeTruthy()
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(screen.getByText('3/3')).toBeTruthy()
  })

  it('supports F3 navigation', () => {
    mountBar()
    const input = screen.getByRole('textbox', { name: 'find.placeholder' })
    fireEvent.change(input, { target: { value: 'token' } })
    fireEvent.keyDown(input, { key: 'F3' })
    expect(screen.getByText('2/3')).toBeTruthy()
  })

  it('closes on Escape', () => {
    const b = mountBar()
    const input = screen.getByRole('textbox', { name: 'find.placeholder' })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(b.close).toHaveBeenCalled()
  })

  it('toggles case sensitivity and regex with pressed state', () => {
    mountBar()
    const caseToggle = screen.getByRole('button', { name: 'find.matchCase' })
    expect(caseToggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(caseToggle)
    expect(caseToggle.getAttribute('aria-pressed')).toBe('true')
    const regexToggle = screen.getByRole('button', { name: 'find.useRegex' })
    expect(regexToggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(regexToggle)
    expect(regexToggle.getAttribute('aria-pressed')).toBe('true')
  })

  it('persists the term and position and restores them on the next open', () => {
    const b = mountBar()
    const input = screen.getByRole('textbox', { name: 'find.placeholder' })
    fireEvent.change(input, { target: { value: 'token' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(b.saved.get(SESSION)).toEqual({ term: 'token', caseSensitive: false, regex: false, index: 1 })
    b.view.unmount()
    render(<FindBar
      useChat={useChat}
      containerRef={{ current: null }}
      sessionId={SESSION}
      t={t}
      close={vi.fn()}
      readSaved={b.readSaved}
      saveSaved={b.saveSaved}
    />)
    const restored = screen.getByRole('textbox', { name: 'find.placeholder' }) as HTMLInputElement
    expect(restored.value).toBe('token')
    expect(screen.getByText('2/3')).toBeTruthy()
  })
})

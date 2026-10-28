// @vitest-environment jsdom
/** Aggregate tool-run row behavior: disclosure, summaries, and the error jump. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { brandString } from '@deepseek-ai/dsh-brand'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'
import type {
  NodeKey, NodeReference, ToolCallBlock, ToolGroupItemSummary, ToolGroupSummarySpec,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ToolGroupRow } from '../src/client/chat/ToolGroupRow.tsx'
import type { ToolGroupExpansionState, UseChatNode } from '../src/client/contract/slots.ts'
import type { ChatNode } from '../src/client/contract/chat-nodes.ts'

const key = (id: string): NodeKey => brandString<NodeKey>(id)
const member = (id: string): NodeReference => ({ kind: 'node', key: key(id) })

function block(id: string, name: string): ToolCallBlock {
  return {
    phase: 'start', callId: id, name, turn: 1, step: 1, time: 0, subCalls: [],
    argsRaw: '{}', args: PartialArguments.EMPTY,
  }
}

const summaries = new Map<string, ToolGroupItemSummary>([
  ['a', { label: 'src/a.ts', detail: '+3 −1', status: 'ok' }],
  ['b', { label: 'src/b.ts', status: 'ok' }],
  ['c', { label: 'src/c.ts', status: 'error' }],
])

const spec: ToolGroupSummarySpec = {
  summarize: (call: ToolCallBlock): ToolGroupItemSummary =>
    summaries.get(call.callId) ?? { label: call.callId, status: 'ok' },
  unit: count => `${count} edits`,
}

const nodes = new Map<string, ChatNode<'tool-call'>>([
  ['a', { key: 'a', id: 'a', kind: 'tool-call', target: 'chat', anchorSeq: 1, location: { kind: 'unresolved' }, visibility: 'visible', data: { root: block('a', 'edit') } }],
  ['b', { key: 'b', id: 'b', kind: 'tool-call', target: 'chat', anchorSeq: 1, location: { kind: 'unresolved' }, visibility: 'visible', data: { root: block('b', 'edit') } }],
  ['c', { key: 'c', id: 'c', kind: 'tool-call', target: 'chat', anchorSeq: 1, location: { kind: 'unresolved' }, visibility: 'visible', data: { root: block('c', 'edit') } }],
])

const expansion = createSnapshotStore<ToolGroupExpansionState>({ all: false, generation: 0 })
const useToolGroupExpansion = bindSnapshotSelector(expansion)
const scrollIntoView = vi.fn()

const t = (id: string): string => id

const useChatNode = ((nodeKey: string, selector?: (value: ChatNode | undefined) => unknown) => {
  const node = nodes.get(nodeKey)
  return selector === undefined ? node : selector(node)
}) as UseChatNode

function renderRow() {
  return render(<ToolGroupRow
    toolName="edit"
    members={[member('a'), member('b'), member('c')]}
    spec={spec}
    cwd={undefined}
    t={t}
    useChatNode={useChatNode}
    useToolGroupExpansion={useToolGroupExpansion}
    renderMember={node => <div key={node.key} data-chat-node-key={node.key}>{`member:${node.key}`}</div>}
  />)
}

beforeAll(() => {
  Element.prototype.scrollIntoView = scrollIntoView
})

afterEach(() => {
  cleanup()
  expansion.set({ all: false, generation: 0 })
  scrollIntoView.mockClear()
})

describe('ToolGroupRow', () => {
  it('renders the unit count and per-call summaries collapsed', () => {
    renderRow()
    expect(screen.getByText('3 edits')).toBeTruthy()
    expect(screen.getByText('src/a.ts')).toBeTruthy()
    expect(screen.getByText('+3 −1')).toBeTruthy()
    expect(screen.queryByText('member:a')).toBeNull()
    expect(screen.getByRole('button', { name: /3 edits/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('expands into the ordinary member rows in original order', () => {
    renderRow()
    fireEvent.click(screen.getByRole('button', { name: /3 edits/ }))
    expect(screen.getByText('member:a')).toBeTruthy()
    expect(screen.getByText('member:b')).toBeTruthy()
    expect(screen.getByText('member:c')).toBeTruthy()
    expect(screen.queryByText('src/a.ts')).toBeNull()
    expect(screen.getByRole('button', { name: /3 edits/ }).getAttribute('aria-expanded')).toBe('true')
  })

  it('marks the error item and jumps to its member row', async () => {
    renderRow()
    fireEvent.click(screen.getByRole('button', { name: 'toolGroup.jumpError' }))
    expect(screen.getByText('member:c')).toBeTruthy()
    await vi.waitFor(() => { expect(scrollIntoView).toHaveBeenCalled() })
  })

  it('follows the shared expansion default when no override exists', () => {
    renderRow()
    act(() => { expansion.set({ all: true, generation: 1 }) })
    expect(screen.getByText('member:a')).toBeTruthy()
  })

  it('retires an explicit override when the shared default flips', () => {
    renderRow()
    fireEvent.click(screen.getByRole('button', { name: /3 edits/ }))
    act(() => { expansion.set({ all: false, generation: 1 }) })
    expect(screen.queryByText('member:a')).toBeNull()
  })
})

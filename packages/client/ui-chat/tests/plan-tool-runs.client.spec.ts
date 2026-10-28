import { brandString } from '@deepseek-ai/dsh-brand'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { describe, expect, it } from 'vitest'
import type { NodeKey, NodeReference, ToolGroupSummarySpec, ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNode } from '../src/client/contract/chat-nodes.ts'
import { planToolRuns, toolCallNameOf } from '../src/client/chat/plan-tool-runs.ts'

const spec: ToolGroupSummarySpec = {
  summarize: () => ({ label: 'call', status: 'ok' }),
  unit: count => `${count} calls`,
}
const summaryFor = (toolName: string): ToolGroupSummarySpec | undefined =>
  toolName === 'edit' || toolName === 'bash' ? spec : undefined

const key = (id: string): NodeKey => brandString<NodeKey>(id)
const member = (id: string): NodeReference => ({ kind: 'node', key: key(id) })

function toolNode(id: string, name: string, visibility: 'visible' | 'hidden' = 'visible'): ChatNode<'tool-call'> {
  return {
    key: id,
    id,
    kind: 'tool-call',
    target: 'chat',
    anchorSeq: 1,
    location: { kind: 'unresolved' },
    visibility,
    data: {
      root: {
        phase: 'start', callId: id, name, turn: 1, step: 1, time: 0, subCalls: [],
        argsRaw: '{}', args: PartialArguments.EMPTY,
      },
    },
  }
}

function settledNode(id: string, name: string): ChatNode<'tool-call'> {
  const root: ToolResultNode = {
    kind: 'tool-result', seq: 2, time: 0, callId: id, name, args: PartialArguments.EMPTY,
    call: { name, argsRaw: '{}' }, callTime: 0, content: [], isError: false, subCalls: [],
  }
  return { ...toolNode(id, name), data: { root } }
}

function commandNode(id: string): ChatNode<'command'> {
  return {
    key: id,
    id,
    kind: 'command',
    target: 'chat',
    anchorSeq: 1,
    location: { kind: 'unresolved' },
    visibility: 'visible',
    data: {
      kind: 'command', seq: 1, time: 0, commandId: 'cmd' as ChatNode<'command'>['data']['commandId'],
      name: 'permission', args: '', outcome: null,
    },
  }
}

function plan(members: readonly NodeReference[], nodes: ReadonlyMap<string, ChatNode>, threshold = 3) {
  return planToolRuns(members, {
    threshold,
    summaryFor,
    readNode: nodeKey => nodes.get(nodeKey),
  })
}

describe('planToolRuns', () => {
  it('groups a same-tool run at the threshold into one segment', () => {
    const nodes = new Map<string, ChatNode>([
      ['a', toolNode('a', 'edit')], ['b', toolNode('b', 'edit')], ['c', toolNode('c', 'edit')],
    ])
    const segments = plan([member('a'), member('b'), member('c')], nodes)
    expect(segments).toEqual([{
      kind: 'run', toolName: 'edit', spec, members: [member('a'), member('b'), member('c')],
    }])
  })

  it('keeps a short run as single rows', () => {
    const nodes = new Map<string, ChatNode>([['a', toolNode('a', 'edit')], ['b', toolNode('b', 'edit')]])
    const segments = plan([member('a'), member('b')], nodes)
    expect(segments).toEqual([{ kind: 'single', member: member('a') }, { kind: 'single', member: member('b') }])
  })

  it('splits runs interrupted by another member kind', () => {
    const nodes = new Map<string, ChatNode>([
      ['a', toolNode('a', 'edit')], ['mid', commandNode('mid')], ['b', toolNode('b', 'edit')],
    ])
    const segments = plan([member('a'), member('mid'), member('b')], nodes)
    expect(segments).toEqual([
      { kind: 'single', member: member('a') },
      { kind: 'single', member: member('mid') },
      { kind: 'single', member: member('b') },
    ])
  })

  it('splits runs interrupted by a different tool name', () => {
    const nodes = new Map<string, ChatNode>([
      ['a', toolNode('a', 'edit')], ['b', toolNode('b', 'bash')], ['c', toolNode('c', 'edit')],
    ])
    const segments = plan([member('a'), member('b'), member('c')], nodes, 2)
    expect(segments.map(segment => segment.kind)).toEqual(['single', 'single', 'single'])
  })

  it('never aggregates tools without a registered provider', () => {
    const nodes = new Map<string, ChatNode>([
      ['a', toolNode('a', 'subagent')], ['b', toolNode('b', 'subagent')], ['c', toolNode('c', 'subagent')],
    ])
    const segments = plan([member('a'), member('b'), member('c')], nodes)
    expect(segments.every(segment => segment.kind === 'single')).toBe(true)
  })

  it('never aggregates hidden nodes or group-part references', () => {
    const nodes = new Map<string, ChatNode>([
      ['a', toolNode('a', 'edit')], ['hidden', toolNode('hidden', 'edit', 'hidden')], ['c', toolNode('c', 'edit')],
      ['part', toolNode('part', 'edit')],
    ])
    const part: NodeReference = { kind: 'node', key: key('part'), groupPart: 'reasoning' }
    const segments = plan([member('a'), member('hidden'), member('c'), part], nodes)
    expect(segments).toEqual([
      { kind: 'single', member: member('a') },
      { kind: 'single', member: member('hidden') },
      { kind: 'single', member: member('c') },
      { kind: 'single', member: part },
    ])
  })

  it('emits one run per maximal same-tool sequence in order', () => {
    const nodes = new Map<string, ChatNode>([
      ['a', toolNode('a', 'bash')], ['b', toolNode('b', 'bash')],
      ['c', toolNode('c', 'edit')], ['d', toolNode('d', 'edit')],
    ])
    const segments = plan([member('a'), member('b'), member('c'), member('d')], nodes, 2)
    expect(segments).toEqual([
      { kind: 'run', toolName: 'bash', spec, members: [member('a'), member('b')] },
      { kind: 'run', toolName: 'edit', spec, members: [member('c'), member('d')] },
    ])
  })

  it('groups a run that mixes running and settled calls', () => {
    const nodes = new Map<string, ChatNode>([
      ['a', settledNode('a', 'edit')], ['b', toolNode('b', 'edit')], ['c', toolNode('c', 'edit')],
    ])
    const segments = plan([member('a'), member('b'), member('c')], nodes)
    expect(segments).toEqual([{
      kind: 'run', toolName: 'edit', spec, members: [member('a'), member('b'), member('c')],
    }])
  })

  it('is deterministic and leaves the input members untouched', () => {
    const nodes = new Map<string, ChatNode>([
      ['a', toolNode('a', 'edit')], ['b', toolNode('b', 'edit')], ['c', toolNode('c', 'edit')],
    ])
    const members: readonly NodeReference[] = [member('a'), member('b'), member('c')]
    const first = plan(members, nodes)
    const second = plan([...members], new Map(nodes))
    expect(second).toEqual(first)
    expect(members).toEqual([member('a'), member('b'), member('c')])
  })
})

describe('toolCallNameOf', () => {
  it('reads the wire name from a running call', () => {
    expect(toolCallNameOf(toolNode('a', 'edit'))).toBe('edit')
  })

  it('reads the paired call name from a settled result', () => {
    expect(toolCallNameOf(settledNode('a', 'edit'))).toBe('edit')
  })

  it('returns undefined for other node kinds', () => {
    expect(toolCallNameOf(commandNode('a'))).toBeUndefined()
  })
})

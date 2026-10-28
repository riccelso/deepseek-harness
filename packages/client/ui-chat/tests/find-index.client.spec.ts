/** Pure conversation find: patterns, extraction, and matches. */
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import { describe, expect, it } from 'vitest'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode } from '../src/client/contract/chat-nodes.ts'
import { compileFindPattern, findMatches, nodeSearchText } from '../src/client/chat/find-index.ts'

function node(id: string, kind: string, data: unknown): ChatConversationViewNode {
  return {
    key: id, id, kind, target: 'chat', anchorSeq: 1,
    location: { kind: 'unresolved' }, visibility: 'visible', data,
  }
}

describe('compileFindPattern', () => {
  it('treats a blank term as empty', () => {
    expect(compileFindPattern('', { caseSensitive: false, regex: false })).toEqual({ kind: 'empty' })
  })

  it('escapes literal terms and ignores case by default', () => {
    const pattern = compileFindPattern('a.b*c', { caseSensitive: false, regex: false })
    expect(pattern.kind).toBe('text')
    if (pattern.kind !== 'text') return
    expect(pattern.matcher.test('xa.B*Cx')).toBe(true)
    expect(pattern.matcher.test('aXbc')).toBe(false)
  })

  it('honors case sensitivity', () => {
    const sensitive = compileFindPattern('Word', { caseSensitive: true, regex: false })
    expect(sensitive.kind).toBe('text')
    if (sensitive.kind !== 'text') return
    expect(sensitive.matcher.test('word')).toBe(false)
    expect(sensitive.matcher.test('Word')).toBe(true)
  })

  it('reports broken regex instead of throwing', () => {
    expect(compileFindPattern('([', { caseSensitive: false, regex: true })).toEqual({ kind: 'invalid' })
  })

  it('compiles valid regex with the case flag', () => {
    const pattern = compileFindPattern('colou?r', { caseSensitive: true, regex: true })
    expect(pattern.kind).toBe('text')
    if (pattern.kind !== 'text') return
    expect(pattern.matcher.test('color')).toBe(true)
    expect(pattern.matcher.test('Colour')).toBe(false)
  })
})

describe('nodeSearchText', () => {
  it('joins text blocks of user-shaped rows', () => {
    const text = nodeSearchText(node('u', 'user', {
      content: [{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }, { type: 'image_url' }],
    }))
    expect(text).toBe('hello\nworld')
  })

  it('keeps assistant text and reasoning, drops other blocks', () => {
    const text = nodeSearchText(node('a', 'assistant-step', {
      blocks: [
        { kind: 'reasoning', text: 'think' },
        { kind: 'text', text: 'answer' },
        { kind: 'image', attachment: 'ref' as never },
      ],
    }))
    expect(text).toBe('think\nanswer')
  })

  it('covers the tool name, arguments, and result text', () => {
    const result: ToolResultNode = {
      kind: 'tool-result', seq: 2, time: 0, callId: 't', name: 'bash',
      args: PartialArguments.EMPTY, call: { name: 'bash', argsRaw: '{"command":"pnpm lint"}' },
      callTime: 0, content: [{ type: 'text', text: 'all good' }], isError: false, subCalls: [],
    }
    const text = nodeSearchText(node('t', 'tool-call', { root: result }))
    expect(text).toBe('bash\n{"command":"pnpm lint"}\nall good')
  })

  it('keeps preparing calls searchable by name', () => {
    const text = nodeSearchText(node('p', 'tool-call', {
      root: { phase: 'preparing', callId: 'p', name: 'read', turn: 1, step: 1, time: 0, subCalls: [], args: new PartialArguments() },
    }))
    expect(text).toBe('read')
  })

  it('covers command rows and turn errors', () => {
    expect(nodeSearchText(node('c', 'command', {
      kind: 'command', seq: 1, time: 0, commandId: 'c1', name: 'permission', args: 'on', outcome: { kind: 'success', text: 'done' },
    }))).toBe('permission\non\ndone')
    expect(nodeSearchText(node('e', 'turn-error', {
      kind: 'turn-error', seq: 1, time: 0, turn: 1, step: 1, message: 'provider failed',
    }))).toBe('provider failed')
  })
})

describe('findMatches', () => {
  const nodes = new Map<string, ChatConversationViewNode>([
    ['a', node('a', 'user', { content: [{ type: 'text', text: 'find me and find me again' }] })],
    ['b', node('b', 'user', { content: [{ type: 'text', text: 'nothing here' }] })],
    ['c', node('c', 'user', { content: [{ type: 'text', text: 'FIND uppercase' }] })],
  ])
  const readNode = (key: string): ChatConversationViewNode | undefined => nodes.get(key)

  it('returns matches in conversation order with positions', () => {
    const pattern = compileFindPattern('find', { caseSensitive: false, regex: false })
    const matches = findMatches(['a', 'b', 'c'], readNode, pattern)
    expect(matches).toEqual([
      { nodeKey: 'a', start: 0, end: 4 },
      { nodeKey: 'a', start: 12, end: 16 },
      { nodeKey: 'c', start: 0, end: 4 },
    ])
  })

  it('respects case sensitivity', () => {
    const matches = findMatches(['a', 'b', 'c'], readNode,
      compileFindPattern('find', { caseSensitive: true, regex: false }))
    expect(matches.map(match => match.nodeKey)).toEqual(['a', 'a'])
  })

  it('skips zero-length regex matches without looping', () => {
    const matches = findMatches(['a'], readNode,
      compileFindPattern('x*', { caseSensitive: false, regex: true }))
    expect(matches).toEqual([])
  })

  it('returns nothing for empty and invalid patterns', () => {
    expect(findMatches(['a'], readNode, compileFindPattern('', { caseSensitive: false, regex: false }))).toEqual([])
    expect(findMatches(['a'], readNode, compileFindPattern('(', { caseSensitive: false, regex: true }))).toEqual([])
  })

  it('caches extraction per node object', () => {
    const before = nodeSearchText(nodes.get('a') as ChatConversationViewNode)
    const again = nodeSearchText(nodes.get('a') as ChatConversationViewNode)
    expect(again).toBe(before)
  })
})

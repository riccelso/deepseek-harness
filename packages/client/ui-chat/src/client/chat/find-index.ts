/** Pure conversation find: text extraction, pattern compilation, and matches. */
import type { ChatConversationViewNode } from '../contract/chat-nodes.ts'
import type { ChatNode } from '../contract/chat-nodes.ts'

/** User-facing search options beside the term. */
export interface FindOptions {
  readonly caseSensitive: boolean
  readonly regex: boolean
}

/** One occurrence, positioned in the extracted text of one Node. */
export interface FindMatch {
  readonly nodeKey: string
  readonly start: number
  readonly end: number
}

/** Compiled term; `empty` and `invalid` never produce matches. */
export type FindPattern =
  | { readonly kind: 'empty' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'text'; readonly matcher: RegExp }

function escapeRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Compile one term into a global matcher.
 * @param term - raw user input.
 * @param options - case sensitivity and regex mode.
 * @returns `empty` for a blank term, `invalid` for a broken regex, else the matcher.
 */
export function compileFindPattern(term: string, options: FindOptions): FindPattern {
  if (term === '') return { kind: 'empty' }
  if (options.regex) {
    try {
      return { kind: 'text', matcher: new RegExp(term, options.caseSensitive ? 'g' : 'gi') }
    } catch {
      return { kind: 'invalid' }
    }
  }
  return { kind: 'text', matcher: new RegExp(escapeRegExp(term), options.caseSensitive ? 'g' : 'gi') }
}

const searchTextCache = new WeakMap<ChatConversationViewNode, string>()

/** Structural payload readers for the widened store-level view Node. */
interface ContentCarryingData { readonly content: readonly unknown[] }
interface BlocksCarryingData { readonly blocks: readonly unknown[] }
interface MessageCarryingData { readonly message: string }
interface SummaryCarryingData { readonly summary: string | null }

function contentText(blocks: readonly unknown[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (typeof block === 'object' && block !== null && 'type' in block) {
      const typed = block as { type: string; text?: unknown }
      if (typed.type === 'text' && typeof typed.text === 'string') parts.push(typed.text)
    }
  }
  return parts.join('\n')
}

function assistantText(blocks: readonly unknown[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null || !('kind' in block)) continue
    const typed = block as { kind: string; text?: unknown }
    if ((typed.kind === 'text' || typed.kind === 'reasoning') && typeof typed.text === 'string') {
      parts.push(typed.text)
    }
  }
  return parts.join('\n')
}

function toolText(node: ChatNode<'tool-call'>): string {
  const block = node.data.root
  const name = 'kind' in block ? block.call?.name ?? block.name : block.name
  const parts = [name]
  const argsRaw = 'kind' in block
    ? block.call?.argsRaw ?? ''
    : 'argsRaw' in block ? block.argsRaw : ''
  if (argsRaw !== '') parts.push(argsRaw)
  if ('kind' in block) {
    for (const content of block.content) {
      if (typeof content === 'object' && 'type' in content) {
        const typed = content as { type: string; text?: unknown }
        if (typed.type === 'text' && typeof typed.text === 'string') parts.push(typed.text)
      }
    }
  }
  return parts.filter(part => part !== '').join('\n')
}

function commandText(node: ChatNode<'command'>): string {
  const data = node.data
  return [data.name ?? '', data.args ?? '', data.outcome?.text ?? '']
    .filter(part => part !== '').join('\n')
}

/**
 * Extract the searchable text of one Chat Node: message and reasoning text,
 * tool names, commands, arguments, and result text. Hidden rows stay
 * searchable: visibility is a presentation fact, not a content fact.
 * @param node - Chat view Node.
 * @returns its concatenated searchable text; empty when the kind has none.
 */
export function nodeSearchText(node: ChatConversationViewNode): string {
  const cached = searchTextCache.get(node)
  if (cached !== undefined) return cached
  let text = ''
  switch (node.kind) {
    case 'user':
    case 'steering':
    case 'context':
    case 'turn-trigger':
      text = contentText((node.data as ContentCarryingData).content)
      break
    case 'assistant-step':
      text = assistantText((node.data as BlocksCarryingData).blocks)
      break
    case 'tool-call':
      text = toolText(node as ChatNode<'tool-call'>)
      break
    case 'command':
      text = commandText(node as ChatNode<'command'>)
      break
    case 'turn-error':
      text = (node.data as MessageCarryingData).message
      break
    case 'compaction':
      text = (node.data as SummaryCarryingData).summary ?? ''
      break
    default:
      text = ''
  }
  searchTextCache.set(node, text)
  return text
}

/**
 * Find every occurrence of one pattern over the conversation's Node order.
 * The extraction is cached per Node object, so streaming updates pay only for
 * the new and changed Nodes.
 * @param order - Node keys in conversation order.
 * @param readNode - current Node reader, valid during the call.
 * @param pattern - compiled term.
 * @returns matches in conversation order, then document order within a Node.
 */
export function findMatches(
  order: readonly string[],
  readNode: (key: string) => ChatConversationViewNode | undefined,
  pattern: FindPattern,
): readonly FindMatch[] {
  if (pattern.kind !== 'text') return []
  const matches: FindMatch[] = []
  for (const key of order) {
    const node = readNode(key)
    if (node === undefined) continue
    const text = nodeSearchText(node)
    if (text === '') continue
    pattern.matcher.lastIndex = 0
    let found = pattern.matcher.exec(text)
    while (found !== null) {
      if (found[0].length > 0) matches.push({ nodeKey: key, start: found.index, end: found.index + found[0].length })
      pattern.matcher.lastIndex = found.index + Math.max(found[0].length, 1)
      found = pattern.matcher.exec(text)
    }
  }
  return matches
}

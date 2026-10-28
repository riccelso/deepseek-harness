/** Pure segmentation of one group's members into consecutive same-Tool runs. */
import type { NodeKey, NodeReference, ToolGroupSummarySpec } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatConversationViewNode, ChatNode } from '../contract/chat-nodes.ts'

/** One rendered member, or one aggregated run of consecutive same-Tool calls. */
export type ToolRunSegment =
  | { readonly kind: 'single'; readonly member: NodeReference }
  | {
    readonly kind: 'run'
    readonly toolName: string
    readonly spec: ToolGroupSummarySpec
    readonly members: readonly NodeReference[]
  }

/** Inputs of one grouping pass; the node reader is valid only during the call. */
export interface ToolRunPlanOptions {
  /** Minimum calls in one run; shorter sequences render individual rows. */
  readonly threshold: number
  /** Summary provider lookup; calls without one never aggregate. */
  readonly summaryFor: (toolName: string) => ToolGroupSummarySpec | undefined
  /** @param key - member Node identity. @returns its current view Node, when assembled. */
  readonly readNode: (key: NodeKey) => ChatConversationViewNode | undefined
}

/**
 * Resolve the wire tool name of one Tool-call Node at its current stage. The
 * store-level view Node types its payload as unknown; the kind check carries
 * the same narrowing the keyed seat performs at dispatch.
 * @param node - Chat view Node.
 * @returns the call's wire name, or undefined for any other Node kind.
 */
export function toolCallNameOf(node: ChatConversationViewNode): string | undefined {
  if (node.kind !== 'tool-call') return undefined
  const block = (node as ChatNode<'tool-call'>).data.root
  return 'kind' in block ? block.call?.name ?? block.name : block.name
}

/**
 * Segment one group's member order into single rows and same-Tool runs. The
 * pass is pure over its inputs and never mutates or reorders the member list,
 * so the same members always produce the same segments regardless of when they
 * were assembled.
 * @param members - ordered group members in their original render order.
 * @param options - threshold, provider lookup, and node reader.
 * @returns segments in member order; group-part references never aggregate.
 */
export function planToolRuns(
  members: readonly NodeReference[],
  options: ToolRunPlanOptions,
): readonly ToolRunSegment[] {
  const segments: ToolRunSegment[] = []
  let run: { toolName: string; spec: ToolGroupSummarySpec; members: NodeReference[] } | undefined
  const flush = (): void => {
    if (run === undefined) return
    const complete = run
    run = undefined
    if (complete.members.length < options.threshold) {
      for (const member of complete.members) segments.push({ kind: 'single', member })
      return
    }
    segments.push({ kind: 'run', toolName: complete.toolName, spec: complete.spec, members: complete.members })
  }
  for (const member of members) {
    const node = member.groupPart === undefined
      ? options.readNode(member.key)
      : undefined
    const toolName = node === undefined ? undefined : toolCallNameOf(node)
    const provider = toolName === undefined ? undefined : options.summaryFor(toolName)
    if (node === undefined || toolName === undefined || provider === undefined
      || node.kind !== 'tool-call' || node.visibility !== 'visible') {
      flush()
      segments.push({ kind: 'single', member })
      continue
    }
    if (run !== undefined && run.toolName === toolName) {
      run.members.push(member)
      continue
    }
    flush()
    run = { toolName, spec: provider, members: [member] }
  }
  flush()
  return segments
}

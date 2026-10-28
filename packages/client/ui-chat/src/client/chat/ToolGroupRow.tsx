/** Collapsible aggregate row for one run of consecutive same-Tool calls. */
import { Fragment, memo, useCallback, useId, useRef, useState, type ReactNode } from 'react'
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NodeKey, NodeReference, ToolGroupSummarySpec } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNode } from '../contract/chat-nodes.ts'
import type { ChatFlowSlotProps, UseChatNode } from '../contract/slots.ts'
import css from './ToolGroupRow.module.css'

/** One aggregate row's seat dependencies, provided by the group body. */
export interface ToolGroupRowProps {
  readonly toolName: string
  readonly members: readonly NodeReference[]
  readonly spec: ToolGroupSummarySpec
  readonly cwd: string | undefined
  readonly t: ChatFlowSlotProps['t']
  readonly useChatNode: UseChatNode
  readonly useToolGroupExpansion: ChatFlowSlotProps['useToolGroupExpansion']
  /** @param member - one run member. @returns its ordinary row rendering. */
  readonly renderMember: (member: NodeReference) => ReactNode
}

/** One member's summary line, subscribing only to its own Node. */
const ToolGroupItemRow = memo(function ToolGroupItemRow({
  nodeKey, spec, cwd, t, useChatNode, onJump,
}: {
  readonly nodeKey: NodeKey
  readonly spec: ToolGroupSummarySpec
  readonly cwd: string | undefined
  readonly t: ChatFlowSlotProps['t']
  readonly useChatNode: UseChatNode
  readonly onJump: () => void
}) {
  const root = useChatNode(nodeKey, node => node !== undefined && node.kind === 'tool-call'
    ? (node as ChatNode<'tool-call'>).data.root
    : undefined)
  const summary = root === undefined ? undefined : spec.summarize(root, cwd)
  if (summary === undefined) return null
  return (
    <span className={css.item} data-tool-group-status={summary.status}>
      <span className={css.itemDot} aria-hidden="true" />
      <span className={css.itemLabel}>{summary.label}</span>
      {summary.detail !== undefined && <span className={css.itemDetail}>{summary.detail}</span>}
      {summary.status === 'error' && (
        <button type="button" className={css.jump} onClick={onJump}>{t('toolGroup.jumpError')}</button>
      )}
    </span>
  )
})

/**
 * Render one run of consecutive same-Tool calls as a count headline, a
 * per-call summary list, and a disclosure that swaps in the ordinary member
 * rows in their original order.
 * @param props - run members, summary provider, and seat dependencies.
 * @returns the aggregate row.
 */
export const ToolGroupRow = memo(function ToolGroupRow({
  toolName, members, spec, cwd, t, useChatNode, useToolGroupExpansion, renderMember,
}: ToolGroupRowProps) {
  const { all, generation } = useToolGroupExpansion(state => state)
  const [override, setOverride] = useState<{ readonly generation: number; readonly open: boolean } | null>(null)
  const open = override !== null && override.generation === generation ? override.open : all
  const rootRef = useRef<HTMLDivElement>(null)
  const bodyId = useId()
  const revealMember = useCallback((key: NodeKey): void => {
    rootRef.current?.querySelector(`[data-chat-node-key="${key}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [])
  const openAt = useCallback((key: NodeKey): void => {
    setOverride({ generation, open: true })
    requestAnimationFrame(() => { revealMember(key) })
  }, [generation, revealMember])
  return (
    <div
      ref={rootRef}
      className={css.root}
      data-tool-group={toolName}
      data-tool-group-count={members.length}
      data-tool-group-open={open || undefined}
      data-chat-flow-key={`tool-group:${toolName}:${members[0]?.key ?? ''}`}
    >
      <button
        type="button"
        className={css.head}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={(event) => {
          event.currentTarget.focus()
          setOverride({ generation, open: !open })
        }}
      >
        <span className={css.unit}>{spec.unit(members.length)}</span>
        <IconChevronDownOutlineRegular className={css.chevron} />
      </button>
      <div id={bodyId} className={css.body}>
        {open
          ? members.map(member => (
            <Fragment key={member.key}>{renderMember(member)}</Fragment>
          ))
          : members.map(member => (
            <ToolGroupItemRow
              key={member.key}
              nodeKey={member.key}
              spec={spec}
              cwd={cwd}
              t={t}
              useChatNode={useChatNode}
              onJump={() => { openAt(member.key) }}
            />
          ))}
      </div>
    </div>
  )
})

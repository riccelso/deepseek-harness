/** Pure per-tool summary rules for aggregate Tool-call rows. */
import type { ToolCallBlock } from './records.ts'

/** Lifecycle conclusion of one grouped call, shared with aggregate row styling. */
export type ToolGroupItemStatus = 'ok' | 'error' | 'running' | 'preparing' | 'stopped'

/** One-line facts about one grouped Tool call, derived from its current slice. */
export interface ToolGroupItemSummary {
  /** Primary line: the call's file path, command, or query. */
  readonly label: string
  /** Optional second fact: diff stats, an exit conclusion, or a result size. */
  readonly detail?: string
  readonly status: ToolGroupItemStatus
}

/** Provider-owned summary rules for one wire tool name. */
export interface ToolGroupSummarySpec {
  /**
   * Summarize one running or settled call of this tool.
   * @param block - current call slice of the grouped Chat Node.
   * @param cwd - Session workspace root; path labels display relative to it.
   * @returns the one-line summary shown inside the aggregate row.
   */
  summarize(block: ToolCallBlock, cwd: string | undefined): ToolGroupItemSummary
  /**
   * Localized aggregate headline for one run of this tool.
   * @param count - calls in the run.
   * @returns localized count label, for example `14 edits`.
   */
  unit(count: number): string
}

/** One summary provider contribution, keyed by wire tool name. */
export interface ToolGroupSummaryRegistration {
  readonly toolName: string
  readonly spec: ToolGroupSummarySpec
}

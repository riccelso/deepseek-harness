/** Aggregate-row summary providers for the read, write, edit, and shell tool families. */
import type { Context } from '@deepseek-ai/cordis'
import type {
  ToolGroupItemSummary, ToolGroupSummaryRegistration, ToolGroupSummarySpec,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { abbreviateHomePath, relativizeToCwd } from '@deepseek-ai/dsh-util-workspace-path'
import type { ToolCallBlock } from './models/tool-call-model.ts'
import { parsedToolCall, singleResultText } from './models/raw-tool-call.ts'
import { terminalCardModel, terminalExitLabel, terminalFailed } from './models/terminal-card-model.ts'
import { CONVERSATION_NS } from '../locale.ts'

/** Longest command line kept in one aggregate row item. */
const COMMAND_LABEL_LIMIT = 48

function firstLine(text: string): string {
  const nl = text.indexOf('\n')
  return nl === -1 ? text : text.slice(0, nl)
}

/**
 * Shorten one shell command for the aggregate list without a copy-bearing
 * marker: truncation keeps the command's own characters.
 * @param command - first line of the authored command.
 * @returns the display line.
 */
function truncateCommand(command: string): string {
  return command.length <= COMMAND_LABEL_LIMIT ? command : `${command.slice(0, COMMAND_LABEL_LIMIT - 1)}…`
}

function lineCount(text: string | undefined): number {
  if (text === undefined || text === '') return 0
  return text.split('\n').length
}

function statusOf(block: ToolCallBlock): ToolGroupItemSummary['status'] {
  if (!('kind' in block)) return block.phase === 'preparing' ? 'preparing' : 'running'
  return block.error?.code === 'interrupted' ? 'stopped' : block.isError ? 'error' : 'ok'
}

/**
 * Read one complete string argument of a parsed call.
 * @param args - parsed object arguments.
 * @param key - argument field name.
 * @returns the field's text, when it is a complete non-empty string.
 */
function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Live host account home for `~` path abbreviation, read at summarize time. */
type HomeReader = () => string | undefined

/**
 * Display label of one file-targeting call, relative to the Session workspace.
 * @param args - parsed object arguments.
 * @param key - argument field carrying the path.
 * @param cwd - Session workspace root.
 * @param home - host account home for `~` abbreviation.
 * @returns the path label, or an empty string when the argument is unavailable.
 */
function pathLabel(args: Record<string, unknown>, key: string, cwd: string | undefined, home: string | undefined): string {
  const path = stringArg(args, key)
  return path === undefined ? '' : abbreviateHomePath(relativizeToCwd(firstLine(path), cwd), home)
}

/**
 * Build the mutation-family provider: the file path label plus `+added −removed`
 * line stats derived from the call's own argument payloads.
 * @param toolName - wire tool name the provider is registered for.
 * @param home - live host account home reader.
 * @returns the summary provider.
 */
function mutationSummary(toolName: 'write' | 'edit', home: HomeReader): ToolGroupSummarySpec['summarize'] {
  return (block, cwd): ToolGroupItemSummary => {
    const parsed = parsedToolCall(block)
    const label = parsed === null ? '' : pathLabel(parsed.args, 'file_path', cwd, home())
    let detail: string | undefined
    if (parsed !== null && toolName === 'edit') {
      const oldText = stringArg(parsed.args, 'old_string')
      const newText = stringArg(parsed.args, 'new_string')
      if (oldText !== undefined && newText !== undefined) detail = `+${lineCount(newText)} −${lineCount(oldText)}`
    } else if (parsed !== null) {
      const content = stringArg(parsed.args, 'content')
      if (content !== undefined) detail = `+${lineCount(content)}`
    }
    return { label: label === '' ? block.callId : label, ...detail === undefined ? {} : { detail }, status: statusOf(block) }
  }
}

/**
 * Build the read-family provider: the path label plus the number of result
 * lines once the call settles.
 * @param home - live host account home reader.
 * @returns the summary provider.
 */
function readSummary(home: HomeReader): ToolGroupSummarySpec['summarize'] {
  return (block, cwd): ToolGroupItemSummary => {
    const parsed = parsedToolCall(block)
    const label = parsed === null ? '' : pathLabel(parsed.args, 'file_path', cwd, home())
    const output = 'kind' in block ? singleResultText(block) : undefined
    const detail = output === undefined ? undefined : `${lineCount(output)}`
    return {
      label: label === '' ? block.callId : label,
      ...detail === undefined ? {} : { detail },
      status: statusOf(block),
    }
  }
}

/**
 * Build the shell-family provider: the authored command with its localized
 * exit conclusion, reusing the terminal card's status parsing.
 * @param t - conversation locale seat for the exit label.
 * @returns the summary provider.
 */
function shellSummary(t: TranslateNS<'conversation'>): ToolGroupSummarySpec['summarize'] {
  return (block, cwd): ToolGroupItemSummary => {
    const parsed = parsedToolCall(block)
    const card = terminalCardModel(block, cwd)
    if (parsed === null || card === null || card.copy.kind !== 'shell') {
      return { label: block.callId, status: statusOf(block) }
    }
    const exit = terminalExitLabel(card, t)
    return {
      label: truncateCommand(firstLine(card.copy.command)),
      ...exit === null ? {} : { detail: exit },
      status: card.card.running === true ? 'running' : terminalFailed(card) ? 'error' : statusOf(block),
    }
  }
}

/**
 * Assemble the built-in summary registrations for the Chat aggregate rows.
 * @param t - conversation locale seat carrying the unit labels.
 * @param home - live host account home reader, consulted at summarize time.
 * @returns one registration per supported wire tool name.
 */
export function builtinToolGroupSummaries(
  t: TranslateNS<'conversation'>,
  home: HomeReader,
): readonly ToolGroupSummaryRegistration[] {
  const editUnit = (count: number): string => t('toolGroup.unit.edit', { count })
  const writeUnit = (count: number): string => t('toolGroup.unit.write', { count })
  const shellUnit = (count: number): string => t('toolGroup.unit.bash', { count })
  const readUnit = (count: number): string => t('toolGroup.unit.read', { count })
  return [
    { toolName: 'edit', spec: { summarize: mutationSummary('edit', home), unit: editUnit } },
    { toolName: 'write', spec: { summarize: mutationSummary('write', home), unit: writeUnit } },
    { toolName: 'bash', spec: { summarize: shellSummary(t), unit: shellUnit } },
    { toolName: 'pwsh', spec: { summarize: shellSummary(t), unit: shellUnit } },
    { toolName: 'read', spec: { summarize: readSummary(home), unit: readUnit } },
  ]
}

/** Registers the built-in aggregate-row summary providers. */
export const toolGroupSummaries = {
  name: 'tool-group-summaries',
  inject: ['uiConversation', 'locale', 'remote'],
  apply(ctx: Context): void {
    const t = ctx.locale.bind(CONVERSATION_NS)
    const home = (): string | undefined => ctx.remote.$host.home
    for (const registration of builtinToolGroupSummaries(t, home)) {
      ctx.effect(() => ctx.uiConversation.toolGroups.register(registration), `ui-tool: tool group summary ${registration.toolName}`)
    }
  },
}

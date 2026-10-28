/**
 * Static Bash readonly policy. Classifies a Bash command line as readonly or
 * unknown from its text alone and feeds that verdict into the `tools/pre-execute`
 * waterfall: with `autoApproveReadonly` the verdict relaxes approval friction,
 * and with `audit` it surfaces on the approval card instead. The classification
 * is one input to the approval decision — it never bypasses the sandbox.
 *
 * @module @deepseek-ai/dsh-bash-readonly-policy
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { classifyBashReadonly } from './classify.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'bash-readonly-policy'

/** The tool registry whose guarded execution pipeline this plugin advises. */
export const inject = ['tools']

/** Validated deployment settings for the readonly advisor. */
export interface Config {
  /** Allow statically readonly Bash commands without asking; opt-in, the sandbox stays active. */
  autoApproveReadonly: boolean
  /** Keep asking for readonly commands and show the static-analysis verdict on the approval card. */
  audit: boolean
}

export const Config: z<Partial<Config>, Config> = z.object({
  autoApproveReadonly: z.boolean().default(false)
    .description('allow statically readonly Bash commands without asking (opt-in; the sandbox stays active)'),
  audit: z.boolean().default(false)
    .description('keep asking for readonly commands and show the static-analysis verdict on the card'),
})

/** Audit-mode card copy, keyed by locale with the fallback chain owned by the approval surface. */
const AUDIT_DISPLAY_REASON = {
  en: 'Readonly by static analysis; audit mode keeps asking',
  zh: '静态分析判定为只读；审计模式仍会询问',
  pt: 'Somente leitura por análise estática; o modo auditoria continua perguntando',
} as const

/** Read the Bash command text from the frozen tool-call arguments. */
function commandOf(execution: ToolExecution): string | undefined {
  const args: unknown = execution.arguments
  if (typeof args !== 'object' || args === null) return undefined
  const command = (args as { command?: unknown }).command
  return typeof command === 'string' && command !== '' ? command : undefined
}

/**
 * Mount the readonly advisor: one prepended `tools/pre-execute` listener that
 * classifies Bash commands statically, auto-allows readonly lines when the
 * opt-in is on, and converts a downstream allow into an auditable ask in audit
 * mode. Every decision is logged in debug with its reason; class counters are
 * reported when the plugin disposes.
 */
export function apply(ctx: Context, config: Config): void {
  const counts = { readonly: 0, readonlyAutoApproved: 0, readonlyAudited: 0, unknown: 0 }
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    if (exec.name !== 'bash') return next()
    const command = commandOf(exec)
    if (command === undefined) return next()
    const verdict = classifyBashReadonly(command)
    ctx.logger.debug('bash-readonly: %s -> %s (%s)', command, verdict.kind, verdict.reason)
    counts[verdict.kind === 'readonly' ? 'readonly' : 'unknown'] += 1
    if (verdict.kind === 'readonly' && config.autoApproveReadonly) {
      counts.readonlyAutoApproved += 1
      return { kind: 'allow' }
    }
    const decision = await next()
    if (verdict.kind === 'readonly' && config.audit && decision.kind === 'allow') {
      counts.readonlyAudited += 1
      return { kind: 'ask', displayReason: { ...AUDIT_DISPLAY_REASON } }
    }
    return decision
  }, { prepend: true })
  ctx.effect(() => () => {
    ctx.logger.debug(
      'bash-readonly counts: readonly=%d autoApproved=%d audited=%d unknown=%d',
      counts.readonly, counts.readonlyAutoApproved, counts.readonlyAudited, counts.unknown,
    )
  }, 'bash-readonly-policy: counters')
}

export { classifyBashReadonly } from './classify.ts'
export type { ReadonlyVerdict } from './classify.ts'

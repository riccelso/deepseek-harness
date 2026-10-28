/** Waterfall behavior of the readonly advisor plugin. */
import { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, type Config } from '@deepseek-ai/dsh-bash-readonly-policy'

function execution(name: string, args: unknown): ToolExecution {
  return {
    callId: 'call-1',
    rootCallId: 'call-1',
    name,
    arguments: args,
    signal: new AbortController().signal,
    token: Symbol('token'),
  } as ToolExecution
}

const liveContexts: Context[] = []

async function mounted(config: Partial<Config> = {}) {
  const ctx = new Context()
  liveContexts.push(ctx)
  const debug = vi.spyOn(ctx.logger, 'debug').mockImplementation(() => {})
  apply(ctx, { autoApproveReadonly: false, audit: false, ...config })
  return {
    ctx,
    debug,
    run: (args: unknown, name = 'bash') => {
      const next = vi.fn<() => Promise<PreToolDecision>>(() => Promise.resolve({ kind: 'allow' }))
      const decision = ctx.waterfall('tools/pre-execute', execution(name, args), next)
      return { decision, next }
    },
  }
}

afterEach(async () => {
  while (liveContexts.length > 0) await liveContexts.pop()?.fiber.dispose()
})

describe('bash-readonly-policy plugin', () => {
  it('delegates non-bash tools and argument shapes without a command', async () => {
    const b = await mounted({ autoApproveReadonly: true })
    const read = b.run({ path: 'a' }, 'read')
    expect(await read.decision).toEqual({ kind: 'allow' })
    expect(read.next).toHaveBeenCalled()
    for (const args of [{ command: 42 }, null, { command: '' }]) {
      const delegated = b.run(args)
      expect(await delegated.decision).toEqual({ kind: 'allow' })
      expect(delegated.next).toHaveBeenCalled()
    }
    expect(b.debug).not.toHaveBeenCalled()
  })

  it('reports class counters when the plugin disposes', async () => {
    const b = await mounted({ autoApproveReadonly: true })
    await b.run({ command: 'git status' }).decision
    await b.run({ command: 'rm -rf x' }).decision
    await b.ctx.fiber.dispose()
    expect(b.debug).toHaveBeenCalledWith(
      'bash-readonly counts: readonly=%d autoApproved=%d audited=%d unknown=%d',
      1, 1, 0, 1,
    )
  })

  it('auto-allows a readonly command without delegating when opted in', async () => {
    const b = await mounted({ autoApproveReadonly: true })
    const { decision, next } = b.run({ command: 'git status --short' })
    expect(await decision).toEqual({ kind: 'allow' })
    expect(next).not.toHaveBeenCalled()
    expect(b.debug).toHaveBeenCalledWith('bash-readonly: %s -> %s (%s)', 'git status --short', 'readonly', 'static-catalog')
  })

  it('passes readonly through unchanged without the opt-in', async () => {
    const b = await mounted()
    const { decision, next } = b.run({ command: 'cat README.md' })
    expect(await decision).toEqual({ kind: 'allow' })
    expect(next).toHaveBeenCalled()
  })

  it('converts a downstream allow into an auditable ask in audit mode', async () => {
    const b = await mounted({ audit: true })
    const { decision } = b.run({ command: 'git status' })
    const resolved = await decision
    expect(resolved.kind).toBe('ask')
    if (resolved.kind === 'ask') {
      expect(resolved.displayReason?.en).toContain('static analysis')
    }
  })

  it('leaves unknown commands to the normal pipeline in every mode', async () => {
    for (const config of [{ autoApproveReadonly: true }, { audit: true }, {}]) {
      const b = await mounted(config)
      const { decision, next } = b.run({ command: 'rm -rf /tmp/x' })
      expect(await decision).toEqual({ kind: 'allow' })
      expect(next).toHaveBeenCalled()
      expect(b.debug).toHaveBeenCalledWith('bash-readonly: %s -> %s (%s)', 'rm -rf /tmp/x', 'unknown', 'not-readonly:rm')
    }
  })
})

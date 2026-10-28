import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { ToolGroupSummaryRegistration, ToolGroupSummarySpec } from '../src/client/contract/tool-groups.ts'
import { ToolGroupSummaryRegistry } from '../src/client/conversation/tool-group-registry.ts'

const spec: ToolGroupSummarySpec = {
  summarize: () => ({ label: 'call', status: 'ok' }),
  unit: count => `${count} calls`,
}

function registration(toolName: string, marker = 'call'): ToolGroupSummaryRegistration {
  return {
    toolName,
    spec: {
      summarize: () => ({ label: marker, status: 'ok' }),
      unit: count => `${count} ${marker}`,
    },
  }
}

function createRegistry(): ToolGroupSummaryRegistry {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  return new ToolGroupSummaryRegistry(ctx)
}

describe('ToolGroupSummaryRegistry', () => {
  it('registers a provider for lookup during the caller effect', () => {
    const registry = createRegistry()
    const dispose = registry.register({ toolName: 'edit', spec })
    expect(registry.forTool('edit')).toBe(spec)
    expect(registry.forTool('bash')).toBeUndefined()
    dispose()
    expect(registry.forTool('edit')).toBeUndefined()
  })

  it('replaces a tool name provider; disposal removes the current one', () => {
    const registry = createRegistry()
    const first = registry.register(registration('read', 'first'))
    const second = registry.register(registration('read', 'second'))
    expect(registry.forTool('read')?.unit(1)).toBe('1 second')
    second()
    expect(registry.forTool('read')).toBeUndefined()
    first()
    expect(registry.forTool('read')).toBeUndefined()
  })

  it('notifies subscribers on registration and disposal', () => {
    const registry = createRegistry()
    const listener = vi.fn()
    const unsubscribe = registry.subscribe(listener)
    const dispose = registry.register({ toolName: 'bash', spec })
    expect(listener).toHaveBeenCalledTimes(1)
    dispose()
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    registry.register({ toolName: 'bash', spec })
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('keeps the disposer idempotent after plugin disposal', async () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const registry = new ToolGroupSummaryRegistry(ctx)
    const dispose = registry.register({ toolName: 'edit', spec })
    await ctx.fiber.dispose()
    dispose()
    dispose()
    expect(registry.forTool('edit')).toBeUndefined()
  })
})

/** Tool-name-indexed summary registrations with the existing effect lifecycle. */
import { Service, type Context } from '@deepseek-ai/cordis'
import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import type { ToolGroupSummaryRegistration, ToolGroupSummarySpec } from '../contract/tool-groups.ts'

/** Registry of pure summary providers for aggregate Tool-call rows. */
export class ToolGroupSummaryRegistry {
  private readonly specs = new Map<string, ToolGroupSummarySpec>()
  private readonly listeners = new Set<() => void>()

  /** @param ctx - Context whose effects own contributed providers. */
  constructor(protected readonly ctx: Context) {
    Object.defineProperty(this, Service.tracker, {
      value: { property: 'ctx' },
    })
  }

  /**
   * Register or replace the summary provider of one tool name.
   * @param registration - tool name and its summary rules.
   * @returns idempotent disposer owned by the caller's effect.
   */
  register(registration: ToolGroupSummaryRegistration): () => void {
    const dispose = this.ctx.effect(() => {
      this.specs.set(registration.toolName, registration.spec)
      notifySubscribers(this.listeners, '[ui-conversation] tool group summary registry')
      return () => {
        if (this.specs.get(registration.toolName) !== registration.spec) return
        this.specs.delete(registration.toolName)
        notifySubscribers(this.listeners, '[ui-conversation] tool group summary registry')
      }
    }, `uiConversation.toolGroups.register(${JSON.stringify(registration.toolName)})`)
    return () => { void dispose() }
  }

  /**
   * Find the provider registered for one tool name.
   * @param toolName - wire tool name.
   * @returns its summary rules, when registered.
   */
  forTool(toolName: string): ToolGroupSummarySpec | undefined {
    return this.specs.get(toolName)
  }

  /**
   * Observe provider registrations.
   * @param listener - synchronous invalidation callback.
   * @returns unsubscribe callback.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}

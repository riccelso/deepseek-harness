/** Aggregate-row preference policy: defaults, adoption, and persistence. */
import { describe, expect, it, vi } from 'vitest'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ChatSettings } from '../src/chat-settings.ts'
import { ToolGroupingPolicy } from '../src/client/tool-grouping.ts'

function form(section: ChatSettings | undefined): ConfigForm<ChatSettings> & { set: ReturnType<typeof vi.fn> } {
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => ({ value: section }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set: vi.fn(),
  } as ConfigForm<ChatSettings> & { set: ReturnType<typeof vi.fn> }
}

describe('ToolGroupingPolicy', () => {
  it('groups with the default threshold before Host settings arrive', () => {
    const policy = new ToolGroupingPolicy(form(undefined))
    expect(policy.enabled.getSnapshot()).toBe(true)
    expect(policy.threshold.getSnapshot()).toBe(3)
    expect(policy.preferences.getSnapshot()).toEqual({ enabled: true, threshold: 3 })
  })

  it('adopts an accepted Host section without writing back', () => {
    const host = form({ toolGrouping: 'off', toolGroupThreshold: 5 } as ChatSettings)
    const policy = new ToolGroupingPolicy(host)
    expect(policy.enabled.getSnapshot()).toBe(false)
    expect(policy.threshold.getSnapshot()).toBe(5)
    expect(host.set).not.toHaveBeenCalled()
  })

  it('publishes and persists explicit choices', () => {
    const host = form(undefined)
    const policy = new ToolGroupingPolicy(host)
    policy.setThreshold(2)
    expect(policy.threshold.getSnapshot()).toBe(2)
    expect(policy.preferences.getSnapshot()).toEqual({ enabled: true, threshold: 2 })
    expect(host.set).toHaveBeenCalledWith('toolGroupThreshold', 2)
    policy.setGrouping('off')
    expect(policy.enabled.getSnapshot()).toBe(false)
    expect(policy.preferences.getSnapshot()).toEqual({ enabled: false, threshold: 2 })
    expect(host.set).toHaveBeenCalledWith('toolGrouping', 'off')
  })

  it('keeps the derived snapshot identity until a preference changes', () => {
    const policy = new ToolGroupingPolicy(form(undefined))
    const before = policy.preferences.getSnapshot()
    policy.setGrouping('on')
    expect(policy.preferences.getSnapshot()).toBe(before)
    policy.setThreshold(3)
    expect(policy.preferences.getSnapshot()).toBe(before)
  })
})

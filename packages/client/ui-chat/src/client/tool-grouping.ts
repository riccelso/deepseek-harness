/** Aggregate-row preferences backed by the same Host configuration form. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_TOOL_GROUPING, DEFAULT_TOOL_GROUP_THRESHOLD, TOOL_GROUPING_FIELD, TOOL_GROUP_THRESHOLD_FIELD,
  type ChatSettings, type ToolGrouping, type ToolGroupThreshold,
} from '../chat-settings.ts'

/** Derived aggregate-row preferences consumed by the flow's member rendering. */
export interface ToolGroupingPreferences {
  readonly enabled: boolean
  readonly threshold: number
}

/** Live aggregate-row preferences consumed by the Chat flow and its Settings row. */
export class ToolGroupingPolicy {
  private readonly unsubscribe: () => void
  /** Reactive enabled choice, grouping by default before Host settings arrive. */
  readonly enabled: SnapshotStore<boolean>
  /** Reactive threshold, defaulting to three calls until Host settings arrive. */
  readonly threshold: SnapshotStore<ToolGroupThreshold>
  /** Identity-stable view of both preferences for the flow's member rendering. */
  readonly preferences: SnapshotStore<ToolGroupingPreferences>

  /**
   * @param host - durable Chat settings scope.
   */
  constructor(private readonly host: ConfigForm<ChatSettings>) {
    const defaultEnabled = DEFAULT_TOOL_GROUPING === 'on'
    this.enabled = createSnapshotStore(defaultEnabled)
    this.threshold = createSnapshotStore(DEFAULT_TOOL_GROUP_THRESHOLD)
    this.preferences = createSnapshotStore<ToolGroupingPreferences>({ enabled: defaultEnabled, threshold: DEFAULT_TOOL_GROUP_THRESHOLD })
    this.unsubscribe = host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /** Release the accepted-value subscription. */
  dispose(): void { this.unsubscribe() }

  /**
   * Publish and persist the enabled choice.
   * @param grouping - `on` collapses consecutive same-Tool calls, `off` keeps individual rows.
   */
  setGrouping(grouping: ToolGrouping): void {
    this.publish((grouping === 'on'), this.threshold.getSnapshot())
    void this.host.set(TOOL_GROUPING_FIELD, grouping)
  }

  /**
   * Publish and persist the aggregate-row threshold.
   * @param threshold - minimum consecutive calls that collapse into one row.
   */
  setThreshold(threshold: ToolGroupThreshold): void {
    this.publish(this.enabled.getSnapshot(), threshold)
    void this.host.set(TOOL_GROUP_THRESHOLD_FIELD, threshold)
  }

  /** Adopt the latest accepted Host section without writing it back. */
  private adopt(): void {
    const section = this.host.getSnapshot().value
    if (section === undefined) return
    this.publish(
      (section.toolGrouping ?? DEFAULT_TOOL_GROUPING) === 'on',
      section.toolGroupThreshold ?? DEFAULT_TOOL_GROUP_THRESHOLD,
    )
  }

  /**
   * Advance every reactive store when either preference actually changed.
   * @param enabled - aggregate rows enabled.
   * @param threshold - minimum calls per aggregate row.
   */
  private publish(enabled: boolean, threshold: ToolGroupThreshold): void {
    if (this.enabled.getSnapshot() !== enabled) this.enabled.set(enabled)
    if (this.threshold.getSnapshot() !== threshold) this.threshold.set(threshold)
    const previous = this.preferences.getSnapshot()
    if (previous.enabled !== enabled || previous.threshold !== threshold) {
      this.preferences.set({ enabled, threshold })
    }
  }
}

/** General Settings row for aggregate same-Tool rows. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  TOOL_GROUP_THRESHOLDS, type ToolGrouping, type ToolGroupThreshold,
} from '../../chat-settings.ts'
import type { ToolGroupingPreferences } from '../tool-grouping.ts'
import type { ChatKey } from '../locale.ts'
import { PreferenceRow } from './PreferenceRow.tsx'

/** Registration-side aggregate-row preference face. */
export interface ToolGroupingRowInjected {
  hooks: {
    /** Derived aggregate-row preferences bound as useToolGrouping. */
    toolGrouping: SnapshotStore<ToolGroupingPreferences>
  }
  /** Enable or disable aggregate rows. */
  setToolGrouping: (grouping: ToolGrouping) => void
  /** Persist the minimum consecutive-call count that aggregates. */
  setToolGroupThreshold: (threshold: ToolGroupThreshold) => void
}

/** Full Settings-row props. */
export type ToolGroupingRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'chat'>
  & InjectFace<ToolGroupingRowInjected>

const GROUPING_LABELS = {
  on: 'settings.toolGrouping.on',
  off: 'settings.toolGrouping.off',
} as const satisfies Record<ToolGrouping, ChatKey>

/**
 * Render the aggregate-row enable choice and its threshold selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function ToolGroupingRow({ useToolGrouping, setToolGrouping, setToolGroupThreshold, t }: ToolGroupingRowProps) {
  const { enabled, threshold } = useToolGrouping(preferences => preferences)
  return (
    <>
      <PreferenceRow
        title={t('settings.toolGrouping.title')}
        description={t('settings.toolGrouping.description')}
        value={enabled ? 'on' : 'off'}
        selectedLabel={t(GROUPING_LABELS[enabled ? 'on' : 'off'])}
        options={[{
          id: 'on', label: t(GROUPING_LABELS.on),
        }, {
          id: 'off', label: t(GROUPING_LABELS.off),
        }]}
        onSelect={(value) => { setToolGrouping(value === 'on' ? 'on' : 'off') }}
      />
      {enabled && (
        <PreferenceRow
          title={t('settings.toolGroupThreshold.title')}
          description={t('settings.toolGroupThreshold.description')}
          value={String(threshold)}
          selectedLabel={t('settings.toolGroupThreshold.count', { count: threshold })}
          options={TOOL_GROUP_THRESHOLDS.map(id => ({
            id: String(id), label: t('settings.toolGroupThreshold.count', { count: id }),
          }))}
          onSelect={(value) => { setToolGroupThreshold(Number(value) as ToolGroupThreshold) }}
        />
      )}
    </>
  )
}

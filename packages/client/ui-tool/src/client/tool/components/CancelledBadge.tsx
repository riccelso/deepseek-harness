/** Inline cancelled cue for a preparation whose stream ended before dispatch. */
import { Tag } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './CancelledBadge.module.css'

/**
 * Render a neutral capsule with the localized cancelled label.
 * @param props - localized cancelled label.
 * @returns the cancelled status capsule.
 */
export function CancelledBadge({ label }: { label: string }) {
  return <Tag tone="neutral" className={css.badge}>{label}</Tag>
}

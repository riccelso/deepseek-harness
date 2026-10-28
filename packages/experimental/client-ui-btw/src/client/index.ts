/** Browser entry for the optional side-question Remote contribution and right-Sidebar tab. */
import type { Context } from '@deepseek-ai/cordis'
import btwRemote from '@deepseek-ai/dsh-experimental-api-btw/remote'
import { mountBtw } from './mount.ts'

export { inject } from './mount.ts'

/**
 * Activate the experimental side-question contribution.
 * @param ctx - Client runtime.
 * @returns complete UI and Remote disposer.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  return await mountBtw(ctx, btwRemote)
}

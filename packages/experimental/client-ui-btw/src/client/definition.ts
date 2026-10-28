/**
 * Stage one of the side-question tab type's registration: what it IS.
 *
 * A page type: it recognizes no resource address, because its content is the
 * current Session's retained side-question log rather than an address, and it
 * is opened by kind — the `/btw` source claims a line, seeds the panel state,
 * and asks the right Sidebar to reveal this tab. No priority band is declared:
 * this type ships from outside the product, and `extension` (the default) is
 * that band. No guide entry either: the only way in is `/btw` itself.
 */
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { NS } from './locales.ts'

/** This implementation's identity in the tab system: the key its body registers under. */
export const BTW_TAB_ID = '@deepseek-ai/dsh-experimental-client-ui-btw'

/** The tab kind this package owns; `/btw` opens and reveals it by this name. */
export const BTW_TAB_KIND = 'btw'

/**
 * The side-question tab type's registry definition.
 *
 * `keepMounted` keeps a visited body mounted through hiding, Session changes,
 * and docking, so an in-flight answer keeps streaming into its tab even while
 * the user reads another one.
 * @param t - namespace-bound translate, read fresh on every title call.
 * @returns the definition to register.
 */
export function btwTabDefinition(t: TranslateNS<typeof NS>): SidebarRightTabDefinition {
  return {
    id: BTW_TAB_ID,
    kind: BTW_TAB_KIND,
    keepMounted: true,
    title: () => t('panel.title'),
  }
}

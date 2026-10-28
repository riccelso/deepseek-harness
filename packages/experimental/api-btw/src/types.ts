/** JSON-safe inputs and results of the experimental side-question Remote namespace. */
import type { BtwExchange, BtwHistory } from '@deepseek-ai/dsh-experimental-btw/types'
import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** The side-question call failed before or during the answering model call. */
    'btw/ask-failed': { readonly reason: string }
  }
}

export type { BtwExchange, BtwHistory }

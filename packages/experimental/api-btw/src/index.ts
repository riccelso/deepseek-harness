/** Authenticated, cancellation-aware Client access to the side-question capability. */
import type { Context } from '@deepseek-ai/cordis'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-experimental-btw'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { EncodedImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { BtwExchange, BtwHistory } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Experimental side-question Remote controller. */
    btwController: BtwController
  }
}

/** Side questions never activate or submit to an Agent. */
export default class BtwController extends TypertRemoteService {
  static inject = ['btw', 'typert']

  constructor(ctx: Context) {
    super(ctx, 'btwController', { namespace: 'btw' })
  }

  /**
   * Answer one side question about a Session from what it already contains.
   * @param sessionId - Session the question is about.
   * @param question - side question exactly as asked.
   * @param images - canonical-base64 images to attach to the question.
   * @param signal - Client cancellation or Remote contribution disposal.
   * @returns the completed exchange without adding a Session event.
   */
  @Remote
  async ask(
    sessionId: SessionId,
    question: string,
    images: readonly EncodedImageAttachment[],
    signal: AbortSignal,
  ): Promise<BtwExchange> {
    signal.throwIfAborted()
    try {
      return await this.ctx.btw.ask(sessionId, question, signal, images)
    } catch (error) {
      signal.throwIfAborted()
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('btw/ask-failed', reason, { reason })
    }
  }

  /**
   * Read the retained side-question exchanges of one Session.
   * @param sessionId - Session whose retained exchanges are read.
   * @returns retained exchanges in log order and the count of evicted older ones.
   */
  @Remote
  history(sessionId: SessionId): BtwHistory {
    return this.ctx.btw.history(sessionId)
  }

  /**
   * Discard every retained exchange of one Session.
   * @param sessionId - Session whose retained exchanges are cleared.
   */
  @Remote
  clear(sessionId: SessionId): void {
    this.ctx.btw.clear(sessionId)
  }
}

/**
 * Side-question engine (`ctx.btw`): answers a question about one Session by
 * forking that Session's resident agent. The fork child inherits the
 * conversation's completed-turn prefix and runs with every global tool denied,
 * so its answer uses only what the conversation already contains. A side
 * question never submits to the parent Agent and appends no message or tool
 * result to the parent Session log; the exchange lives in an in-memory
 * per-Session ring that a Host restart discards. The fork child itself is an
 * ordinary durable child Session — the side content lives in the child's log,
 * never the parent's.
 * @module @deepseek-ai/dsh-experimental-btw
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { admitEncodedImages } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-attachment'
import type { EncodedImageAttachment, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { deadline } from '@deepseek-ai/dsh-timeout'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-subagent'
import type { BtwExchange, BtwHistory, BtwModelRoute, BtwTokenUsage } from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Experimental side-question engine. */
    btw: BtwSideQuestions
  }
}

/** Execution and retention policy of the side-question engine. */
export interface Config {
  /** Output-token cap of one answering fork child. */
  readonly maxOutputTokens: number
  /** End-to-end deadline of one side question, in milliseconds. */
  readonly timeoutMs: number
  /** Exchanges retained per Session for replay and the overlay list. */
  readonly historyLimit: number
  /** Maximum accepted question length in Unicode characters. */
  readonly questionMaxLength: number
  /** Explicit provider of the answering child; must be paired with `model`. */
  readonly provider?: string
  /** Explicit model of the answering child; must be paired with `provider`. */
  readonly model?: string
}

const BTW_TIMEOUT_CODE = 'btw/timeout'
/** Characters kept from one earlier answer inside the replayed history. */
const EARLIER_ANSWER_CHARS = 400
/** Catalog label of every side-question child; carries no side content. */
const CHILD_LABEL = 'btw side question'

/** Instruction heading every side-question fork prompt. */
function instruction(): string {
  return [
    'You are answering one side question about this conversation.',
    'Use ONLY the conversation transcript and the earlier side questions supplied below.',
    'You have no tools: you cannot read files, run commands, or search, and you must not claim to.',
    'Answer in the same language as the question. Be concise and self-contained; quote exact names, paths, and values from the conversation when they answer the question.',
    'If the supplied material does not contain the answer, say so plainly and suggest asking in the main conversation.',
  ].join('\n')
}

/** Ellipsize one string to at most `limit` characters. */
function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

/** Marker an image-carrying question adds to the replayed history. */
function imageMark(exchange: BtwExchange): string {
  return exchange.imageCount === undefined || exchange.imageCount === 0 ? '' : ` [image x${exchange.imageCount}]`
}

/** Render the retained exchanges as replayable earlier-question text. */
export function renderEarlier(history: readonly BtwExchange[]): string {
  if (history.length === 0) return 'None yet.'
  return history
    .map(exchange => `Q: ${exchange.question}${imageMark(exchange)}\nA: ${truncate(exchange.answer, EARLIER_ANSWER_CHARS)}`)
    .join('\n\n')
}

/** Frame the answering child's user prompt: instruction, earlier exchanges, and the question. */
export function framePrompt(history: readonly BtwExchange[], question: string): string {
  return [
    instruction(),
    '',
    'Earlier side questions (oldest first; not part of the conversation):',
    '<side>',
    renderEarlier(history),
    '</side>',
    '',
    'Side question:',
    '<question>',
    question,
    '</question>',
  ].join('\n')
}

/**
 * Read the answering child's own final-step token usage and request route from
 * its Session. The child's log begins with the inherited parent prefix, so the
 * LAST usage-bearing assistant message and the LAST request header are the
 * answering step's own accounting.
 * @param events - the child Session's events in log order.
 * @returns the accounting fields, when the child recorded either.
 */
export function childAccounting(events: readonly SessionEvent[]): Pick<BtwExchange, 'usage' | 'route'> {
  let usage: BtwTokenUsage | undefined
  let route: BtwModelRoute | undefined
  for (const event of events) {
    if (event.type === 'request/header') {
      const { provider, model } = event.data.header.config
      route = { provider, model }
    } else if (event.type === 'assistant/message' && event.data.usage !== undefined) {
      usage = event.data.usage
    }
  }
  return { ...usage === undefined ? {} : { usage }, ...route === undefined ? {} : { route } }
}

/** In-memory retention state of one Session. */
interface Ring {
  entries: BtwExchange[]
  dropped: number
}

/**
 * The side-question engine. Forks a Session's resident agent with every global
 * tool denied, resolves the answer from the child activation's result, and
 * retains the exchanges of every addressed Session in memory.
 */
export default class BtwSideQuestions extends Service {
  static inject = ['agents', 'subagents', 'sessionQuery', 'attachments']

  static Config: z<Config> = z.object({
    maxOutputTokens: z.natural().min(1).default(1024),
    timeoutMs: z.natural().min(1000).default(120000),
    historyLimit: z.natural().min(1).max(100).default(20),
    questionMaxLength: z.natural().min(1).default(2000),
    provider: z.string(),
    model: z.string(),
  })

  private readonly rings = new Map<SessionId, Ring>()

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'btw')
    if ((config.provider === undefined) !== (config.model === undefined)) {
      throw new Error('btw: config provider and model must be set together')
    }
    ctx.effect(() => () => { this.rings.clear() }, 'btw: ring disposal')
  }

  /**
   * Answer one side question by forking the Session's resident agent with
   * every global tool denied.
   * @param sessionId - Session the question is about; its agent must be resident.
   * @param question - trimmed side question.
   * @param signal - caller cancellation; aborts the fork child and discards the exchange.
   * @param images - canonical-base64 images to admit and attach to the question.
   * @returns the completed exchange, also recorded in this Session's ring.
   * @throws when the question is empty or too long, the Session has no resident
   * agent to fork, an image is rejected by the attachment store, or the fork
   * ends without a text answer.
   */
  async ask(
    sessionId: SessionId,
    question: string,
    signal: AbortSignal,
    images: readonly EncodedImageAttachment[] = [],
  ): Promise<BtwExchange> {
    signal.throwIfAborted()
    const trimmed = question.trim()
    if (trimmed.length === 0) throw new Error('btw: question must not be empty')
    if (trimmed.length > this.config.questionMaxLength) {
      throw new Error(`btw: question is ${trimmed.length} characters, exceeding questionMaxLength ${this.config.questionMaxLength}`)
    }
    const parent = this.ctx.agents.get(sessionId)
    if (parent === undefined) {
      throw new Error(`btw: session "${sessionId}" has no resident agent to fork`)
    }
    const refs = images.length === 0 ? [] : await this.admitImages(images, signal)
    const history = this.history(sessionId).entries
    using callDeadline = deadline(signal, this.config.timeoutMs, BTW_TIMEOUT_CODE)
    const activation = await this.ctx.subagents.startActivation({
      provider: 'fork',
      label: CHILD_LABEL,
      delivery: 'caller',
      signal: callDeadline.signal,
      request: {
        prompt: [
          { type: 'text', text: framePrompt(history, trimmed) },
          ...refs.map(attachment => ({ type: 'image' as const, attachment })),
        ],
        parent,
        toolFilter: { allow: [] },
        agentOptions: {
          maxTokens: this.config.maxOutputTokens,
          ...this.config.provider !== undefined ? { provider: this.config.provider, model: this.config.model } : {},
        },
      },
    })
    // Cancellation after publication is the caller's job: aborting the deadline
    // signal (caller cancel or timeout) stops the child through dispose() so a
    // cancelled side question never keeps a fork running.
    const cancelOnAbort = (): void => {
      void activation.dispose().catch((_error: unknown) => {
        // Nothing is awaited on this path; a teardown failure here surfaces
        // through the result path's own dispose.
      })
    }
    callDeadline.signal.addEventListener('abort', cancelOnAbort, { once: true })
    try {
      const result = await activation.result
      callDeadline.signal.throwIfAborted()
      if (result.stopReason !== 'completed' && result.stopReason !== 'max-tokens') {
        throw new Error(`btw: the side-question fork ended ${result.stopReason}${result.diagnostic === undefined ? '' : `: ${result.diagnostic}`}`)
      }
      const answer = result.output
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n')
        .trim()
      if (answer.length === 0) throw new Error('btw: the side-question fork produced no text answer')
      const exchange: BtwExchange = {
        question: trimmed,
        ...refs.length === 0 ? {} : { imageCount: refs.length },
        answer,
        at: Date.now(),
        ...await this.observeChildAccounting(activation.childId),
      }
      this.record(sessionId, exchange)
      return exchange
    } finally {
      callDeadline.signal.removeEventListener('abort', cancelOnAbort)
      await activation.dispose().catch((error: unknown) => {
        // The exchange already settled; a spent child's teardown failure must
        // not fail or delay the answer.
        void error
      })
    }
  }

  /**
   * Read the retained exchanges of one Session.
   * @param sessionId - Session whose ring is read.
   * @returns retained exchanges in log order and the count of evicted older ones.
   */
  history(sessionId: SessionId): BtwHistory {
    const ring = this.rings.get(sessionId)
    return ring === undefined
      ? { entries: [], dropped: 0 }
      : { entries: [...ring.entries], dropped: ring.dropped }
  }

  /**
   * Discard every retained exchange of one Session.
   * @param sessionId - Session whose ring is cleared.
   */
  clear(sessionId: SessionId): void {
    this.rings.delete(sessionId)
  }

  /** Admit encoded images through the attachment store's batch limits. */
  private async admitImages(images: readonly EncodedImageAttachment[], signal: AbortSignal): Promise<readonly ImageAttachmentRef[]> {
    signal.throwIfAborted()
    try {
      return await admitEncodedImages(this.ctx.attachments, images)
    } catch (error) {
      throw new Error(`btw: image attachment rejected: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Observe the child Session and derive its final-step accounting; advisory only. */
  private async observeChildAccounting(childId: SessionId): Promise<Pick<BtwExchange, 'usage' | 'route'>> {
    try {
      using observation = await this.ctx.sessionQuery.observeSession(childId)
      return childAccounting(observation.events)
    } catch (_error) {
      // Usage and route are card decoration; an unobservable child keeps the answer.
      return {}
    }
  }

  private record(sessionId: SessionId, exchange: BtwExchange): void {
    const ring = this.rings.get(sessionId) ?? { entries: [], dropped: 0 }
    ring.entries.push({ ...exchange })
    while (ring.entries.length > this.config.historyLimit) {
      ring.entries.shift()
      ring.dropped += 1
    }
    this.rings.set(sessionId, ring)
  }
}

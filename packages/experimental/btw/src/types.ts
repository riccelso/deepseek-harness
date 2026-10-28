/** Wire types of the side-question engine, shared by its Remote controller and the browser overlay. */
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Exact model route that answered one exchange. */
export interface BtwModelRoute {
  /** Provider identity, as resolved for the answering call. */
  readonly provider: string
  /** Provider-owned model id. */
  readonly model: string
}

/** Token accounting of the answering fork child's final model step. */
export interface BtwTokenUsage {
  /** Prompt tokens the answering step consumed. */
  readonly inputTokens: number
  /** Completion tokens the answering step produced. */
  readonly outputTokens: number
  /** Exact full-call total when the adapter reported one. */
  readonly totalTokens?: number
}

/** One recorded side-question exchange. The question and answer never enter the parent Session log. */
export interface BtwExchange {
  /** Trimmed question exactly as asked. */
  readonly question: string
  /** Images attached to the question, when any were admitted. */
  readonly imageCount?: number
  /** Assembled text answer. */
  readonly answer: string
  /** Wall-clock milliseconds when the answer completed. */
  readonly at: number
  /** Route that produced the answer, when the child's request header was readable. */
  readonly route?: BtwModelRoute
  /** Token cost of the answering step, when the child's accounting was readable. */
  readonly usage?: BtwTokenUsage
}

/** Retained side-question history of one Session. */
export interface BtwHistory {
  /** Retained exchanges in log order, oldest first, newest last. */
  readonly entries: readonly BtwExchange[]
  /** Count of older exchanges evicted by the retention limit. */
  readonly dropped: number
}

/** Session a side question or history read addresses. */
export type BtwSessionId = SessionId

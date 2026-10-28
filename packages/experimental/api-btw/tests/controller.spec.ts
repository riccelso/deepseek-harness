/** Remote surface over the engine: ask mapping, history, clear, and cancellation. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import BtwController from '../src/index.ts'
import type { BtwExchange } from '@deepseek-ai/dsh-experimental-btw/types'
import { RemoteError, remoteErrorOf } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session'

const roots: Context[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => root.fiber.dispose())) })

const SESSION = 's1' as SessionId
const EXCHANGE: BtwExchange = { question: 'q', answer: 'a', at: 1 }

function fixture(ask: (sessionId: SessionId, question: string, signal: AbortSignal, images: readonly unknown[]) => Promise<BtwExchange>) {
  const ctx = new Context(); roots.push(ctx)
  const history = vi.fn(() => ({ entries: [EXCHANGE], dropped: 0 }))
  const clear = vi.fn()
  ctx.provide('btw', { ask, history, clear })
  return { api: new BtwController(ctx), history, clear }
}

it('answers through the engine and surfaces failures as one stable RemoteError', async () => {
  const { api } = fixture(async (_sessionId, question) => ({ ...EXCHANGE, question }))
  await expect(api.ask(SESSION, 'what?', [], new AbortController().signal)).resolves.toMatchObject({ question: 'what?', answer: 'a' })
  const failing = fixture(async () => { throw new Error('fork ended error: boom') })
  const failure = await failing.api.ask(SESSION, 'q', [], new AbortController().signal)
    .then(() => undefined, (error: unknown) => error) as RemoteError<'btw/ask-failed'>
  expect(remoteErrorOf(failure)?.code).toBe('btw/ask-failed')
  expect(failure.message).toBe('fork ended error: boom')
  expect(failure.details).toEqual({ reason: 'fork ended error: boom' })
})

it('rethrows caller cancellation instead of wrapping it', async () => {
  const abort = new AbortController()
  abort.abort(new Error('cancelled'))
  const { api } = fixture(async () => EXCHANGE)
  await expect(api.ask(SESSION, 'q', [], abort.signal)).rejects.toThrow('cancelled')
})

it('stringifies a non-Error engine failure', async () => {
  const { api } = fixture(async () => { throw 'engine cold' })
  const failure = await api.ask(SESSION, 'q', [], new AbortController().signal)
    .then(() => undefined, (error: unknown) => error) as RemoteError<'btw/ask-failed'>
  expect(failure.message).toBe('engine cold')
  expect(failure.details).toEqual({ reason: 'engine cold' })
})

it('rethrows cancellation that lands while the engine is already failing', async () => {
  const abort = new AbortController()
  const { api } = fixture(async () => {
    abort.abort(new Error('late cancel'))
    throw new Error('engine failed')
  })
  await expect(api.ask(SESSION, 'q', [], abort.signal)).rejects.toThrow('late cancel')
})

it('reads and clears retained history synchronously', () => {
  const { api, history, clear } = fixture(async () => EXCHANGE)
  expect(api.history(SESSION)).toEqual({ entries: [EXCHANGE], dropped: 0 })
  expect(history).toHaveBeenCalledWith(SESSION)
  api.clear(SESSION)
  expect(clear).toHaveBeenCalledWith(SESSION)
})

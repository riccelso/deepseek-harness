/** Framing, accounting derivation, retention, and the fork-based ask over fakes. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import BtwSideQuestions, { childAccounting, framePrompt, renderEarlier } from '../src/index.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SubagentActivationSpec } from '@deepseek-ai/dsh-subagent'

const CONFIG = {
  maxOutputTokens: 512,
  timeoutMs: 60000,
  historyLimit: 3,
  questionMaxLength: 50,
}

function event(type: string, seq: number, data: unknown): SessionEvent {
  return { type, seq, time: seq, data } as never
}

function headerEvent(provider: string, model: string): SessionEvent {
  return event('request/header', 0, { header: { config: { provider, model } }, reason: 'initial' })
}

function usageEvent(seq: number, usage: { inputTokens: number; outputTokens: number; totalTokens?: number }): SessionEvent {
  return event('assistant/message', seq, {
    turn: 1, step: 1,
    message: { role: 'assistant', content: [{ type: 'text', text: 'a' }], source: { kind: 'model', provider: 'p', model: 'm' } },
    stream: [], usage,
  })
}

function observation(events: readonly SessionEvent[]): unknown {
  const lease = { events, [Symbol.dispose]: () => {} }
  return { source: 'live', retain: () => lease, ...lease }
}

/** One scripted activation the fake subagents service hands back. */
interface FakeActivationOptions {
  readonly answer?: string
  readonly output?: readonly unknown[]
  readonly stopReason?: string
  readonly diagnostic?: string
  /** `'hang'` leaves the result unsettled until the start signal aborts. */
  readonly settle?: 'hang'
  readonly disposeFails?: boolean
}

interface MountedOptions extends FakeActivationOptions {
  readonly config?: Record<string, unknown>
  readonly attachments?: unknown
  readonly childEvents?: readonly SessionEvent[]
  readonly observeFails?: boolean
  readonly residentParent?: boolean
}

const PARENT = { id: SessionId('parent-1') }

async function mounted(options: MountedOptions = {}) {
  const started: SubagentActivationSpec[] = []
  let disposeCalls = 0
  const ctx = new Context()
  ctx.provide('agents', {
    get: (id: string) => (options.residentParent === false ? undefined : id === PARENT.id ? PARENT : undefined),
  } as never)
  ctx.provide('subagents', {
    startActivation: async (spec: SubagentActivationSpec) => {
      started.push(spec)
      let settleResult: ((value: unknown) => void) | undefined
      const result = new Promise<unknown>((resolve) => { settleResult = resolve })
      // The real seam settles an aborted run instead of rejecting; the fake
      // mirrors that so the engine's abort path runs end to end.
      spec.signal.addEventListener('abort', () => { settleResult?.({ stopReason: 'aborted', output: [] }) }, { once: true })
      if (options.settle !== 'hang') {
        settleResult?.({
          stopReason: options.stopReason ?? 'completed',
          output: options.output ?? [{ type: 'text', text: options.answer ?? 'fork answer' }],
          ...options.diagnostic === undefined ? {} : { diagnostic: options.diagnostic },
        })
      }
      return {
        childId: SessionId(`child-${String(started.length)}`),
        result,
        dispose: async () => {
          disposeCalls += 1
          if (options.disposeFails) throw new Error('teardown failed')
        },
      }
    },
  } as never)
  ctx.provide('sessionQuery', {
    observeSession: async (_id: string) => {
      if (options.observeFails) throw new Error('unobservable')
      return observation(options.childEvents ?? [headerEvent('p', 'm')])
    },
  } as never)
  ctx.provide('attachments', (options.attachments ?? {}) as never)
  const base = ctx.plugin(BtwSideQuestions, { ...CONFIG, ...options.config })
  await base
  return { ctx, btw: ctx.get('btw')!, started, disposeCalls: () => disposeCalls, dispose: async () => { await base.dispose() } }
}

describe('framing', () => {
  it('frames the instruction, earlier exchanges, and the question', () => {
    const prompt = framePrompt(
      [{ question: 'q1', answer: 'a1', at: 1 }, { question: 'q2 with image', answer: 'x'.repeat(500), at: 2, imageCount: 2 }],
      'what next?',
    )
    expect(prompt).toContain('side question about this conversation')
    expect(prompt).toContain('Q: q1\nA: a1')
    expect(prompt).toContain('Q: q2 with image [image x2]')
    expect(prompt).toContain('…')
    expect(prompt).toContain('<question>\nwhat next?\n</question>')
  })

  it('renders empty history explicitly', () => {
    expect(renderEarlier([])).toBe('None yet.')
  })
})

describe('accounting', () => {
  it('keeps only the child\'s own last usage and route over an inherited prefix', () => {
    const accounting = childAccounting([
      headerEvent('inherited', 'old'),
      usageEvent(1, { inputTokens: 900, outputTokens: 90 }),
      usageEvent(2, { inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
      headerEvent('child', 'answerer'),
      event('turn/start', 5, { turn: 9 }),
    ])
    expect(accounting).toEqual({
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      route: { provider: 'child', model: 'answerer' },
    })
  })

  it('omits fields the child log does not record', () => {
    expect(childAccounting([event('turn/start', 1, { turn: 1 })])).toEqual({})
  })
})

describe('service', () => {
  it('forks with every tool denied and records the exchange', async () => {
    const { btw, started, disposeCalls, dispose } = await mounted({
      childEvents: [headerEvent('p', 'm'), usageEvent(2, { inputTokens: 10, outputTokens: 5, totalTokens: 15 })],
    })
    try {
      const exchange = await btw.ask(PARENT.id, 'what did I say?', new AbortController().signal)
      expect(started).toHaveLength(1)
      const spec = started[0]!
      expect(spec.provider).toBe('fork')
      expect(spec.delivery).toBe('caller')
      expect(spec.label).toBe('btw side question')
      expect(spec.request.toolFilter).toEqual({ allow: [] })
      expect(spec.request.parent).toBe(PARENT)
      expect(spec.request.prompt[0]).toMatchObject({ type: 'text' })
      expect((spec.request.prompt[0] as { text: string }).text).toContain('what did I say?')
      expect(spec.request.agentOptions).toEqual({ maxTokens: 512 })
      expect(exchange).toMatchObject({
        question: 'what did I say?',
        answer: 'fork answer',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        route: { provider: 'p', model: 'm' },
      })
      expect(btw.history(PARENT.id).entries).toHaveLength(1)
      expect(disposeCalls()).toBeGreaterThanOrEqual(1)
    } finally { await dispose() }
  })

  it('overrides the route through the configured provider and model', async () => {
    const { btw, started, dispose } = await mounted({ config: { provider: 'explicit', model: 'side' } })
    try {
      const exchange = await btw.ask(PARENT.id, 'q', new AbortController().signal)
      expect(started[0]!.request.agentOptions).toEqual({ maxTokens: 512, provider: 'explicit', model: 'side' })
      expect(exchange.route).toEqual({ provider: 'p', model: 'm' })
    } finally { await dispose() }
  })

  it('sends admitted images as prompt blocks and counts them', async () => {
    const saved: unknown[][] = []
    const attachments = {
      saveImages: async (images: unknown[]) => {
        saved.push(images)
        return images.map(() => ({ attachmentId: 'sha256:' + 'a'.repeat(64), mediaType: 'image/png', bytes: 2, width: 1, height: 1 }))
      },
    }
    const { btw, started, dispose } = await mounted({ attachments })
    try {
      const exchange = await btw.ask(PARENT.id, 'what is in the picture?', new AbortController().signal, [
        { mediaType: 'image/png', data: 'aGk=', name: 'shot.png' },
      ])
      expect(saved).toHaveLength(1)
      expect(started[0]!.request.prompt[1]).toMatchObject({ type: 'image' })
      expect(exchange.imageCount).toBe(1)
    } finally { await dispose() }
  })

  it('wraps a non-Error attachment rejection as a btw failure', async () => {
    const attachments = {
      saveImages: async () => { throw 'batch limit' },
    }
    const { btw, dispose } = await mounted({ attachments })
    try {
      await expect(btw.ask(PARENT.id, 'q', new AbortController().signal, [
        { mediaType: 'image/png', data: 'aGk=' },
      ])).rejects.toThrow('image attachment rejected: batch limit')
    } finally { await dispose() }
  })

  it('keeps only text blocks of a mixed answer', async () => {
    const { btw, dispose } = await mounted({ output: [{ type: 'reasoning' }, { type: 'text', text: 'line' }] })
    try {
      await expect(btw.ask(PARENT.id, 'q', new AbortController().signal)).resolves.toMatchObject({ answer: 'line' })
    } finally { await dispose() }
  })

  it('keeps a cancelled ask failing through a dispose that also fails', async () => {
    const { btw, disposeCalls, dispose } = await mounted({ settle: 'hang', disposeFails: true })
    const abort = new AbortController()
    const asking = btw.ask(PARENT.id, 'q', abort.signal)
    await new Promise<void>((resolve: () => void) => { setTimeout(resolve, 0) })
    abort.abort(new Error('cancelled'))
    try {
      await expect(asking).rejects.toThrow()
      expect(disposeCalls()).toBeGreaterThanOrEqual(2)
    } finally { await dispose() }
  })

  it('wraps attachment-store rejection as a btw failure', async () => {
    const attachments = {
      saveImages: async () => { throw new Error('batch limit') },
    }
    const { btw, dispose } = await mounted({ attachments })
    try {
      await expect(btw.ask(PARENT.id, 'q', new AbortController().signal, [
        { mediaType: 'image/png', data: 'aGk=' },
      ])).rejects.toThrow('image attachment rejected')
    } finally { await dispose() }
  })

  it('keeps the answer when the child session is unobservable', async () => {
    const { btw, dispose } = await mounted({ observeFails: true })
    try {
      const exchange = await btw.ask(PARENT.id, 'q', new AbortController().signal)
      expect(exchange.answer).toBe('fork answer')
      expect('usage' in exchange).toBe(false)
      expect('route' in exchange).toBe(false)
    } finally { await dispose() }
  })

  it('rejects a fork that ends without completing and keeps the ring empty', async () => {
    const { btw, dispose } = await mounted({ stopReason: 'error', diagnostic: 'boom' })
    try {
      await expect(btw.ask(PARENT.id, 'q', new AbortController().signal)).rejects.toThrow('btw: the side-question fork ended error: boom')
      expect(btw.history(PARENT.id).entries).toHaveLength(0)
    } finally { await dispose() }
  })

  it('rejects a failed fork without a diagnostic', async () => {
    const { btw, dispose } = await mounted({ stopReason: 'error' })
    try {
      await expect(btw.ask(PARENT.id, 'q', new AbortController().signal)).rejects.toThrow('btw: the side-question fork ended error')
    } finally { await dispose() }
  })

  it('rejects a completed fork that produced no text', async () => {
    const { btw, dispose } = await mounted({ output: [] })
    try {
      await expect(btw.ask(PARENT.id, 'q', new AbortController().signal)).rejects.toThrow('no text answer')
    } finally { await dispose() }
  })

  it('stops the child and rejects when the caller cancels mid-flight', async () => {
    const { btw, disposeCalls, dispose } = await mounted({ settle: 'hang' })
    const abort = new AbortController()
    const asking = btw.ask(PARENT.id, 'q', abort.signal)
    await new Promise<void>((resolve: () => void) => { setTimeout(resolve, 0) })
    abort.abort(new Error('cancelled'))
    try {
      await expect(asking).rejects.toThrow()
      expect(disposeCalls()).toBeGreaterThanOrEqual(1)
      expect(btw.history(PARENT.id).entries).toHaveLength(0)
    } finally { await dispose() }
  })

  it('keeps a settled answer through a dispose failure', async () => {
    const { btw, dispose } = await mounted({ disposeFails: true })
    try {
      await expect(btw.ask(PARENT.id, 'q', new AbortController().signal)).resolves.toMatchObject({ answer: 'fork answer' })
    } finally { await dispose() }
  })

  it('rejects empty and oversized questions and sessions without a resident agent', async () => {
    const { btw, dispose } = await mounted()
    try {
      await expect(btw.ask(PARENT.id, '   ', new AbortController().signal)).rejects.toThrow('empty')
      await expect(btw.ask(PARENT.id, 'x'.repeat(51), new AbortController().signal)).rejects.toThrow('questionMaxLength')
    } finally { await dispose() }
    const bare = await mounted({ residentParent: false })
    try {
      await expect(bare.btw.ask(SessionId('gone'), 'q', new AbortController().signal)).rejects.toThrow('no resident agent to fork')
    } finally { await bare.dispose() }
  })

  it('retains only historyLimit exchanges and counts the evicted ones', async () => {
    const { btw, dispose } = await mounted()
    try {
      for (const index of [1, 2, 3, 4]) await btw.ask(PARENT.id, `q${index}`, new AbortController().signal)
      const history = btw.history(PARENT.id)
      expect(history.entries.map((entry: { question: string }) => entry.question)).toEqual(['q2', 'q3', 'q4'])
      expect(history.dropped).toBe(1)
      btw.clear(PARENT.id)
      expect(btw.history(PARENT.id)).toEqual({ entries: [], dropped: 0 })
    } finally { await dispose() }
  })

  it('fails loud when config names provider without model', async () => {
    const ctx = new Context()
    ctx.provide('agents', {} as never)
    ctx.provide('subagents', {} as never)
    ctx.provide('sessionQuery', {} as never)
    ctx.provide('attachments', {} as never)
    const base = ctx.plugin(BtwSideQuestions, { ...CONFIG, provider: 'lonely' })
    await expect(base).rejects.toThrow('provider and model must be set together')
  })
})

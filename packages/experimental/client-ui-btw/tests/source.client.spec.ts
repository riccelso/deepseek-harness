/** Line claiming, envelope refusal, tab-type wiring, and the panels store. */
import { Context } from '@deepseek-ai/cordis'
import { beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { btwSource, BtwPanels, inject, mountBtw, registerUi } from '../src/client/mount.ts'
import { BTW_TAB_ID, btwTabDefinition } from '../src/client/definition.ts'
import type { BtwCard, BtwPanelEntry } from '../src/client/BtwTabPanel.tsx'
import { MAX_IMAGE_DRAFTS } from '../src/client/images.ts'

beforeAll(() => {
  // Node has no Object-URL statics; the ask path only revokes previews.
  if (typeof URL.revokeObjectURL !== 'function') URL.revokeObjectURL = () => {}
})

const SESSION = { sessionId: 's1' } as never
const t = (key: string): string => key

describe('btw slash source', () => {
  const open = vi.fn()
  const reveal = vi.fn()
  const source = btwSource(
    t,
    { subagentAddress: () => undefined, binding: () => undefined },
    { open } as never,
    reveal,
  )

  it('offers one candidate outside subagent sessions', async () => {
    await expect(source.candidates(SESSION, {} as never)).resolves.toHaveLength(1)
  })

  it('hides the candidate for subagent sessions', async () => {
    const hidden = btwSource(t, { subagentAddress: () => 'agent-1', binding: () => undefined }, { open } as never, reveal)
    await expect(hidden.candidates(SESSION, {} as never)).resolves.toEqual([])
  })

  it('picks into an editable /btw token', () => {
    expect(source.onPick({} as never)).toEqual({ text: '/btw ' })
  })

  it('claims bare and argued lines, opens the panel state, and reveals the tab', async () => {
    const signal = new AbortController().signal
    await expect(source.matchEnter!(SESSION, '/btw', signal, { attachments: 0 })).resolves.toBe('handled')
    expect(open).toHaveBeenLastCalledWith('s1', undefined)
    expect(reveal).toHaveBeenLastCalledWith('s1')
    await expect(source.matchEnter!(SESSION, '  /btw what config file?  ', signal, { attachments: 0 })).resolves.toBe('handled')
    expect(open).toHaveBeenLastCalledWith('s1', 'what config file?')
    expect(reveal).toHaveBeenLastCalledWith('s1')
  })

  it('ignores other commands and refuses attachments by throwing', async () => {
    const signal = new AbortController().signal
    for (const line of ['/btw2 hi', '/other hi', 'plain text']) {
      await expect(source.matchEnter!(SESSION, line, signal, { attachments: 0 })).resolves.toBeUndefined()
    }
    expect(() => { void source.matchEnter!(SESSION, '/btw hi', signal, { attachments: 2 }) })
      .toThrow('notice.attachmentsUnsupported')
  })
})

describe('btw tab registration', () => {
  it('registers the type, the keyed body, and a source that reveals the tab', async () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const sources = new Map<string, InputTriggerSource>()
    const registerType = vi.fn(() => () => {})
    const openTabIn = vi.fn()
    ctx.provide('inputTriggers', {
      registerSource(src: InputTriggerSource) {
        sources.set(src.trigger + ' ' + src.name, src)
        return () => { sources.delete(src.trigger + ' ' + src.name) }
      },
    })
    ctx.provide('sessions', { subagentAddress: () => undefined, binding: () => undefined })
    ctx.provide('remote', {})
    ctx.provide('sidebarRightTabs', { register: registerType })
    ctx.provide('sidebarRight', { openTabIn })
    await ctx.plugin(SlotRegistry).await()
    ctx.slots.register({
      name: 'root',
      children: { 'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' } },
    } as never, (() => null) as never)
    ctx.provide('locale', new LocaleRuntime(ctx))
    const fiber = ctx.plugin({ inject: [...inject], apply: registerUi })
    await fiber.await()

    expect(registerType).toHaveBeenCalledWith(expect.objectContaining({ id: BTW_TAB_ID, kind: 'btw' }))
    const entries = ctx.slots.entries('sidebar.right.pane.tab')
    expect(entries).toHaveLength(1)
    expect(entries[0]!.options.key).toBe(BTW_TAB_ID)
    const entryInject = (entries[0] as { inject?: () => unknown }).inject
    expect(typeof entryInject?.()).toBe('object')
    const source = sources.get('/ btw')
    expect(source).toBeDefined()
    await expect(source!.matchEnter!(SESSION, '/btw reveal me', new AbortController().signal, { attachments: 0 }))
      .resolves.toBe('handled')
    expect(openTabIn).toHaveBeenCalledWith('s1', 'btw')
  })
})

describe('btw panels store', () => {
  interface Exchange {
    readonly question: string
    readonly answer: string
    readonly at: number
    readonly usage?: { readonly inputTokens: number; readonly outputTokens: number; readonly totalTokens?: number }
  }
  type RemoteResult<T> = { ok: true; value: T } | { ok: false; error: Error }

  function fakeCtx(ask: (question: string) => Promise<RemoteResult<Exchange>>): never {
    const exchange: Exchange = { question: 'q', answer: 'the answer', at: 1, usage: { inputTokens: 3, outputTokens: 4 } }
    return {
      remote: {
        btw: {
          ask: async (_session: string, question: string) => ask(question),
          history: async (): Promise<RemoteResult<{ entries: readonly Exchange[]; dropped: number }>> =>
            ({ ok: true, value: { entries: [exchange], dropped: 0 } }),
          clear: async (): Promise<RemoteResult<void>> => ({ ok: true, value: undefined }),
        },
      },
    } as never
  }

  const settle = async (): Promise<void> => { await new Promise((resolve) => { setTimeout(resolve, 0) }) }

  it('opens one card per ask, clears the draft, and settles it done with tokens', async () => {
    const store = createSnapshotStore<Record<string, BtwPanelEntry>>({})
    const panels = new BtwPanels(fakeCtx(async () => ({ ok: true, value: { question: 'q', answer: 'the answer', at: 1, usage: { inputTokens: 3, outputTokens: 4 } } })), store)
    const id = 's1' as SessionId
    panels.open(id, 'what did I ask?')
    const opened = store.getSnapshot()[id]!
    expect(opened.question).toBe('')
    expect(opened.cards).toHaveLength(1)
    expect(opened.cards[0]).toMatchObject({ question: 'what did I ask?', status: 'generating' })
    await settle()
    const settled = store.getSnapshot()[id]!.cards[0] as BtwCard
    expect(settled).toMatchObject({ status: 'done', answer: 'the answer', tokens: 7 })
  })

  it('asks with queued image drafts and releases their previews', async () => {
    const store = createSnapshotStore<Record<string, BtwPanelEntry>>({})
    const panels = new BtwPanels(fakeCtx(async () => ({ ok: true, value: { question: 'q', answer: 'a', at: 1 } })), store)
    const id = 's1' as SessionId
    const face = panels.face()
    face.setQuestion(id, 'what is this?')
    face.addImage(id, { mediaType: 'image/png', data: 'aGk=', name: 'shot.png', url: 'blob:one' })
    face.ask(id, store.getSnapshot()[id]!.question)
    expect(store.getSnapshot()[id]!.images).toEqual([])
    expect(store.getSnapshot()[id]!.cards[0]).toMatchObject({ imageCount: 1 })
    await settle()
  })

  it('runs concurrent asks independently and cancels exactly one', async () => {
    const store = createSnapshotStore<Record<string, BtwPanelEntry>>({})
    const pending = new Map<string, (value: RemoteResult<Exchange>) => void>()
    const deferredAsk = (question: string): Promise<RemoteResult<Exchange>> =>
      new Promise((resolve: (value: RemoteResult<Exchange>) => void) => { pending.set(question, resolve) })
    const panels = new BtwPanels(fakeCtx(deferredAsk), store)
    const id = 's1' as SessionId
    panels.open(id, 'first?')
    panels.face().ask(id, 'second?')
    const cardOf = (question: string): BtwCard =>
      store.getSnapshot()[id]!.cards.find(card => card.question === question)!
    expect(store.getSnapshot()[id]!.cards.map(card => card.question)).toEqual(['first?', 'second?'])

    panels.face().cancel(id, cardOf('first?').id)
    expect(cardOf('first?')).toMatchObject({ status: 'cancelled' })
    expect(cardOf('second?')).toMatchObject({ status: 'generating' })

    pending.get('second?')!({ ok: true, value: { question: 'second?', answer: 'late', at: 2 } })
    await settle()
    expect(cardOf('second?')).toMatchObject({ status: 'done', answer: 'late' })
    expect(cardOf('first?')).toMatchObject({ status: 'cancelled' })
  })

  it('marks a failed ask on its card alone', async () => {
    const store = createSnapshotStore<Record<string, BtwPanelEntry>>({})
    const panels = new BtwPanels(fakeCtx(async () => ({ ok: false, error: new Error('remote down') })), store)
    const id = 's1' as SessionId
    panels.face().ask(id, 'break?')
    await settle()
    expect(store.getSnapshot()[id]!.cards[0]).toMatchObject({ status: 'error', error: 'remote down' })
  })

  it('seeds restored cards from retained history once per Session', async () => {
    const store = createSnapshotStore<Record<string, BtwPanelEntry>>({})
    const panels = new BtwPanels(fakeCtx(async () => ({ ok: true, value: { question: 'q', answer: 'a', at: 1 } })), store)
    panels.ensure('s2' as SessionId)
    expect(store.getSnapshot()['s2']).toMatchObject({ loaded: false, cards: [] })
    await settle()
    const restored = store.getSnapshot()['s2']!
    expect(restored.loaded).toBe(true)
    expect(restored.cards).toHaveLength(1)
    expect(restored.cards[0]).toMatchObject({ status: 'done', answer: 'the answer', tokens: 7 })
    panels.ensure('s2' as SessionId)
    await settle()
    expect(store.getSnapshot()['s2']!.cards).toHaveLength(1)
  })

  it('clears this window\'s cards after clearing the Host ring', async () => {
    const store = createSnapshotStore<Record<string, BtwPanelEntry>>({})
    const panels = new BtwPanels(fakeCtx(async () => ({ ok: true, value: { question: 'q', answer: 'a', at: 1 } })), store)
    const id = 's3' as SessionId
    panels.face().ask(id, 'gone?')
    await settle()
    expect(store.getSnapshot()[id]!.cards).toHaveLength(1)
    panels.face().clearHistory(id)
    await settle()
    expect(store.getSnapshot()[id]!.cards).toEqual([])
  })

  it('inserts one answer as the conversation draft through the session binding', async () => {
    const setDraft = vi.fn()
    const focus = vi.fn()
    const bindingCtx = {
      get: (name: string) => name === 'conversation'
        ? { input: { for: () => ({ setDraft, focus }) } }
        : undefined,
    }
    const store = createSnapshotStore<Record<string, BtwPanelEntry>>({})
    const panels = new BtwPanels(fakeCtx(async () => ({ ok: true, value: { question: 'q', answer: 'a', at: 1 } })), store, {
      subagentAddress: () => undefined,
      binding: () => ({ ctx: bindingCtx as never }),
    })
    panels.face().insertIntoConversation('s4' as SessionId, 'the answer')
    expect(setDraft).toHaveBeenCalledWith('the answer')
    expect(focus).toHaveBeenCalledTimes(1)
    // Without a retained binding the insert is a no-op, not an error.
    const orphan = new BtwPanels(fakeCtx(async () => ({ ok: true, value: { question: 'q', answer: 'a', at: 1 } })), store, {
      subagentAddress: () => undefined,
      binding: () => undefined,
    })
    expect(() => { orphan.face().insertIntoConversation('s4' as SessionId, 'x') }).not.toThrow()
  })
})

describe('btw mount lifecycle', () => {
  interface MountOptions {
    readonly locale?: unknown
    readonly sessions?: unknown
    readonly inputTriggers?: unknown
  }

  function mountableCtx(options: MountOptions = {}): Context {
    const ctx = new Context()
    ctx.provide('remote', {})
    ctx.provide('remote.btw', {
      ask: vi.fn(async () => ({ ok: true, value: { question: 'q', answer: 'a', at: 1 } })),
      history: vi.fn(async () => ({ ok: true, value: { entries: [], dropped: 0 } })),
      clear: vi.fn(async () => ({ ok: true, value: undefined })),
    } as never)
    void ctx.plugin(SlotRegistry).await().then(() => {
      ctx.slots.register({
        name: 'root',
        children: { 'sidebar.right.pane.tab': { kind: 'keyed', scope: 'session' } },
      } as never, (() => null) as never)
    })
    ctx.provide('locale', options.locale === undefined ? new LocaleRuntime(ctx) : options.locale)
    ctx.provide('sidebarRight', { openTabIn: vi.fn() })
    ctx.provide('sidebarRightTabs', { register: vi.fn(() => () => {}) })
    ctx.provide('sessions', options.sessions === undefined
      ? { subagentAddress: () => undefined, binding: () => undefined }
      : options.sessions)
    ctx.provide('inputTriggers', options.inputTriggers ?? { registerSource: vi.fn(() => () => {}) })
    return ctx
  }

  it('exposes every panel action through the injected face', () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const heard = { transcribe: vi.fn(async () => ({ ok: true as const, value: { text: 'heard' } })) }
    ctx.provide('remote.speech', heard)
    const store = createSnapshotStore<Record<string, BtwPanelEntry>>({})
    const panels = new BtwPanels(ctx, store)
    const face = panels.face()
    const id = 's1' as SessionId
    face.ensure(id)
    face.setQuestion(id, 'draft')
    for (let index = 0; index <= MAX_IMAGE_DRAFTS; index += 1) {
      face.addImage(id, { mediaType: 'image/png', data: 'aGk=', name: `s${String(index)}.png`, url: `blob:${String(index)}` })
    }
    const images = store.getSnapshot()[id]!.images
    expect(images).toHaveLength(MAX_IMAGE_DRAFTS)
    face.removeImage(id, images[0]!.url)
    expect(store.getSnapshot()[id]!.images).toHaveLength(MAX_IMAGE_DRAFTS - 1)
    expect(face.speechReady()).toBe(true)
    void expect(face.transcribe('aGk=', new AbortController().signal)).resolves.toBe('heard')
    face.discard(id, 'missing')
    face.cancel(id, 'missing')
    expect(store.getSnapshot()[id]!.question).toBe('draft')
  })

  it('surfaces speech unavailability and transcription failure', async () => {
    const bare = new Context()
    onTestFinished(async () => { await bare.fiber.dispose() })
    const silent = new BtwPanels(bare, createSnapshotStore<Record<string, BtwPanelEntry>>({}))
    expect(silent.face().speechReady()).toBe(false)
    await expect(silent.face().transcribe('aGk=', new AbortController().signal)).rejects.toThrow('unavailable')
    const failing = new Context()
    onTestFinished(async () => { await failing.fiber.dispose() })
    failing.provide('remote.speech', { transcribe: vi.fn(async () => ({ ok: false as const, error: new Error('engine cold') })) })
    const hoarse = new BtwPanels(failing, createSnapshotStore<Record<string, BtwPanelEntry>>({}))
    await expect(hoarse.face().transcribe('aGk=', new AbortController().signal)).rejects.toThrow('engine cold')
  })

  it('mounts the Remote contribution and the UI together and disposes both', async () => {
    const ctx = mountableCtx()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const disposeRemote = vi.fn(async () => {})
    ;(ctx.get('remote') as { $mount: unknown }).$mount = vi.fn(async () => disposeRemote)
    const dispose = await mountBtw(ctx, {} as never)
    expect(ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(1)
    await dispose()
    expect(disposeRemote).toHaveBeenCalledOnce()
    expect(ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(0)
  })

  it('rolls the Remote contribution back when the UI fails to mount', async () => {
    const ctx = mountableCtx({ locale: {} })
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const disposeRemote = vi.fn(async () => {})
    ;(ctx.get('remote') as { $mount: unknown }).$mount = vi.fn(async () => disposeRemote)
    await expect(mountBtw(ctx, {} as never)).rejects.toThrow()
    expect(disposeRemote).toHaveBeenCalledOnce()
  })

  it('registers the slash source only with a usable sessions face and title fresh per call', async () => {
    const registerSource = vi.fn(() => () => {})
    const ctx = mountableCtx({ inputTriggers: { registerSource } })
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const fiber = ctx.plugin({ inject: [...inject], apply: registerUi })
    await fiber.await()
    expect(registerSource).toHaveBeenCalledOnce()
    const definition = btwTabDefinition(t as never)
    expect(definition.title?.({} as never)).toBe('panel.title')
    await fiber.dispose()
    expect(ctx.slots.entries('sidebar.right.pane.tab')).toHaveLength(0)
  })

  it('skips the slash source when the sessions face cannot resolve addresses', async () => {
    const registerSource = vi.fn(() => () => {})
    const ctx = mountableCtx({ sessions: {}, inputTriggers: { registerSource } })
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const fiber = ctx.plugin({ inject: [...inject], apply: registerUi })
    await fiber.await()
    expect(registerSource).not.toHaveBeenCalled()
    await fiber.dispose()
  })
})

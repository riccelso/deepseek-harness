/** Source-safe lifecycle for the optional side-question Remote and browser UI. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-experimental-api-btw/remote'
import type { BtwExchange } from '@deepseek-ai/dsh-experimental-api-btw/types'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import type { TranslateNS } from '@deepseek-ai/dsh-client-locale/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ClientSessionContext, InputTriggerSource, PickOutcome, SubmitEnvelope } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type { BtwCard, BtwPanelEntry, BtwPanelInjected } from './BtwTabPanel.tsx'
import { MAX_IMAGE_DRAFTS, type BtwImageDraft } from './images.ts'
import { BtwTabPanel } from './BtwTabPanel.tsx'
import { BTW_TAB_ID, BTW_TAB_KIND, btwTabDefinition } from './definition.ts'
import { en, ja, es, fr, de, ru, pt, NS, zh } from './locales.ts'

export const inject = ['remote', 'slots', 'locale', 'sidebarRight', 'sidebarRightTabs']

/** Blank per-session state before the first interaction or history read. */
const BLANK_ENTRY: BtwPanelEntry = Object.freeze({
  question: '', cards: [], dropped: 0, loaded: false, images: [],
})

/** The speech Remote face another bundle may mount; used opportunistically for voice input. */
interface SpeechFace {
  transcribe(request: { readonly audioBase64: string }, signal: AbortSignal): Promise<
    | { ok: true; value: { readonly text: string } }
    | { ok: false; error: Error }
  >
}

/** Collapse one exchange usage record to the card's display total. */
function tokenCount(usage: BtwExchange['usage'] | undefined): { tokens: number } | Record<string, never> {
  if (usage === undefined) return {}
  return { tokens: usage.totalTokens ?? usage.inputTokens + usage.outputTokens }
}

/** Seed one retained Host exchange as a settled card. */
function historyCard(exchange: BtwExchange, index: number): BtwCard {
  return {
    id: `h${String(exchange.at)}-${String(index)}`,
    question: exchange.question,
    status: 'done',
    ...exchange.imageCount === undefined ? {} : { imageCount: exchange.imageCount },
    answer: exchange.answer,
    ...tokenCount(exchange.usage),
  }
}

/** Root-level side-question controller: one panel entry per Session over one snapshot store. */
export class BtwPanels {
  private readonly asks = new Map<string, AbortController>()
  private cardSeq = 0

  constructor(
    private readonly ctx: Context,
    private readonly store: ReturnType<typeof createSnapshotStore<Record<string, BtwPanelEntry>>>,
    private readonly sessions?: SessionsAddressFace,
  ) {}

  /** The injected face for one tab body: the observable plus every panel action. */
  face(): BtwPanelInjected {
    return {
      hooks: { panels: this.store },
      ensure: (sessionId) => { this.ensure(sessionId) },
      setQuestion: (sessionId, text) => { this.patch(sessionId, { question: text }) },
      addImage: (sessionId, draft) => { this.addImage(sessionId, draft) },
      removeImage: (sessionId, url) => { this.removeImage(sessionId, url) },
      speechReady: () => this.speechReady(),
      transcribe: (audio, signal) => this.transcribe(audio, signal),
      ask: (sessionId, question) => { void this.ask(sessionId, question) },
      cancel: (sessionId, cardId) => { this.cancel(sessionId, cardId) },
      discard: (sessionId, cardId) => { this.discard(sessionId, cardId) },
      insertIntoConversation: (sessionId, text) => { this.insertIntoConversation(sessionId, text) },
      clearHistory: (sessionId) => { void this.clearHistory(sessionId) },
    }
  }

  /** Queue one picked image draft in the composer, bounded by the draft cap. */
  addImage(sessionId: SessionId, draft: BtwImageDraft): void {
    const images = this.store.getSnapshot()[sessionId]?.images ?? []
    if (images.length >= MAX_IMAGE_DRAFTS) return
    this.patch(sessionId, { images: [...images, draft] })
  }

  /** Drop one queued image draft and release its preview URL. */
  removeImage(sessionId: SessionId, url: string): void {
    const images = this.store.getSnapshot()[sessionId]?.images ?? []
    const dropped = images.find(image => image.url === url)
    if (dropped !== undefined) URL.revokeObjectURL(dropped.url)
    this.patch(sessionId, { images: images.filter(image => image.url !== url) })
  }

  /** Whether another bundle mounted the speech Remote this tab can transcribe through. */
  speechReady(): boolean {
    return this.speechFace() !== undefined
  }

  /** Transcribe one WAV recording through the opportunistic speech Remote. */
  async transcribe(audio: string, signal: AbortSignal): Promise<string> {
    const speech = this.speechFace()
    if (speech === undefined) throw new Error('btw: speech transcription is unavailable')
    const result = await speech.transcribe({ audioBase64: audio }, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value.text
  }

  /** Resolve the speech Remote another bundle may have mounted; absence is normal. */
  private speechFace(): SpeechFace | undefined {
    // Presence check via get(): the reflect accessor ctx.remote.speech throws
    // "without inject" for a namespace this plugin never declared.
    const key = 'remote.speech' as string & keyof Context
    const face = this.ctx.get(key)
    return face as SpeechFace | undefined
  }

  /** Load one Session's retained history without asking: the restored-tab path. */
  ensure(sessionId: SessionId): void {
    if (this.store.getSnapshot()[sessionId] === undefined) {
      this.patch(sessionId, {})
      void this.refresh(sessionId)
    }
  }

  /** Activate one Session's side questions; a nonempty question is asked immediately. */
  open(sessionId: SessionId, question?: string): void {
    this.patch(sessionId, { ...question === undefined ? {} : { question } })
    void this.refresh(sessionId)
    if (question !== undefined && question.trim().length > 0) void this.ask(sessionId, question)
  }

  /** Cancel one in-flight card; the card settles cancelled and the composer stays free. */
  cancel(sessionId: SessionId, cardId: string): void {
    const abort = this.asks.get(cardId)
    if (abort === undefined) return
    this.asks.delete(cardId)
    abort.abort(new Error('cancelled'))
    this.patchCard(sessionId, cardId, { status: 'cancelled' })
  }

  /** Remove one settled card from this window's list; the Host ring is untouched. */
  discard(sessionId: SessionId, cardId: string): void {
    this.patch(sessionId, {
      cards: (this.store.getSnapshot()[sessionId]?.cards ?? []).filter(card => card.id !== cardId),
    })
  }

  /**
   * Place one answer in the main conversation's composer as a draft. Nothing is
   * submitted: the user decides whether to send.
   */
  insertIntoConversation(sessionId: SessionId, text: string): void {
    const binding = this.sessions?.binding(sessionId)
    if (binding === undefined) return
    const input = binding.ctx.get('conversation')?.input.for(binding.ctx)
    if (input === undefined) return
    input.setDraft(text)
    input.focus()
  }

  private async ask(sessionId: SessionId, question: string): Promise<void> {
    const trimmed = question.trim()
    if (trimmed.length === 0) return
    const cardId = `c${String(this.cardSeq += 1)}`
    const abort = new AbortController()
    this.asks.set(cardId, abort)
    const entry = this.store.getSnapshot()[sessionId]
    const drafts = entry?.images ?? []
    const images = drafts.map(({ url: _url, ...draft }) => draft)
    this.patch(sessionId, {
      question: '',
      images: [],
      cards: [...(entry?.cards ?? []), {
        id: cardId,
        question: trimmed,
        status: 'generating',
        ...images.length === 0 ? {} : { imageCount: images.length },
      }],
    })
    for (const draft of drafts) {
      URL.revokeObjectURL(draft.url)
    }
    try {
      // Always send the images field, empty array included: the descriptor
      // declares it required, and an omitted field fails validation as missing.
      const result = await this.ctx.remote.btw.ask(sessionId, trimmed, images, abort.signal)
      if (abort.signal.aborted) return
      if (!result.ok) {
        this.patchCard(sessionId, cardId, { status: 'error', error: result.error.message })
        return
      }
      this.patchCard(sessionId, cardId, {
        status: 'done',
        answer: result.value.answer,
        ...tokenCount(result.value.usage),
      })
    } catch (error) {
      if (abort.signal.aborted) return
      this.patchCard(sessionId, cardId, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      })
    } finally {
      if (this.asks.get(cardId) === abort) this.asks.delete(cardId)
    }
  }

  /** Read the Host ring once per Session; retained exchanges seed this window's cards. */
  private async refresh(sessionId: SessionId, signal?: AbortSignal): Promise<void> {
    try {
      const result = await this.ctx.remote.btw.history(sessionId)
      if (signal?.aborted || !result.ok) return
      this.store.update((panels) => {
        const current = panels[sessionId]
        if (current?.loaded === true) return
        panels[sessionId] = {
          ...BLANK_ENTRY,
          ...(current === undefined ? {} : current),
          loaded: true,
          dropped: result.value.dropped,
          cards: [...result.value.entries.map(historyCard), ...(current?.cards ?? [])],
        }
      })
    } catch (_error) {
      /* History is advisory restoration; a failed read keeps the last snapshot. */
    }
  }

  private async clearHistory(sessionId: SessionId): Promise<void> {
    try {
      await this.ctx.remote.btw.clear(sessionId)
    } catch (_error) {
      /* Clearing is best-effort; the patch below still drops this window's cards. */
    }
    this.patch(sessionId, { cards: [], dropped: 0 })
  }

  private patchCard(sessionId: SessionId, cardId: string, patch: Partial<BtwCard>): void {
    this.store.update((panels) => {
      const current = panels[sessionId]
      if (current === undefined) return
      panels[sessionId] = {
        ...current,
        cards: current.cards.map(card => card.id === cardId ? { ...card, ...patch } : card),
      }
    })
  }

  private patch(sessionId: SessionId, patch: Partial<BtwPanelEntry>): void {
    this.store.update((panels) => {
      const current = panels[sessionId]
      // A plain Record root keeps immer drafts plugin-free: the browser bundle
      // does not enable the MapSet plugin a Map root would require.
      panels[sessionId] = { ...BLANK_ENTRY, ...(current === undefined ? {} : current), ...patch }
    })
  }

  /** Abort every pending ask and release every preview URL; the plugin fiber is going away. */
  dispose(): void {
    for (const abort of this.asks.values()) abort.abort(new Error('plugin disposed'))
    this.asks.clear()
    for (const entry of Object.values(this.store.getSnapshot())) {
      for (const image of entry.images) URL.revokeObjectURL(image.url)
    }
    this.store.set({})
  }
}

/** The face this source needs from the client sessions service; guarded at registration. */
export interface SessionsAddressFace {
  subagentAddress(id: SessionId): unknown
  /** Retained Session binding whose scope owns the conversation input. */
  binding(id: SessionId): { readonly ctx: Context } | undefined
}

/** Reveals one Session's side-question tab; the mount binds this to the right Sidebar. */
export type BtwReveal = (sessionId: SessionId) => void

/** The '/' source claiming /btw lines: bare reveals the tab, argued reveals and asks. */
export function btwSource(
  t: TranslateNS<typeof NS>,
  sessions: SessionsAddressFace,
  panels: BtwPanels,
  reveal: BtwReveal,
): InputTriggerSource {
  const claimable = (session: ClientSessionContext): boolean => sessions.subagentAddress(session.sessionId) === undefined
  return {
    trigger: '/',
    name: 'btw',
    showGroupTitle: false,
    candidates(session) {
      return Promise.resolve(claimable(session)
        ? [{ name: 'btw', label: t('menu.label'), description: t('menu.description') }]
        : [])
    },
    onPick: () => ({ text: '/btw ' }),
    matchEnter(session, line, _signal, envelope: SubmitEnvelope): Promise<PickOutcome> {
      const trimmed = line.trim()
      if (trimmed !== '/btw' && !trimmed.startsWith('/btw ')) return Promise.resolve(undefined)
      if (!claimable(session)) return Promise.resolve(undefined)
      if (envelope.attachments > 0) throw new Error(t('notice.attachmentsUnsupported'))
      panels.open(session.sessionId, trimmed === '/btw' ? undefined : trimmed.slice('/btw '.length).trim())
      reveal(session.sessionId)
      return Promise.resolve('handled')
    },
  }
}

/** Register the tab type, its body, and the '/btw' source on one client runtime. */
export function registerUi(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'btw: dictionaries')
  const store = createSnapshotStore<Record<string, BtwPanelEntry>>({})
  const sessions = ctx.get('sessions') as SessionsAddressFace | undefined
  const panels = new BtwPanels(ctx, store, sessions)
  ctx.effect(() => () => { panels.dispose() }, 'btw: panels disposal')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: BTW_TAB_ID, locale: NS, inject: () => panels.face(),
  }, BtwTabPanel)), 'btw: tab body')
  const locale = ctx.get('locale')
  if (locale !== undefined) {
    const t = locale.bind(NS)
    ctx.effect(() => ctx.sidebarRightTabs.register(btwTabDefinition(t)), 'btw: tab type')
    const inputTriggers = ctx.get('inputTriggers')
    if (sessions !== undefined && typeof sessions.subagentAddress === 'function' && inputTriggers !== undefined) {
      const reveal: BtwReveal = (sessionId) => { ctx.sidebarRight.openTabIn(sessionId, BTW_TAB_KIND) }
      ctx.effect(() => inputTriggers.registerSource(btwSource(t, sessions, panels, reveal)), 'btw: slash source')
    }
  }
}

/**
 * Mount this experimental namespace without adding it to stable API Remotes.
 * @param ctx - Client runtime owning the Remote, dictionaries, slots, and the right Sidebar.
 * @param contribution - generated side-question Remote definitions.
 * @returns disposer joining UI and Remote withdrawal.
 */
export async function mountBtw(ctx: Context, contribution: TypertRemoteContribution): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(contribution)
  const ui = ctx.inject(['remote.btw', 'slots', 'locale', 'sidebarRight', 'sidebarRightTabs'], registerUi)
  try { await ui } catch (error) { await ui.dispose(); await disposeRemote(); throw error }
  return async () => { await ui.dispose(); await disposeRemote() }
}

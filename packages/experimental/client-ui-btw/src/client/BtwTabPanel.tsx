/**
 * The side-question tab's body: a parallel chat in the right Sidebar that
 * reads the whole conversation and never writes back into it.
 *
 * The transcript scrolls through this window's side-question cards — one per
 * ask, each with its own status — and the composer stays free while cards are
 * in flight, so side questions overlap freely. Nothing here appends to the
 * Session's history: the engine keeps its own per-Session exchange log, and a
 * tab restored by a reload seeds its cards from that log without asking
 * anything new.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Button, MarkdownText, IconCloseOutlineRegular, IconMicrophoneOutlineRegular, IconPaperclipOutlineRegular, IconStopFillRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { MAX_IMAGE_DRAFTS, fileToImageDraft, type BtwImageDraft } from './images.ts'
import { Recording, RecordingError, audioBase64 } from './audio.ts'
import css from './BtwTabPanel.module.css'
import { NS } from './locales.ts'

/** Lifecycle of one side-question card inside this window. */
export interface BtwCard {
  /** Window-local identity; seeded history cards use their exchange timestamp. */
  readonly id: string
  /** Question exactly as asked. */
  readonly question: string
  /** Generating while the fork runs; settled states are terminal for the card. */
  readonly status: 'generating' | 'done' | 'cancelled' | 'error'
  /** Answer text once done. */
  readonly answer?: string
  /** Failure text once errored. */
  readonly error?: string
  /** Images attached to the question, when any were sent. */
  readonly imageCount?: number
  /** Token cost of the answer, when the engine reported one. */
  readonly tokens?: number
}

/** Retained per-session side-question state rendered by one tab body. */
export interface BtwPanelEntry {
  /** Current draft question inside the tab's composer. */
  readonly question: string
  /** This window's cards, oldest first; independent of any in-flight state. */
  readonly cards: readonly BtwCard[]
  /** Count of older exchanges evicted by the Host's retention limit. */
  readonly dropped: number
  /** Whether the Host's retained history was read at least once. */
  readonly loaded: boolean
  /** Image drafts queued in the composer, preview URLs included. */
  readonly images: readonly BtwImageDraft[]
}

/** Host calls injected without exposing a Cordis Context to React. */
export interface BtwPanelInjected {
  /** Per-Session panel entries keyed by Session id; a plain Record root keeps immer plugin-free. */
  hooks: { panels: HostObservable<Readonly<Record<string, BtwPanelEntry>>> }
  /** Load one Session's retained history without asking anything. */
  ensure(sessionId: SessionId): void
  setQuestion(sessionId: SessionId, text: string): void
  ask(sessionId: SessionId, question: string): void
  /** Cancel one in-flight card; it settles cancelled without touching siblings. */
  cancel(sessionId: SessionId, cardId: string): void
  /** Remove one settled card from this window's list. */
  discard(sessionId: SessionId, cardId: string): void
  /** Place one answer in the main conversation's composer as an unsent draft. */
  insertIntoConversation(sessionId: SessionId, text: string): void
  clearHistory(sessionId: SessionId): void
  addImage(sessionId: SessionId, draft: BtwImageDraft): void
  removeImage(sessionId: SessionId, url: string): void
  /** Whether another bundle mounted a speech Remote this tab can transcribe through. */
  speechReady(): boolean
  /** Transcribe one WAV recording; resolves to the recognized text. */
  transcribe(audio: string, signal: AbortSignal): Promise<string>
}

/** Image files carried by one paste event; empty when the paste carries none. */
export function clipboardImageFiles(data: DataTransfer | null | undefined): readonly File[] {
  if (data === undefined || data === null) return []
  const fromItems = [...data.items]
    .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
    .map(item => item.getAsFile())
    .filter((file): file is File => file !== null)
  if (fromItems.length > 0) return fromItems
  // Some clipboard sources populate only the files list.
  return [...data.files].filter(file => file.type.startsWith('image/'))
}

/** Right-Sidebar tab body; framework props supply the Session identity and live tab record. */
export type BtwTabPanelProps = PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<typeof NS> & InjectFace<BtwPanelInjected>

/** Render the side-question chat: every card, and a composer free during flights. */
export function BtwTabPanel({
  sessionId, useTabInfo, usePanels, ensure, setQuestion, ask, cancel, discard, insertIntoConversation,
  clearHistory, addImage, removeImage, speechReady, transcribe, t,
}: BtwTabPanelProps): ReactNode {
  const entry = usePanels(panels => panels[sessionId])
  const { tab } = useTabInfo()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const recordingRef = useRef<Recording | undefined>(undefined)
  const [mic, setMic] = useState<'idle' | 'recording' | 'transcribing'>('idle')
  const [micError, setMicError] = useState<string | undefined>(undefined)
  const [pickError, setPickError] = useState<string | undefined>(undefined)
  const [copiedAt, setCopiedAt] = useState<string | undefined>(undefined)
  // A stable identity keeps MarkdownText's streaming cache across renders.
  const markdownLabels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') },
    footnotes: t('markdown.footnotes'),
  }), [t])
  const missing = entry === undefined
  useEffect(() => {
    // A restored tab carries no store entry in this window; loading it here
    // keeps the reload path and the first-open path one code path.
    if (missing) ensure(sessionId)
  }, [missing, sessionId, ensure])
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  useEffect(() => () => { void recordingRef.current?.dispose() }, [])

  const pickImages = (files: readonly File[] | null): void => {
    setPickError(undefined)
    if (files === null) return
    void (async () => {
      for (const file of files) {
        try {
          addImage(sessionId, await fileToImageDraft(file))
        } catch (error) {
          setPickError(error instanceof Error ? error.message : String(error))
        }
      }
    })()
  }

  const startMic = (): void => {
    setMicError(undefined)
    const recording = new Recording()
    recordingRef.current = recording
    void recording.start().then(() => { setMic('recording') }, (error: unknown) => {
      recordingRef.current = undefined
      setMicError(error instanceof RecordingError ? error.kind : String(error))
    })
  }

  const stopMic = (): void => {
    const recording = recordingRef.current
    if (recording === undefined) return
    recordingRef.current = undefined
    setMic('transcribing')
    const abort = new AbortController()
    void recording.stop(120)
      .then(bytes => transcribe(audioBase64(bytes), abort.signal))
      .then((text) => {
        const recognized = text.trim()
        if (recognized.length > 0) {
          setQuestion(sessionId, entry?.question === undefined || entry.question.length === 0 ? recognized : `${entry.question}
${recognized}`)
        }
      })
      .catch((error: unknown) => {
        setMicError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => { setMic('idle') })
  }
  const cards: readonly BtwCard[] = entry?.cards ?? []
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight })
  }, [cards.length, cards.at(-1)?.status, cards.at(-1)?.answer])
  useEffect(() => {
    // Auto-grow the composer with the draft, capped by the stylesheet.
    const input = inputRef.current
    if (input === null) return
    input.style.height = 'auto'
    input.style.height = String(Math.min(input.scrollHeight, 160)) + 'px'
  }, [entry?.question])

  if (entry === undefined) {
    return <div className={css.root} data-btw-panel="">
      <div className={css.emptyWrap}><p className={css.empty}>{t('panel.empty')}</p></div>
      <div className={css.composer}>
        <input className={css.input} placeholder={t('panel.placeholder')} readOnly />
      </div>
    </div>
  }

  const empty = cards.length === 0
  const toolbar = cards.length > 0
    ? <div className={css.toolbar}>
      <Button type="button" variant="ghost" size="sm" onClick={() => { clearHistory(sessionId) }}>{t('panel.clear')}</Button>
    </div>
    : null
  const onPickedFiles = (event: { target: { files: FileList | null; value: string } }): void => {
    pickImages(event.target.files === null ? null : Array.from(event.target.files))
    event.target.value = ''
  }
  const submit = (): void => { ask(sessionId, entry.question) }
  const copy = (card: BtwCard): void => {
    if (card.answer === undefined) return
    void navigator.clipboard.writeText(card.answer).then(() => {
      setCopiedAt(card.id)
      window.setTimeout(() => { setCopiedAt(undefined) }, 1500)
    })
  }

  return <div className={css.root} data-btw-panel=""
    onPaste={(event) => {
      // Any paste inside the tab may carry an image; text pastes pass through.
      const files = clipboardImageFiles(event.clipboardData)
      if (files.length === 0) return
      event.preventDefault()
      pickImages(files)
    }}>
    {toolbar}
    {empty
      ? <div className={css.emptyWrap}><p className={css.empty}>{t('panel.empty')}</p></div>
      : <div className={css.transcript} ref={transcriptRef}>
        {entry.dropped > 0 && <p className={css.evicted}>{t('panel.evicted', { count: String(entry.dropped) })}</p>}
        {cards.map(card => <div key={card.id} className={css.exchange}>
          <p className={css.question}>{card.question}{(card.imageCount ?? 0) > 0
            && <span className={css.imageNote}> {t('panel.images', { count: String(card.imageCount) })}</span>}</p>
          {card.status === 'generating' && <div className={css.actions}>
            <p className={css.pending} role="status">{t('panel.pending')}</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => { cancel(sessionId, card.id) }}>{t('panel.cancel')}</Button>
          </div>}
          {card.status === 'cancelled' && <div className={css.actions}>
            <p className={css.cancelled}>{t('panel.cancelled')}</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => { discard(sessionId, card.id) }}>{t('panel.discard')}</Button>
          </div>}
          {card.status === 'error' && <div className={css.answerBlock}>
            <p className={css.error} role="alert">{card.error}</p>
            <Button type="button" variant="ghost" size="sm" onClick={() => { discard(sessionId, card.id) }}>{t('panel.discard')}</Button>
          </div>}
          {card.status === 'done' && card.answer !== undefined && <div className={css.answerBlock}>
            <MarkdownText text={card.answer} labels={markdownLabels} variant="compact" />
            <p className={css.meta}>{card.tokens === undefined ? '' : t('panel.tokens', { count: String(card.tokens) })}</p>
            <div className={css.actions}>
              <Button type="button" variant="ghost" size="sm" onClick={() => { copy(card) }}>
                {t(copiedAt === card.id ? 'panel.copied' : 'panel.copy')}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => {
                if (card.answer !== undefined) insertIntoConversation(sessionId, card.answer)
              }}>
                {t('panel.insert')}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => { discard(sessionId, card.id) }}>{t('panel.discard')}</Button>
            </div>
          </div>}
        </div>)}
      </div>}
    {entry.images.length > 0 && <div className={css.thumbs}>
      {entry.images.map(image => <span key={image.url} className={css.thumbWrap}>
        <img className={css.thumb} src={image.url} alt={image.name ?? image.mediaType} />
        <Button type="button" variant="ghost" size="sm" className={css.thumbRemove} aria-label={t('panel.removeImage')}
          onClick={() => { removeImage(sessionId, image.url) }}><IconCloseOutlineRegular size={12} /></Button>
      </span>)}
    </div>}
    {pickError !== undefined && <p className={css.pickError} role="alert">{pickError}</p>}
    {micError !== undefined && <p className={css.pickError} role="alert">{t('panel.mic.error')}: {micError}</p>}
    {mic === 'transcribing' && <p className={css.pending} role="status">{t('panel.mic.busy')}</p>}
    <div className={css.composer}>
      <input ref={fileRef} type="file" multiple hidden accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={onPickedFiles} />
      <Button type="button" variant="ghost" size="sm" aria-label={t('panel.attach')} disabled={entry.images.length >= MAX_IMAGE_DRAFTS}
        onClick={() => { fileRef.current?.click() }}><IconPaperclipOutlineRegular size={14} /></Button>
      {speechReady() && (mic === 'recording'
        ? <Button type="button" variant="ghost" size="sm" aria-label={t('panel.mic.stop')} onClick={stopMic}><IconStopFillRegular size={14} /></Button>
        : <Button type="button" variant="ghost" size="sm" aria-label={t('panel.mic.record')} disabled={mic !== 'idle'}
          onClick={startMic}><IconMicrophoneOutlineRegular size={14} /></Button>)}
      <textarea ref={inputRef} className={css.input} value={entry.question} placeholder={t('panel.placeholder')} rows={1}
        onChange={(event) => { setQuestion(sessionId, event.target.value) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() }
          else if (event.key === 'Escape') { event.preventDefault(); tab.actions.close() }
        }} />
      <Button type="button" variant="outline" size="sm" disabled={entry.question.trim().length === 0} onClick={submit}>{t('panel.ask')}</Button>
    </div>
  </div>
}

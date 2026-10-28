/** Floating find-in-conversation bar over the Chat panel. */
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { IconChevronDownOutlineRegular, IconChevronUpOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { UseChat } from '../contract/slots.ts'
import type { ChatFlowSlotProps } from '../contract/slots.ts'
import type { SavedChatFind } from '../contract/slots.ts'
import { clearFindHighlights, paintFindHighlights, revealFindRow } from './find-dom.ts'
import { compileFindPattern, findMatches } from './find-index.ts'
import css from './FindBar.module.css'

/** One rendered find bar's dependencies, provided by the Chat view. */
export interface FindBarProps {
  readonly useChat: UseChat
  readonly containerRef: RefObject<HTMLElement | null>
  readonly sessionId: SessionId
  readonly t: ChatFlowSlotProps['t']
  readonly close: () => void
  /** @returns the Session's last find state, when saved. */
  readonly readSaved: (sessionId: SessionId) => SavedChatFind | undefined
  /** Persist the Session's find state for the next open. */
  readonly saveSaved: (sessionId: SessionId, state: SavedChatFind) => void
}

/**
 * Render the conversation find bar: live count over the projected Node order,
 * keyboard navigation with revelation of collapsed groups, case and regex
 * toggles with inline validation, and highlight paint through the CSS Custom
 * Highlight API. The term and options persist per Session across closes.
 * @param props - Chat projection hooks, container ref, and persistence face.
 * @returns the bar, or null before the view mounts its container.
 */
export function FindBar({ useChat, containerRef, sessionId, t, close, readSaved, saveSaved }: FindBarProps) {
  const [saved] = useState(() => readSaved(sessionId))
  const [term, setTerm] = useState(saved?.term ?? '')
  const [caseSensitive, setCaseSensitive] = useState(saved?.caseSensitive ?? false)
  const [regex, setRegex] = useState(saved?.regex ?? false)
  const [index, setIndex] = useState(saved?.index ?? 0)
  const inputRef = useRef<HTMLInputElement>(null)
  const order = useChat(snapshot => snapshot.order)
  const nodeStore = useChat(snapshot => snapshot.nodes)
  const options = useMemo(() => ({ caseSensitive, regex }), [caseSensitive, regex])
  const pattern = useMemo(() => compileFindPattern(term, options), [term, options])
  const matches = useMemo(() => findMatches(order, key => nodeStore.get(key), pattern),
    [order, nodeStore, pattern])
  const current = matches.length === 0 ? 0 : Math.min(index, matches.length - 1)
  const activeNodeKey = matches[current]?.nodeKey
  useEffect(() => {
    inputRef.current?.focus()
  }, [])
  useEffect(() => {
    paintFindHighlights(containerRef.current ?? document.body, term, options, activeNodeKey)
    saveSaved(sessionId, { term, caseSensitive, regex, index: current })
  }, [containerRef, term, options, caseSensitive, regex, activeNodeKey, current, matches.length, saveSaved, sessionId])
  useEffect(() => clearFindHighlights, [])
  const navigate = (direction: 1 | -1): void => {
    if (matches.length === 0) return
    const next = (current + direction + matches.length) % matches.length
    setIndex(next)
    const row = revealFindRow(matches[next]?.nodeKey ?? '')
    row?.scrollIntoView({ block: 'center' })
  }
  const count = pattern.kind === 'invalid' || term === ''
    ? ''
    : matches.length === 0 ? t('find.noResults') : `${current + 1}/${matches.length}`
  return (
    <div className={css.bar} data-chat-find role="search">
      <input
        ref={inputRef}
        className={css.input}
        type="text"
        value={term}
        placeholder={t('find.placeholder')}
        aria-label={t('find.placeholder')}
        data-find-invalid={pattern.kind === 'invalid' || undefined}
        onChange={(event) => { setTerm(event.target.value); setIndex(0) }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'F3') {
            event.preventDefault()
            navigate(event.shiftKey ? -1 : 1)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            close()
          }
        }}
      />
      <span className={css.count} data-find-status={count === '' ? undefined : count === t('find.noResults') ? 'empty' : 'ok'}>{count}</span>
      {pattern.kind === 'invalid' && <span className={css.invalid} role="alert">{t('find.invalidRegex')}</span>}
      <button
        type="button"
        className={css.toggle}
        aria-pressed={caseSensitive}
        aria-label={t('find.matchCase')}
        data-find-case={caseSensitive || undefined}
        onClick={() => { setCaseSensitive(value => !value); setIndex(0) }}
      >Aa</button>
      <button
        type="button"
        className={css.toggle}
        aria-pressed={regex}
        aria-label={t('find.useRegex')}
        data-find-regex={regex || undefined}
        onClick={() => { setRegex(value => !value); setIndex(0) }}
      >.*</button>
      <button type="button" className={css.control} aria-label={t('find.previous')} onClick={() => { navigate(-1) }}>
        <IconChevronUpOutlineRegular />
      </button>
      <button type="button" className={css.control} aria-label={t('find.next')} onClick={() => { navigate(1) }}>
        <IconChevronDownOutlineRegular />
      </button>
      <button type="button" className={css.control} aria-label={t('find.close')} onClick={close}>{t('find.escKey')}</button>
    </div>
  )
}

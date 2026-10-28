/** DOM helpers for conversation find: highlight ranges and row revelation. */
import type { FindOptions } from './find-index.ts'
import { compileFindPattern } from './find-index.ts'

/** Registry names of the two highlight layers. */
const FIND_HIGHLIGHT = 'dsh-chat-find'
const FIND_HIGHLIGHT_ACTIVE = 'dsh-chat-find-active'

/**
 * Collect the text Nodes of one element in document order.
 * @param root - element to walk.
 * @returns its text Nodes.
 */
function textNodesOf(root: Element): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let current = walker.nextNode(); current !== null; current = walker.nextNode()) {
    nodes.push(current as Text)
  }
  return nodes
}

/**
 * Build DOM Ranges for every rendered occurrence of one term inside a row.
 * @param row - the Node row element.
 * @param term - raw user input.
 * @param options - case sensitivity and regex mode.
 * @returns one Range per rendered occurrence, in document order.
 */
export function rowFindRanges(row: Element, term: string, options: FindOptions): readonly Range[] {
  const pattern = compileFindPattern(term, options)
  if (pattern.kind !== 'text') return []
  const ranges: Range[] = []
  for (const node of textNodesOf(row)) {
    const text = node.data
    if (text === '') continue
    pattern.matcher.lastIndex = 0
    let found = pattern.matcher.exec(text)
    while (found !== null && found[0].length > 0) {
      const range = document.createRange()
      range.setStart(node, found.index)
      range.setEnd(node, found.index + found[0].length)
      ranges.push(range)
      pattern.matcher.lastIndex = found.index + found[0].length
      found = pattern.matcher.exec(text)
    }
  }
  return ranges
}

/**
 * Publish the find highlight layers over the rendered rows of one container.
 * Browsers without the CSS Custom Highlight API keep count and navigation
 * without painting.
 * @param container - conversation content element.
 * @param term - raw user input.
 * @param options - case sensitivity and regex mode.
 * @param activeNodeKey - Node key whose occurrences take the active layer.
 */
export function paintFindHighlights(
  container: Element,
  term: string,
  options: FindOptions,
  activeNodeKey: string | undefined,
): void {
  const view = container.ownerDocument.defaultView
  if (view === null) return
  // The registry ships behind the CSS Custom Highlight API; engines without
  // it have no `CSS.highlights` at all even though the lib types it as present.
  const registry = (view as { readonly CSS?: { readonly highlights?: HighlightRegistry } }).CSS?.highlights
  if (registry === undefined || typeof Highlight === 'undefined') return
  const inactive: AbstractRange[] = []
  const active: AbstractRange[] = []
  if (term !== '') {
    for (const row of container.querySelectorAll('[data-chat-node-key]')) {
      const ranges = rowFindRanges(row, term, options)
      const layer = row.getAttribute('data-chat-node-key') === activeNodeKey ? active : inactive
      for (const range of ranges) layer.push(range)
    }
  }
  registry.set(FIND_HIGHLIGHT, new Highlight(...inactive))
  registry.set(FIND_HIGHLIGHT_ACTIVE, new Highlight(...active))
}

/**
 * Remove both find highlight layers; closing the bar never leaves paint behind.
 */
export function clearFindHighlights(): void {
  const view = document.defaultView
  if (view === null) return
  const registry = (view as { readonly CSS?: { readonly highlights?: HighlightRegistry } }).CSS?.highlights
  if (registry === undefined) return
  registry.delete(FIND_HIGHLIGHT)
  registry.delete(FIND_HIGHLIGHT_ACTIVE)
}

/**
 * Reveal one Node row: expand an enclosing aggregate Tool run and process
 * group when their disclosures are closed, then report the row element.
 * @param nodeKey - Chat Node key.
 * @returns the revealed row element, when mounted.
 */
export function revealFindRow(nodeKey: string): Element | null {
  const row = document.querySelector(`[data-chat-node-key="${nodeKey}"]`)
  if (row === null) return null
  let scope: Element | null = row
  while (scope !== null) {
    const group: Element | null = scope.closest('[data-tool-group], [data-step-process]')
    if (group === null) break
    const header = group.querySelector('button[aria-expanded="false"]')
    if (header !== null) (header as HTMLElement).click()
    scope = group.parentElement
  }
  return row
}

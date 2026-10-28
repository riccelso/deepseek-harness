// @vitest-environment jsdom
/** DOM find helpers: highlight ranges, paint guards, and row revelation. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearFindHighlights, paintFindHighlights, revealFindRow, rowFindRanges } from '../src/client/chat/find-dom.ts'

afterEach(() => {
  document.body.innerHTML = ''
})

function conversation(): Element {
  document.body.innerHTML = `
    <div id="container">
      <div data-chat-node-key="a"><p>find me here and find me again</p></div>
      <div data-tool-group="edit" id="group">
        <button aria-expanded="false" id="groupHeader"></button>
        <div data-chat-node-key="b"><span>hidden find text</span></div>
      </div>
    </div>`
  return document.getElementById('container') as Element
}

describe('rowFindRanges', () => {
  it('builds one range per rendered occurrence across text nodes', () => {
    const container = conversation()
    const row = container.querySelector('[data-chat-node-key="a"]') as Element
    const ranges = rowFindRanges(row, 'find', { caseSensitive: false, regex: false })
    expect(ranges).toHaveLength(2)
    expect(ranges[0]?.toString()).toBe('find')
    expect(ranges[1]?.toString()).toBe('find')
  })

  it('escapes literal terms and honors case sensitivity', () => {
    const container = conversation()
    const row = container.querySelector('[data-chat-node-key="a"]') as Element
    expect(rowFindRanges(row, 'me.', { caseSensitive: false, regex: false })).toHaveLength(0)
    expect(rowFindRanges(row, 'FIND', { caseSensitive: false, regex: false })).toHaveLength(2)
    expect(rowFindRanges(row, 'FIND', { caseSensitive: true, regex: false })).toHaveLength(0)
  })
})

describe('paintFindHighlights', () => {
  it('is a no-op without the CSS Custom Highlight API', () => {
    const container = conversation()
    expect(() => { paintFindHighlights(container, 'find', { caseSensitive: false, regex: false }, 'a') }).not.toThrow()
  })

  it('clearing never throws regardless of support', () => {
    expect(() => { clearFindHighlights() }).not.toThrow()
  })
})

describe('revealFindRow', () => {
  it('expands enclosing aggregate groups and returns the row', () => {
    const container = conversation()
    const header = document.getElementById('groupHeader') as HTMLButtonElement
    const click = vi.spyOn(header, 'click')
    const row = revealFindRow('b')
    expect(row).toBe(container.querySelector('[data-chat-node-key="b"]'))
    expect(click).toHaveBeenCalled()
  })

  it('returns null for an unmounted row', () => {
    conversation()
    expect(revealFindRow('missing')).toBeNull()
  })
})

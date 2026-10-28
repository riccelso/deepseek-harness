# Agent Note: Conversation find indexes the projection, highlights the DOM

Status: implemented

English | [中文](2026-10-28-conversation-find-bar.zh.md)

## Problem

The Web client searches across sessions but not inside the visible transcript. Locating an earlier term in a long conversation required scrolling or the browser's own page find, which cannot see rows hidden behind collapsed process groups and knows nothing of the conversation's node order. A find feature must count and order matches over content the projection knows — including collapsed rows — while its visual layer can only paint what is rendered, and it must not mutate message content, selection, or the persisted transcript.

## Decision

### The index is non-DOM and content-complete

`find-index.ts` extracts one searchable text per Chat Node (user/steering/context content, assistant text and reasoning, tool name/arguments/result text, command rows, turn errors) and caches it per Node object. Count, order, and navigation derive from matches over the projected node order; hidden and collapsed rows stay searchable because visibility is a presentation fact. Streaming updates re-search only what changed, since unchanged Nodes keep their cached extraction.

### Highlights are an overlay through the CSS Custom Highlight API

Painting builds DOM ranges over the rendered rows of the conversation container and registers two highlight layers (`dsh-chat-find`, `dsh-chat-find-active`) — content, selection, and the transcript are never mutated. Browsers without the API keep count and navigation without paint. The layer rules live in `ui-theme`'s `find-highlight.css` as a global sheet; text color stays inherited so contrast rides the theme's label tokens.

### Navigation reveals before it scrolls

Moving to a match first expands any enclosing collapsed disclosure (aggregate tool runs, process groups) by clicking their headers, then scrolls the row into view — the collapsed-group analogue of desvirtualization in a list that does not virtualize.

### One open flag, per-Session persistence

The bar's open state is a single plugin-scope store driven by the optional `shortcuts` service (`chat.find.open`: `primary+F` on Desktop, `primary+alt+F` on Web — the unmodified chord stays with the browser's page find, matching the Settings binding policy). Term, options, and position persist per Session in the apply closure and restore on reopen; Escape closes and clears the paint.

## Consequences

- Count and painted highlights can differ when rendered text omits index text (for example truncated previews); the count owns navigation, the paint owns only what is visible.
- The DOM revelation is a best-effort walk over disclosure headers, so a custom renderer that hides rows by other means simply does not scroll.

## Alternatives considered

- **DOM-based search (`window.find` or scanning rendered text)**: cannot count or navigate into collapsed rows, and fights virtualization instead of embracing the projection.
- **`<mark>` wrapping in message renderers**: mutates rendered content, breaks selection semantics, and spreads matching logic into every renderer.
- **Storing find state in the Chat store**: the store is Session-owned conversation state; find state is view-local and ephemeral, so it lives in the apply closure with the open flag.

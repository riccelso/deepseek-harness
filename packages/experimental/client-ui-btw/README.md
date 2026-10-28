---
description: "Browser half of /btw: the '/' source claiming the line, the right-Sidebar tab with markdown answers, image attachments, and voice transcription."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-btw

English | [中文](README.zh.md)

## Summary

This browser half registers the `btw` '/' source and the side-question tab in the right Sidebar. Typing `/btw question` and pressing Enter claims the whole line — nothing is submitted — and reveals the tab as a parallel chat; bare `/btw` reveals it with the composer empty. Every ask is one card with its own status — generating (cancellable), cancelled, error, or done with token cost, copy, insert-as-draft, and discard — and several asks run concurrently over a composer that stays usable. Answers render as markdown; the composer attaches images and records voice questions when a speech Remote is mounted.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

Load through the [btw bundle](../btw-bundle/README.md). This window's cards render in one scrolling transcript — questions as bubbles, markdown answers with per-card actions — above a fixed composer with image attach (queued thumbnails, sent as admitted attachments) and an opportunistic microphone that transcribes into the draft; Escape closes the tab, Enter asks, and a main-draft `/btw` line carrying attachments is refused with a notice while the draft stays intact. A reload seeds the cards from the engine's retained history; cancel and discard are window-local and never touch the Host ring.

## Understand the implementation

`mount.ts` mounts the [api-btw](../api-btw/README.md) Remote contribution, keeps one panel entry per Session in a snapshot store, registers the '/' source (subagent sessions are skipped), and registers the right-Sidebar tab type plus its keyed body. The source's `matchEnter` returns `handled` after opening the panel state and revealing the tab, so the submit machine clears the draft without sending. Each ask appends a card driven by its own AbortController — cancel marks the card cancelled and stops only that fork — and `insertIntoConversation` resolves the Session binding's conversation input to set the draft and focus the composer.

## Further Exploration

The answering engine is [btw](../btw/README.md).

## Dev Note

The entry imports the generated Remote contribution; Web replays exercise the built entry, and source tests cover the slash source.

## Model Experience

None, as this package never enters the model context; a claimed /btw line never becomes a prompt.

#### KV Cache effect

None. Opening or asking from the panel adds no Session request; the answering call is the engine's, not the Session's.

## Known Limitations and Deferred Work

- Answers are single-shot (no streaming).
- The tab keeps no per-Session keyboard history.
- Cards are window-local; only completed exchanges survive a reload, seeded from the Host ring.
- The microphone appears only when another bundle mounts a speech Remote (the voice-input bundle); images ride the base attachment store.

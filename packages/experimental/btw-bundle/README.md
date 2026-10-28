---
description: "Optional bundle composing the /btw side-question engine, Remote, and browser tab; answers come from a tool-less fork of the conversation."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-btw-bundle

English | [中文](README.zh.md)

## Summary

This optional bundle composes [btw](../btw/README.md), [api-btw](../api-btw/README.md), and [client-ui-btw](../client-ui-btw/README.md): `/btw <question>` answers from the current conversation in a right-Sidebar tab that never enters the Session log.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

Enable this bundle on the Plugins page. Type `/btw <question>` and press Enter — the line is claimed, nothing is submitted, and the right Sidebar reveals the side-question tab with the answer rendered as markdown. Bare `/btw` reveals the tab on its newest exchange. Every ask runs as its own card: it can be cancelled in flight, several run at once, and a finished card shows its token cost and offers `Insert into conversation`, which places the answer in the main composer as an unsent draft. The tab's composer attaches images to the question (a vision-less route fails that ask with the fork's error) and transcribes recorded voice into the draft when a speech-capable bundle is also installed. The engine's `provider` and `model` pin the answering child's route; omit both to inherit each Session's own model.

## Understand the implementation

`cordis.patch.yml` inserts the three runtime rows with the engine's default policy (1024 output tokens, 120 s deadline, 20 retained exchanges). The engine forks through the composed subagent runtime; the answering child inherits the conversation and runs with every global tool denied.

## Further Exploration

Each member package documents its half; `docs/DETAIL.md` is the user-facing detail page.

## Dev Note

The icon is an original speech-bubble question mark; no bundled fonts or third-party assets.

## Model Experience

None, as this bundle never enters the parent Session's context: side content reaches neither its context nor its log, and the answering fork child runs its own turn.

#### KV Cache effect

None for the parent Session's request stream. The fork child re-sends the inherited prefix on its own first request and never touches the Session's prompt cache.

## Known Limitations and Deferred Work

- Answers are single-shot; there is no streaming.
- Retention is in-memory; a Host restart clears it (the durable fork child keeps its own log).
- The Session's agent must be resident to fork; a disposed agent refuses side questions.
- Concurrent asks share the subagent capacity.

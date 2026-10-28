---
description: "Side-question engine: one tool-less fork child answering from a Session's inherited conversation, with optional admitted images."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-btw

English | [中文](README.zh.md)

## Summary

This Service Definition answers one `/btw` side question about a Session by forking that Session's resident agent with every global tool denied. The fork child inherits the conversation's completed-turn prefix, so its answer uses only what the Session already contains. It never submits to the parent Agent and appends no message or tool result to the parent Session log; each exchange lives in an in-memory per-Session ring while the child's own log is an ordinary durable child Session.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

Load through the [btw bundle](../btw-bundle/README.md). The Session's agent must be resident (idle is fine): the fork inherits its origin, lineage, and route. `provider` and `model` (set together) override the child's route; when both are omitted the child follows the parent agent's options. `maxOutputTokens` caps the answering turn, `timeoutMs` bounds the whole exchange, `historyLimit` retains exchanges per Session, and `questionMaxLength` rejects oversized questions before any fork starts.

## Understand the implementation

`ask` resolves the parent agent through `agents`, admits encoded images through the attachment store's batch limits, and starts one `fork` activation through `subagents` with `toolFilter: { allow: [] }` (every global tool denied) and caller delivery. The child's user prompt frames the answering instruction, the retained earlier exchanges (they are not part of the conversation), the question, and the admitted images. The activation's result supplies the text answer; the child Session's last usage-bearing assistant message and last request header supply the card's token cost and route, read through `sessionQuery` as advisory decoration. Caller cancellation or the deadline disposes the activation, which stops the child; the ring records only successful exchanges.

## Further Exploration

The Remote surface over this engine is [api-btw](../api-btw/README.md); the browser half is [client-ui-btw](../client-ui-btw/README.md).

## Dev Note

The prompt frame and accounting derivation are pure and exported for tests; the service owns no Session handle beyond one disposed child observation per ask. The parent Session gains only the subagent catalog fact naming the child — never the question or answer.

## Model Experience

None, as this package never enters the parent Session's context: the answering fork child runs its own Agent turn on its own request stream, and the parent's next request is unchanged.

#### KV Cache effect

None for the parent Session's cache. The fork child re-sends the inherited prefix on its own first request and never warms or reuses the parent's prompt cache.

## Known Limitations and Deferred Work

- The ring is in-memory; a Host restart discards it. The child Session itself is durable, so the exchange content survives only there, never in the parent log.
- Answers are single-shot; streaming is deferred.
- Images are admitted but never replayed into the earlier-question frame; only a count marker is.
- Concurrent side questions share the subagent capacity (`maxActiveSubagents`); beyond it, an ask is rejected until a slot frees.
- The parent log records one `subagent/catalog` fact per fork (id and fixed label only, no side content).

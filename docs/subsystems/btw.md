# Side questions

English | [中文](btw.zh.md)

The `/btw` side-question capability owned by [`@deepseek-ai/dsh-experimental-btw`](../../packages/experimental/btw/README.md) and exposed to browsers through [`@deepseek-ai/dsh-experimental-api-btw`](../../packages/experimental/api-btw/README.md). A side question answers from what a Session already contains: the engine forks the Session's resident agent with every global tool denied, so the answering child inherits the conversation's completed-turn prefix and runs one tool-less turn. Exchange and retention fields are owned by the [engine README](../../packages/experimental/btw/README.md); the browser tab is [client-ui-btw](../../packages/experimental/client-ui-btw/README.md).

## Isolation guarantees

The fork child is an ordinary durable child Session; the side exchange never reaches the parent. The parent Session's log gains no `user/message` or `tool/result` from an ask — only the standard `subagent/catalog` fact naming the child (id and a fixed label, never the question or answer), and the parent's next model request is byte-identical to one asked without side questions. Retained exchanges live in an in-memory per-Session ring on the Host; a reload of the browser restores them, a Host restart discards them.

## Service behavior

`ctx.btw.ask(sessionId, question, signal, images?)` resolves the parent agent (it must be resident; idle is fine), admits images through the attachment store, and starts one `fork` activation with `toolFilter: { allow: [] }` and caller delivery. Caller cancellation or the configured deadline disposes the activation, which stops the child. The activation's result text is the answer; the child Session's last usage-bearing assistant message and last request header supply the card's token cost and route as advisory decoration. `ctx.btw.history` reads the ring; `ctx.btw.clear` discards it. The Remote surface `ctx.btwController` mirrors the three operations for browser clients, wrapping ask failures as one stable `btw/ask-failed` RemoteError.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxbtw--btwsidequestions"></a>

### `ctx.btw` — `BtwSideQuestions`

The side-question engine. Forks a Session's resident agent with every global tool denied, resolves the answer from the child activation's result, and retains the exchanges of every addressed Session in memory.

```ts cordis-catalog
/**
 * Answer one side question by forking the Session's resident agent with
 * every global tool denied.
 * @param sessionId - Session the question is about; its agent must be resident.
 * @param question - trimmed side question.
 * @param signal - caller cancellation; aborts the fork child and discards the exchange.
 * @param images - canonical-base64 images to admit and attach to the question.
 * @returns the completed exchange, also recorded in this Session's ring.
 * @throws when the question is empty or too long, the Session has no resident
 * agent to fork, an image is rejected by the attachment store, or the fork
 * ends without a text answer.
 */
async ask( sessionId: SessionId, question: string, signal: AbortSignal, images: readonly EncodedImageAttachment[] = [], ): Promise<BtwExchange>

/**
 * Read the retained exchanges of one Session.
 * @param sessionId - Session whose ring is read.
 * @returns retained exchanges in log order and the count of evicted older ones.
 */
history(sessionId: SessionId): BtwHistory

/**
 * Discard every retained exchange of one Session.
 * @param sessionId - Session whose ring is cleared.
 */
clear(sessionId: SessionId): void
```

Types: [EncodedImageAttachment](attachment.md) · [SessionId](core.md)

Source: [`packages/experimental/btw/src/index.ts`](../../packages/experimental/btw/src/index.ts)

<a id="ctxbtwcontroller--btwcontroller"></a>

### `ctx.btwController` — `BtwController`

Side questions never activate or submit to an Agent.

```ts cordis-catalog
/**
 * Answer one side question about a Session from what it already contains.
 * @param sessionId - Session the question is about.
 * @param question - side question exactly as asked.
 * @param images - canonical-base64 images to attach to the question.
 * @param signal - Client cancellation or Remote contribution disposal.
 * @returns the completed exchange without adding a Session event.
 */
@Remote async ask( sessionId: SessionId, question: string, images: readonly EncodedImageAttachment[], signal: AbortSignal, ): Promise<BtwExchange>

/**
 * Read the retained side-question exchanges of one Session.
 * @param sessionId - Session whose retained exchanges are read.
 * @returns retained exchanges in log order and the count of evicted older ones.
 */
@Remote history(sessionId: SessionId): BtwHistory

/**
 * Discard every retained exchange of one Session.
 * @param sessionId - Session whose retained exchanges are cleared.
 */
@Remote clear(sessionId: SessionId): void
```

Types: [EncodedImageAttachment](attachment.md) · [SessionId](core.md)

Source: [`packages/experimental/api-btw/src/index.ts`](../../packages/experimental/api-btw/src/index.ts)
<!-- END GENERATED cordis-surface -->

# Agent Note: Aggregate same-Tool rows as a render-level projection over a summary registry

Status: implemented

English | [中文](2026-10-28-tool-call-grouping-projection.zh.md)

## Problem

Long agent turns produce dozens of consecutive calls of the same tool. Each call rendered as its own row kept the process-group body a wall of repeated cards, even though the surrounding process grouping already collapsed whole turns. Collapsing runs of same-tool calls needs per-tool summary knowledge (paths, diff stats, commands, exit conclusions) that the Chat renderer does not own, and it must not touch the durable Session log or the Conversation group engine, which already occupies the one Group Definition seat per target.

## Decision

### The summary registry lives on `ctx.uiConversation.toolGroups`

`UiConversation` owns a `ToolGroupSummaryRegistry` keyed by wire tool name. A registration supplies a pure `summarize(block, cwd)` per-call summary and a localized `unit(count)` headline. Providers register at plugin load (`ui-tool` registers edit, write, bash, pwsh, read, reusing the terminal-card status parsing and path abbreviation the cards already use); a tool without a provider never aggregates, so custom tools with their own renderers are unaffected by construction. This keeps tool knowledge in the tool package, the conversation vocabulary in `ui-conversation`'s locale namespace, and the rendering in `ui-chat`, without a feature-plugin runtime import.

### The grouping is a pure projection under the group engine, not a second group engine

`planToolRuns` segments one group's member list into single references and same-tool runs at or above the threshold. It runs inside `ChatGroupSeat`'s member rendering, below the `ConversationGroupDefinition` that already owns root ordering. The event log, the group engine's output, and the persisted transcript are untouched: disabling the preference restores the previous one-row-per-call rendering from the same members, and reloading rebuilds identical segments from the same nodes.

### Aggregate disclosure follows a shared default with per-row overrides

Each aggregate row owns an explicit override; rows without one follow a shared `{ all, generation }` store, so one shortcut (`chat.toolGroups.toggleAll`, registered only when the optional `shortcuts` service is present) flips every row at once. Advancing `generation` retires stale overrides. The shortcut registration uses optional `ctx.inject` so compositions without the registry keep every other Chat contribution; requiring it statically broke the assembled web boot.

### Preferences ride the existing Chat settings form

`toolGrouping` (on/off) and `toolGroupThreshold` (2/3/5/10) persist through the `ui-chat` configuration form beside the work-details preferences, with a derived identity-stable snapshot for the flow's member rendering.

## Consequences

- The aggregate row hides per-row actions until expanded; failed calls keep a jump-to-member badge so errors stay reachable while collapsed.
- Web scenario goldens that count visible tool rows must expand process groups first and then aggregate rows (`expandToolGroups` visits matches from the last inward, because opening a row removes it from the `aria-expanded="false"` selector set).
- The registry is boot-time: later registrations do not re-plan already rendered members.

## Alternatives considered

- **A second `ConversationGroupDefinition` for tool runs**: the engine allows one Group Definition per target and `chat` already owns its seat; sub-grouping inside a group body is not an engine concept, so runs would have to become root entries and re-implement ordering the process group already owns.
- **Hard-coded families inside `ui-chat`**: the Chat renderer would have to duplicate the tool-model derivations (command/exit parsing, path abbreviation) that live in `ui-tool`, crossing the feature-plugin boundary the export discipline forbids.
- **Keyed slot for summaries instead of a registry**: the grouping decision must happen before render, but a slot only resolves at render time; a service registry gives the projection a synchronous lookup.

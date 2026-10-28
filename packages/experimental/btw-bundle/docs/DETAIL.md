# Side questions (/btw)

## What it does

Typing `/btw <question>` in the composer answers the question from what the current conversation already contains — messages, replies, and tool results — without submitting anything and without adding a Session event. The exchange appears in a side-question tab of the right Sidebar, a parallel chat that reads the whole conversation and never writes back into it; it keeps the Session's last exchanges for follow-ups and disappears with the Host process.

## How it works

- The client's `btw` '/' source claims the whole `/btw …` line (bare `/btw` reveals the tab empty). A line carrying attachments is refused and the draft stays intact.
- The tab calls the `btw` Remote: `ask` (question plus any attached images), `history`, `clear`; answers render as markdown.
- The composer attaches images (the Session's route must accept vision) and can transcribe a recorded voice question into the draft when a speech-capable bundle is installed.
- The host engine serializes the Session's model-visible history, frames it with the retained exchanges and the question, and dispatches one text-only model call (no tools) on the Session's own route, or the configured `provider`/`model` pair.

## Limits

- Answers are single-shot; there is no streaming and no follow-up turn.
- Retention is in-memory only; a Host restart clears the thread.
- A Session with no request header yet refuses its first side question unless `provider` and `model` are configured.

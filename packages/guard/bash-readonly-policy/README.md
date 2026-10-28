---
description: "Static read-only classification for Bash commands, feeding the approval waterfall: opt-in auto-approval of safe reads and an audit mode that surfaces the verdict."
kind: "package-reference"
---

# @deepseek-ai/dsh-bash-readonly-policy

English | [中文](README.zh.md)

## Summary

Classifies a Bash command line as readonly or unknown from its text alone — a pure port of ZCode's argv/flags/git/gh analysis — and feeds the verdict to the `tools/pre-execute` waterfall: opt-in auto-approval for readonly commands, and an audit mode that keeps asking while showing the verdict. Fail-closed by construction; never a sandbox bypass.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

- Mount it where the approval friction of read-only commands hurts; it ships in `dsh-base`.
- Set `autoApproveReadonly: true` to allow statically readonly commands without asking (the sandbox and every other guard stay active).
- Set `audit: true` to keep asking for readonly commands and show the static-analysis verdict on the approval card.
- Import `classifyBashReadonly` for pure classification without any plugin machinery.

## Understand the implementation

`src/classify.ts` walks one command's parsed segments: every pipeline or list member must classify readonly, and any unsafe analysis, write option, redirect, dynamic word (`$(...)`, backticks, parameter expansion), `git` beside a directory change, or catalog-unknown command fails closed to `unknown` with a stable reason token. `src/analyzer/` is the pinned ZCode analysis library (argv parser over `unbash`, per-command flag tables, git/gh subcommand catalogs, dangerous-word matchers) with local additions (`env` assignments-only rule).

The plugin prepends one `tools/pre-execute` listener: `allow` without delegating for readonly commands under the opt-in; in audit mode it converts a downstream allow into an ask whose `displayReason` carries the verdict. Every decision logs in debug with its reason; class counters (never command text) report on dispose.

## Dev Note

The classification deliberately reads only the command string — no filesystem, no execution — so `git` beside `cd` and every dynamic expansion stay unknown even when a runtime check might clear them. Counters ride the debug logger because session telemetry mirrors session events only.

## Model Experience

### Approval friction only

#### What the model sees

This plugin adds no prompt or schema. With `autoApproveReadonly` on, a readonly auto-approval executes exactly as a manual approval would; with `audit` on, the ask reaches the model through the existing approval card with the verdict in its display reason. Unknown commands flow through the unchanged `tools/pre-execute` pipeline.

#### Token effect

Zero tokens: decisions only remove or keep an approval round-trip; no result content changes.

#### KV Cache effect

None. Approval decisions happen before execution; the request stream and prompt cache are untouched.

## Known Limitations and Deferred Work

- The `env` rule allows assignments and `--` only; `env -i`-style flags are unknown until cataloged.
- Class counters are debug-logged, not exported through session telemetry.
- `pwsh` is out of scope; the catalogs are POSIX Bash.
- The ported `src/analyzer/` internals are excluded from per-branch coverage; behavior is gated through the corpus and property suite (see `vitest.config.ts`).

# Agent Note: Bash readonly policy as a pinned port under the approval waterfall

Status: implemented

English | [中文](2026-10-28-bash-readonly-policy-port.zh.md)

## Problem

Approval friction treats `git status` and `rm -rf` alike unless a deployment widens a preset broadly. ZCode maintains a pure static analyzer (~3.3k lines: argv parsing over `unbash`, per-command flag tables, git/gh subcommand catalogs, dangerous-word matchers) that classifies Bash commands readonly without executing them. Porting it into DSH needed a home that keeps the verdict an input to the approval decision — never a sandbox bypass — and a coverage story for a wholesale upstream copy.

## Decision

### The library is a pinned port under `guard/bash-readonly-policy/src/lib`

The ZCode analyzer files are copied with import-extension adaptation only, plus local additions (`env` assignments-only rule; exactOptionalPropertyTypes fixes). `unbash` is pinned at the upstream-tested `4.0.1`. The public surface is `classifyBashReadonly(command): ReadonlyVerdict`: one command's every pipeline/list segment must classify readonly, and any unsafe analysis, write option, redirect, dynamic word, `git` beside a directory change, or catalog-unknown command fails closed to `unknown` with a stable reason token. The classifier reads the command string only — no filesystem, no execution.

### The verdict feeds `tools/pre-execute`; it never replaces the guards

One prepended listener: with `autoApproveReadonly` (default off — opt-in per deployment, never a global default) a readonly command is allowed without delegating, so askers downstream of it do not add friction; with `audit` a downstream allow becomes an ask whose `displayReason` carries the verdict. Unknown commands always delegate unchanged, and the sandbox, guards, and timeout wrapper stay in the chain for every decision.

### Coverage gates behavior, not upstream internals

`src/lib/**` is excluded from per-branch coverage with the reason recorded in `vitest.config.ts`: the corpus and property suite (ported ZCode cases plus DSH additions, 200+ commands, zero false negatives over the write vocabulary under quoting wrappers) gate the observable contract, while per-branch coverage of the port would recreate upstream's own internal test suite. `classify.ts` and `index.ts` remain under the per-file 100% gate.

## Consequences

- `cd` beside `git` stays unknown even though a runtime check could clear it: the string-only contract is the security boundary the corpus proves.
- Class counters ride the debug logger and a dispose report; session telemetry mirrors session events only and has no plugin-counter channel.
- Adding the plugin row to `dsh-base` mounts it in every shipped profile; defaults keep it inert.

## Alternatives considered

- **A fresh, smaller classifier**: loses the battle-tested catalogs and edge cases the port carries; the PRD explicitly requires the port.
- **Presets carrying the opt-in**: presets today hold only sandbox and approval knobs; a plugin Config keeps the policy's toggles with the policy until presets grow a readonly slot.
- **Full per-branch coverage of `src/lib/`**: weeks of upstream test re-porting for no additional behavioral guarantee over the corpus.

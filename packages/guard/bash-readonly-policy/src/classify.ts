/** String-level readonly classification over the ported argv policy library. */
import { analyzeBashCommand, isBashCommandPermissionSafe } from './analyzer/bash-command-parser.ts'
import { evaluateBashReadonlyPolicy, hasKnownBashWriteOption } from './analyzer/bash-readonly-policy.ts'
import { analysisContainsGitAndDirectoryChange } from './analyzer/bash-git-runtime-safety.ts'

/** Fail-closed verdict of one whole Bash command line. */
export type ReadonlyVerdict =
  | { readonly kind: 'readonly'; readonly reason: string }
  | { readonly kind: 'unknown'; readonly reason: string }

/**
 * Classify one Bash command line as readonly or unknown from its text alone,
 * without executing it and without filesystem access. Every segment of a
 * pipeline or list must be readonly for the whole line to be readonly; any
 * unsafe analysis, write option, redirection, dynamic word, or command outside
 * the catalog fails closed to `unknown`.
 * @param command - the complete Bash command line.
 * @returns the verdict with a stable, locale-neutral reason token.
 */
export function classifyBashReadonly(command: string): ReadonlyVerdict {
  const analysis = analyzeBashCommand(command)
  if (!isBashCommandPermissionSafe(analysis)) return { kind: 'unknown', reason: 'unsafe-analysis' }
  if (analysis.commands.length === 0) return { kind: 'unknown', reason: 'empty-command' }
  if (analysisContainsGitAndDirectoryChange(analysis.commands)) {
    return { kind: 'unknown', reason: 'git-with-directory-change' }
  }
  for (const commandPart of analysis.commands) {
    if (hasKnownBashWriteOption(commandPart)) return { kind: 'unknown', reason: `write-option:${commandPart.name}` }
    if (evaluateBashReadonlyPolicy(commandPart) !== true) {
      return { kind: 'unknown', reason: `not-readonly:${commandPart.name}` }
    }
  }
  // The loop returned on every non-readonly command, and the analysis has at
  // least one command, so reaching here means every command was readonly.
  return { kind: 'readonly', reason: 'static-catalog' }
}

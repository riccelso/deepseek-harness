/** Built-in aggregate-row summary providers for the read, write, edit, and shell families. */
import { describe, expect, it } from 'vitest'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { PartialArguments } from '@deepseek-ai/dsh-util-values'
import type { ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { builtinToolGroupSummaries } from '../src/client/tool/tool-group-summaries.ts'

const t = ((key: string, params?: Record<string, unknown>): string =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`) as TranslateNS<'conversation'>

const home = (): string | undefined => undefined

function call(name: string, args: Record<string, unknown>): ToolCallBlock {
  return {
    phase: 'start', callId: 'c1', name, turn: 1, step: 1, time: 0, subCalls: [],
    argsRaw: JSON.stringify(args), args: PartialArguments.fromObject(args),
  }
}

function settled(name: string, args: Record<string, unknown>, result: {
  text?: string
  isError?: boolean
  code?: string
}): ToolResultNode {
  return {
    kind: 'tool-result', seq: 2, time: 0, callId: 'c1', name,
    args: PartialArguments.fromObject(args),
    call: { name, argsRaw: JSON.stringify(args) }, callTime: 0,
    content: result.text === undefined ? [] : [{ type: 'text', text: result.text }],
    isError: result.isError === true,
    ...result.code === undefined ? {} : { error: { name: 'ToolError', code: result.code } },
    subCalls: [],
  }
}

const registrations = builtinToolGroupSummaries(t, home)
const specFor = (toolName: string) => registrations.find(registration => registration.toolName === toolName)?.spec

describe('builtinToolGroupSummaries', () => {
  it('registers the built-in families', () => {
    expect(registrations.map(registration => registration.toolName)).toEqual([
      'edit', 'write', 'bash', 'pwsh', 'read',
    ])
  })

  it('labels each family through its localized unit key', () => {
    expect(specFor('edit')?.unit(14)).toBe('toolGroup.unit.edit:{"count":14}')
    expect(specFor('write')?.unit(2)).toBe('toolGroup.unit.write:{"count":2}')
    expect(specFor('bash')?.unit(8)).toBe('toolGroup.unit.bash:{"count":8}')
    expect(specFor('pwsh')?.unit(3)).toBe('toolGroup.unit.bash:{"count":3}')
    expect(specFor('read')?.unit(30)).toBe('toolGroup.unit.read:{"count":30}')
  })

  it('summarizes an edit with its workspace-relative path and line stats', () => {
    const spec = specFor('edit')
    const running = spec?.summarize(call('edit', {
      file_path: '/w/src/a.ts', old_string: 'one\ntwo', new_string: 'one\nchanged\nadded',
    }), '/w')
    expect(running).toEqual({ label: 'src/a.ts', detail: '+3 −2', status: 'running' })
    const done = spec?.summarize(settled('edit', {
      file_path: '/w/src/a.ts', old_string: 'one\ntwo', new_string: 'one\nchanged\nadded',
    }, { text: 'done' }), '/w')
    expect(done?.status).toBe('ok')
  })

  it('summarizes a write with its added line count', () => {
    const summary = specFor('write')?.summarize(call('write', {
      file_path: '/w/out.md', content: 'a\nb\nc',
    }), '/w')
    expect(summary).toEqual({ label: 'out.md', detail: '+3', status: 'running' })
  })

  it('summarizes a bash call with its command and localized exit conclusion', () => {
    const spec = specFor('bash')
    const failed = spec?.summarize(settled('bash', {
      command: 'pnpm typecheck', description: 'check types',
    }, { text: 'errors\n[exit code: 1]' }), '/w')
    expect(failed).toEqual({
      label: 'pnpm typecheck',
      detail: 'terminal.exitCode:{"code":1}',
      status: 'error',
    })
    const passing = spec?.summarize(settled('bash', {
      command: 'pnpm lint', description: 'lint',
    }, { text: 'ok\n[exit code: 0]' }), '/w')
    expect(passing).toEqual({ label: 'pnpm lint', status: 'ok' })
  })

  it('truncates long commands in the aggregate list', () => {
    const long = 'x'.repeat(80)
    const summary = specFor('bash')?.summarize(call('bash', { command: long, description: 'd' }), undefined)
    expect(summary?.label.length).toBe(48)
    expect(summary?.label.endsWith('…')).toBe(true)
  })

  it('summarizes a read with its path and settled line count', () => {
    const spec = specFor('read')
    const running = spec?.summarize(call('read', { file_path: '/w/src/a.ts' }), '/w')
    expect(running).toEqual({ label: 'src/a.ts', status: 'running' })
    const done = spec?.summarize(settled('read', { file_path: '/w/src/a.ts' }, { text: 'l1\nl2\nl3' }), '/w')
    expect(done).toEqual({ label: 'src/a.ts', detail: '3', status: 'ok' })
  })

  it('falls back to the call id when no argument view is available', () => {
    const summary = specFor('edit')?.summarize({
      phase: 'preparing', callId: 'c9', name: 'edit', turn: 1, step: 1, time: 0, subCalls: [],
      args: new PartialArguments(),
    }, undefined)
    expect(summary?.label).toBe('c9')
    expect(summary?.status).toBe('preparing')
  })

  it('reports stopped calls through the interrupted error code', () => {
    const summary = specFor('read')?.summarize(settled('read', {
      file_path: '/w/src/a.ts',
    }, { isError: true, code: 'interrupted' }), '/w')
    expect(summary?.status).toBe('stopped')
  })
})

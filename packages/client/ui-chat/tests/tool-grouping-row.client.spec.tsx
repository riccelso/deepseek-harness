// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { allowAllAccess, bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ToolGroupingRow, type ToolGroupingRowProps } from '../src/client/settings/ToolGroupingRow.tsx'
import type { ToolGrouping, ToolGroupThreshold } from '../src/chat-settings.ts'
import type { ToolGroupingPreferences } from '../src/client/tool-grouping.ts'
import { en, pt } from '../src/client/locale.ts'

afterEach(cleanup)

function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, phase: 'ready', projectionsBySession: {},
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], pinnedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  }))
}

function noPendingInteraction() {
  return bindSnapshotSelector(createSnapshotStore<SessionStatusSnapshot>(new Map()))
}

// The resource hook the resources plugin merges into GlobalStandardProps; this row reads no address.
const useResource = (() => ({ status: 'none' as const, value: undefined, failure: undefined })) as GlobalStandardProps['useResource']

function mount(preferences: ToolGroupingPreferences = { enabled: true, threshold: 3 }, dictionary: typeof en | typeof pt = en) {
  const source = createSnapshotStore<ToolGroupingPreferences>(preferences)
  const setToolGrouping = vi.fn((grouping: ToolGrouping) => {
    source.set({ ...source.getSnapshot(), enabled: grouping === 'on' })
  })
  const setToolGroupThreshold = vi.fn((threshold: ToolGroupThreshold) => {
    source.set({ ...source.getSnapshot(), threshold })
  })
  const props: ToolGroupingRowProps = {
    usePanelInfo: selector => selector({ activePanelId: null }),
    useSessions: emptySessions(),
    useSessionStatus: noPendingInteraction(),
    useWorkspaces: emptyWorkspaces(),
    useSessionRetainInfo: () => undefined,
    useResource,
    ...allowAllAccess,
    useToolGrouping: bindSnapshotSelector(source),
    setToolGrouping,
    setToolGroupThreshold,
    t: makeTranslate(dictionary),
  }
  render(<ToolGroupingRow {...props} />)
  return { setToolGrouping, setToolGroupThreshold, source, props }
}

describe('ToolGroupingRow', () => {
  it('shows the aggregate-row choice with the threshold selector enabled', () => {
    mount()
    expect(screen.getByText('Tool call grouping')).toBeDefined()
    expect(screen.getByText('Collapse consecutive calls of the same tool into one summary row')).toBeDefined()
    expect(screen.getByRole('button', { name: 'On' })).toBeDefined()
    expect(screen.getByText('Grouping threshold')).toBeDefined()
  })

  it('turns grouping off and hides the threshold selector', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: 'On' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Off' }))
    expect(b.setToolGrouping).toHaveBeenLastCalledWith('off')
    expect(screen.getByRole('button', { name: 'Off' })).toBeDefined()
    expect(screen.queryByText('Grouping threshold')).toBeNull()
    expect(b.setToolGroupThreshold).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Off' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'On' }))
    expect(b.setToolGrouping).toHaveBeenLastCalledWith('on')
    expect(screen.getByText('Grouping threshold')).toBeDefined()
  })

  it('offers the threshold choices and publishes a selection', () => {
    const b = mount()
    const trigger = screen.getByRole('button', { name: '3 calls' })
    fireEvent.click(trigger)
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual([
      '2 calls', '3 calls', '5 calls', '10 calls',
    ])
    fireEvent.click(screen.getByRole('menuitem', { name: '5 calls' }))
    expect(b.setToolGroupThreshold).toHaveBeenLastCalledWith(5)
    expect(b.setToolGrouping).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '5 calls' })).toBeDefined()
  })

  it('follows the mirrored preference and keeps the row while disabled', () => {
    const b = mount({ enabled: false, threshold: 2 })
    expect(screen.getByRole('button', { name: 'Off' })).toBeDefined()
    expect(screen.queryByText('Grouping threshold')).toBeNull()
    act(() => { b.source.set({ enabled: true, threshold: 10 }) })
    expect(screen.getByRole('button', { name: '10 calls' })).toBeDefined()
  })

  it('labels every control in Portuguese', () => {
    mount({ enabled: true, threshold: 3 }, pt)
    expect(screen.getByText('Agrupamento de chamadas de ferramentas')).toBeDefined()
    expect(screen.getByText('Recolhe chamadas consecutivas da mesma ferramenta em uma linha de resumo')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Ativado' })).toBeDefined()
    expect(screen.getByText('Limite de agrupamento')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: 'Ativado' }))
    expect(screen.getByRole('menuitem', { name: 'Desativado' })).toBeDefined()
    fireEvent.pointerDown(document.body)
    fireEvent.click(screen.getByRole('button', { name: '3 chamadas' }))
    expect(screen.getByRole('menuitem', { name: '10 chamadas' })).toBeDefined()
  })
})

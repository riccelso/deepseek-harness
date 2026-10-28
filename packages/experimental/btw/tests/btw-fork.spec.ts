/**
 * AC gate over the REAL fork seam: a side question inherits the conversation,
 * runs with every tool denied, and neither its question nor its answer reaches
 * the parent Session's log or the parent's next model request.
 */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mountWorkingDirectoryFixture } from '../../../subagent/subagent/tests/working-directory-fixture.ts'
import { mountLocalActivations } from '../../../subagent/subagent/tests/local-activation.ts'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as fork from '../../../subagent/subagent-fork-in-process/src/index.ts'
import BtwSideQuestions from '../src/index.ts'

const QUESTION = 'what does landlock mean here?'
const SIDE_ANSWER = 'landlock is the sandbox used by this harness'
const PARENT_TURN = 'parent answer'
const PARENT_NEXT = 'next parent answer'

async function setup(script: ConstructorParameters<typeof MockAdapter>[0]) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await mountLocalActivations(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await mountWorkingDirectoryFixture(ctx)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(fork, { providerName: 'fork' })
  // The engine's accounting read happens after the activation's teardown: in a
  // real host the durable child Session satisfies observeSession; here the
  // live child agent is captured at publication and its Session read later.
  const childSessions = new Map<string, { snapshotEvents(): readonly object[] }>()
  ctx.on('subagent/start', (info) => {
    const agent = ctx.agents.get(info.id)
    if (agent !== undefined) childSessions.set(info.id, agent.session)
  })
  ctx.provide('sessionQuery', {
    observeSession: async (id: string) => {
      const session = childSessions.get(id)
      if (session === undefined) throw new Error('no observable child')
      const events = session.snapshotEvents() as never
      const lease = { events, [Symbol.dispose]: () => {} }
      return { source: 'live', retain: () => lease, ...lease }
    },
  } as never)
  ctx.provide('attachments', {} as never)
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  await ctx.plugin(BtwSideQuestions, {
    maxOutputTokens: 512, timeoutMs: 60000, historyLimit: 3, questionMaxLength: 2000,
  })
  const engine = ctx.get('btw')!
  const parent = await ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  return { adapter, engine, parent }}

describe('dsh-experimental-btw over the real fork', () => {
  it('answers from the inherited conversation without leaking into the parent context', async () => {
    const { adapter, engine, parent } = await setup([
      textResponse(PARENT_TURN), textResponse(SIDE_ANSWER), textResponse(PARENT_NEXT),
    ])
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'fix the login flow' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    const prefixLength = parent.session.snapshotEvents().length

    const exchange = await engine.ask(parent.id, QUESTION, new AbortController().signal)

    // AC-01: the fork inherited the completed conversation and answered from it.
    expect(exchange).toMatchObject({ question: QUESTION, answer: SIDE_ANSWER })
    expect(typeof exchange.usage?.inputTokens).toBe('number')
    expect(typeof exchange.usage?.outputTokens).toBe('number')
    // The answering child is a seeded descendant of the parent.
    expect(adapter.requests).toHaveLength(2)

    // AC-02: the deny-all start filter left the answering request tool-less.
    expect((adapter.requests[1]?.tools ?? []).map(tool => tool.name)).toEqual([])

    // AC-03, log side: the parent log gained no message or tool result and no
    // event payload carries the side exchange.
    const added = parent.session.snapshotEvents().slice(prefixLength)
    expect(added.filter(event => event.type === 'user/message' || event.type === 'tool/result')).toEqual([])
    const serialized = JSON.stringify(added)
    expect(serialized).not.toContain(QUESTION)
    expect(serialized).not.toContain(SIDE_ANSWER)
    expect(engine.history(parent.id).entries).toHaveLength(1)

    // AC-03, request side: the parent's next model request contains neither the
    // question nor the answer.
    parent.followup(createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }))
    await parent.whenIdle()
    expect(adapter.requests).toHaveLength(3)
    const nextRequest = JSON.stringify(adapter.requests[2])
    expect(nextRequest).not.toContain(QUESTION)
    expect(nextRequest).not.toContain(SIDE_ANSWER)
  })
})

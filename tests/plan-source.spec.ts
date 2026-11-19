/** The plan Source: plan files in a local checkout as Triggers from `operator`, their Tickets, and the reply log. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { checkPlans, planKind, planRoot, OPERATOR, type PlanConfig } from '../src/sources/plan.ts'
import { planLog } from '../src/sources/plan-channel.ts'
import type { SourceContext } from '../src/sources/host.ts'
import { key } from '../src/core/index.ts'
import { startRuntime, type Host } from './fixtures/host.ts'

let h: Host, repository: string, ctx: SourceContext
const config = (overrides: Partial<PlanConfig> = {}): PlanConfig => planKind.schema.parse({ repository, directory: 'plans', ...overrides })
const write = (path: string, text: string) => { mkdirSync(join(repository, 'plans', path, '..'), { recursive: true }); writeFileSync(join(repository, 'plans', path), text) }
/** The stored Trigger of a plan file's revision, by the id the Source derives from its path and content. */
const triggerOf = (path: string, text: string) => h.runtime.store.triggers.get(key('plan', path, key('plan-file', text)))!
// The host's checkout, whose `plans` directory setup checked, and the plan Source and its operator on the allowed list.
beforeEach(async () => {
  h = await startRuntime()
  repository = h.repository
  ctx = h.runtime.context(planKind)
})
afterEach(async () => { await h.stop() })

it('takes the plans present at its first check as a baseline, and receives each added or changed plan as the operator\'s request', async () => {
  write('existing.md', '# Existing plan')
  expect(await checkPlans(ctx, config())).toBe(0)
  write('auth/login.md', '# Login\n- [ ] Add rate limiting\nAcceptance: pnpm test passes')
  expect(await checkPlans(ctx, config())).toBe(1)
  // An unchanged directory receives nothing; a hidden directory, such as the reply log's, is never read.
  mkdirSync(join(repository, 'plans', '.super-coding-agent'), { recursive: true })
  writeFileSync(join(repository, 'plans', '.super-coding-agent', 'x.md'), 'log')
  expect(await checkPlans(ctx, config())).toBe(0)
  await h.runtime.idle()
  const trigger = triggerOf('auth/login.md', '# Login\n- [ ] Add rate limiting\nAcceptance: pnpm test passes')
  expect(trigger).toMatchObject({ actor: { source: 'plan', id: OPERATOR }, human: true, addressed: 'direct', threads: [{ source: 'plan', id: 'auth/login.md' }],
    text: expect.stringContaining('Add rate limiting'), meta: { path: 'auth/login.md', file: join(repository, 'plans', 'auth/login.md') } })
  expect(h.candidates()).toContain(trigger.id)
  expect(h.runtime.health.plan).toMatchObject({ state: 'ready', detail: expect.stringContaining('2 plan files') })
  // Accepted, it becomes a Ticket whose worker reads the plan file's path in its environment.
  const result = await h.route({ kind: 'accept', trigger_id: trigger.id, title: 'Login rate limiting', worktree_name: 'login-rate-limit',
    acknowledgement: '收到，按计划实现登录限流。' })
  await h.runtime.idle()
  const ticket = h.runtime.store.tickets.get((result.ticket as { ticket_id: string }).ticket_id)!
  expect(Object.fromEntries(h.runtime.ticketEnvironment(ticket).map(item => [item.key, item.value]))).toMatchObject({
    SUPER_CODING_AGENT_REPOSITORY: repository, SUPER_CODING_AGENT_PLAN_DIR: join(repository, 'plans'),
    SUPER_CODING_AGENT_PLAN_FILE: join(repository, 'plans', 'auth/login.md') })
  // A change to the plan is a new Trigger on the same Thread, which reaches the open Ticket.
  write('auth/login.md', '# Login\n- [ ] Add rate limiting\n- [ ] Log refusals')
  expect(await checkPlans(ctx, config())).toBe(1)
  await h.runtime.idle()
  const changed = triggerOf('auth/login.md', '# Login\n- [ ] Add rate limiting\n- [ ] Log refusals')
  expect(changed.threads).toEqual(trigger.threads)
  expect(h.runtime.store.tickets.get(ticket.id)!.inputs.some(input => input.kind === 'trigger' && input.triggerId === changed.id)).toBe(true)
})

it('receives existing plans too when asked, and appends replies to the plan\'s log once per message, never to the plan', async () => {
  write('task.md', '# Task')
  expect(await checkPlans(ctx, config({ includeExisting: true }))).toBe(1)
  await h.runtime.idle()
  const trigger = triggerOf('task.md', '# Task')
  const message = { id: 'm1', channel: trigger.channel!, text: '已完成：限流已加上，测试通过。', kind: 'reply' as const }
  expect(await planKind.channel!.send({ commands: h.runtime.commands }, message)).toBe('sent')
  expect(await planKind.channel!.send({ commands: h.runtime.commands }, message)).toBe('sent')
  const log = readFileSync(planLog(join(repository, 'plans'), 'task.md'), 'utf8')
  expect(log.match(/已完成/g)).toHaveLength(1)
  expect(readFileSync(join(repository, 'plans', 'task.md'), 'utf8')).toBe('# Task')
  expect(planKind.channel!.link(trigger.channel!.address, {})).toMatchObject({ url: `file://${join(repository, 'plans', 'task.md')}` })
})

it('reports a missing plan directory, reads a plan as its Thread\'s one message, and finds a plan\'s Thread by its path', async () => {
  expect(await checkPlans(ctx, config({ directory: 'nowhere' }))).toBe(0)
  expect(h.runtime.health.plan).toMatchObject({ state: 'error', code: 'planDirectoryMissing', values: { directory: join(repository, 'nowhere') } })
  expect(existsSync(join(repository, 'nowhere'))).toBe(false)
  expect(planRoot({ repository, directory: '/abs/plans' })).toBe('/abs/plans')
  write('a.md', '# A')
  await checkPlans(ctx, config({ includeExisting: true }))
  const trigger = triggerOf('a.md', '# A')
  const read = await planKind.threadContext!.read(h.runtime.commands, trigger, 'thread', undefined, config())
  expect(read.messages).toEqual([{ id: trigger.id, from: OPERATOR, at: trigger.at, text: '# A', path: 'a.md' }])
  expect(await planKind.threadContext!.read(h.runtime.commands, trigger, 'root', undefined, config())).toEqual({ messages: [], body: {} })
  expect(planKind.find!('a.md')).toEqual({ threads: ['plan:a.md'], terms: [] })
  expect(planKind.find!('rate limiting')).toEqual({ threads: [], terms: [] })
})

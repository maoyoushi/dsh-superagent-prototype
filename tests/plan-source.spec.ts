/** The plan Source: plan files found by pattern in a local checkout as Triggers from `operator`, their Tickets, and the reply log. */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkPlans, planKind, OPERATOR, type PlanConfig } from '../src/sources/plan.ts'
import { planLog } from '../src/sources/plan-channel.ts'
import { DEFAULT_PATTERNS, globMatcher, planFiles } from '../src/sources/plan-files.ts'
import type { SourceContext } from '../src/sources/host.ts'
import { key } from '../src/core/index.ts'
import { KV } from '../src/kv.ts'
import { startRuntime, type Host } from './fixtures/host.ts'

let h: Host, repository: string, ctx: SourceContext
const PLANS = [{ pattern: 'plans/**/*.md' }]
const config = (overrides: Partial<PlanConfig> = {}): PlanConfig => planKind.schema.parse({ repository, patterns: PLANS, ...overrides })
/** Writes a file at a repository path. */
const write = (path: string, text: string) => { mkdirSync(join(repository, path, '..'), { recursive: true }); writeFileSync(join(repository, path), text) }
/** The stored Trigger of a plan file's revision, by the id the Source derives from its repository path and content. */
const triggerOf = (path: string, text: string, revision = 1) => h.runtime.store.triggers.get(key('plan', path, key('plan-file', text), String(revision)))!
// The host's checkout and the plan Source and its operator on the allowed list.
beforeEach(async () => {
  h = await startRuntime()
  repository = h.repository
  ctx = h.runtime.context(planKind)
})
afterEach(async () => { await h.stop() })

it('takes the plans present at its first check as a baseline, and receives each added or changed plan as the operator\'s request', async () => {
  write('plans/existing.md', '# Existing plan')
  expect(await checkPlans(ctx, config())).toBe(0)
  write('plans/auth/login.md', '# Login\n- [ ] Add rate limiting\nAcceptance: pnpm test passes')
  expect(await checkPlans(ctx, config())).toBe(1)
  // An unchanged repository receives nothing; a hidden directory, such as the reply log's, is never read.
  write('plans/.super-coding-agent/x.md', 'log')
  expect(await checkPlans(ctx, config())).toBe(0)
  await h.runtime.idle()
  const trigger = triggerOf('plans/auth/login.md', '# Login\n- [ ] Add rate limiting\nAcceptance: pnpm test passes')
  expect(trigger).toMatchObject({ actor: { source: 'plan', id: OPERATOR }, human: true, addressed: 'direct', threads: [{ source: 'plan', id: 'plans/auth/login.md' }],
    text: expect.stringContaining('Add rate limiting'), meta: { path: 'plans/auth/login.md', file: join(repository, 'plans', 'auth', 'login.md') } })
  expect(h.candidates()).toContain(trigger.id)
  expect(h.runtime.health.plan).toMatchObject({ state: 'ready', detail: `2 plan files in ${repository}; 0 received` })
  // Accepted, it becomes a Ticket whose worker reads the plan file's path and the checkout in its environment.
  const result = await h.route({ kind: 'accept', trigger_id: trigger.id, title: 'Login rate limiting', worktree_name: 'login-rate-limit',
    acknowledgement: '收到，按计划实现登录限流。' })
  await h.runtime.idle()
  const ticket = h.runtime.store.tickets.get((result.ticket as { ticket_id: string }).ticket_id)!
  const environment = Object.fromEntries(h.runtime.ticketEnvironment(ticket).map(item => [item.key, item.value]))
  expect(environment).toMatchObject({ SUPER_CODING_AGENT_REPOSITORY: repository, SUPER_CODING_AGENT_PLAN_FILE: join(repository, 'plans', 'auth', 'login.md') })
  expect(environment).not.toHaveProperty('SUPER_CODING_AGENT_PLAN_DIR')
  // A change to the plan is a new Trigger on the same Thread, which reaches the open Ticket.
  write('plans/auth/login.md', '# Login\n- [ ] Add rate limiting\n- [ ] Log refusals')
  expect(await checkPlans(ctx, config())).toBe(1)
  await h.runtime.idle()
  const changed = triggerOf('plans/auth/login.md', '# Login\n- [ ] Add rate limiting\n- [ ] Log refusals', 2)
  expect(changed.threads).toEqual(trigger.threads)
  expect(h.runtime.store.tickets.get(ticket.id)!.inputs.some(input => input.kind === 'trigger' && input.triggerId === changed.id)).toBe(true)
})

it('receives existing plans too when asked, and appends replies to the plan\'s ignored log once per message, never to the plan', async () => {
  write('plans/task.md', '# Task')
  expect(await checkPlans(ctx, config({ includeExisting: true }))).toBe(1)
  await h.runtime.idle()
  const trigger = triggerOf('plans/task.md', '# Task')
  const message = { id: 'm1', channel: trigger.channel!, text: '已完成：限流已加上，测试通过。', kind: 'reply' as const }
  expect(await planKind.channel!.send({ commands: h.runtime.commands }, message)).toBe('sent')
  expect(await planKind.channel!.send({ commands: h.runtime.commands }, message)).toBe('sent')
  const log = planLog(repository, 'plans/task.md')
  expect(log).toBe(join(repository, '.super-coding-agent', 'logs', 'plans', 'task.md.log.md'))
  expect(readFileSync(log, 'utf8').match(/已完成/g)).toHaveLength(1)
  // The log directory ignores itself, so replies never show up as changes of the checkout, and is never read as plans.
  expect(readFileSync(join(repository, '.super-coding-agent', '.gitignore'), 'utf8')).toBe('*\n')
  expect(await checkPlans(ctx, config({ patterns: [{ pattern: '**/*.md' }] }))).toBe(0)
  expect(readFileSync(join(repository, 'plans', 'task.md'), 'utf8')).toBe('# Task')
  expect(planKind.channel!.link(trigger.channel!.address, {})).toMatchObject({ url: `file://${join(repository, 'plans', 'task.md')}` })
})

it('waits for setup without a repository, reads a plan as its Thread\'s one message, and finds a plan\'s Thread by its path', async () => {
  expect(await checkPlans(ctx, config({ repository: '' }))).toBe(0)
  expect(h.runtime.health.plan).toMatchObject({ state: 'paused', code: 'setupPending' })
  expect(() => config({ repository: 'relative/repo' })).toThrow()
  write('plans/a.md', '# A')
  await checkPlans(ctx, config({ includeExisting: true }))
  const trigger = triggerOf('plans/a.md', '# A')
  const read = await planKind.threadContext!.read(h.runtime.commands, trigger, 'thread', undefined, config())
  expect(read.messages).toEqual([{ id: trigger.id, from: OPERATOR, at: trigger.at, text: '# A', path: 'plans/a.md' }])
  expect(await planKind.threadContext!.read(h.runtime.commands, trigger, 'root', undefined, config())).toEqual({ messages: [], body: {} })
  expect(planKind.find!('plans/a.md')).toEqual({ threads: ['plan:plans/a.md', 'plan:a.md'], terms: [] })
  expect(planKind.find!(join(repository, 'plans', 'a.md')).threads).toContain('plan:plans/a.md')
  expect(planKind.find!('./plans/a.md').threads).toContain('plan:plans/a.md')
  expect(planKind.find!('rate limiting')).toEqual({ threads: [], terms: [] })
})

it('receives a plan reverted to earlier content, a deleted plan restored, and skips an unreadable entry without stopping the check', async () => {
  write('plans/a.md', 'A')
  expect(await checkPlans(ctx, config({ includeExisting: true }))).toBe(1)
  write('plans/a.md', 'B')
  expect(await checkPlans(ctx, config())).toBe(1)
  // Content the plan had before is a new revision, which becomes a new Trigger rather than a duplicate.
  write('plans/a.md', 'A')
  expect(await checkPlans(ctx, config())).toBe(1)
  expect(triggerOf('plans/a.md', 'A', 3)).toBeDefined()
  // A deleted plan is forgotten once, keeping its revision count.
  rmSync(join(repository, 'plans', 'a.md'))
  expect(await checkPlans(ctx, config())).toBe(0)
  const forgotten = ctx.state.get(KV.plan.file(repository, 'plans/a.md'))
  expect(forgotten).toMatchObject({ hash: '', revision: 3 })
  expect(await checkPlans(ctx, config())).toBe(0)
  expect(ctx.state.get(KV.plan.file(repository, 'plans/a.md'))).toEqual(forgotten)
  write('plans/a.md', 'A')
  expect(await checkPlans(ctx, config())).toBe(1)
  expect(triggerOf('plans/a.md', 'A', 4)).toBeDefined()
  // A directory the check cannot read is named in health, its plans are not forgotten, and the other plans are still received.
  write('plans/locked/c.md', 'C')
  expect(await checkPlans(ctx, config())).toBe(1)
  chmodSync(join(repository, 'plans', 'locked'), 0)
  write('plans/b.md', 'B')
  try {
    expect(await checkPlans(ctx, config())).toBe(1)
    expect(h.runtime.health.plan).toMatchObject({ state: 'ready', detail: expect.stringContaining('unreadable: plans/locked/') })
    expect(ctx.state.get(KV.plan.file(repository, 'plans/locked/c.md'))?.hash).not.toBe('')
  } finally { chmodSync(join(repository, 'plans', 'locked'), 0o755) }
  expect(await checkPlans(ctx, config())).toBe(0)
})

it('does not receive a plan again that was unreadable for a while and comes back unchanged', async () => {
  write('plans/a.md', 'A')
  expect(await checkPlans(ctx, config({ includeExisting: true }))).toBe(1)
  chmodSync(join(repository, 'plans', 'a.md'), 0)
  try {
    expect(await checkPlans(ctx, config())).toBe(0)
    expect(h.runtime.health.plan).toMatchObject({ state: 'ready', detail: expect.stringContaining('unreadable: plans/a.md') })
  } finally { chmodSync(join(repository, 'plans', 'a.md'), 0o644) }
  expect(await checkPlans(ctx, config())).toBe(0)
  expect(ctx.state.get(KV.plan.file(repository, 'plans/a.md'))).toMatchObject({ hash: key('plan-file', 'A'), revision: 1 })
})

it('drops a blank pattern row on save instead of refusing the whole block, and still refuses an overlong one', () => {
  const saved = planKind.schema.parse({ repository, patterns: [{ pattern: 'PLAN.md' }, { pattern: '' }, { pattern: '   ' }, { pattern: 'docs/**/*.md' }] })
  expect(saved.patterns).toEqual([{ pattern: 'PLAN.md' }, { pattern: 'docs/**/*.md' }])
  expect(planKind.schema.safeParse({ repository, patterns: [{ pattern: 'x'.repeat(201) }] }).success).toBe(false)
})

it('finds the plans of common planning tools anywhere in the repository by default, but not other Markdown or skipped directories', async () => {
  expect(planKind.schema.parse({ repository }).patterns).toEqual(DEFAULT_PATTERNS.map(pattern => ({ pattern })))
  const plans = ['PLAN.md', 'docs/superpowers/plans/x.md', 'docs/stories/1.1.story.md', 'specs/001-auth/tasks.md',
    '_bmad-output/implementation-artifacts/stories/s1.md']
  for (const path of plans) write(path, `# ${path}`)
  for (const path of ['README.md', 'src/notes.md', 'node_modules/x/plans/a.md', '.hidden/plans/a.md', 'specs/001-auth/spec.md']) write(path, '# Other')
  expect(await checkPlans(ctx, planKind.schema.parse({ repository, includeExisting: true }))).toBe(plans.length)
  for (const path of plans) expect(triggerOf(path, `# ${path}`).threads).toEqual([{ source: 'plan', id: path }])
  expect(h.runtime.health.plan).toMatchObject({ detail: `${plans.length} plan files in ${repository}; ${plans.length} received` })
  // A pattern that reaches into any directory still skips hidden ones and dependencies.
  const found = await planFiles(repository, ['**/plans/*.md'])
  expect(found.files.map(file => file.path)).toEqual(['docs/superpowers/plans/x.md'])
})

it('takes plans a pattern change newly matches as a baseline, while still receiving changes to plans it knows', async () => {
  write('plans/a.md', 'A1')
  write('docs/stories/s.md', 'S1')
  expect(await checkPlans(ctx, config())).toBe(0)
  write('plans/a.md', 'A2')
  const wider = config({ patterns: [...PLANS, { pattern: 'docs/stories/**/*.md' }] })
  // The changed known plan is received; the story the new pattern matches only sets its baseline.
  expect(await checkPlans(ctx, wider)).toBe(1)
  expect(triggerOf('plans/a.md', 'A2', 2)).toBeDefined()
  expect(h.runtime.store.triggers.get(key('plan', 'docs/stories/s.md', key('plan-file', 'S1'), '1'))).toBeUndefined()
  write('docs/stories/s.md', 'S2')
  expect(await checkPlans(ctx, wider)).toBe(1)
  expect(triggerOf('docs/stories/s.md', 'S2', 2)).toBeDefined()
  expect(existsSync(join(repository, '.super-coding-agent'))).toBe(false)
})

describe('globMatcher', () => {
  const matches = (pattern: string, path: string) => globMatcher(pattern).test(path)
  it('spans any number of directories with ** at the start, in the middle and at the end', () => {
    expect(matches('**/plans/*.md', 'plans/a.md')).toBe(true)
    expect(matches('**/plans/*.md', 'x/y/plans/a.md')).toBe(true)
    expect(matches('**/plans/*.md', 'plans/x/a.md')).toBe(false)
    expect(matches('docs/**/tasks.md', 'docs/tasks.md')).toBe(true)
    expect(matches('docs/**/tasks.md', 'docs/a/b/tasks.md')).toBe(true)
    expect(matches('docs/**/tasks.md', 'docsx/tasks.md')).toBe(false)
    expect(matches('specs/**', 'specs/a/b.md')).toBe(true)
    expect(matches('specs/**', 'other/specs/a.md')).toBe(false)
  })
  it('keeps * and ? within one directory, matches literally otherwise and ignores case and a leading ./', () => {
    expect(matches('plans/*.md', 'plans/a/b.md')).toBe(false)
    expect(matches('v?.md', 'v1.md')).toBe(true)
    expect(matches('v?.md', 'v10.md')).toBe(false)
    expect(matches('a+b.md', 'a+b.md')).toBe(true)
    expect(matches('a+b.md', 'aab.md')).toBe(false)
    expect(matches('PLAN.md', 'plan.md')).toBe(true)
    expect(matches('PLAN.md', 'Plan.MD')).toBe(true)
    expect(matches('Docs/Stories/**/*.md', 'docs/stories/1.md')).toBe(true)
    expect(matches('./plans/*.md', 'plans/a.md')).toBe(true)
  })
})

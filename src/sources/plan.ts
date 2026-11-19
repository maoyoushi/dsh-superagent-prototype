/**
 * The plan Source kind and plugin entry: the plan and task files of a local checkout, found by pattern anywhere in it, become
 * Triggers from `operator`.
 */
import type { Context } from '@deepseek-ai/cordis'
import { isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import { key, type Trigger } from '../core/index.ts'
import { KV } from '../kv.ts'
import { health, sourceContext, type SourceContext } from './host.ts'
import type { SourceKind } from './kind.ts'
import { planChannel, planLog } from './plan-channel.ts'
import { DEFAULT_PATTERNS, planFiles, readPlanFile, type PlanFile } from './plan-files.ts'
import { pause } from './poll.ts'

export const SOURCE = 'plan'
/** The sender of every plan file: the operator who wrote it, as the plan Source's part of the Policy lists it. */
export const OPERATOR = 'operator'
/** Whether a pattern row holds no pattern, only whitespace. */
const isBlankPattern = (row: unknown): boolean =>
  typeof row === 'object' && row !== null && 'pattern' in row && typeof row.pattern === 'string' && row.pattern.trim() === ''
const PlanConfigSchema = z.object({
  repository: z.string().trim().refine(path => path === '' || isAbsolute(path), 'An absolute path').default(''),
  // A blank row is one the panel added and left empty: it is dropped, not a reason to refuse the whole block.
  patterns: z.preprocess(rows => Array.isArray(rows) ? rows.filter(row => !isBlankPattern(row)) : rows,
    z.array(z.object({ pattern: z.string().trim().min(1).max(200) }).strict()).max(50))
    .default(() => DEFAULT_PATTERNS.map(pattern => ({ pattern }))),
  pollSeconds: z.number().int().min(5).max(3600).default(30),
  failuresBeforeError: z.number().int().min(1).max(20).default(3),
  includeExisting: z.boolean().default(false),
}).strict()
export type PlanConfig = z.infer<typeof PlanConfigSchema>

export const planKind: SourceKind<PlanConfig> = {
  kind: SOURCE,
  title: { zh: '计划文件', en: 'Plan files' },
  description: { zh: '仓库里由人写好的计划或任务文件（superpowers、BMAD、speckit、PLAN.md 等），按路径模式在整个仓库中查找；新增或修改的文件成为待接的工作，回复写入 .super-coding-agent/logs 下的日志。', en: 'Plan or task files people write in the repository (superpowers, BMAD, speckit, PLAN.md and the like), found anywhere in it by path pattern; a new or changed file becomes work to accept, and replies go to a log under .super-coding-agent/logs.' },
  schema: PlanConfigSchema,
  fields: [
    { key: 'repository', type: 'text', pattern: '/.*', label: { zh: '仓库目录', en: 'Repository directory' },
      hint: { zh: '本地 git 检出的绝对路径；执行器在每个工单的目录里基于它工作。保存时检查它，然后重启 super-coding-agent。', en: 'Absolute path of the local git checkout; the Executor works from it in each Ticket\'s directory. Saving checks it, then restarts super-coding-agent.' } },
    { key: 'patterns', type: 'rows', label: { zh: '计划文件的路径模式', en: 'Plan file patterns' },
      hint: { zh: '相对仓库根的 glob，不区分大小写：** 跨任意层目录，* 只在一层内。匹配的 Markdown 文件都是计划；隐藏目录、node_modules 和构建输出不读。默认覆盖 superpowers、BMAD、speckit 和 PLAN.md/TASKS.md 等。', en: 'Globs from the repository root, case-insensitive: ** spans directories, * stays within one. Every matching Markdown file is a plan; hidden directories, node_modules and build output are not read. The defaults cover superpowers, BMAD, speckit and PLAN.md/TASKS.md and the like.' },
      columns: [{ key: 'pattern', type: 'text', label: { zh: '模式', en: 'Pattern' } }] },
    { key: 'includeExisting', type: 'switch', label: { zh: '接收已有的计划', en: 'Receive existing plans' },
      hint: { zh: '关闭时，开始监听时已有的文件只作为基线，之后新增或修改才会收到。', en: 'When off, files present when watching starts are only a baseline; later additions and changes are received.' } },
    { key: 'pollSeconds', type: 'number', advanced: true, min: 5, max: 3600, label: { zh: '检查间隔 / 秒', en: 'Check interval / seconds' } },
    { key: 'failuresBeforeError', type: 'number', advanced: true, min: 1, max: 20, label: { zh: '连续失败几次后报告异常', en: 'Failed checks before reporting an error' } }],
  health: ['plan'],
  channel: planChannel,
  threadContext: {
    messageId: trigger => trigger.id,
    // The plan text is the Trigger's own: a read returns it as the Thread's one message.
    read: async (_commands, trigger, part) => part === 'thread'
      ? { messages: [{ id: trigger.id, from: OPERATOR, at: trigger.at, text: trigger.text, path: String(trigger.meta.path ?? '') }], body: {} }
      : { messages: [], body: {} },
  },
  // A browser cannot open the plan's file URL from the panel, so the panel reads the file's current text here.
  original: async (thread, config) => {
    const path = thread.startsWith(`${SOURCE}:`) ? thread.slice(SOURCE.length + 1) : ''
    const text = path && config.repository ? await readPlanFile(config.repository, path, config.patterns.map(item => item.pattern)) : undefined
    return text === undefined ? undefined : { path, text }
  },
  // A plan named by a longer path, such as its path in the repository, matches the Thread of each of its path's suffixes.
  find: query => {
    const parts = query.trim().replace(/^\.?\//, '').split('/')
    if (!/\.md$/i.test(parts.at(-1) ?? '')) return { threads: [], terms: [] }
    return { threads: parts.map((_, at) => `${SOURCE}:${parts.slice(at).join('/')}`), terms: [] }
  },
  policy: {
    schema: z.object({ allowed: z.array(z.object({ id: z.string().trim().min(1).max(200), name: z.string().trim().max(100).optional() }).strict())
      .default([{ id: OPERATOR, name: 'Operator' }]) }).strict(),
    fields: [{ key: 'allowed', type: 'rows', label: { zh: '能发起工作的发送者', en: 'Senders who may originate work' },
      columns: [{ key: 'id', type: 'text', label: { zh: '发送者', en: 'Sender' } }, { key: 'name', type: 'text', optional: true,
        label: { zh: '名字', en: 'Name' } }] }],
    explicit: { zh: '仓库里新增或修改的计划文件，发送者为 operator。', en: 'A plan file added or changed in the repository, sent by operator.' },
  },
  environment: {
    variables: [
      { key: 'SUPER_CODING_AGENT_PLAN_FILE', description: { zh: '这个工单来源计划文件的绝对路径；不要修改它', en: 'Absolute path of this ticket\'s plan file; never edit it' } }],
    values: ({ trigger }) => ({ SUPER_CODING_AGENT_PLAN_FILE: typeof trigger?.meta.file === 'string' ? trigger.meta.file : '' }),
  },
}

/**
 * The Trigger of one revision of a plan file: the operator's direct request, on the Thread of that file. `revision` counts the
 * file's received revisions, so content it had before, such as after a revert, is a new Trigger rather than a duplicate.
 */
export function planTrigger(root: string, plan: PlanFile, revision = 1): Trigger {
  const address = { path: plan.path, file: plan.file, log: planLog(root, plan.path) }
  return { id: key(SOURCE, plan.path, plan.hash, String(revision)), source: SOURCE, threads: [{ source: SOURCE, id: plan.path }], actor: { source: SOURCE, id: OPERATOR },
    human: true, addressed: 'direct', at: plan.at, text: plan.text, channel: { source: SOURCE, thread: `${SOURCE}:${plan.path}`, address },
    url: pathToFileURL(plan.file).href, meta: { path: plan.path, file: plan.file, hash: plan.hash } }
}

/**
 * One check of the repository: each plan file whose content changed since its last Trigger becomes a new one. When the scope of
 * the check is new, that is the repository or the patterns changed, files not seen before only set the baseline unless
 * `includeExisting` is on.
 * @returns How many Triggers the check received.
 */
export async function checkPlans(ctx: SourceContext, config: PlanConfig): Promise<number> {
  const root = config.repository
  if (!root || !isAbsolute(root)) { ctx.report('plan', health('paused', 'setupPending')); return 0 }
  const patterns = config.patterns.map(item => item.pattern)
  const { files, large, unreadable, truncated } = await planFiles(root, patterns)
  const scope = JSON.stringify([root, patterns])
  const baseline = ctx.state.get(KV.plan.root) !== scope
  let received = 0
  for (const plan of files) {
    const seen = ctx.state.get(KV.plan.file(root, plan.path))
    if (seen?.hash === plan.hash) continue
    const revision = (seen?.revision ?? 0) + 1
    if (!(baseline && !seen && !config.includeExisting)) {
      const result = await ctx.receive(planTrigger(root, plan, revision))
      ctx.threads.describe(`${SOURCE}:${plan.path}`, { label: plan.path, url: pathToFileURL(plan.file).href })
      if (result !== 'duplicate') received += 1
    }
    ctx.state.set(KV.plan.file(root, plan.path), { hash: plan.hash, at: plan.at, revision })
  }
  // A deleted plan is forgotten, so restoring it is received again; its revision count goes on from where it was. A plan the
  // check could not read, or one in a directory it could not read, is neither: it is left as it was.
  const present = new Set([...files, ...large.map(path => ({ path }))].map(plan => plan.path)), prefix = KV.plan.file(root, '')
  const kept = (path: string) => present.has(path) || unreadable.some(item => item === path || (item.endsWith('/') && path.startsWith(item)))
  for (const name of ctx.state.keys(KV.plan.file)) {
    if (!name.startsWith(prefix) || kept(name.slice(prefix.length))) continue
    const stored = ctx.state.get(name)
    if (stored && stored.hash !== '') ctx.state.set(name, { hash: '', at: stored.at, revision: stored.revision ?? 1 })
  }
  ctx.state.set(KV.plan.root, scope)
  const notes = [large.length ? `too large: ${large.join(', ')}` : '', unreadable.length ? `unreadable: ${unreadable.join(', ')}` : '',
    truncated ? 'the repository has too many entries; some were not looked at' : ''].filter(Boolean)
  ctx.report('plan', { state: 'ready', detail: `${files.length} plan files in ${root}; ${received} received${notes.length ? `; ${notes.join('; ')}` : ''}`,
    at: new Date().toISOString() })
  return received
}

export const name = 'super-coding-agent-plan'
export const inject = ['orchestrator']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.orchestrator.sources.register(planKind), 'plan: source kind')
  ctx.effect(() => {
    const source = sourceContext(ctx.orchestrator, planKind)
    const controller = new AbortController()
    // Unhandled rejections terminate the DSH process, so a failure escaping the loop is reported as source health instead.
    const running = watch(source, controller.signal)
      .catch((error: unknown) => { source.report('plan', { state: 'error', detail: String(error) }) })
    return async () => { controller.abort(); await running }
  })
}
async function watch(ctx: SourceContext, signal: AbortSignal): Promise<void> {
  let failures = 0
  await ctx.ready
  if (!ctx.configured()) { ctx.report('plan', health('paused', 'setupPending')); return }
  while (!signal.aborted) {
    const config = ctx.config<PlanConfig>(SOURCE)
    try {
      if (!config) ctx.report('plan', health('paused', 'sourceOff'))
      else await checkPlans(ctx, config)
      failures = 0
    } catch (error) {
      failures += 1
      if (!signal.aborted && failures >= (config?.failuresBeforeError ?? 1)) {
        ctx.report('plan', health('error', 'pollFailures', { count: String(failures), error: String(error) }))
      }
    }
    await pause((ctx.config<PlanConfig>(SOURCE)?.pollSeconds ?? 30) * 1000, signal)
  }
}

/** The plan Source kind and plugin entry: plan files an operator writes in a local checkout become Triggers from `operator`. */
import type { Context } from '@deepseek-ai/cordis'
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { stat } from 'node:fs/promises'
import { z } from 'zod'
import { key, type Trigger } from '../core/index.ts'
import { KV } from '../kv.ts'
import { health, sourceContext, type SourceContext } from './host.ts'
import type { SourceKind } from './kind.ts'
import { planChannel, planLog } from './plan-channel.ts'
import { planFiles, type PlanFile } from './plan-files.ts'
import { pause } from './poll.ts'

export const SOURCE = 'plan'
/** The sender of every plan file: the operator who wrote it, as the plan Source's part of the Policy lists it. */
export const OPERATOR = 'operator'
const PlanConfigSchema = z.object({
  repository: z.string().trim().refine(path => path === '' || isAbsolute(path), 'An absolute path').default(''),
  directory: z.string().trim().min(1).default('docs/plans'),
  pollSeconds: z.number().int().min(5).max(3600).default(30),
  failuresBeforeError: z.number().int().min(1).max(20).default(3),
  includeExisting: z.boolean().default(false),
}).strict()
export type PlanConfig = z.infer<typeof PlanConfigSchema>
/** The plan directory: `directory` itself when absolute, else below the repository. */
export const planRoot = (config: Pick<PlanConfig, 'repository' | 'directory'>): string =>
  isAbsolute(config.directory) ? config.directory : resolve(config.repository, config.directory)

export const planKind: SourceKind<PlanConfig> = {
  kind: SOURCE,
  title: { zh: '计划文件', en: 'Plan files' },
  description: { zh: '仓库里由人写好的计划或任务文件（superpowers、BMAD、speckit 等）；新增或修改的文件成为待接的工作，回复写入 .super-coding-agent 下的日志。', en: 'Plan or task files people write in the repository (superpowers, BMAD, speckit and the like); a new or changed file becomes work to accept, and replies go to a log under .super-coding-agent.' },
  schema: PlanConfigSchema,
  fields: [
    { key: 'repository', type: 'text', pattern: '/.*', label: { zh: '仓库目录', en: 'Repository directory' },
      hint: { zh: '本地 git 检出的绝对路径；执行器在每个工单的目录里基于它工作。保存时检查它和计划目录，然后重启 super-coding-agent。', en: 'Absolute path of the local git checkout; the Executor works from it in each Ticket\'s directory. Saving checks it and the plan directory, then restarts super-coding-agent.' } },
    { key: 'directory', type: 'text', label: { zh: '计划目录', en: 'Plan directory' },
      hint: { zh: '相对仓库目录的路径，或绝对路径。其下每个 Markdown 文件是一份计划；隐藏目录不读。', en: 'A path relative to the repository directory, or absolute. Every Markdown file below it is a plan; hidden directories are not read.' } },
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
  find: query => /\.md$/i.test(query.trim()) ? { threads: [`${SOURCE}:${query.trim().replace(/^\.?\//, '')}`], terms: [] } : { threads: [], terms: [] },
  policy: {
    schema: z.object({ allowed: z.array(z.object({ id: z.string().trim().min(1).max(200), name: z.string().trim().max(100).optional() }).strict())
      .default([{ id: OPERATOR, name: 'Operator' }]) }).strict(),
    fields: [{ key: 'allowed', type: 'rows', label: { zh: '能发起工作的发送者', en: 'Senders who may originate work' },
      columns: [{ key: 'id', type: 'text', label: { zh: '发送者', en: 'Sender' } }, { key: 'name', type: 'text', optional: true,
        label: { zh: '名字', en: 'Name' } }] }],
    explicit: { zh: '计划目录里新增或修改的计划文件，发送者为 operator。', en: 'A plan file added or changed in the plan directory, sent by operator.' },
  },
  environment: {
    variables: [
      { key: 'SUPER_CODING_AGENT_REPOSITORY', description: { zh: '本地 git 检出的绝对路径', en: 'Absolute path of the local git checkout' } },
      { key: 'SUPER_CODING_AGENT_PLAN_DIR', description: { zh: '计划目录的绝对路径', en: 'Absolute path of the plan directory' } },
      { key: 'SUPER_CODING_AGENT_PLAN_FILE', description: { zh: '这个工单来源计划文件的绝对路径；不要修改它', en: 'Absolute path of this ticket\'s plan file; never edit it' } }],
    values: ({ deployment, trigger }) => ({ SUPER_CODING_AGENT_REPOSITORY: deployment.repository, SUPER_CODING_AGENT_PLAN_DIR: deployment.plan.directory,
      SUPER_CODING_AGENT_PLAN_FILE: typeof trigger?.meta.file === 'string' ? trigger.meta.file : '' }),
  },
}

/** The Trigger of one revision of a plan file: the operator's direct request, on the Thread of that file. */
export function planTrigger(root: string, plan: PlanFile): Trigger {
  const address = { path: plan.path, file: plan.file, log: planLog(root, plan.path) }
  return { id: key(SOURCE, plan.path, plan.hash), source: SOURCE, threads: [{ source: SOURCE, id: plan.path }], actor: { source: SOURCE, id: OPERATOR },
    human: true, addressed: 'direct', at: plan.at, text: plan.text, channel: { source: SOURCE, thread: `${SOURCE}:${plan.path}`, address },
    url: pathToFileURL(plan.file).href, meta: { path: plan.path, file: plan.file, hash: plan.hash } }
}

/**
 * One check of the plan directory: each file whose content changed since its last Trigger becomes a new one. On the first
 * check of a directory, files already there only set the baseline unless `includeExisting` is on.
 * @returns How many Triggers the check received.
 */
export async function checkPlans(ctx: SourceContext, config: PlanConfig): Promise<number> {
  const root = planRoot(config)
  if (!await stat(root).then(info => info.isDirectory(), () => false)) {
    ctx.report('plan', health('error', 'planDirectoryMissing', { directory: root }))
    return 0
  }
  const { files, skipped } = await planFiles(root)
  const baseline = ctx.state.get(KV.plan.root) !== root
  let received = 0
  for (const plan of files) {
    const seen = ctx.state.get(KV.plan.file(root, plan.path))
    if (seen?.hash === plan.hash) continue
    if (!(baseline && !config.includeExisting)) {
      await ctx.receive(planTrigger(root, plan))
      ctx.threads.describe(`${SOURCE}:${plan.path}`, { label: plan.path, url: pathToFileURL(plan.file).href })
      received += 1
    }
    ctx.state.set(KV.plan.file(root, plan.path), { hash: plan.hash, at: plan.at })
  }
  ctx.state.set(KV.plan.root, root)
  const large = skipped.length ? `; skipped as too large: ${skipped.join(', ')}` : ''
  ctx.report('plan', { state: 'ready', detail: `${files.length} plan files in ${root}; ${received} received${large}`, at: new Date().toISOString() })
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

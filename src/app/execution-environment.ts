/** Execution environment variables exposed to prepare commands and documented in worker Session instructions; never contains credentials. */
import { join } from 'node:path'
import type { Ticket, Trigger } from '../core/index.ts'
import type { Deployment } from '../deployment.ts'
import type { Settings, SubagentRole } from '../policy.ts'
import type { Localized, VariableSpec } from '../sources/kind.ts'
import type { SourceRegistry } from '../sources/registry.ts'

/** Variables registered by the Executor; `ticket` entries are populated only when a ticket is present. */
export const EXECUTOR_VARIABLES: readonly (VariableSpec & { ticket?: true })[] = [
  { key: 'SUPER_CODING_AGENT_DIR', ticket: true, description: { zh: '这个工单的执行目录；执行器 Session 在其中工作', en: 'This ticket\'s directory; the executor Session works in it' } },
  { key: 'SUPER_CODING_AGENT_NAME', ticket: true, description: { zh: '工单的短名，也是执行目录的名字', en: 'The ticket\'s short name, also its directory\'s name' } },
  { key: 'SUPER_CODING_AGENT_TICKET', ticket: true, description: { zh: '工单 id', en: 'The ticket id' } },
  { key: 'SUPER_CODING_AGENT_REPOSITORY', description: { zh: '本地 git 检出的绝对路径；默认的准备命令从它创建工单的 worktree', en: 'Absolute path of the local git checkout, which the default prepare command makes each Ticket\'s worktree from' } },
  { key: 'SUPER_CODING_AGENT_DEVELOP_TOOL', description: { zh: '开发子任务所用的工具；worker 表示执行器自己做', en: 'The tool that develops a subtask; worker means the Executor does it itself' } },
  { key: 'SUPER_CODING_AGENT_VERIFY_TOOL', description: { zh: '验证子任务所用的工具；worker 表示执行器自己做', en: 'The tool that verifies a subtask against its acceptance checks; worker means the Executor does it itself' } },
  { key: 'SUPER_CODING_AGENT_REVIEW_TOOL', description: { zh: '审查子任务所用的工具；worker 表示执行器自己做', en: 'The tool that reviews a subtask\'s diff; worker means the Executor does it itself' } },
  { key: 'SUPER_CODING_AGENT_SUBTASK_MINUTES', description: { zh: '单个子任务应在多少分钟内完成', en: 'Minutes one delegated subtask should finish within' } },
  { key: 'SUPER_CODING_AGENT_BLOCKED_COMMANDS', description: { zh: '这个执行环境禁止调用的命令，以空格分隔；不要运行它们', en: 'Commands blocked in this execution environment, separated by spaces; never run them' } },
]
export interface Variable { key: string; value: string; description: Localized; owner: string }

/** The delegation tool of a role's choice, as the worker preset names it. */
const ROLE_TOOLS: Record<SubagentRole, string> = { 'claude-code': 'subagent_claude_code', codex: 'subagent_codex', worker: 'worker' }
export const executionRoot = (settings: Settings, stateDir: string): string => settings.executor.directory || join(stateDir, 'work')

/** Lists all declared variables grouped by owner; `enabled` is false for Sources that are currently switched off. */
export function declaredVariables(sources: SourceRegistry, settings?: Settings): { owner: string; enabled: boolean; variables: readonly VariableSpec[] }[] {
  const on = new Set(sources.environments(settings).map(item => item.kind.kind))
  return [{ owner: 'executor', enabled: true, variables: EXECUTOR_VARIABLES },
    ...sources.declarations().map(({ kind, variables }) => ({ owner: kind, enabled: on.has(kind), variables }))]
}

export function environmentOf(input: { deployment: Deployment; sources: SourceRegistry; settings: Settings; ticket?: { id: string; name: string; directory: string }; trigger?: Trigger }): Variable[] {
  const { deployment, sources, settings, ticket, trigger } = input
  const { roles, maxSubtaskMinutes } = settings.subagents
  const executor: Record<string, string> = { SUPER_CODING_AGENT_REPOSITORY: deployment.repository,
    SUPER_CODING_AGENT_BLOCKED_COMMANDS: settings.executor.blockedCommands.join(' '),
    SUPER_CODING_AGENT_DEVELOP_TOOL: ROLE_TOOLS[roles.develop], SUPER_CODING_AGENT_VERIFY_TOOL: ROLE_TOOLS[roles.verify],
    SUPER_CODING_AGENT_REVIEW_TOOL: ROLE_TOOLS[roles.review], SUPER_CODING_AGENT_SUBTASK_MINUTES: String(maxSubtaskMinutes), ...ticket ? { SUPER_CODING_AGENT_DIR: ticket.directory, SUPER_CODING_AGENT_NAME: ticket.name, SUPER_CODING_AGENT_TICKET: ticket.id } : {} }
  const result: Variable[] = EXECUTOR_VARIABLES.filter(spec => !spec.ticket || ticket).map(spec => ({ key: spec.key, value: executor[spec.key] ?? '', description: spec.description, owner: 'executor' }))
  for (const { kind, environment, config } of sources.environments(settings)) {
    const values = environment.values({ deployment, config, ...trigger ? { trigger } : {} })
    for (const spec of environment.variables) result.push({ key: spec.key, value: values[spec.key] ?? '', description: spec.description, owner: kind.kind })
  }
  return result
}

/** Combines a ticket's fixed directory, name, and origin trigger with the deployment's current settings. */
export function ticketEnvironment(input: { deployment: Deployment; sources: SourceRegistry; settings: Settings; ticket: Ticket; trigger?: Trigger }) {
  const { ticket, trigger, ...rest } = input
  const values = { id: ticket.id, name: ticket.execution?.name ?? '', directory: ticket.execution?.directory ?? '' }
  return environmentOf({ ...rest, ticket: values, ...trigger ? { trigger } : {} })
}
export function environmentLines(variables: Variable[]): string {
  return variables.map(variable => `- ${variable.key} = ${JSON.stringify(variable.value)}: ${variable.description.en}.`).join('\n')
}

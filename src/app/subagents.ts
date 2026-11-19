/** Mounts DSH's Claude Code and Codex subagent providers from the Subagents settings, and checks that their CLIs start. */
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import { UserError } from '../core/index.ts'
import type { HealthEntry } from '../infra/health.ts'
import { runAsWorker } from '../infra/environment.ts'
import { SUBAGENT_PROVIDERS, type Settings, type SubagentProvider, type SubagentsConfig } from '../policy.ts'

/** How long an availability check (`<command> --version`) may take. */
const PROBE_TIMEOUT_MS = 15_000
/** The settings key of each provider. */
const KEYS: Record<SubagentProvider, 'claudeCode' | 'codex'> = { 'claude-code': 'claudeCode', codex: 'codex' }
const LABELS: Record<SubagentProvider, string> = { 'claude-code': 'Claude Code', codex: 'Codex' }
const now = (): string => new Date().toISOString()

/** A Cordis plugin module as the provider packages export it. */
export type ProviderPlugin = { name: string; inject?: unknown; apply(ctx: Context, config: { env?: Record<string, string> }): unknown }
/** Loads a provider plugin; the default imports DSH's package of that name. */
export type ProviderLoader = (provider: SubagentProvider) => Promise<ProviderPlugin>
/** Runs a command and returns its standard output; rejects when it cannot start or exits non-zero. */
export type Probe = (argv: string[], signal: AbortSignal) => Promise<string>

const loadProvider: ProviderLoader = async provider => (provider === 'codex'
  ? await import('@deepseek-ai/dsh-subagent-codex') : await import('@deepseek-ai/dsh-subagent-claude-code')) as unknown as ProviderPlugin

/** Host dependencies used by `Subagents`. */
export interface SubagentsHost {
  /** DSH Cordis context the providers are mounted on; it must provide `subagents` and `subprocess`. */
  readonly context: Context
  readonly settings: () => Settings
  /** The `subagents` health entry. */
  readonly health: HealthEntry
  readonly lifetime: AbortSignal
  /** Working directory of availability checks. */
  readonly cwd: string
  readonly load?: ProviderLoader
  readonly probe?: Probe
}

/** A mounted provider: the command and environment it was mounted with, and its fiber. */
interface Mount { key: string; fiber: Fiber }
/** One provider's state, as the panel reads it. */
export interface SubagentStatus { enabled: boolean; mounted: boolean; available: boolean | null; version: string; error: string }

/** The environment a provider's children get: the configured variables, and Claude Code's model as ANTHROPIC_MODEL. */
export function providerEnv(config: SubagentsConfig, provider: SubagentProvider): Record<string, string> {
  if (provider === 'codex') return { ...config.codex.env }
  const { env, model } = config.claudeCode
  return { ...env, ...model ? { ANTHROPIC_MODEL: model } : {} }
}

/**
 * Owns the Claude Code and Codex subagent providers: mounts each enabled one from the Subagents settings, remounts it when its
 * command or environment changes, checks its CLI with `<command> --version`, and reports the `subagents` health entry.
 * `Settings` calls `check` before saving the block and `sync` after; the worker preset's delegation tools appear while their
 * provider is mounted.
 */
export class Subagents {
  private readonly mounts = new Map<SubagentProvider, Mount>()
  private readonly checks = new Map<SubagentProvider, { available: boolean; version: string; error: string }>()
  /** The sync that runs, which a later one waits for so mounts change one at a time. */
  private queue: Promise<void> = Promise.resolve()
  constructor(private readonly host: SubagentsHost) {}
  /** Mounts the enabled providers of the current settings; a failed check or mount is reported in health, not thrown. */
  install(): Promise<void> { return this.sync() }
  /**
   * Refuses a save that enables a provider whose CLI does not start, or changes the command of an enabled one to such a CLI.
   * @throws UserError (`subagentUnavailable`) naming the provider and what its check printed.
   */
  async check(candidate: SubagentsConfig, current: SubagentsConfig): Promise<void> {
    for (const provider of SUBAGENT_PROVIDERS) {
      const next = candidate[KEYS[provider]], before = current[KEYS[provider]]
      if (!next.enabled || (before.enabled && before.command === next.command)) continue
      const result = await this.probe(provider, next.command)
      if (!result.available) throw new UserError('subagentUnavailable', { provider: LABELS[provider], error: result.error })
    }
  }
  /** Brings the mounted providers in line with the current settings, one change at a time. */
  sync(): Promise<void> {
    const run = this.queue.then(() => this.apply())
    this.queue = run.catch(() => {})
    return run
  }
  /** Each provider's state: enabled, mounted, and what its last check found (`available: null` before any check). */
  status(): Record<SubagentProvider, SubagentStatus> {
    const config = this.host.settings().subagents
    return Object.fromEntries(SUBAGENT_PROVIDERS.map(provider => {
      const checked = this.checks.get(provider)
      return [provider, { enabled: config[KEYS[provider]].enabled, mounted: this.mounts.has(provider), available: checked?.available ?? null,
        version: checked?.version ?? '', error: checked?.error ?? '' }]
    })) as Record<SubagentProvider, SubagentStatus>
  }
  /** Unmounts every provider. */
  async dispose(): Promise<void> {
    await this.queue
    const mounts = [...this.mounts.values()]
    this.mounts.clear()
    await Promise.allSettled(mounts.map(mount => mount.fiber.dispose()))
  }
  private async apply(): Promise<void> {
    const config = this.host.settings().subagents
    const failures: string[] = []
    for (const provider of SUBAGENT_PROVIDERS) {
      const settings = config[KEYS[provider]]
      const env = providerEnv(config, provider)
      const key = settings.enabled ? JSON.stringify([settings.command, env]) : ''
      const mounted = this.mounts.get(provider)
      if (mounted?.key === key || (!mounted && !key)) continue
      if (mounted) { this.mounts.delete(provider); await mounted.fiber.dispose().catch(() => {}) }
      if (!key || this.host.lifetime.aborted) continue
      const checked = await this.probe(provider, settings.command)
      if (!checked.available) { failures.push(`${LABELS[provider]}: ${checked.error}`); continue }
      try {
        const plugin = await (this.host.load ?? loadProvider)(provider)
        const fiber = await (this.host.context.plugin as (plugin: unknown, config: unknown) => PromiseLike<Fiber>)(plugin, { env })
        this.mounts.set(provider, { key, fiber })
      } catch (error) { failures.push(`${LABELS[provider]}: ${error instanceof Error ? error.message : String(error)}`) }
    }
    this.report(failures)
  }
  private async probe(provider: SubagentProvider, command: string) {
    const { host } = this
    const signal = AbortSignal.any([host.lifetime, AbortSignal.timeout(PROBE_TIMEOUT_MS)])
    const run = host.probe ?? ((argv: string[], abort: AbortSignal) => runAsWorker(host.context.subprocess, argv, host.cwd, abort))
    const result = await run([command, '--version'], signal)
      .then(output => ({ available: true, version: output.trim().split('\n')[0] ?? '', error: '' }),
        (error: unknown) => ({ available: false, version: '', error: error instanceof Error ? error.message : String(error) }))
    this.checks.set(provider, result)
    return result
  }
  private report(failures: string[]): void {
    const on = SUBAGENT_PROVIDERS.filter(provider => this.mounts.has(provider))
    const versions = on.map(provider => `${LABELS[provider]} ${this.checks.get(provider)?.version || 'ready'}`)
    this.host.health.set(failures.length ? { state: 'error', detail: failures.join('; '), at: now() }
      : { state: 'ready', detail: versions.length ? versions.join('; ') : 'No subagent is enabled', at: now() })
  }
}

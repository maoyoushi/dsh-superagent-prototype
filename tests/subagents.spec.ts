/** The Claude Code and Codex subagent providers: availability checks, mounting from settings, health, and the Subagents block. */
import { Context } from '@deepseek-ai/cordis'
import { afterEach, expect, it, vi } from 'vitest'
import { UserError } from '../src/core/index.ts'
import type { Health } from '../src/sources/host.ts'
import { SettingsSchema, SubagentsConfigSchema, type Settings, type SubagentProvider } from '../src/policy.ts'
import { Subagents, providerEnv, type Probe, type ProviderPlugin } from '../src/app/subagents.ts'
import { chat, startRuntime, type Host } from './fixtures/host.ts'

/** A Subagents on a bare Cordis context, with fake providers that record what they were mounted with and when they were released. */
function harness(probe: Probe) {
  let settings: Settings = SettingsSchema.parse({})
  let health: Health | undefined
  const mounted: { provider: SubagentProvider; env: Record<string, string> }[] = [], released: SubagentProvider[] = []
  const plugin = (provider: SubagentProvider): ProviderPlugin => ({ name: `fake-${provider}`, apply: (ctx, config) => {
    mounted.push({ provider, env: config.env ?? {} })
    ctx.effect(() => () => { released.push(provider) })
  } })
  const subagents = new Subagents({ context: new Context(), settings: () => settings, lifetime: new AbortController().signal, cwd: '/tmp',
    health: { get: () => health, set: value => { health = value }, release: () => {} }, probe, load: async provider => plugin(provider) })
  const set = (value: unknown) => { settings = SettingsSchema.parse({ subagents: value }) }
  return { subagents, mounted, released, set, health: () => health, current: () => settings.subagents }
}
const versions: Probe = async argv => argv[0] === 'claude' ? '2.1.327 (Claude Code)\n' : 'codex-cli 0.158.0\n'
const missing: Probe = async argv => { throw new Error(`${argv[0]} is not an executable file on PATH`) }

it('mounts each enabled provider once with its environment, and Claude Code\'s model as ANTHROPIC_MODEL', async () => {
  const h = harness(versions)
  h.set({ claudeCode: { enabled: true, model: 'claude-opus-5-5', env: { ANTHROPIC_BASE_URL: 'https://example.test' } }, codex: { enabled: true } })
  await h.subagents.install()
  await h.subagents.sync()
  expect(h.mounted).toEqual([{ provider: 'claude-code', env: { ANTHROPIC_BASE_URL: 'https://example.test', ANTHROPIC_MODEL: 'claude-opus-5-5' } },
    { provider: 'codex', env: {} }])
  expect(h.health()).toMatchObject({ state: 'ready', detail: 'Claude Code 2.1.327 (Claude Code); Codex codex-cli 0.158.0' })
  expect(h.subagents.status().codex).toEqual({ enabled: true, mounted: true, available: true, version: 'codex-cli 0.158.0', error: '' })
})

it('remounts a provider whose environment changed, and releases one that was disabled', async () => {
  const h = harness(versions)
  h.set({ claudeCode: { enabled: true }, codex: { enabled: true } })
  await h.subagents.install()
  h.set({ claudeCode: { enabled: true, model: 'claude-sonnet-5-5' }, codex: { enabled: false } })
  await h.subagents.sync()
  expect([...h.released].sort()).toEqual(['claude-code', 'codex'])
  expect(h.mounted.map(item => item.provider)).toEqual(['claude-code', 'codex', 'claude-code'])
  expect(h.subagents.status()).toMatchObject({ 'claude-code': { mounted: true }, codex: { enabled: false, mounted: false } })
  await h.subagents.dispose()
  expect(h.released.filter(item => item === 'claude-code')).toHaveLength(2)
})

it('refuses to enable a provider whose CLI does not start, and reports one that stopped starting in health without mounting it', async () => {
  const h = harness(missing)
  const enable = SubagentsConfigSchema.parse({ codex: { enabled: true } })
  await expect(h.subagents.check(enable, h.current())).rejects.toThrow(UserError)
  await expect(h.subagents.check(enable, h.current())).rejects.toMatchObject({ code: 'subagentUnavailable',
    values: { provider: 'Codex', error: 'codex is not an executable file on PATH' } })
  // A provider already on, whose command is unchanged, is not checked again on a save of another field.
  await expect(h.subagents.check({ ...enable, maxSubtaskMinutes: 30 }, enable)).resolves.toBeUndefined()
  h.set({ codex: { enabled: true } })
  await h.subagents.install()
  expect(h.mounted).toEqual([])
  expect(h.health()).toMatchObject({ state: 'error', detail: 'Codex: codex is not an executable file on PATH' })
  expect(h.subagents.status().codex).toMatchObject({ enabled: true, mounted: false, available: false })
})

it('reports no enabled subagent as ready, and passes only configured variables to Codex', async () => {
  const h = harness(versions)
  await h.subagents.install()
  expect(h.health()).toMatchObject({ state: 'ready', detail: 'No subagent is enabled' })
  expect(providerEnv(SubagentsConfigSchema.parse({ codex: { env: { OPENAI_API_KEY: 'sk-test' } }, claudeCode: { model: 'x' } }), 'codex'))
    .toEqual({ OPENAI_API_KEY: 'sk-test' })
})

let host: Host | undefined
afterEach(async () => { await host?.stop(); host = undefined })

it('saves the Subagents block from the panel only, hides its environment values from Sessions, and records which variables changed', async () => {
  host = await startRuntime()
  const { runtime } = host
  vi.spyOn(runtime.subagents, 'sync').mockResolvedValue()
  const value = { ...runtime.store.settings().subagents, codex: { enabled: false, command: 'codex', env: { OPENAI_API_KEY: 'sk-secret' } },
    roles: { develop: 'codex', verify: 'claude-code', review: 'worker' } }
  const saved = await host.api('PUT', 'settings/subagents', { value, revision: 0 })
  expect(saved).toMatchObject({ status: 200, body: { revision: 1 } })
  expect(runtime.store.settings().subagents).toMatchObject({ codex: { env: { OPENAI_API_KEY: 'sk-secret' } }, roles: { develop: 'codex' } })
  expect(runtime.subagents.sync).toHaveBeenCalledOnce()
  // The main Session reads the block with its values hidden, and cannot save it.
  expect(runtime.settings.block('subagents').value).toMatchObject({ codex: { env: { OPENAI_API_KEY: '***' } } })
  expect(JSON.stringify(runtime.settings.view())).not.toContain('sk-secret')
  await expect(runtime.settings.save('subagents', value, 1, 'tool')).rejects.toMatchObject({ code: 'panelOnlySubagents' })
  const history = await host.api('GET', 'policy/history')
  const latest = (history.body.items as { block?: string; changes: { code: string; items?: string[] }[] }[])[0]!
  expect(latest.block).toBe('subagents')
  expect(latest.changes).toEqual(expect.arrayContaining([{ code: 'subagentEnv', name: 'Codex', items: ['OPENAI_API_KEY'] }, { code: 'subagentRoles' }]))
  expect(JSON.stringify(history.body)).not.toContain('sk-secret')
  const view = await host.api('GET', 'settings')
  expect(view.body).toMatchObject({ blocks: { subagents: { revision: 1 } }, subagents: { codex: { enabled: false } } })
  expect(runtime.health.subagents).toMatchObject({ state: 'ready' })
})

it('names each role\'s tool and the subtask bound in a ticket\'s execution environment, worker for the Executor itself', async () => {
  host = await startRuntime()
  const { runtime } = host
  const settings = runtime.store.settings()
  runtime.store.saveSettings({ ...settings, subagents: { ...settings.subagents, roles: { develop: 'codex', verify: 'worker', review: 'claude-code' },
    maxSubtaskMinutes: 45 } })
  const { ticket } = await host.acceptedTicket(chat('1', '修复登录页'))
  expect(Object.fromEntries(runtime.ticketEnvironment(ticket).map(variable => [variable.key, variable.value]))).toMatchObject({
    SUPER_CODING_AGENT_DEVELOP_TOOL: 'subagent_codex', SUPER_CODING_AGENT_VERIFY_TOOL: 'worker', SUPER_CODING_AGENT_REVIEW_TOOL: 'subagent_claude_code',
    SUPER_CODING_AGENT_SUBTASK_MINUTES: '45' })
})

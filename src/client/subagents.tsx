/** The Subagents settings: the Claude Code and Codex providers with their availability, the roles of a delegated subtask, and its time bound. */
import type { SettingsView } from './api.ts'
import { LIMITS } from '../limits.ts'
import { InfoTip, Input, Switch } from './controls.tsx'
import { SaveBar } from './draft.tsx'
import { usePanel } from './provider.tsx'
import { Field, Fields, numberOf, useBlockDraft, useSettings } from './settings-kit.tsx'
import { Section } from './widgets.tsx'
import type { DshSuperagentKey } from './locales.ts'

type Config = SettingsView['blocks']['subagents']['value']
type Status = SettingsView['subagents']['codex']
type ProviderKey = 'claudeCode' | 'codex'
const PROVIDERS = [{ key: 'claudeCode', id: 'claude-code', label: 'Claude Code' }, { key: 'codex', id: 'codex', label: 'Codex' }] as const
const ROLES = ['develop', 'verify', 'review'] as const
const ROLE_OPTIONS = ['claude-code', 'codex', 'worker'] as const

/** `NAME=value` lines, one variable per line; blank lines and lines without `=` are dropped. */
export const envText = (env: Record<string, string>): string => Object.entries(env).map(([name, value]) => `${name}=${value}`).join('\n')
export function envOf(text: string): Record<string, string> {
  return Object.fromEntries(text.split('\n').map(line => line.trim()).filter(line => line.includes('=')).map(line => {
    const at = line.indexOf('=')
    return [line.slice(0, at).trim(), line.slice(at + 1)]
  }))
}

/** What a provider's last availability check found, in words. */
function availability(t: (key: DshSuperagentKey, values?: Record<string, string>) => string, status: Status): string {
  if (!status.enabled) return t('subagentOff')
  if (status.available === false) return t('subagentUnavailableNow', { error: status.error })
  if (status.mounted) return t('subagentReady', { version: status.version || '—' })
  return t('subagentChecking')
}

export function SubagentSettings() {
  const { t } = usePanel()
  const { blocks, subagents: status } = useSettings().settings
  const config = blocks.subagents.value
  // Environment variables and the time bound stay as typed in the draft, and are parsed once on save.
  const saved = { ...config, maxSubtaskMinutes: String(config.maxSubtaskMinutes), claudeEnv: envText(config.claudeCode.env),
    codexEnv: envText(config.codex.env) }
  const draft = useBlockDraft('subagents', saved, blocks.subagents.revision, ({ claudeEnv, codexEnv, ...value }): Config => ({ ...value,
    maxSubtaskMinutes: numberOf(value.maxSubtaskMinutes) ?? 0, claudeCode: { ...value.claudeCode, env: envOf(claudeEnv) },
    codex: { ...value.codex, env: envOf(codexEnv) } }))
  const value = draft.value
  const edit = (next: Partial<typeof value>) => draft.edit({ ...value, ...next })
  const provider = (key: ProviderKey, next: Partial<Config[ProviderKey]>) => edit({ [key]: { ...value[key], ...next } } as Partial<typeof value>)
  return <form className="dt-form" onSubmit={event => { void draft.submit(event) }}>
    <Fields disabled={draft.busy}>
      <div className="dt-form dt-block">
        <h2 className="dt-block-title">{t('subagentsTitle')}<InfoTip text={t('subagentsIntro')} /></h2>
        {PROVIDERS.map(({ key, id, label }) => <Section key={key} title={label}>
          <p className={status[id].available === false && status[id].enabled ? 'dt-error' : 'dt-hint'}>{availability(t, status[id])}</p>
          <div className="dt-switch-row">
            <div className="dt-field-head">{t('subagentEnabled', { name: label })}</div>
            <Switch checked={value[key].enabled} label={t('subagentEnabled', { name: label })}
              onChange={enabled => provider(key, { enabled })} />
          </div>
          <Field label={t('subagentCommand', { name: label })} hint={t('subagentCommandHint')}>
            <Input className="dt-mono" required spellCheck={false} value={value[key].command}
              onChange={event => provider(key, { command: event.target.value })} />
          </Field>
          {key === 'claudeCode' && <Field label={t('subagentModel')} hint={t('subagentModelHint')}>
            <Input className="dt-mono" spellCheck={false} placeholder={t('subagentModelDefault')} value={value.claudeCode.model}
              onChange={event => provider('claudeCode', { model: event.target.value })} />
          </Field>}
          <Field label={t('subagentEnv', { name: label })} hint={t('subagentEnvHint')}>
            <textarea className="dt-textarea dt-mono" rows={2} spellCheck={false} placeholder="NAME=value"
              value={key === 'claudeCode' ? value.claudeEnv : value.codexEnv}
              onChange={event => edit(key === 'claudeCode' ? { claudeEnv: event.target.value } : { codexEnv: event.target.value })} />
          </Field>
        </Section>)}
        <Section title={t('subagentRoles')} hint={t('subagentRolesHint')}>
          {ROLES.map(role => <Field key={role} label={t(`subagentRole.${role}`)}>
            <select className="dt-select" value={value.roles[role]}
              onChange={event => edit({ roles: { ...value.roles, [role]: event.target.value as typeof ROLE_OPTIONS[number] } })}>
              {ROLE_OPTIONS.map(option => <option key={option} value={option}>{t(`subagentWho.${option}`)}</option>)}
            </select>
          </Field>)}
        </Section>
        <Field label={t('subagentMinutes')} hint={t('subagentMinutesHint')}>
          <Input type="number" min={LIMITS.subtaskMinutes.min} max={LIMITS.subtaskMinutes.max} required value={value.maxSubtaskMinutes}
            onChange={event => edit({ maxSubtaskMinutes: event.target.value })} />
        </Field>
      </div>
    </Fields>
    <SaveBar {...draft} onDiscard={draft.discard} />
  </form>
}

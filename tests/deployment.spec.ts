import { execFile } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Config, executable, machineOf, resolveDeployment, type Machine, type Probe } from '../src/deployment.ts'
import { gitEnv } from './fixtures/git.ts'

const exec = promisify(execFile)
let dir: string
let path: string
const program = (file: string, body = ''): string => { writeFileSync(file, `#!/bin/sh\n${body}\n`); chmodSync(file, 0o755); return file }
const minimal = (overrides: Record<string, unknown> = {}) => ({ stateDir: join(dir, 'state'), ...overrides })
const machine = (overrides: Partial<Machine> = {}): Machine => ({ ...machineOf(Config(minimal())), ...overrides })
/** Runs commands like worker shells do, but locally, with the system's git. */
const probe: Probe = async argv => (await exec(argv[0]!, argv.slice(1), { env: gitEnv({ PATH: path, HOME: dir }) })).stdout
const setupError = (place: string, code: string, values: Record<string, unknown> = {}) => expect.objectContaining({ place, code, values: expect.objectContaining(values) })

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'deployment-'))
  mkdirSync(join(dir, 'bin')); mkdirSync(join(dir, 'state', 'worker-bin'), { recursive: true }); mkdirSync(join(dir, 'widgets'))
  path = [join(dir, 'state-link', 'worker-bin'), `${join(dir, 'state', 'worker-bin')}/`, join(dir, 'bin'), '/usr/bin', '/bin'].join(':')
  program(join(dir, 'bin', 'tool'))
  // Stale worker shims with the same binary name must be skipped regardless of PATH normalization or symlinks.
  program(join(dir, 'state', 'worker-bin', 'tool'))
  symlinkSync(join(dir, 'state'), join(dir, 'state-link'))
  await exec('git', ['init', '-q', join(dir, 'widgets')], { env: gitEnv() })
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

// Setup spawns CLI subprocesses that can take several seconds when tests run in parallel.
vi.setConfig({ testTimeout: 30_000 })

describe('configuration schema', () => {
  it('requires only the state directory and reads the editable fields through references', () => {
    expect(() => Config({})).toThrow('stateDir')
    const read = machineOf(Config({ stateDir: join(dir, 'state') }))
    // Limits are volatile references that the loader updates in place and callers read when used.
    expect({ ...read, promptMaxChars: read.promptMaxChars.get(), admissionContextMaxPages: read.admissionContextMaxPages.get(),
      admissionContextTimeoutMs: read.admissionContextTimeoutMs.get() })
      .toEqual({ stateDir: join(dir, 'state'), promptMaxChars: 100000, admissionContextMaxPages: 10, admissionContextTimeoutMs: 15000 })
    expect(() => Config(minimal({ stateDir: 'relative/dir' }))).toThrow()
    expect(() => Config(minimal({ stateDir: '~/dir' }))).toThrow()
  })
  it('names keys the configuration does not define, and where the values of older keys live now', () => {
    const raw = minimal({ repository: 'acme/widgets', repositoryPath: '/srv/widgets', blockedCommands: [], author: { name: 'Alice' }, extra: 1 })
    expect(() => machineOf(Config(raw))).toThrow('keys it does not use: repository (now on the plan Source), repositoryPath (now in the prepare command of the Execution settings), blockedCommands (now in the Execution settings), author (now prompt text), extra;')
  })
})

describe('setup', () => {
  it('resolves the local checkout the plan Source names', async () => {
    const repository = join(dir, 'widgets'), host = machine()
    expect(await resolveDeployment(host, { repository, patterns: [{ pattern: 'plans/**/*.md' }], pollSeconds: 30 }, probe))
      .toEqual({ ...host, repository })
    // Plans need no directory of their own: a checkout with no plans folder resolves too.
    expect((await resolveDeployment(machine(), { repository }, probe)).repository).toBe(repository)
  })
  it('names what is missing: the repository, a directory at its path, a git checkout there', async () => {
    const needs = (code: string, values: Record<string, unknown>, plan: unknown) =>
      expect(resolveDeployment(machine(), plan, probe)).rejects.toEqual(setupError('plan', code, values))
    await needs('repositoryUnset', {}, undefined)
    await needs('repositoryUnset', {}, { repository: '  ' })
    await needs('repositoryMissing', { repository: join(dir, 'nowhere') }, { repository: join(dir, 'nowhere') })
    await needs('repositoryMissing', { repository: 'widgets' }, { repository: 'widgets' })
    writeFileSync(join(dir, 'file'), '')
    await needs('repositoryMissing', { repository: join(dir, 'file') }, { repository: join(dir, 'file') })
    mkdirSync(join(dir, 'plain'))
    await needs('repositoryNotGit', { repository: join(dir, 'plain'), output: expect.stringContaining('not a git repository') }, { repository: join(dir, 'plain') })
  })
  it('finds an executable by name on PATH, skipping the worker shims', () => {
    expect(executable('tool', path, join(dir, 'state', 'worker-bin'))).toBe(join(dir, 'bin', 'tool'))
    expect(() => executable('nothing-here', join(dir, 'bin'))).toThrow('nothing-here is not an executable file on PATH')
    expect(() => executable('bin/tool', path)).toThrow('must be a command name or an absolute path')
  })
})

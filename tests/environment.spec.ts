import { execFile, spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SENSITIVE_ENV_PATTERN, type SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { GIT_LOCATION, WORKER_COMMANDS, agentVariables, runAsWorker, verifyEnvironment, withoutDirectory, workerBin, writeEnvironment }
  from '../src/infra/environment.ts'
import { CliError } from '../src/infra/commands.ts'
import { testDeployment } from './fixtures/deployment.ts'
import { gitEnv } from './fixtures/git.ts'

// Git and shell subprocesses can exceed the 5s default timeout when the test suite runs in parallel.
vi.setConfig({ testTimeout: 30_000 })
const exec = promisify(execFile)
let dir: string
const program = (path: string, body: string): string => { writeFileSync(path, `#!/bin/sh\n${body}\n`); chmodSync(path, 0o755); return path }
/** Worker shell environment after DSH strips credential-shaped variables. */
const workerEnv = (env: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined && !SENSITIVE_ENV_PATTERN.test(entry[0])))
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'environment-')); mkdirSync(join(dir, 'real')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('worker shims', () => {
  it('make each blocked command fail by name, and shim none of the commands workers need', async () => {
    await writeEnvironment(testDeployment({ stateDir: dir }), ['personal-cli', ...WORKER_COMMANDS])
    const bin = workerBin(dir)
    expect(WORKER_COMMANDS).toEqual(['git', 'claude', 'codex'])
    expect(readdirSync(bin)).toEqual(['personal-cli'])
    await expect(exec(join(bin, 'personal-cli'), [])).rejects.toMatchObject({ code: 1, stderr: 'personal-cli is blocked in this installation.\n' })
    // A blocked command reached by name through PATH fails too, while the other PATH entries still resolve.
    program(join(dir, 'real', 'personal-cli'), 'echo real')
    program(join(dir, 'real', 'other-cli'), 'echo other')
    const path = [bin, join(dir, 'real'), '/usr/bin', '/bin'].join(':')
    await expect(exec('personal-cli', [], { env: { PATH: path } })).rejects.toMatchObject({ code: 1 })
    expect((await exec('other-cli', [], { env: { PATH: path } })).stdout).toBe('other\n')
    // It writes no git configuration of its own.
    expect(readdirSync(dir).sort()).toEqual(['real', 'worker-bin'])
  })
  it('replace only what dsh-superagent wrote and refuse anything else in its places', async () => {
    await writeEnvironment(testDeployment({ stateDir: dir }), ['old-cli', 'kept-cli'])
    await writeEnvironment(testDeployment({ stateDir: dir }), ['kept-cli'])
    expect(readdirSync(workerBin(dir)).sort()).toEqual(['kept-cli'])
    // A file that merely contains the marker on a later line, and a symlink to a shim, are rejected.
    writeFileSync(join(workerBin(dir), 'notes'), `notes\nmore\n${readFileSync(join(workerBin(dir), 'kept-cli'), 'utf8').split('\n')[1]}\n`)
    await expect(writeEnvironment(testDeployment({ stateDir: dir }), [])).rejects.toThrow(`${join(workerBin(dir), 'notes')} was not written by dsh-superagent`)
    expect(readdirSync(workerBin(dir)).sort()).toEqual(['kept-cli', 'notes'])
    rmSync(join(workerBin(dir), 'notes'))
    symlinkSync(join(workerBin(dir), 'kept-cli'), join(workerBin(dir), 'link'))
    await expect(writeEnvironment(testDeployment({ stateDir: dir }), [])).rejects.toThrow('link was not written by dsh-superagent')
    rmSync(join(workerBin(dir), 'link'))
    await writeEnvironment(testDeployment({ stateDir: dir }), [])
    expect(readdirSync(workerBin(dir))).toEqual([])
  })
  it('replaces the files it wrote under the project\'s earlier names', async () => {
    await writeEnvironment(testDeployment({ stateDir: dir }), ['old-cli', 'older-cli', 'oldest-cli'])
    const legacy = (file: string, name: string) => writeFileSync(file, readFileSync(file, 'utf8').replace('Written by dsh-superagent', `Written by ${name}`))
    legacy(join(workerBin(dir), 'old-cli'), 'dsh-tag'); legacy(join(workerBin(dir), 'older-cli'), 'dsh-freelancer'); legacy(join(workerBin(dir), 'oldest-cli'), 'dsh-go')
    await writeEnvironment(testDeployment({ stateDir: dir }), ['old-cli'])
    expect(readdirSync(workerBin(dir))).toEqual(['old-cli'])
    expect(readFileSync(join(workerBin(dir), 'old-cli'), 'utf8')).toContain('Written by dsh-superagent')
  })
})

describe('worker git', () => {
  it('commits with the operator\'s own global git identity and configuration, also after DSH drops credential-shaped variables', async () => {
    const home = join(dir, 'home'); mkdirSync(home)
    writeFileSync(join(home, '.gitconfig'), '[user]\n\tname = Operator Person\n\temail = operator@example.com\n[core]\n\tabbrev = 9\n')
    // Configuration passed through the environment, as `git -c` in a parent process leaves it, is cleared.
    const env = workerEnv({ ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), GIT_CONFIG_GLOBAL: undefined, GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: undefined, GIT_AUTHOR_EMAIL: undefined, GIT_COMMITTER_NAME: undefined, GIT_COMMITTER_EMAIL: undefined,
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.email', GIT_CONFIG_VALUE_0: 'injected@example.com', ...agentVariables() })
    expect(agentVariables()).not.toHaveProperty('GIT_CONFIG_GLOBAL')
    expect(agentVariables()).not.toHaveProperty('GIT_CONFIG_NOSYSTEM')
    expect(agentVariables()).not.toHaveProperty('GIT_AUTHOR_NAME')
    const git = async (...args: string[]): Promise<string> => (await exec('git', args, { cwd: dir, env })).stdout.trim()
    await git('init', '-q', 'repo')
    expect(await git('-C', 'repo', 'config', 'user.email')).toBe('operator@example.com')
    expect(await git('-C', 'repo', 'config', 'core.abbrev')).toBe('9')
    await git('-C', 'repo', 'commit', '--allow-empty', '-q', '-m', 'worker commit')
    expect(await git('-C', 'repo', 'log', '-1', '--format=%an <%ae> / %cn <%ce>'))
      .toBe('Operator Person <operator@example.com> / Operator Person <operator@example.com>')
  })
  it('fails instead of asking the operator\'s askpass helpers when no credential helper has an answer', async () => {
    const log = join(dir, 'asked')
    const askpass = program(join(dir, 'askpass'), `echo asked >> ${log}; echo operator-secret`)
    const env = workerEnv({ PATH: process.env.PATH, HOME: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_ASKPASS: askpass, SSH_ASKPASS: askpass, ...agentVariables() })
    await exec('git', ['init', '-q', 'repo'], { cwd: dir, env })
    await exec('git', ['-C', 'repo', 'config', 'core.askPass', askpass], { cwd: dir, env })
    const fill = exec('git', ['-C', 'repo', 'credential', 'fill'], { cwd: dir, env, timeout: 10_000 })
    fill.child.stdin?.end('protocol=https\nhost=example.com\n\n')
    await expect(fill).rejects.toMatchObject({ stderr: expect.stringContaining('terminal prompts disabled') })
    expect(() => readFileSync(log, 'utf8')).toThrow()
  })
})

it('removes every spelling of a directory from PATH and keeps the other entries', () => {
  mkdirSync(join(dir, 'state', 'worker-bin'), { recursive: true })
  symlinkSync(join(dir, 'state'), join(dir, 'link'))
  const bin = join(dir, 'state', 'worker-bin')
  expect(withoutDirectory([`${bin}/`, join(dir, 'link', 'worker-bin'), '/usr/bin', 'node_modules/.bin'].join(':'), bin)).toBe('/usr/bin:node_modules/.bin')
})

/** Minimal SubprocessRuntime backed by child_process.spawn. */
const subprocess = (): SubprocessRuntime => ({
  spawn: ({ argv, cwd }: { argv: readonly string[]; cwd: string }) => {
    const child = spawn(argv[0]!, argv.slice(1), { cwd, env: gitEnv() })
    const output = { stdout: '', stderr: '' }
    child.stdout.on('data', chunk => { output.stdout += String(chunk) })
    child.stderr.on('data', chunk => { output.stderr += String(chunk) })
    const reader = (name: 'stdout' | 'stderr') => ({ readFrom: () => ({ text: output[name], nextOffset: 0, lossy: false }) })
    const done = new Promise(resolve => child.on('close', code => resolve({ exitCode: code, signal: null })))
    return { done, collected: { stdout: reader('stdout'), stderr: reader('stderr') } }
  },
}) as unknown as SubprocessRuntime
describe('worker commands', () => {
  const signal = new AbortController().signal
  it('report a failed command\'s exit status', async () => {
    const error = await runAsWorker(subprocess(), ['sh', '-c', 'echo nope >&2; exit 3'], dir, signal).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CliError)
    expect(error).toMatchObject({ message: 'nope', exitCode: 3 })
  })
  it('verify that workers can run git, and fail when they cannot', async () => {
    await expect(verifyEnvironment({ stateDir: dir }, subprocess(), signal)).resolves.toBeUndefined()
    const missing = { spawn: () => ({ done: Promise.resolve({ exitCode: 127, signal: null }),
      collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: 'git: command not found' }) } } }) } as unknown as SubprocessRuntime
    await expect(verifyEnvironment({ stateDir: dir }, missing, signal)).rejects.toThrow('git: command not found')
  })
})

describe('the repository the host\'s environment names', () => {
  it('is left alone by the tests\' git and named in no worker\'s environment, as when they run inside `git rebase --exec`', async () => {
    // A scratch repository stands for the one under test, which `git rebase --exec` names in GIT_DIR and GIT_WORK_TREE.
    await exec('git', ['init', '-q', 'scratch'], { cwd: dir, env: gitEnv() })
    const config = () => readFileSync(join(dir, 'scratch', '.git', 'config'), 'utf8')
    const before = config()
    vi.stubEnv('GIT_DIR', join(dir, 'scratch', '.git')); vi.stubEnv('GIT_WORK_TREE', join(dir, 'scratch'))
    // The operator's limit on git's search for a repository names none, and stays.
    vi.stubEnv('GIT_CEILING_DIRECTORIES', dir)
    try {
      // What the tests do: a repository of their own.
      await exec('git', ['init', '-q', 'repo'], { cwd: dir, env: gitEnv() })
      expect(readdirSync(join(dir, 'repo'))).toContain('.git')
      expect(config()).toBe(before)
      // The worker environment, which workers' shells and the host's own commands get, names no repository.
      const env = workerEnv({ ...process.env, ...agentVariables() })
      for (const name of GIT_LOCATION) expect(env, name).not.toHaveProperty(name)
      expect(env.GIT_CEILING_DIRECTORIES).toBe(dir)
      const { stdout } = await exec('git', ['-C', join(dir, 'repo'), 'rev-parse', '--show-toplevel'], { env })
      expect(stdout.trim()).toMatch(/repo$/)
    } finally { vi.unstubAllEnvs() }
  })
})

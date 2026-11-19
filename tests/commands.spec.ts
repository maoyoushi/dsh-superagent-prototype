import { expect, it, vi } from 'vitest'
import { CliError, Commands, commandError } from '../src/infra/commands.ts'
import { testDeployment } from './fixtures/deployment.ts'

const deployment = testDeployment()
const commands = (signal = new AbortController().signal) => new Commands(() => deployment, {}, signal)

it('runs git in the directory it names and preserves literal shell metacharacters in argv', async () => {
  const value = commands(); const run = vi.spyOn(value, 'run').mockResolvedValue('')
  await value.git(['commit', '-m', '`whoami` $(touch x)'], '/work/ticket-1')
  expect(run).toHaveBeenCalledWith('git', ['commit', '-m', '`whoami` $(touch x)'], '/work/ticket-1')
  expect(await commands().run('printf', ['%s', '`whoami` $(touch x)'])).toBe('`whoami` $(touch x)')
})
it('runs every command with its environment over the process environment, where undefined removes a variable', async () => {
  process.env.DSH_SUPERAGENT_AMBIENT = 'host'
  try {
    const output = await new Commands(() => deployment, { DSH_SUPERAGENT_AMBIENT: undefined, DSH_SUPERAGENT_PROBE: 'agent' }, new AbortController().signal).run('env', [])
    expect(output).toContain('DSH_SUPERAGENT_PROBE=agent')
    expect(output).not.toContain('DSH_SUPERAGENT_AMBIENT=')
  } finally { delete process.env.DSH_SUPERAGENT_AMBIENT }
})
it('reports failures that print a JSON error with their code and without command arguments', () => {
  const failed = commandError({ stderr: '[page 1] fetching...\n' + JSON.stringify({ error: { code: 232011, message: 'operator is not in the chat' } }) })
  expect(failed).toMatchObject({ message: 'operator is not in the chat (232011)', code: 232011 })
  expect(commandError({ stderr: JSON.stringify({ error: { code: 999, message: 'scope missing' } }) }).message).toBe('scope missing (999)')
})
it('names only the program and how it ended when a command prints no diagnostics, never its arguments', async () => {
  const value = commands()
  const secret = 'secret reply text'
  await expect(value.run('sh', ['-c', 'exit 3', secret])).rejects.toMatchObject({ message: 'sh exited with code 3', exitCode: 3 })
  await expect(value.run('sh', ['-c', 'kill -9 $$', secret])).rejects.toMatchObject({ message: 'sh was stopped by SIGKILL' })
  await expect(value.run('/no/such/program', ['secret reply text'])).rejects.toMatchObject({ message: 'program could not run: ENOENT' })
  // Timeouts kill the child with SIGTERM; Node's default error message would echo every argument.
  const timedOut = { killed: true, signal: 'SIGTERM', code: null, stderr: '', message: 'Command failed: /path/tool send --text withdrawn' }
  expect(commandError(timedOut, '/path/tool')).toMatchObject({ message: 'tool timed out after 90 s' })
  expect(String(commandError(timedOut, '/path/tool'))).not.toContain('withdrawn')
})
it('reports failures as CliError with the diagnostics the CLI printed and the exit status', async () => {
  const failed = commandError({ stderr: 'fatal: not a git repository\n', code: 128 })
  expect(failed).toBeInstanceOf(CliError)
  expect(failed).toMatchObject({ message: 'fatal: not a git repository', code: undefined, exitCode: 128 })
  expect(commandError({ stderr: JSON.stringify({ error: { code: 230011, message: 'The message is recalled' } }),
    code: 1 })).toMatchObject({ message: 'The message is recalled (230011)', code: 230011, exitCode: 1 })
  await expect(commands().run('sh', ['-c', 'echo boom >&2; exit 2'])).rejects.toMatchObject({ message: 'boom', exitCode: 2 })
  // A cancelled command stays an AbortError so callers can distinguish cancellation from failure.
  const aborted = Object.assign(new Error('The operation was aborted'), { name: 'AbortError', stderr: '' })
  expect(commandError(aborted)).toBe(aborted)
  const controller = new AbortController()
  const running = commands(controller.signal).run('sleep', ['5'])
  controller.abort()
  await expect(running).rejects.toMatchObject({ name: 'AbortError' })
})

it('stops a running command when the signal of its work aborts, or the lifetime, and leaves the other work running', async () => {
  const lifetime = new AbortController(), work = new AbortController()
  const value = commands(lifetime.signal)
  const started = Date.now()
  const running = value.withSignal(work.signal).run('sleep', ['5'])
  work.abort()
  await expect(running).rejects.toThrow()
  // Only commands bound to the aborted work signal stop.
  expect(await value.run('echo', ['still'])).toBe('still\n')
  expect(value.withSignal()).toBe(value)
  const other = value.withSignal(new AbortController().signal).run('sleep', ['5'])
  lifetime.abort()
  await expect(other).rejects.toThrow()
  expect(Date.now() - started).toBeLessThan(4000)
})

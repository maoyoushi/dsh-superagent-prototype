/** The plan Channel: replies to a plan file are appended to its log under `<repository>/.super-coding-agent/logs/`, never to the plan. */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { OutboundMessage } from '../core/index.ts'
import type { SourceChannel } from './kind.ts'

/** The directory, below the repository, that holds each plan file's log; it ignores itself, so the logs stay out of git. */
export const LOG_DIRECTORY = '.super-coding-agent'
/** The log of the plan file at `path` (relative to the repository `root`). */
export const planLog = (root: string, path: string): string => join(root, LOG_DIRECTORY, 'logs', `${path}.log.md`)
/** The marker a sent message leaves in the log, which makes a resend of the same message id a no-op. */
const marker = (id: string): string => `<!-- super-coding-agent message ${id} -->`
const TITLES: Record<OutboundMessage['kind'], string> = { acknowledgement: 'Acknowledgement', reply: 'Reply', notice: 'Notice' }

/** Appends `message` to the log its address names, once per message id. */
export async function sendPlan(message: OutboundMessage): Promise<'sent' | 'gone'> {
  const log = message.channel.address.log
  if (!log) return 'gone'
  const seen = await readFile(log, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return ''; throw error })
  if (seen.includes(marker(message.id))) return 'sent'
  await mkdir(dirname(log), { recursive: true })
  // The log directory ignores itself in git, so replies never show up as changes of the repository.
  const at = log.lastIndexOf(`${sep}${LOG_DIRECTORY}${sep}`), own = log.slice(0, at + LOG_DIRECTORY.length + 1)
  if (at >= 0) await writeFile(join(own, '.gitignore'), '*\n', { flag: 'wx' }).catch(() => { /* Already there. */ })
  const entry = `## ${TITLES[message.kind]} · ${new Date().toISOString()}\n${marker(message.id)}\n\n${message.text.trim()}\n\n`
  await appendFile(log, entry, 'utf8')
  return 'sent'
}
export const planChannel: SourceChannel<Record<string, unknown>> = {
  send: (_host, message) => sendPlan(message),
  link: address => address.file ? { url: pathToFileURL(address.file).href, label: { zh: '计划文件', en: 'Plan file' } }
    : { url: '', label: { zh: '计划文件', en: 'Plan file' } },
}

/** The plan Channel: replies to a plan file are appended to its log under `<plan directory>/.super-coding-agent/`, never to the plan. */
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { OutboundMessage } from '../core/index.ts'
import type { SourceChannel } from './kind.ts'

/** The directory, below the plan directory, that holds each plan file's log. */
export const LOG_DIRECTORY = '.super-coding-agent'
/** The log of the plan file at `path` (relative to the plan directory `root`). */
export const planLog = (root: string, path: string): string => join(root, LOG_DIRECTORY, `${path}.log.md`)
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
  const entry = `## ${TITLES[message.kind]} · ${new Date().toISOString()}\n${marker(message.id)}\n\n${message.text.trim()}\n\n`
  await appendFile(log, entry, 'utf8')
  return 'sent'
}
export const planChannel: SourceChannel<Record<string, unknown>> = {
  send: (_host, message) => sendPlan(message),
  link: address => address.file ? { url: pathToFileURL(address.file).href, label: { zh: '计划文件', en: 'Plan file' } }
    : { url: '', label: { zh: '计划文件', en: 'Plan file' } },
}

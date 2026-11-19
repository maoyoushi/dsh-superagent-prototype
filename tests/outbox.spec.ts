/** Outbox delivery when processing is paused or a Source kind registers late, and the word limit of replies. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { OutboundMessage } from '../src/core/index.ts'
import type { SourceKind } from '../src/sources/kind.ts'
import { IM_WORDS } from '../src/infra/text.ts'
import { chat, chatChannel, startRuntime, type Host } from './fixtures/host.ts'

let h: Host
beforeEach(async () => { h = await startRuntime() })
afterEach(async () => { await h.stop() })
async function at(ms: number) {
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + ms })
  try { await h.runtime.pump(); await h.runtime.sendReplies() } finally { vi.useRealTimers() }
}

it('holds every message while processing is paused, and sends it once processing resumes', async () => {
  await h.runtime.settings.pause(true, 'panel')
  chatChannel.reset()
  h.runtime.outbox.send({ id: 'held', channel: chat('1', 'x').channel!, text: '已合并。', kind: 'notice' })
  await h.runtime.sendReplies()
  expect([h.runtime.outbox.status('held'), chatChannel.sent.length]).toEqual(['pending', 0])
  await h.runtime.settings.pause(false, 'panel')
  await h.runtime.pump(); await h.runtime.sendReplies()
  expect(h.runtime.outbox.status('held')).toBe('sent')
  expect(chatChannel.sent.map(message => [message.id, message.text])).toEqual([['held', '已合并。']])
})

it('keeps a message for a Source that is not installed waiting, and sends it once the Source\'s kind registers', async () => {
  const sent: OutboundMessage[] = []
  const probe: SourceKind<Record<string, never>> = { kind: 'probe', title: { zh: '探针', en: 'Probe' }, description: { zh: '', en: '' }, health: [],
    schema: z.object({}).strict(), fields: [],
    channel: { send: async (_host, message) => { sent.push(message); return 'sent' }, link: () => ({ url: '', label: { zh: '探针', en: 'Probe' } }) } }
  h.runtime.outbox.send({ id: 'waiting', channel: { source: 'probe', thread: 'probe:1', address: {} }, text: 'Done', kind: 'reply' })
  await h.runtime.sendReplies()
  expect([h.runtime.outbox.status('waiting'), h.runtime.health.reply?.state]).toEqual(['pending', 'ready'])
  h.runtime.sources.register(probe)
  // A message whose Source was not installed is tried again after 5 seconds.
  await at(5000)
  expect([h.runtime.outbox.status('waiting'), sent.map(message => message.id)]).toEqual(['sent', ['waiting']])
})

it('refuses a reply longer than the message word limit on every Channel, and leaves no receipt of it', () => {
  const words = (count: number) => Array.from({ length: count }, () => 'word').join(' ')
  const channel = chat('1', 'x').channel!
  expect(() => { h.runtime.outbox.send({ id: 'long', channel, text: words(IM_WORDS + 1), kind: 'reply' }) }).toThrow(`maximum is ${IM_WORDS}`)
  expect(h.runtime.outbox.status('long')).toBeUndefined()
  h.runtime.outbox.send({ id: 'short', channel, text: words(IM_WORDS), kind: 'reply' })
  expect(h.runtime.outbox.status('short')).toBe('pending')
})

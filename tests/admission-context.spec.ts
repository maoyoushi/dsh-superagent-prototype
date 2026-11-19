import { expect, it } from 'vitest'
import { z } from 'zod'
import { admissionContext, threadWindow } from '../src/sources/admission-context.ts'
import type { Commands } from '../src/infra/commands.ts'
import type { ContextMessage, ContextPart, SourceKind } from '../src/sources/kind.ts'
import { SourceRegistry } from '../src/sources/registry.ts'
import { SettingsSchema } from '../src/policy.ts'
import type { Trigger } from '../src/core/index.ts'
const message = (index: number): ContextMessage => ({ id: `om_${index}`, from: 'ou_user', at: String(index), text: `Message ${index}` })
it('returns the thread opening and trigger neighbors with exact internal and trailing gaps', () => {
  const result = threadWindow(Array.from({ length: 40 }, (_, i) => message(i)), 'om_25')
  expect(result.entries.map((item: { position: number }) => item.position)).toEqual([1, 2, 3, 4, 5, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31])
  expect(result.entries[5]?.omitted_before).toBe(15)
  expect(result.omitted_after).toBe(9)
  expect(result.source_found).toBe(true)
})
it('deduplicates overlapping windows and reports an absent source without inventing neighbors', () => {
  const messages = Array.from({ length: 12 }, (_, i) => message(i))
  expect(threadWindow(messages, 'om_3').entries.map((item: { position: number }) => item.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  expect(threadWindow(messages, 'om_absent')).toMatchObject({ source_found: false, loaded_messages: 12, omitted_after: 7 })
})
/** A Source whose Thread reads return the pages given, each named by the cursor that reads it (`first` for the first page). */
function paged(pages: Record<string, ContextPart>) {
  const reads: (string | undefined)[] = []
  const kind: SourceKind<Record<string, never>> = { kind: 'probe', title: { zh: '探针', en: 'Probe' }, description: { zh: '', en: '' }, health: [],
    schema: z.object({}).strict(), fields: [],
    threadContext: { messageId: trigger => String(trigger.meta.messageId), read: async (_commands, _trigger, _part, cursor) => {
      reads.push(cursor)
      return pages[cursor ?? 'first']!
    } } }
  const sources = new SourceRegistry(() => SettingsSchema.parse({}))
  sources.register(kind)
  const trigger: Trigger = { id: 'event', source: 'probe', threads: [{ source: 'probe', id: 'room:om_9' }], actor: { source: 'probe', id: 'ou_user' },
    human: true, text: 'Trigger', at: '', meta: { messageId: 'om_9' } }
  return { context: sources.threadContext(trigger)!, reads }
}
const commands = {} as Commands
it('retains pagination limits and exact loaded counts rather than claiming complete history', async () => {
  const { context, reads } = paged({ first: { messages: [message(0), message(1)], next: 'next', body: {} },
    next: { messages: [message(2)], body: {} } })
  const result = await admissionContext(context, commands, 1)
  expect(result).toMatchObject({ complete: false, next: 'next', window: { loaded_messages: 2, source_found: false } })
  expect(reads).toEqual([undefined])
  // With pages enough, it reads to the end; a message a later page repeats counts once.
  const all = paged({ first: { messages: [message(0), message(1)], next: 'next', body: {} }, next: { messages: [message(1), message(9)], body: {} } })
  expect(await admissionContext(all.context, commands, 5)).toMatchObject({ complete: true, next: null,
    window: { loaded_messages: 3, source_found: true } })
  expect(all.reads).toEqual([undefined, 'next'])
})
it('says how the Source read the Thread, such as the chat around a message outside a topic, and refuses a cursor that repeats', async () => {
  const { context } = paged({ first: { messages: [-2, -1, 9].map(message), status: 'chat_neighbours', body: {} } })
  const result = await admissionContext(context, commands, 3)
  expect(result).toMatchObject({ status: 'chat_neighbours', complete: true, window: { source_found: true, loaded_messages: 3 } })
  expect(result.messages.map(item => item.id)).toEqual(['om_-2', 'om_-1', 'om_9'])
  const looping = paged({ first: { messages: [message(0)], next: 'again', body: {} }, again: { messages: [message(1)], next: 'again', body: {} } })
  await expect(admissionContext(looping.context, commands, 5)).rejects.toThrow('Thread pagination repeated a cursor')
})

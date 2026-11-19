/**
 * A test-only Source kind, `chat`: group chats and direct messages whose senders are people or bots, who address the agent by
 * a mention or a direct message, and whose messages may reply to one another. It exercises what the plan Source cannot
 * express (a bot sender, a message that does not address the agent, a reply that fails or whose conversation is gone, a
 * sender list synced from a chat) without any real chat service: its Channel records what it sends in `chatChannel`.
 */
import { z } from 'zod'
import { key, type OutboundMessage, type ScopeResult, type Trigger } from '../../src/core/index.ts'
import { KV } from '../../src/kv.ts'
import { sourceContext } from '../../src/sources/host.ts'
import type { ContextMessage, SourceKind } from '../../src/sources/kind.ts'

export const CHAT_SOURCE = 'chat'
/** The listed person, the listened group chat, and the agent's own bot identities in the chat service. */
export const MEMBER = 'ou_alice', CHAT = 'oc_team', BOT = 'ou_bot', BOT_APP = 'cli_bot'

/** What the Channel sent, and what its next sends answer: `sent`, `gone`, or a throw for a failure a later retry may fix. */
export const chatChannel = {
  sent: [] as OutboundMessage[],
  answer: (_message: OutboundMessage): 'sent' | 'gone' => 'sent',
  reset() { this.sent.length = 0; this.answer = () => 'sent' },
}
/** Messages a Thread context read returns, by Thread id (`<chat>:<root>`); a Thread without any reads as its Trigger alone. */
export const chatHistory = new Map<string, ContextMessage[]>()
/** The people of each chat a policy sync reads, and the names a label refresh reads, by chat id. */
export const chatDirectory = { members: new Map<string, { id: string; name: string }[]>(), names: {} as Record<string, string>,
  /** Reads a chat's people, as a policy sync does; tests spy on it to delay or fail a read. */
  read: async (chatId: string): Promise<{ id: string; name: string }[] | undefined> => chatDirectory.members.get(chatId) }

const ConfigSchema = z.object({
  chats: z.array(z.object({ chatId: z.string().regex(/^oc_[a-zA-Z0-9]+$/), name: z.string().trim().max(60).optional(), listen: z.enum(['mentions', 'all']) }).strict())
    .refine(chats => new Set(chats.map(chat => chat.chatId)).size === chats.length, 'Duplicate chat IDs').default([]),
  directMessages: z.boolean().default(true),
  otherChats: z.enum(['none', 'mentions']).default('none'),
}).strict()
export type ChatConfig = z.infer<typeof ConfigSchema>

const EventSchema = z.object({ message_id: z.string(), chat_id: z.string(), chat_type: z.enum(['p2p', 'group']),
  sender_id: z.string(), sender_type: z.enum(['user', 'bot', 'app']), content: z.string(), create_time: z.string(),
  mentions: z.array(z.object({ id: z.string(), key: z.string().optional(), name: z.string().optional() })).default([]),
  root_id: z.string().optional(), parent_id: z.string().optional(), url: z.string().optional() })
export const chatThreadId = (chatId: string, rootId: string | undefined, messageId: string): string => `${chatId}:${rootId ?? messageId}`
export const chatTriggerId = (messageId: string): string => key(CHAT_SOURCE, messageId)

/** A Trigger of one chat message, or undefined for the agent's own messages; `create_time` is epoch milliseconds. */
export function chatTrigger(input: unknown): Trigger | undefined {
  const event = EventSchema.parse(input)
  if (event.sender_id === BOT || event.sender_id === BOT_APP) return undefined
  const direct = event.chat_type === 'p2p'
  const mentioned = event.mentions.some(mention => mention.id === BOT || mention.id === BOT_APP)
  const thread = chatThreadId(event.chat_id, event.root_id, event.message_id)
  const text = event.mentions.reduce((result, mention) => mention.key && mention.name ? result.replaceAll(mention.key, `@${mention.name}`) : result, event.content)
  return { id: chatTriggerId(event.message_id), source: CHAT_SOURCE, threads: [{ source: CHAT_SOURCE, id: thread }],
    actor: { source: CHAT_SOURCE, id: event.sender_id }, human: event.sender_type === 'user',
    ...(direct ? { addressed: 'direct' as const } : mentioned ? { addressed: 'mention' as const } : {}),
    at: new Date(Number(event.create_time)).toISOString(), text,
    channel: { source: CHAT_SOURCE, thread: `${CHAT_SOURCE}:${event.chat_id}`, address: { chatId: event.chat_id, messageId: event.message_id, ...direct ? { direct: 'true' } : {} } },
    ...(event.url ? { url: event.url } : {}),
    meta: { chatId: event.chat_id, messageId: event.message_id, direct, mentioned, ...(event.root_id ? { rootId: event.root_id } : {}),
      ...(event.parent_id ? { parentId: event.parent_id } : {}) } }
}

/** Build a mention Trigger from Alice in `oc_team`, using the digits in `id` as the timestamp offset in seconds. */
export function chat(id: string, text: string, overrides: Record<string, unknown> = {}): Trigger {
  const at = String(Date.parse('2026-09-09T00:00:00Z') + Number(id.replace(/\D/g, '') || 0) * 1000)
  return chatTrigger({ message_id: `om_${id}`, chat_id: CHAT, chat_type: 'group', sender_id: MEMBER, sender_type: 'user', content: text, create_time: at,
    mentions: [{ id: BOT }], ...overrides })!
}

const scope = (meta: Record<string, unknown>, config: ChatConfig): ScopeResult => {
  if (meta.direct === true) return config.directMessages ? { listened: true, observed: false, row: 'direct' } : { listened: false, reason: 'direct_messages_not_allowed' }
  const listed = config.chats.find(item => item.chatId === meta.chatId)
  if (listed) return { listened: true, observed: listed.listen === 'all', row: listed.chatId }
  return config.otherChats === 'mentions' ? { listened: true, observed: false, row: 'other' } : { listened: false, reason: 'chat_not_allowed' }
}
const PolicySchema = z.object({
  allowed: z.array(z.object({ id: z.string().regex(/^ou_[a-zA-Z0-9]+$/), name: z.string().trim().max(100).optional() }).strict()).default([]),
  syncChat: z.string().regex(/^(oc_[a-zA-Z0-9]+)?$/).default(''),
  bots: z.array(z.object({ id: z.string().regex(/^(cli|ou)_[a-zA-Z0-9]+$/), name: z.string().trim().max(100).optional() }).strict()).optional(),
}).strict()

export const chatKind: SourceKind<ChatConfig> = {
  kind: CHAT_SOURCE,
  title: { zh: '聊天', en: 'Chat' },
  description: { zh: '测试用的聊天来源。', en: 'A chat Source for tests.' },
  schema: ConfigSchema,
  fields: [
    { key: 'chats', type: 'rows', label: { zh: '接收的群', en: 'Chats' }, columns: [
      { key: 'chatId', type: 'text', label: { zh: '群', en: 'Chat' }, pattern: 'oc_[a-zA-Z0-9]+', choose: { zh: '选择群', en: 'Choose a chat' }, refresh: { zh: '刷新', en: 'Refresh' } },
      { key: 'listen', type: 'select', label: { zh: '接收', en: 'Receive' }, options: [{ value: 'mentions', label: { zh: '仅 @', en: '@ only' } }, { value: 'all', label: { zh: '全部消息', en: 'All' } }] }] },
    { key: 'otherChats', type: 'select', label: { zh: '其他群', en: 'Other chats' }, options: [{ value: 'none', label: { zh: '不接收', en: 'Not received' } }, { value: 'mentions', label: { zh: '仅 @', en: '@ only' } }] },
    { key: 'directMessages', type: 'switch', label: { zh: '接收私聊', en: 'Direct messages' } },
  ],
  // Two parts, as a Source with a listener and a history recovery has: its state is the first that holds of both.
  health: ['chat', 'history'],
  scope: ({ meta }, config) => scope(meta, config),
  channel: {
    allowed: (address, config) => scope({ chatId: address.chatId ?? '', direct: address.direct === 'true' }, config).listened,
    send: async (_host, message) => { const answer = chatChannel.answer(message); chatChannel.sent.push(message); return answer },
    // A link names the Trigger of the message it answers, whose own link the panel prefers.
    link: address => ({ url: address.chatId && address.messageId ? `https://chat.example.test/${address.chatId}/${address.messageId}` : '', label: { zh: '聊天消息', en: 'Chat message' },
      ...address.messageId ? { triggerId: chatTriggerId(address.messageId) } : {} }),
  },
  threadContext: {
    messageId: trigger => String(trigger.meta.messageId ?? trigger.id),
    read: async (_commands, trigger, part) => {
      const thread = trigger.threads[0]!.id
      const own: ContextMessage = { id: String(trigger.meta.messageId ?? trigger.id), from: trigger.actor.id, at: trigger.at, text: trigger.text }
      return part === 'thread' ? { messages: chatHistory.get(thread) ?? [own], body: {} } : { messages: [], body: {} }
    },
    images: text => [...new Set(text.match(/\bimg_[A-Za-z0-9_]+/g) ?? [])],
    image: async (_agent, _commands, _trigger, message, imageKey) => ({ image: imageKey, message: message.id }),
  },
  find: query => ({ threads: [], terms: [...new Set(query.match(/om_[A-Za-z0-9_-]+/g) ?? [])] }),
  repliesTo: trigger => typeof trigger.meta.parentId === 'string' ? chatTriggerId(trigger.meta.parentId) : undefined,
  refreshLabels: async host => {
    const names = { ...chatDirectory.names }
    sourceContext(host, chatKind).state.set(KV.sources.labels(CHAT_SOURCE), names)
    return names
  },
  policy: {
    unnamed: { person: { zh: '聊天用户', en: 'Chat user' }, bot: { zh: '聊天机器人', en: 'Chat bot' } },
    schema: PolicySchema,
    fields: [
      { key: 'allowed', type: 'rows', label: { zh: '能发起工作的人', en: 'People who may originate work' },
        columns: [{ key: 'id', type: 'text', label: { zh: 'ID', en: 'ID' }, pattern: 'ou_[a-zA-Z0-9]+' }, { key: 'name', type: 'text', label: { zh: '名字', en: 'Name' }, optional: true }] },
      { key: 'syncChat', type: 'text', pattern: '(oc_[a-zA-Z0-9]+)?', label: { zh: '同步来源群', en: 'Sync chat' }, choose: { zh: '不同步', en: 'Do not sync' } },
      { key: 'bots', type: 'rows', label: { zh: '消息可以成为候选的机器人', en: 'Bots whose messages may become candidates' },
        columns: [{ key: 'id', type: 'text', label: { zh: 'ID', en: 'ID' }, pattern: '(cli|ou)_[a-zA-Z0-9]+' }, { key: 'name', type: 'text', label: { zh: '名字', en: 'Name' }, optional: true }] },
    ],
    explicit: { zh: '名单内的人 @ 机器人或私聊机器人。', en: 'Someone on the list who mentions the bot or messages it directly.' },
    rows(stored) {
      const config = ConfigSchema.parse(stored)
      const mentions = { zh: '仅 @', en: '@ only' }
      return [
        ...config.chats.map(item => ({ id: item.chatId, label: item.name || item.chatId, note: item.listen === 'all' ? { zh: '全部消息', en: 'All' } : mentions,
          cells: { listedUnaddressed: item.listen === 'all', unlistedAddressed: true, unlistedUnaddressed: item.listen === 'all' } })),
        { id: 'other', label: { zh: '其他群', en: 'Other chats' }, note: config.otherChats === 'mentions' ? mentions : { zh: '不接收', en: 'Not received' },
          cells: { listedUnaddressed: false, unlistedAddressed: config.otherChats === 'mentions', unlistedUnaddressed: false } },
        { id: 'direct', label: { zh: '私聊', en: 'Direct messages' }, note: config.directMessages ? { zh: '接收', en: 'Received' } : { zh: '不接收', en: 'Not received' },
          cells: { listedUnaddressed: false, unlistedAddressed: config.directMessages, unlistedUnaddressed: false } },
      ]
    },
    sync: {
      label: { zh: '立即同步', en: 'Sync now' },
      ready: part => !!part.syncChat,
      async run(_host, part) {
        const members = await chatDirectory.read(String(part.syncChat))
        if (!members) throw new Error(`The chat ${String(part.syncChat)} returned no member list`)
        // Keep the listed order so policy versions stay stable; names follow the chat, and new people join at the end.
        const names = new Map(members.map(person => [person.id, person.name]))
        const known = new Set(part.allowed.map(entry => entry.id))
        return { ...part, allowed: [...part.allowed.filter(entry => names.has(entry.id)).map(entry => ({ ...entry, name: names.get(entry.id)! })),
          ...members.filter(person => !known.has(person.id)).map(person => ({ id: person.id, name: person.name }))] }
      },
    },
  },
}

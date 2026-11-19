# 008 Cookbook

This cookbook shows how to extend super-coding-agent. It uses the terms in [001 Domain model](001-domain.md) and [002 Authorization](002-authorization.md), and the components in [007 Architecture](007-architecture.md).

## Add a Source

A Source turns events from the outside into Triggers and carries replies back. This recipe walks through the plan Source, `src/sources/plan.ts`, `plan-files.ts` and `plan-channel.ts`, as the worked example. A new Source follows the same steps; where the plan Source leaves an interface out, the step says what a Source that reads conversations would add.

The implementation has four responsibilities: translate events, define receiving and authorization rules, provide replies and context, and maintain a polling loop. The numbered steps build those pieces in order.

### 1. Map the events onto the domain

Choose stable mappings before writing code. Trigger ids, Thread ids and Channel addresses are persisted, so changing them later can disconnect existing records.

| Concept | For plan files |
| --- | --- |
| Trigger | One revision of one plan file: its path and the hash of its content |
| Thread | Every revision of one plan file: `plan:<path in the repository>`, such as `plan:docs/plans/login.md` |
| Actor | `operator`, the person who writes the plans, as the allowed list names it |
| Channel address | The plan's path, its absolute file, and its log under `.super-coding-agent/logs/` |
| Receiving scope | None: the Source receives every plan it reads |

A Source that reads conversations maps a message to a Trigger, the message and its replies to a Thread, the sender's own id to the actor, and the conversation it listens to to a receiving scope.

### 2. Configuration: schema, fields, facts and health

```ts
const PlanConfigSchema = z.object({
  repository: z.string().trim().refine(path => path === '' || isAbsolute(path), 'An absolute path').default(''),
  patterns: z.array(z.object({ pattern: z.string().trim().min(1).max(200) }).strict()).max(50)
    .default(() => DEFAULT_PATTERNS.map(pattern => ({ pattern }))),
  pollSeconds: z.number().int().min(5).max(3600).default(30),
  failuresBeforeError: z.number().int().min(1).max(20).default(3),
  includeExisting: z.boolean().default(false),
}).strict()

export const planKind: SourceKind<PlanConfig> = {
  kind: SOURCE,
  title: { zh: '计划文件', en: 'Plan files' },
  description: { zh: '…', en: 'Plan or task files people write in the repository …' },
  schema: PlanConfigSchema,
  fields: [
    { key: 'repository', type: 'text', pattern: '/.*', label: { zh: '仓库目录', en: 'Repository directory' }, hint: { … } },
    { key: 'patterns', type: 'rows', label: { zh: '计划文件的路径模式', en: 'Plan file patterns' }, hint: { … },
      columns: [{ key: 'pattern', type: 'text', label: { zh: '模式', en: 'Pattern' } }] },
    { key: 'includeExisting', type: 'switch', label: { zh: '接收已有的计划', en: 'Receive existing plans' }, hint: { … } },
    { key: 'pollSeconds', type: 'number', advanced: true, min: 5, max: 3600, label: { … } },
    { key: 'failuresBeforeError', type: 'number', advanced: true, min: 1, max: 20, label: { … } }],
  health: ['plan'],
  // channel, threadContext, find, policy and environment follow in the next steps.
}
```

- `kind` is the stable Source id. It appears in Trigger `source`, Thread-key prefixes, the `source:plan` settings block and the Source's part of the Policy.
- `schema` validates stored configuration and supplies defaults. Before an operator saves an instance, the registry creates an enabled instance from those defaults. Make defaults receive nothing harmful: with no repository, setup waits, and with `includeExisting` off, plans already present start nothing.
- `fields` generates the Source settings form without custom panel code. `advanced` hides less common settings. A `rows` field edits a list of records keyed by its first column; a Source that can resolve ids to display names implements `refreshLabels` and saves the names under `KV.sources.labels(kind)`.
- Setup reads Source fields only through `SETUP_FIELDS` in `src/deployment.ts`. The plan Source's `repository` is listed there, so setup checks it, and a change to it restarts super-coding-agent; its `patterns` are not, so a change to them applies at the next round. Optional `facts(deployment)` displays values setup derived; the plan Source has none.
- `health` declares the Source's health entries, initially `starting`. Registration claims each name and refuses collisions with entries such as `runtime`, `reply`, `worker`, `subagents` or effect kinds. Use the kind's name and leave `sync:<id>` for Policy syncs. An `error` makes the status script exit 2 and the hourly check notify the operator, so report it only when human action may be needed.

### 3. Translate an event into a Trigger

`planFiles(root, patterns)` in `plan-files.ts` walks the repository and reads every Markdown file whose repository path matches one of the patterns (`globMatcher`: case-insensitive, `**` spans directories, `*` and `?` stay within one). It skips hidden directories such as `.git` and `.super-coding-agent`, `node_modules`, `vendor` and build output, and stops after 100,000 entries. It gives each plan its repository path, text and content hash, and lists apart the files over 2 MiB and the files and directories it could not read. `planTrigger` turns one into a Trigger:

```ts
export function planTrigger(root: string, plan: PlanFile, revision = 1): Trigger {
  const address = { path: plan.path, file: plan.file, log: planLog(root, plan.path) }
  return { id: key(SOURCE, plan.path, plan.hash, String(revision)), source: SOURCE, threads: [{ source: SOURCE, id: plan.path }], actor: { source: SOURCE, id: OPERATOR },
    human: true, addressed: 'direct', at: plan.at, text: plan.text, channel: { source: SOURCE, thread: `${SOURCE}:${plan.path}`, address },
    url: pathToFileURL(plan.file).href, meta: { path: plan.path, file: plan.file, hash: plan.hash } }
}
```

- **Stable ids.** Derive the Trigger id from the event through `key`. `Engine.receive` returns `duplicate` for stored ids, and duplicate accepts create only one Ticket, so re-reading is safe. The plan Source includes the content hash and the file's revision count, so an edit, or a revert to earlier content, is a new Trigger and an unchanged file is not.
- **Threads.** The first Thread is primary and owns the Eval. Additional Threads add Correlation context. The Source chooses the id; its full key is `plan:<path>`.
- **Sender.** Use Source-native ids in `actor`. Set `human: false` for bots and automated events; a Source that has them lists the bots that may make inferred candidates in its Policy part. Set `addressed` to `mention` or `direct` only when the event actually addresses the agent: this gives an allowed sender's request explicit strength. A plan is written for the agent, so it is `direct`. Never produce a Trigger for the agent's own writes; the plan Source never reads its log directory.
- **Reply destination and metadata.** `channel` identifies where replies go; `url` links to the source. `channel.thread` groups messages for ordered delivery: a Ticket's later messages wait behind its earlier ones until an earlier message has failed three times. Keep Source-specific fields in `meta`. Both `meta` and `text` are untrusted data, not authorization.

Agents read the new kind through `orchestrator_read trigger/<id>` and `thread/<key>`. Text search works without extra code. Implement `find(query)` when people use Source-specific references; the plan Source maps a query ending in `.md`, a repository path or a longer one such as the file's absolute path, to the Thread of each of its path's suffixes:

```ts
  find: query => {
    const parts = query.trim().replace(/^\.?\//, '').split('/')
    if (!/\.md$/i.test(parts.at(-1) ?? '')) return { threads: [], terms: [] }
    return { threads: parts.map((_, at) => `${SOURCE}:${parts.slice(at).join('/')}`), terms: [] }
  },
```

### 4. What the Source receives: scope

The plan Source declares no `scope`: it receives every Trigger it produces and observes none of them, so unaddressed events never reach the admission table. A Source that listens only to some conversations declares `scope({ meta }, config)` and returns `{ listened: false, reason }` for the others, or `{ listened: true, observed, row }`. The Engine calls it through `SourceRegistry` for each incoming Trigger; out-of-scope Triggers are stored as filtered with their reason and create no Thread. `observed: true` means the Source receives unaddressed messages there, which allows admission-table decisions for them, and `row` names the admission row.

Revalidation calls `scope` with the Mandate's stored metadata, so make it depend only on `meta` and configuration. Pass events to `receive` rather than dropping them in the polling loop, so the panel can explain what it filtered.

### 5. Replies: the Channel

```ts
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
```

- **Idempotent sends.** Outbox calls `SourceRegistry.send`, which invokes `channel.send`. A send may fail after the write happened, so retries must not duplicate messages. Use `message.id` as an idempotency key: the plan Channel writes a hidden marker with each entry and appends nothing when it finds it. A Source with a remote service passes the id as the service's idempotency key.
- **Permanent versus retryable failure.** Return `sent` on success and `gone` only when delivery is permanently impossible, such as an address without a log. A gone message is retained as dropped and never queued again. Throw for other failures so Outbox retries after 5 seconds, doubling to 300 seconds. For a CLI, `CliError.code` is the code the CLI's output reports.
- **Allowed destinations.** Optional `allowed(address, config)` checks a saved address against the current configuration; a destination no longer listened to is dropped, while a disabled Source leaves messages waiting. The plan Channel has no `allowed`, so every address is permitted while the Source is on.
- **Links.** `link(address, links)` returns the URL and label the panel displays through `SourceRegistry.link`.
- **Never write the source.** The plan Channel writes the log, not the plan: a write to the plan would change it and produce a new Trigger.

### 6. Thread context for assessments

```ts
  threadContext: {
    messageId: trigger => trigger.id,
    read: async (_commands, trigger, part) => part === 'thread'
      ? { messages: [{ id: trigger.id, from: OPERATOR, at: trigger.at, text: trigger.text, path: String(trigger.meta.path ?? '') }], body: {} }
      : { messages: [], body: {} },
  },
```

Assessment reads the conversation around a Trigger: `orchestrator_eval` reads an initial window, and `orchestrator_eval_read` expands pages, the root or the parent message. A plan is its Thread's one message, so the plan Source returns the Trigger itself.

- `read(commands, trigger, part, cursor, config)` returns a `ContextPart`. Its `messages` use `ContextMessage`: `{id, from, at, text}` plus applicable `bot`, `deleted`, `reply_to`, `url`, `path` and `line` fields. `next` is omitted on the last page. `body` is the content shown to the assessing Session. `part` is `thread`, `root` or `parent`.
- `messageId(trigger)` finds the Trigger's own message among them.
- `images(text)` and `image(…)` are for a kind whose messages carry images; `repliesTo(trigger)` is for one whose messages reply to earlier ones. The plan Source has neither.

A kind without `threadContext` gives assessments no Thread context; the Trigger's own text stays readable.

### 7. Who may ask: the Source's part of the Policy

```ts
  policy: {
    schema: z.object({ allowed: z.array(z.object({ id: z.string().trim().min(1).max(200), name: z.string().trim().max(100).optional() }).strict())
      .default([{ id: OPERATOR, name: 'Operator' }]) }).strict(),
    fields: [{ key: 'allowed', type: 'rows', label: { zh: '能发起工作的发送者', en: 'Senders who may originate work' },
      columns: [{ key: 'id', type: 'text', label: { zh: '发送者', en: 'Sender' } }, { key: 'name', type: 'text', optional: true,
        label: { zh: '名字', en: 'Name' } }] }],
    explicit: { zh: '仓库里新增或修改的计划文件，发送者为 operator。', en: 'A plan file added or changed in the repository, sent by operator.' },
  },
```

- `schema` validates the Source's part of the Policy, including `allowed` sender ids, compared case-insensitively. It is saved at `policy.sources.plan` and contributes to the Policy version. The default of `PolicyConfigSchema` in `src/policy.ts` also lists `operator`, so a fresh install accepts plans at once.
- `fields` generates the form under **Eval → On each Source**, beginning with `allowed`. `explicit` explains what counts as an explicit request.
- A Source that reads conversations adds `rows(config)`, the admission rows of its receiving scopes with the cells each offers, whose ids match the `row` that `scope` returns; optional `bots`, the bots whose messages may become inferred candidates; optional `unnamed`, display labels for opaque sender ids; and optional `sync: {label, ready(part), run(host, part, signal)}`, which refreshes the allowed list at startup and on **Sync now**, reporting failures under `sync:<id>`.

### 8. Variables for the Executor

```ts
  environment: {
    variables: [
      { key: 'SUPER_CODING_AGENT_PLAN_FILE', description: { zh: '…', en: 'Absolute path of this ticket\'s plan file; never edit it' } }],
    values: ({ trigger }) => ({ SUPER_CODING_AGENT_PLAN_FILE: typeof trigger?.meta.file === 'string' ? trigger.meta.file : '' }),
  },
```

Execution settings show declared `variables` beside the prepare command even when the Source is off. While it is on, `values` supplies the values from the deployment, the configuration and the Ticket's originating Trigger. The default prepare command reads `SUPER_CODING_AGENT_REPOSITORY`, which the Executor registers from the deployment so it is set even while the Source is off; the worker reads `SUPER_CODING_AGENT_PLAN_FILE` to find its plan.

Use the `SUPER_CODING_AGENT_` prefix, return an empty value when the Trigger does not carry the fact, and never include credentials.

### 9. The plugin entry and its loop

```ts
export const name = 'super-coding-agent-plan'
export const inject = ['orchestrator']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.orchestrator.sources.register(planKind), 'plan: source kind')
  ctx.effect(() => {
    const source = sourceContext(ctx.orchestrator, planKind)
    const controller = new AbortController()
    // Unhandled rejections terminate the DSH process, so a failure escaping the loop is reported as source health instead.
    const running = watch(source, controller.signal)
      .catch((error: unknown) => { source.report('plan', { state: 'error', detail: String(error) }) })
    return async () => { controller.abort(); await running }
  })
}
async function watch(ctx: SourceContext, signal: AbortSignal): Promise<void> {
  let failures = 0
  await ctx.ready
  if (!ctx.configured()) { ctx.report('plan', health('paused', 'setupPending')); return }
  while (!signal.aborted) {
    const config = ctx.config<PlanConfig>(SOURCE)
    try {
      if (!config) ctx.report('plan', health('paused', 'sourceOff'))
      else await checkPlans(ctx, config)
      failures = 0
    } catch (error) {
      failures += 1
      if (!signal.aborted && failures >= (config?.failuresBeforeError ?? 1)) {
        ctx.report('plan', health('error', 'pollFailures', { count: String(failures), error: String(error) }))
      }
    }
    await pause((ctx.config<PlanConfig>(SOURCE)?.pollSeconds ?? 30) * 1000, signal)
  }
}
```

The plugin injects `orchestrator`. Its first effect registers the kind and unregisters it on disposal. The second runs the loop with a `SourceContext`. Disposal aborts the loop and awaits it, also during a stop or a restart.

`checkPlans(ctx, config)` is one round: it reports `setupPending` while the repository is not an absolute path, reads the plan files, and for each whose hash differs from the one stored under `KV.plan.file(root, path)` calls `ctx.receive(planTrigger(…))`, describes its Thread, and stores the new hash and revision. When the scope is new, the repository and patterns recorded in `KV.plan.root`, a file it has not seen before only sets its baseline unless `includeExisting` is on; a change to a file it knows is still received. A deleted plan is forgotten once, by storing an empty hash with its revision count, so restoring it is received again; a plan too large or unreadable, or in a directory it could not read, is left as it was.

- **Setup and the switch.** Wait for `ctx.ready`, and read nothing while `ctx.configured()` is false: setup restarts super-coding-agent once it resolves. Read `ctx.config(kind)` on every round: it is undefined while the Source is off.
- **Read positions.** Store them in `ctx.state` using typed entries in `KV` (`src/kv.ts`), as `KV.plan` does. `tests/store.spec.ts` requires key literals to appear only in that registry. Setting `undefined` removes a record; `ctx.atomic` groups writes in a transaction. Advance a position only after `receive` stored the Triggers it covers, so an interrupted round reads them again; stable ids make that safe.
- **Thread metadata.** After receiving a Trigger, call `ctx.threads.describe(key, {label, url, facts})` to give its Thread a display name and link; the plan Source uses the plan's path and file URL. `ctx.threads.patch(key, meta)` sets or removes Source-owned keys.
- **Health.** Write only declared entries through `ctx.report`. `health(state, code, values)` gives fixed texts such as `setupPending`, `sourceOff` and `pollFailures`. Count consecutive failures before reporting `error`, and report `ready` with what the round found.
- **Abort.** `pause(ms, signal)` from `src/sources/poll.ts` waits between rounds and ends at once on abort, and fake timers in tests drive it. Pass the signal to every command the round runs.

A Source that needs to send its own notices calls `ctx.notify`; Outbox delivers them like other replies. A Source whose Threads decide when work is done uses `ctx.tickets.bindThread` and `threadClosed`; the Engine still decides when the Ticket ends. The plan Source does neither.

### 10. Register the plugin

Build the module as its own entry in `tsdown.config.ts`:

```ts
entry: { index: 'src/index.ts', 'plan-watch': 'src/sources/plan.ts' },
```

Export the built file in `package.json` (`"./plan-watch": "./lib/plan-watch.js"` under `exports`), and add the plugin to the `insert` list of the bundle's `cordis.patch.yml`:

```yaml
    - id: super-coding-agent-plan
      name: super-coding-agent/plan-watch
```

A new Source follows the same three steps with its own name, such as `webhook-watch`. Insert it with `disabled: true` if it should start off; a profile's `cordis.patch.yml` then enables it with its `id` and `disabled: false`. Build and restart. The Source appears in Sources settings and under **Eval → On each Source**.

Add its module and spec to the module and test tables in [007 Architecture](007-architecture.md). `tests/docs.spec.ts` checks that both indexes are complete.

### 11. Tests

`tests/plan-source.spec.ts` tests the plan Source on a running Runtime: `startRuntime` from `tests/fixtures/host.ts` gives a simulated DeepSeek Harness host with a git checkout whose `plans` directory setup checked, and `h.runtime.context(planKind)` gives the Source's `SourceContext`. The test writes plan files, calls `checkPlans` directly, and reads the stored Triggers and Tickets:

```ts
it('takes the plans present at its first check as a baseline, and receives each added or changed plan as the operator\'s request', async () => {
  write('existing.md', '# Existing plan')
  expect(await checkPlans(ctx, config())).toBe(0)
  write('auth/login.md', '# Login\n- [ ] Add rate limiting\nAcceptance: pnpm test passes')
  expect(await checkPlans(ctx, config())).toBe(1)
  …
})
```

Cover at least:

- the translation: a stable id, the Thread, the actor, `human` and `addressed`, and no Trigger for the agent's own writes;
- a round: Triggers stored once, the baseline, an unchanged source receiving nothing, a change producing a new Trigger on the same Thread that reaches the open Ticket;
- `send`: `sent` once per message id, `gone` only when delivery can never succeed, and a throw for any other failure;
- the Thread context and `find`;
- a source it cannot read, such as an unreadable directory, named in health without stopping the round or forgetting what it covers;
- the execution variables a Ticket of this Source gets.

Generic behaviour the plan Source cannot express, such as bots, mentions, receiving scopes and replies under a message, is tested with the test-only chat Source in `tests/fixtures/chat.ts`; a Source with those features adds the same cases for itself, as `tests/policy.spec.ts` and `tests/registry.spec.ts` do for the chat Source.

### Checklist

1. Map Triggers, Threads, actors, Channel addresses and receiving scopes.
2. Write the kind: `schema`, `fields`, `health`, and `facts` if setup derives any; list fields setup must check in `SETUP_FIELDS`.
3. Translate events into Triggers with stable ids, and drop the agent's own.
4. Decide what the Source receives in `scope`, from `meta` alone, or leave it out to receive everything.
5. Give it a Channel whose `send` writes each message once and answers `gone` only when the destination can never receive it.
6. Give assessments its Thread context, if it can read a Thread.
7. Give it a part of the Policy with `allowed`, and admission rows, bots and sync if it reads conversations.
8. Register its execution environment variables.
9. Write the plugin entry and a loop that waits for setup, follows the switch, moves read positions after `receive`, reports health and stops on abort; name the positions in `KV`.
10. Add the build entry, the export and the `cordis.patch.yml` insert, and list the module and its spec in the tables of 007.
11. Test it as `tests/plan-source.spec.ts` tests the plan Source.

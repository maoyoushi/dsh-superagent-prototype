# GitNexus Engineering Plan

> Task: Trim dsh-superagent into **super-coding-agent**: operator-written plan files are the only Source, each Ticket runs in a DSH worker Session that decomposes the work into bounded, checkpointed subtasks delegated to Claude Code and Codex subagent providers (configurable, availability-checked, role preferences such as Claude develops / Codex verifies), the web panel stays, and the project is renamed.
> Evidence verified at commit 8c32a9dc5d72c033816c6a8110b37f40cf94fba4; GitNexus index refreshed this session (`gitnexus analyze --index-only --pdg`, runner gitnexus 1.6.12, runner identity schema current; 27,953 nodes, 784 flows, process coverage truncated by budget).
> Evidence provenance schema 2; global dirty digest 0a4f8bba3f5a61b346e729aea1bbfb4d6ce8f94b0505a27d655a671e82f85ec4; cited-path manifest 70 sorted entries; exact generated plan path excluded.
> Deepen pass (same session, same HEAD, index still fresh): provider packages, provider mounting, delegation-tool lifecycle and the rename footprint re-verified; references TransformerOptimus/SuperCoder and yashdev9274/superCli read; see §3, §6 G, §12.

Category: Architecture change (full form, `impact_depth` 3, strict freshness). User choices recorded up front: delete the GitHub and Feishu Sources and take tasks from plan files prepared with superpowers/BMAD/speckit/PLAN; stay a DSH plugin and use DSH's Claude Code and Codex subagent providers with configurable availability checks, model and role preferences; keep the panel; Standard depth. At the plan gate the user asked to Deepen, to rename the project to `super-coding-agent` (written `super-codeing-agent`; spelling to confirm, §12) and to draw on SuperCoder and superCli.

## 1. Objective

Turn the prototype into a single-purpose SuperAgent for one local repository:

1. **One Source: `plan`.** A watched directory of plan/task files in the repository checkout. A new or changed file is a Trigger from the operator; an accepted file becomes a Ticket; replies (acknowledgement, questions, results) are appended to a per-file log next to the plans, never into the plan file itself.
2. **Coordinator worker.** Each Ticket still runs in its own DSH worker Session and directory (`DshExecutor` unchanged in shape), but the worker's job becomes decomposition and acceptance: it writes self-contained, bounded subtask briefs and delegates them to `subagent_claude_code` / `subagent_codex` according to configured roles (default: Claude Code develops, Codex verifies), integrates the results, runs the acceptance checks named in the plan, and reports.
3. **Configurable subagents.** A new `subagents` settings block (panel + `orchestrator_settings_save`) that enables each provider, carries its `env` (API keys, `ANTHROPIC_MODEL`), the role mapping and a subtask size bound; dsh-superagent mounts the provider plugins from these settings, probes `claude --version` / `codex --version` before enabling, and reports a `subagents` health entry.
4. **Removal.** GitHub and Feishu Source kinds, bundled skills, `gh`/`lark-cli` transport and shims, pull-request rules, Feishu word limits, account setup probes, and the schema-10→11 migration.
5. **Rename.** `dsh-superagent` → `super-coding-agent` everywhere the product is named (package, plugin ids, presets, env prefix, service script, prompt section, locale key type, UI label), leaving role names (`orchestrator` service, `/orchestrator/api`, `orchestrator_*` tools, `orchestrator.sqlite`) untouched.
6. **Borrowed ideas** (references read: SuperCoder `README.md`/`ARCHITECTURE.md`, superCli `README.md`/`AGENTS.md`/CLI README): a checkpoint-and-rewind rule per delegated subtask (SuperCoder's `git-ops` turn checkpoints, bounded to the project root); one fixed mode per Session (our worker is coding-only, the plan file is the plan); an env prefix named after the product (`SUPERCODER_` → `SUPER_CODING_AGENT_`); native CLIs installed and signed in by the operator rather than wrapped (superCli's local Codex connect); repository `AGENTS.md` as the agent's standing instructions (already in `prompts/work.md`).

## 2. Current Behaviour

- `src/index.ts` mounts `Runtime` (`src/app/runtime.ts:87-171`), which composes Store, Setup, Prompts, Commands, SourceRegistry, Sessions, Settings, DshExecutor, MasterAssessor, Outbox, Engine and Passes [verified]. Runtime wires GitHub specifics directly: `pullEndNotices` on `ticket.ended` (`runtime.ts:148-152`), `feishuSettings(sources).readPageSize` for resources (`runtime.ts:120`), a `github` SourceContext on the tool host (`runtime.ts:163`), and `feishu()` into `Prompts` (`runtime.ts:102-103`) [verified].
- Setup (`src/app/setup.ts:76-98`) resolves the deployment through `resolveDeployment` (GitHub CLI identity + push access, `src/deployment.ts:87-106`) and `resolveFeishuBot` (`deployment.ts:114-131`), then writes `gh`/`lark-cli` shims and an isolated git config (`src/infra/environment.ts:79-103`) [verified]. Nothing runs until GitHub setup succeeds (`Runtime.initialize`, `runtime.ts:204-207`) [verified].
- Sessions (`src/app/sessions.ts`) creates the main Session under `ROUTER_PRESET` and workers under `WORKER_PRESET` (`sessions.ts:48,138-155`), decorates each with the composed prompt section, skills and tools (`decorate`, `sessions.ts:232-269`), and restricts workers to `WORK_TOOLS` (`sessions.ts:61-62`), which today include DSH's `subagent`, `list_subagent_models`, `send_message`, `list_agents`, `interrupt_agent` [verified]. `bindSkills` registers the bundled `feishu`/`github` skills (`sessions.ts:319-325`) [verified].
- The worker preset in `cordis.patch.yml` carries one `@deepseek-ai/dsh-tool-subagent` row (`provider: spawn`, `agentPreset: standard`) plus `dsh-tool-subagent-control` inside a `delegation` group; `tests/bundle-patch.spec.ts:29-52` asserts exactly that shape and the row ids `['dsh-superagent','dsh-superagent-github','dsh-superagent-feishu','dsh-superagent-worker-preset','dsh-superagent-router-preset']` [verified].
- Executor tools (`src/app/tools/executor.ts`) bind pull requests on `orchestrator_report` via `readPull`/`claimPull` and name the GitHub login in the `pr_number` description (`executor.ts:82-92`) [verified].
- Settings blocks are `policy | eval | executor | source:<id>` (`src/policy.ts:107`), saved through `Settings.save` (`src/app/settings.ts:148-200`) with a model check for `eval`/`executor` and `setup.checkAccounts` when a setup field changes [verified]. `SETUP_FIELDS` names the GitHub and Feishu account fields (`deployment.ts:51`) [verified].
- Statement-level: `DshExecutor.launch` (`src/executor/dsh.ts:425-471`) is guarded by `closing()`/`paused()`/`liveTicket`+`latestAssignment` checks at `dsh.ts:426-429` (PDG controls: three guards at lines 426, 427, 429) and otherwise only prepares the directory, ensures the Session and queues the first message [graph+verified]. `Sessions.decorate` has three guard exits (`sessions.ts:233`, `:237`, `:259`) before the master/worker branch at `:262` (PDG controls) [graph+verified]. The Executor therefore needs no change for the new delegation shape; the change lands in presets, tools, prompts and settings.

## 3. Relevant Architecture

- Hexagonal core (`src/core`, pure) behind ports (`src/core/ports.ts`); glue in `src/app`; Sources behind `SourceKind` (`src/sources/kind.ts:85-113`) and `SourceContext` (`src/sources/host.ts:31-66`); one writer per state; narrow `Pick` host interfaces; `UserError` codes in `src/core/errors.ts`; `SetupError` codes in `src/setup.ts` [verified].
- Health entries are claimed once on `HealthBoard` (`src/infra/health.ts:18-33`); `tests/locales.spec.ts:27-33` requires a `health.<name>` locale key for every entry dsh-superagent itself writes [verified].
- `tests/docs.spec.ts:58-67` fails unless the Modules and Tests tables of `docs/007-architecture.md` list every file under `src/` and every `tests/**/*.spec.ts(x)` and only existing files: **every step below that adds or deletes a file must edit those tables in the same commit** [verified].
- `tests/model-surface.spec.ts:40-52` budgets everything models read (worker 40,500 chars) and bans phrases; it starts a Runtime on the fake host with Feishu triggers and mocked `Commands` [verified].
- `tests/fixtures/host.ts` is the simulated DSH host: fake `subprocess.spawn` answered by an `answers` map keyed on the argv string (`host.ts:150-180`), fake `subagents` (`host.ts:89-134`), and it registers `feishuKind`/`githubKind` (`host.ts:254`) [verified].
- DSH host facts [verified against the installed DSH 0.2.1-rc.3]: `@deepseek-ai/dsh-base/cordis.patch.yml:359-370` mounts the `@deepseek-ai/dsh-subagent` service with `spawn`/`fork` providers on every profile; `@deepseek-ai/dsh-tool-subagent` config is `{ provider, toolName?, modelSelectionSettings?, agentOptions?, agentPreset?, allowedAgentPresets?, maxDepth?: number | 'provider-managed' }` (its `lib/types/index.d.ts`); `@deepseek-ai/dsh-subagent-codex` and `@deepseek-ai/dsh-subagent-claude-code` exist on npm through `0.2.1-rc.3` and `0.2.2-rc.5`, register fixed provider names `codex` and `claude-code`, inject `['subagents','subprocess']`, accept `{ env?: Record<string,string>; disposeGraceMs?: number }`, run one self-contained text task per call in the parent Session's cwd, return only the final answer, accept no follow-up messages, reject `modelSelectionSettings`, and do not install, log in to, select a model for, or version-probe the CLI (their READMEs at 0.0.1-rc.1; re-verify at the pinned version, §12). Cordis exposes `ctx.plugin(plugin, config)` (`@deepseek-ai/cordis/lib/types/registry.d.ts:120,198`).
- Local machine: `claude` 2.1.327 and `codex-cli` 0.158.0 on PATH [verified]; the Codex provider's protocol evidence is pinned to codex 0.147.0 (§12 risk).
- Deepen re-verification [verified]: `@deepseek-ai/dsh-subagent-codex@0.2.1-alpha.2` and `@deepseek-ai/dsh-subagent-claude-code@0.2.1-alpha.2` exist; peers `cordis ~4.0.5-alpha.1`, `dsh-llm/dsh-session/dsh-timeout/dsh-subagent/dsh-subprocess 0.2.1-alpha.2` (exact), matching this repo's pins; dependencies include `@deepseek-ai/dsh-tool-subagent 0.2.1-alpha.2`, and for codex `@openai/codex 0.153.4` (a runtime dependency despite the README calling it test-only), for claude-code `@anthropic-ai/claude-agent-sdk 0.3.263`. Their `apply(ctx, config)` resolves config and calls `ctx.subagents.registerProvider(new <X>Provider(resolved.providerName, ctx, resolved))` with `inject = ['subagents','subprocess']` — so `ctx.plugin(providerModule, { env })` from Runtime works wherever those two services exist. Their README composition is `name: '@deepseek-ai/dsh-tool-subagent', config: { provider: codex|claude-code, toolName: subagent_codex|subagent_claude_code, maxDepth: provider-managed }`.
- The installed `dsh-tool-subagent` (0.2.1-rc.3) subscribes to `subagent/provider-added` / `subagent/provider-removed` and resolves `ctx.subagents.getProvider(config.provider)` lazily (`lib/index.js:368-371,498-506`) — tools appear when the provider mounts later [verified]. `enableRunInBackground` is absent from its config type — do not set it [verified].
- `codex --help` offers `-m/--model` and `-c model=…`, and the binary reads `CODEX_HOME`; the provider's argv is fixed (`codex app-server --stdio`), so Codex model selection stays in native config [verified]. Whether `claude` honours `ANTHROPIC_MODEL` was not confirmed from the binary; keep as an assumption with a runtime check (§12).
- Rename footprint [verified by grep]: 354 × `dsh-superagent`, 116 × `DSH_SUPERAGENT`, 41 × `superagent`, 34 × `Superagent` across ~70 files; heaviest: `tests/service-script.spec.ts` 38, `docs/006-deployment.md` 34, `src/client/locales.ts` 28, `tests/runtime.spec.ts` 24, `cordis.patch.yml` 16, `scripts/dsh-superagent` 14. Role names that stay: `Service(ctx, 'orchestrator')` (`runtime.ts:88`), `/orchestrator/api/` (`http.ts:236-240`, `client/api.ts:37`), `orchestrator.sqlite` (`runtime.ts:98`), `orchestrator_*` tools. Message source kind `'dsh-superagent'` is set in `src/app/delivery.ts` and read at `dsh.ts:498`.

## 4. GitNexus Findings

- `impact {target: SourceRegistry, upstream, maxDepth 3, summaryOnly}` → 26 direct dependents, 90 total, risk CRITICAL; affected flows are the management routes (`GET overview`, `GET sources`, `GET threads/:key`, `ticketPage`, `GET policy/history`), `candidateCard`, and Runtime's constructor/`links`/`deployed` [graph]. **Conclusion:** keep `SourceRegistry` and the `SourceKind` protocol unchanged; replace kinds beneath it instead of touching the registry.
- `impact {target: Commands (Class), upstream, maxDepth 1}` → 35 direct dependents (exact): files `src/app/{assessment,links,outbox,resources,runtime,source-context}.ts`, `src/infra/environment.ts`, `src/sources/{admission-context,feishu-channel,feishu-image,feishu-loops,feishu-read,github-channel,github-read,github,host,kind,registry}.ts`; functions `sourceLink`, `sourceContextOf`, `backfillChat`, `pollThread` (feishu), `refreshChatNames`, `readPull`, `intakeComments`, `pollBranchCi`, `pollChecks`, `pollNotifications`, `pollThread` (github), `readNotified`, `readStream`, `MasterAssessor.read`, `MasterAssessor.seed`, `Runtime.constructor`, `Commands.withSignal` [graph]. §9 accounts for each.
- `query {"launch worker session… collect report"}` → flows `Execute → At/LatestReport`, symbols `DshExecutor` (`dsh.ts:207-673`), `Executor` port (`ports.ts:59-69`), `Assignments.delivered/interrupted`, `reportRelay`/`resultRelay` (`src/app/notices.ts`) [graph]. **Conclusion:** report plumbing is Source-agnostic; only `executorTools` carries GitHub.
- `context` resource: 208 files, 784 flows; clusters App 576 / Client 298 / Tests 272 / Sources 165 / Executor 103 / Views 55 / Infra 40 / Tools 26 symbols [graph].
- Source-derived (grep, verified): imports from `src/sources` into `src/app` are listed in §9; `github|feishu|lark` occurrences by test file: `sources.spec` 370, `runtime.spec` 284, `policy.spec` 117, `runtime-concurrency.spec` 92, `migration.spec` 90, `panel-source.spec` 86, `views.spec` 79, `commands.spec` 75, `tools.spec` 63, `fixtures/panel-server.ts` 57, then a long tail.
- Related tests located: `tests/bundle-patch.spec.ts`, `tests/model-surface.spec.ts`, `tests/locales.spec.ts`, `tests/docs.spec.ts`, `tests/deployment.spec.ts`, `tests/environment.spec.ts`, `tests/commands.spec.ts`, `tests/settings.spec.ts`, `tests/prompts.spec.ts`, `tests/panel-execution.spec.tsx`, `tests/panel-deployment.spec.tsx`, `tests/store.spec.ts` (every `KV` key spelled only in `src/kv.ts`) [verified by listing].

## 5. Statement-Level PDG Findings

- `Sessions.decorate` (`src/app/sessions.ts:232-269`): CDG shows guard returns at `:233` (already bound), `:237` (not master and not a ticket → `limitSubagent`), `:259` (binding replaced while awaiting the skill scope); the tool registration loop at `:261` and the master/worker split at `:262` depend on `:259` being false. **Implication:** adding the two external delegation tools to `WORK_TOOLS` changes only the `allow` list computed in `workOnly` (`:290-293`, REACHING_DEF `allow` def `:290` → use `:293`); no new control path. External children have no DSH Session, so `limitSubagent` is never reached for them; it may stay.
- `DshExecutor.launch` (`src/executor/dsh.ts:425-471`): the only control dependencies are the `current()` guards (`:426` closing, `:427` paused, `:429` live+latest). Directory preparation, Session creation and first-message delivery are unconditional once live. **Implication:** no Executor change is needed for delegation; the delegation contract lives in the preset, `WORK_TOOLS`, prompts and settings.
- `policyMessage`/`inputMessage` (`dsh.ts:138-164`) carry no Source branch [graph]; `triggerMessage` (`dsh.ts:121-125`) embeds `source_url`/`source_url_read` from `sourceLink` — the plan kind supplies a `file://` link through `channel.link`.
- Security/performance PDG modes: not applicable.

## 6. Proposed Changes

Grouped by area; symbols named here are source-verified.

**A. Subagent providers and the `subagents` settings block**

1. `package.json`: add `@deepseek-ai/dsh-subagent-claude-code` and `@deepseek-ai/dsh-subagent-codex` to `peerDependencies` (`^0.2.1-alpha.2`) and `devDependencies` (`0.2.1-alpha.2`, the line the other DSH packages pin); add both to `tsdown.config.ts` `neverBundle` (already covered by the `/^@deepseek-ai\//` pattern — no change needed there) [verified pattern].
2. `cordis.patch.yml` worker preset: replace the `delegation` group (`tool-subagent-control`, `tool-subagent` spawn) with two rows `{ id: tool-subagent-claude-code, name: '@deepseek-ai/dsh-tool-subagent', config: { provider: claude-code, toolName: subagent_claude_code, maxDepth: provider-managed } }` and the `codex`/`subagent_codex` twin. Do not add the provider plugins to the patch: Runtime mounts them from settings (A4). Keep `tool-todo`. Update the comment block.
3. `src/app/sessions.ts` `WORK_TOOLS`: remove `'subagent', 'list_subagent_models', 'send_message', 'list_agents', 'interrupt_agent'`; add `'subagent_claude_code', 'subagent_codex'`.
4. New `src/app/subagents.ts` — class `Subagents` (JSDoc required) with host `Pick`s (`context`, `store.settings`, `health: HealthEntry`, `lifetime`, `machine.stateDir`): `install()` mounts each enabled provider through `ctx.plugin(providerPlugin, { env })` in a disposable fiber and remounts on `settingsChanged('subagents')`; `probe(provider)` runs `[command, '--version']` via `runAsWorker(ctx.subprocess, …)` (`src/infra/environment.ts:128`) with a 15 s timeout; `check(candidate)` is called by `Settings.save` and throws `UserError('subagentUnavailable', { provider, error })` when enabling a provider whose probe fails; `status()` returns `{ claudeCode: { enabled, available, version }, codex: {…}, roles }` for the view; health entry `subagents` = ready when every enabled provider probed, error otherwise. For `claudeCode.model`, inject `ANTHROPIC_MODEL` into that provider's `env` at mount time.
5. `src/policy.ts`: `SubagentProviderSchema = z.object({ enabled: z.boolean().default(false), command: z.string().trim().min(1), env: z.record(z.string().regex(/^[A-Z_][A-Z0-9_]*$/), z.string().max(LIMITS.envValue)).default({}) }).strict()`; `SubagentsConfigSchema = z.object({ claudeCode: SubagentProviderSchema.extend({ model: z.string().trim().default('') }).default({ command: 'claude' }), codex: SubagentProviderSchema.default({ command: 'codex' }), roles: z.object({ develop: Role, verify: Role, review: Role }).default({ develop: 'claude-code', verify: 'codex', review: 'codex' }), maxSubtaskMinutes: z.number().int().min(…).max(…).default(20) }).strict()` with `Role = z.enum(['claude-code', 'codex', 'worker'])`; add `subagents` to `SettingsSchema` and `SettingsBlock`. Add limits to `src/limits.ts`.
6. `src/app/settings.ts` `BLOCKS`: add `subagents` with `parse`, `merge`, and a `guard` refusing non-panel origins when `env` changes (`UserError('panelOnlySubagents')`, env may hold secrets); in `save`, call `host.subagents.check(candidate)` when the block is `subagents`. `src/app/views/settings.ts`: add `blocks.subagents` and `subagents: subagents.status()`. `src/core/errors.ts`: add `subagentUnavailable` (`refused`) and `panelOnlySubagents` (`refused`). `src/app/api.ts`: types follow from the view. `src/app/runtime.ts`: construct `Subagents` with `board.claim('subagents')`, pass to Settings host and `httpHost`, `install()` in `initialize()` after setup, dispose in `shutdown()`.
7. `src/app/resources.ts` `settings/<block>` text and `src/app/tools/main.ts` `orchestrator_settings_save` block enum: include `subagents`.

**B. Worker as coordinator (prompts)**

8. New `prompts/delegation.md` → built-in part `runtime/delegation` (role WORKER) in `src/app/prompts.ts` (`PartKey` list `:25-26`, `builtInParts` `:55-70`, `promptParts` `:102-116`) and `src/app/context.ts`. Content, one sentence per line: the child sees only the task text and the ticket directory, so every brief is self-contained (goal, files, constraints, acceptance criteria, what to report back); one concern per subtask, sized to finish within `maxSubtaskMinutes`; never delegate the whole plan or an open-ended investigation; use the tool the `develop` role names to implement and the `verify` role's tool to run checks and judge acceptance against the plan's criteria, which must report pass/fail with evidence; review the diff yourself between rounds; at most three develop/verify rounds per subtask before `orchestrator_report blocked`; keep a running log via `orchestrator_report progress` naming each subtask and its outcome; a `worker` role means do that step yourself; **checkpoint before, rewind after:** before delegating a subtask commit the tree (`git add -A && git commit --allow-empty -m 'checkpoint: <subtask>'`) and record the SHA, and when the verify round fails twice restore the ticket directory to that SHA (hard reset plus clean of untracked files, inside the ticket directory only) before the next attempt or a blocked report. The role→tool mapping and bound are rendered from settings through the environment section (`src/app/execution-environment.ts`: add variables `DSH_SUPERAGENT_DEVELOP_TOOL`, `DSH_SUPERAGENT_VERIFY_TOOL`, `DSH_SUPERAGENT_REVIEW_TOOL`, `DSH_SUPERAGENT_SUBTASK_MINUTES` to `EXECUTOR_VARIABLES`, values from `settings.subagents`).
9. Rewrite `prompts/worker.md` and `prompts/work.md` for a local checkout: the deliverable is committed work on a branch in the ticket directory plus the acceptance evidence, reported with `orchestrator_report ready`; replace PR/CI/review paragraphs; drop "Use gh for ALL GitHub operations", Feishu and `pr_number` sentences. Trim `prompts/replies.md`, `subscriptions.md`, `dispatch.md`, `admission.md`, `shared.md`, `team/communication.md`, `team/delivery.md`, `team/scope.md` of GitHub/Feishu/IM wording (delivery becomes "committed, verified change on the ticket branch; plan file left untouched; results in the plan log"). Delete `prompts/cli.md`, `skills/`, `src/app/skill-files.ts` `bundledSkills` and `load`, `src/app/context.ts` `sourceSkills`/`cliNotes`, `prompts.ts` parts `skill/feishu`/`skill/github` and the `feishu` constructor flag; `Sessions.bindSkills` registers team skills only.

**C. The `plan` Source kind**

10. New `src/sources/plan.ts` (kind + plugin entry, exported as `./plan-watch`), `src/sources/plan-files.ts` (directory walk, content hash via `key`, frontmatter-free), `src/sources/plan-channel.ts` (append replies to `<directory>/.superagent/<relative-path>.log.md`, create dirs, `'sent'`; `link` → `file://` URL, label "Plan file"). Kind: `kind: 'plan'`; `schema: { directory: z.string().default('docs/plans'), pattern: z.string().default('**/*.md'), pollSeconds: int 5..3600 default 30 }`; `fields` for the three; `health: ['plan']`; `policy: { schema: SourcePolicySchema-compatible with allowed default [{ id: 'operator', name: 'Operator' }], fields, explicit: "a plan file saved under the watched directory" }`; `threadContext.read` returns the file text as one `ContextMessage` (`from: 'operator'`), `root`/`parent` empty; `find(query)` → `plan:<relative path>` when the query names a path; `environment.variables`: `DSH_SUPERAGENT_PLAN_FILE`, `DSH_SUPERAGENT_PLAN_DIR`, `DSH_SUPERAGENT_REPOSITORY`. Poll loop (reuse `pause` from `src/sources/poll.ts`; delete `polled`/`cursorAt`/`pollThreads`/`POLL_HORIZON_MS` if nothing else uses them): for each matching file compare `{ hash, mtime }` with `KV.plan.file(path)`; a new or changed file → `ctx.receive({ id: key('plan', path, hash), source: 'plan', threads: [{ source: 'plan', id: path }], actor: { source: 'plan', id: 'operator' }, human: true, addressed: 'direct', at, text, channel: { source: 'plan', thread: path, address: { path } }, url: 'file://…', meta: { path, hash } })`, then store the cursor. Files under `.superagent/` are ignored. Report `health('error','planDirectoryMissing')` when the directory is absent, `pollFailures` on repeated errors.
11. `src/kv.ts`: remove `github` and `feishu` families (and the `Retry` import); add `plan: { file: family<{ hash: string; at: string }, [path: string]>('plan-file:') }`.
12. `src/sources/host.ts` `HEALTH_TEXT`: replace `feishuCliUnset`/`feishuBotMissing` with `planDirectoryMissing: 'The plan directory {directory} does not exist'`.
13. `tsdown.config.ts` entries: `{ index, 'plan-watch': 'src/sources/plan.ts' }` (drop `github-watch`, `feishu-watch`); `package.json` `exports`: `./plan-watch`; remove `skills` from `files`; `cordis.patch.yml` inserts: `dsh-superagent`, `dsh-superagent-plan` (`name: dsh-superagent/plan-watch`), the two presets.

**D. Deployment, environment, commands**

14. `src/deployment.ts`: `Deployment extends Machine { repository: string /* absolute path of the git checkout */; plan: { directory: string /* absolute */ } }`; `PlanSetupSchema = z.object({ repository: z.string().trim().default(''), directory: z.string().trim().default('docs/plans') })`; `SETUP_FIELDS = { plan: ['repository', 'directory'] }`; `resolveDeployment(machine, planConfig, probe)` → `SetupError('repositoryUnset')` when empty, `repositoryMissing` when `stat` fails, `repositoryNotGit` when `probe(['git','-C',repository,'rev-parse','--show-toplevel'])` fails, resolves `directory` against the repository, `planDirectoryMissing` when absent. Delete `GithubAccountsSchema`, `FeishuBotSchema`, `FeishuBot`, `resolveFeishuBot`, `GithubUser`, `RepositoryAccess`, `AuthStatus`, `BotInfo`; keep `executable`, `workerProbe`, `machineOf`, `Config` (add `github`/`feishu` to `MOVED` → "removed").
15. `src/setup.ts`: `SetupPlace = 'deployment' | 'plan'`; codes `foreignFile`, `environmentFailed`, `repositoryUnset`, `repositoryMissing`, `repositoryNotGit`, `planDirectoryMissing`; drop `gitTooOld` and every `agentCli*`/`feishu*` code. `src/app/setup.ts`: drop `feishuProblem`, `resolveFeishuBot`; `checkAccounts` validates `source:plan`; `check()` refuses only when configured.
16. `src/infra/environment.ts`: `WORKER_COMMANDS = ['git', 'claude', 'codex']` (cannot be blocked); `writeEnvironment(deployment, blocked)` writes only the blocked-command shims (message: "`<name>` is blocked in this installation"); drop the `gh`/`lark-cli` shims, `credentialHelper`, the credential section of the worker git config (keep the isolated `GIT_CONFIG_GLOBAL` file so `blockedCommands` and `GIT_LOCATION` clearing still apply); `verifyEnvironment` checks `git --version` only. `src/infra/commands.ts`: keep `CliError`, `commandError`, `Commands.run`, `git`, `withSignal`; delete `gh`, `api`, `pages`, `lark`, `path`, `validItems`, `Tally`.
17. `src/app/runtime.ts`: drop `pullEndNotices`, `feishuSettings`, `feishu`, `feishuProblem`, `github` on the tool host, `feishuPageSize` on resources; `links()` passes `{ repository }` only. `src/app/http.ts`, `src/app/source-context.ts`, `src/app/views/sources.ts`, `src/app/views/overview.ts`: drop `feishuProblem`; `setup` view `accounts` → `{ repository, planDirectory }`.
18. `src/app/tools/executor.ts`: drop `pr_number`, `readPull`, `claimPull`, `host.github`; `orchestrator_report` keeps `state`, `summary`, `human_action`, `question_for_trigger_id`, `reply_to_trigger_id`; thread-key examples become `plan:<path>`. `src/app/cards.ts`: drop `pullOf`/`pr_number`. `src/app/links.ts`: `sourceLink` returns the kind's `channel.link` URL; delete Feishu link cache use (`sourceLinks` TextCache in Runtime and `HttpHost.sourceLinks` go too). `src/app/resources.ts`: drop `feishu/…` and `github/…` resources, `readGithub`, `feishuRead`, `feishuReferences`, `feishuRef`, `feishuTriggerId`, `feishuPageSize`. `src/app/assessment.ts`: replace `readRepositoryPath` with a local read under `deployment.repository` (path confined to the checkout, directory listing or file). `src/app/outbox.ts:29`: drop the Feishu `checkedImText` branch. `src/app/tools/main.ts`: fix descriptions at `:243`, `:253`, `:268`.
19. `src/app/migration.ts`: `SCHEMA_VERSION = 12`, `OLDEST_SCHEMA = 12`; keep `tooOld`; delete every schema-10/11 conversion (`migrateTo11`, `migrateSettings`, `basisOf`, `ticketOf`, `withoutCopies`, `reasonsOf`, Feishu/GitHub cursor conversions, `DEAD_KEYS`, `REMOVED_SOURCES`); `Store` opens a fresh database at 12 and refuses older ones. (Decision, see §12: existing state directories are not migrated.)
20. Delete `src/sources/github.ts`, `github-trigger.ts`, `github-pull.ts`, `github-channel.ts`, `github-read.ts`, `feishu.ts`, `feishu-trigger.ts`, `feishu-loops.ts`, `feishu-channel.ts`, `feishu-read.ts`, `feishu-image.ts`; keep `admission-context.ts` (used by `MasterAssessor` through the plan kind's `threadContext`) and `kind.ts`/`host.ts`/`registry.ts`. `src/sources/kind.ts`: `ChannelLinks = Partial<Pick<Deployment, 'repository'>>`; `ThreadContext.image`/`images` stay optional and unused.

**E. Panel**

21. `src/client/execution.tsx`: a "Subagents" section (per provider: enabled switch, command, model for Claude Code, env rows via the `rows` field kit; role selects; subtask minutes; availability line from `subagents.status`) using `useBlockDraft('subagents', …)`; `ConfigHistory blocks` add `subagents`. `src/client/overview.tsx`: show the `subagents` health entry among problems; remove the Feishu branch (`:27-28`). `src/client/deployment.tsx`: rows repository path and plan directory; remove agent/Feishu rows. `src/client/app.tsx:76`, `ticket.tsx:178`, `text.ts:37` cleanups. `src/client/locales.ts`: add `health.subagents`, `subagents*`, `userError.subagentUnavailable`, `userError.panelOnlySubagents`, `setup.*` texts for the new codes; remove Feishu/GitHub-only keys. `src/client/route.ts`: no change (Subagents lives in the `execution` group).

**G. Rename to `super-coding-agent`**

23. One mechanical commit over code, tests, prompts, scripts, docs and packaging: `dsh-superagent` → `super-coding-agent` (package `name`, plugin `name` in `src/index.ts`, bundle row ids `super-coding-agent`, `super-coding-agent-plan`, `super-coding-agent-worker-preset`, `super-coding-agent-router-preset`, preset ids `super-coding-agent-worker`/`-router` in `cordis.patch.yml` and `WORKER_PRESET`/`ROUTER_PRESET` in `sessions.ts:48`, tsdown client banner id, prompt section `super-coding-agent-policy` (`sessions.ts:245`), `SKILL_PREFIX = 'super-coding-agent-'` (`prompts.ts:20`), message source kind in `src/app/delivery.ts` and the check at `dsh.ts:498`, log prefixes, `scripts/dsh-superagent` → `scripts/super-coding-agent` with its control/log names and default profile `super-coding-agent`, `SETUP.md` probe pattern, `examples/profile.cordis.patch.yml`); `DSH_SUPERAGENT_` → `SUPER_CODING_AGENT_` (`execution-environment.ts` variables and every prompt that names them); `DshSuperagentKey` → `SuperCodingAgentKey`, `dshSuperagent*` → `superCodingAgent*` in `src/client`; UI label "Superagent" → "Super Coding Agent" (sidebar entry in `src/client/index.tsx`, `locales.ts`). Keep: `orchestrator` service/API/database/tool names, CSS `dt-` prefix, `KV` keys. Tests: `tests/service-script.spec.ts`, `tests/bundle-patch.spec.ts`, `tests/environment.spec.ts`, `tests/prompts.spec.ts`, panel specs, `tests/locales.spec.ts` follow the same replacement; `tests/docs.spec.ts` tables list the renamed script.

**F. Tests, docs, packaging**

22. Tests: see §8. Docs: `docs/007-architecture.md` Modules/Tests tables updated in every step; final step rewrites `docs/000`–`008`, `README.md`, `SETUP.md`, `CLAUDE.md`, `examples/profile.cordis.patch.yml`, and `scripts/dsh-superagent` wording if it names `gh`.

## 7. Implementation Sequence

Each step ends with `pnpm check` green and the `docs/007-architecture.md` tables matching the tree, and is one commit.

1. **Delegation tools in the worker preset** (A1–A3). Deps, `cordis.patch.yml`, `WORK_TOOLS`; update `tests/bundle-patch.spec.ts` (two `dsh-tool-subagent` rows with providers `claude-code`/`codex`, no `dsh-tool-subagent-control`), `tests/model-surface.spec.ts` tool expectations if they list worker tools. *Risk note:* both provider packages exist at `0.2.1-alpha.2` with peers matching the repo pins (verified in Deepen); `pnpm install` pulls `@openai/codex 0.153.4` and `@anthropic-ai/claude-agent-sdk 0.3.263` as their dependencies — expect a larger install, and keep running the host-installed CLIs.
2. **`subagents` settings block and `Subagents` component** (A4–A7). New `src/app/subagents.ts`, schema, limits, errors, settings/views/api/http/runtime wiring, locales for the health entry and errors; tests `tests/subagents.spec.ts` (new), `tests/settings.spec.ts`, `tests/locales.spec.ts` entries object, `tests/health.spec.ts`, `tests/fixtures/host.ts` answers for `claude --version` / `codex --version`. *Risk note:* `ctx.plugin` with a provider whose `inject` includes `subagents` must run under a context where that service exists — in tests the fake host provides `subagents`; mount lazily inside `ctx.inject(['subagents','subprocess'], …)`.
3. **Panel Subagents section** (E21 for `execution.tsx`/`overview.tsx`, locales). Tests `tests/panel-execution.spec.tsx`, `tests/panel-overview.spec.tsx`, `tests/fixtures/panel-server.ts`.
4. **Coordinator prompts** (B8; B9 only the Source-neutral parts). New `prompts/delegation.md`, environment variables, `prompts.ts`/`context.ts`; tests `tests/prompts.spec.ts`, `tests/model-surface.spec.ts` budget, `tests/cards.spec.ts` if it checks built-in text rules, `tests/environment.spec.ts`/`tests/views.spec.ts` for the new variables.
5. **`plan` Source kind, additive** (C10–C13 except the removals of `github-watch`/`feishu-watch`). Register in `tests/fixtures/host.ts`; new `tests/plan-source.spec.ts`; `tests/bundle-patch.spec.ts` row ids gain `dsh-superagent-plan`; `tests/registry.spec.ts` if it enumerates kinds. The kind reads `repository` from `deployment.repository` once step 7 lands; until then it takes the checkout from its own config field `repository` (removed in step 7).
6. **Remove Feishu** (the Feishu half of D14–D20, B9, E21). Delete `feishu*.ts`, `skills/dsh-superagent-feishu`, `feishuProblem`, `resolveFeishuBot`, `lark-cli` shim, Outbox limit, Feishu resources/links, Feishu prompt part and skill, Feishu locales; tests `tests/feishu-read.spec.ts`, `tests/feishu-image.spec.ts` deleted; `tests/sources.spec.ts`, `tests/runtime.spec.ts`, `tests/policy.spec.ts`, `tests/views.spec.ts`, `tests/tools.spec.ts`, `tests/model-surface.spec.ts` (triggers become plan or GitHub triggers for now), `tests/deployment.spec.ts`, `tests/environment.spec.ts`, `tests/commands.spec.ts`, `tests/panel-*.spec.tsx` adjusted.
7. **Remove GitHub; deployment becomes a local checkout** (the GitHub half of D14–D20, C11–C13 removals, B9 GitHub wording). Delete `github*.ts`, `skills/dsh-superagent-github`, `prompts/cli.md`, `src/app/skill-files.ts` skill loading, `gh` shim and credential helper, `Commands.gh/api/pages`, `pullEndNotices`, `pr_number`, `pullOf`, GitHub resources, `KV.github`; `resolveDeployment` on the local checkout; `SETUP_FIELDS = { plan }`; `migration.ts` → schema 12 refusal only; `tsdown`/`package.json` entries; `tests/github-read.spec.ts` deleted, `tests/sources.spec.ts` deleted (covered by `plan-source.spec.ts`), `tests/migration.spec.ts` reduced to the refusal, `tests/commands.spec.ts` git-only, `tests/fixtures/deployment.ts` new shape, `tests/runtime.spec.ts`/`runtime-concurrency.spec.ts`/`followups.spec.ts`/`core-engine.spec.ts` triggers rewritten to the plan Source. *Risk note:* largest step; run `pnpm test` per file while converting (`pnpm vitest run tests/<name>.spec.ts`).
8. **Rename to `super-coding-agent`** (G23). One mechanical commit after the removals so deleted files are not renamed first: replace the four spellings per the mapping, rename `scripts/dsh-superagent`, update `WORKER_PRESET`/`ROUTER_PRESET`, env prefix, locale key type, UI label, `SETUP.md`/docs mentions and `docs/007` tables; `pnpm check`. *Risk note:* the deployed profile entry `id: dsh-superagent` and state dir `~/.dsh/state/superagent` must be re-pointed by the operator (documented in step 10); `KV` data is name-free, but this change plus schema 12 means a fresh state directory anyway.
9. **Panel and copy cleanup** (rest of E21): deployment page, search hint, icons, placeholder text, locale pruning; `tests/panel-deployment.spec.tsx`, `tests/panel-panel.spec.tsx`, `tests/client.spec.tsx`.
10. **Docs and setup** (F22): rewrite `docs/000`–`008` for the plan Source and coordinator (keep the numbered-link rule), `README.md`, `SETUP.md` (questions: repository path, plan directory, which CLIs are installed and signed in, roles, model; upgrade note: new profile entry id, new state directory, fix the `yunxiao` row), `CLAUDE.md`, `examples/profile.cordis.patch.yml`, the renamed service script's text; credit the borrowed ideas (SuperCoder checkpoints, superCli native-CLI connect) in `docs/000`/`007`. Final `pnpm check`.

## 8. Test Strategy

- **Update:** `tests/bundle-patch.spec.ts` (step 1, 5, 7), `tests/settings.spec.ts`, `tests/locales.spec.ts`, `tests/health.spec.ts`, `tests/panel-execution.spec.tsx`, `tests/panel-overview.spec.tsx`, `tests/panel-deployment.spec.tsx`, `tests/prompts.spec.ts`, `tests/model-surface.spec.ts`, `tests/cards.spec.ts`, `tests/deployment.spec.ts`, `tests/environment.spec.ts`, `tests/commands.spec.ts`, `tests/runtime.spec.ts`, `tests/runtime-concurrency.spec.ts`, `tests/followups.spec.ts`, `tests/core-engine.spec.ts`, `tests/policy.spec.ts`, `tests/views.spec.ts`, `tests/tools.spec.ts`, `tests/registry.spec.ts`, `tests/store.spec.ts` (KV families), `tests/migration.spec.ts`, `tests/fixtures/host.ts`, `tests/fixtures/deployment.ts`, `tests/fixtures/panel-server.ts`.
- **Delete:** `tests/sources.spec.ts`, `tests/feishu-read.spec.ts`, `tests/feishu-image.spec.ts`, `tests/github-read.spec.ts`.
- **New `tests/subagents.spec.ts`:** (a) settings with `codex.enabled: true` and a fake `codex --version` answer → provider mounted once, health `ready`, `status().codex.available === true`; (b) probe fails (empty/erroring spawn) → `save('subagents', …)` throws `UserError('subagentUnavailable')` and nothing is mounted; (c) disabling a mounted provider disposes its fiber; (d) `claudeCode.model: 'claude-opus-5-5'` → mounted config `env.ANTHROPIC_MODEL` equals it; (e) a tool-origin save that changes `env` throws `panelOnlySubagents`; (f) roles render into `DSH_SUPERAGENT_DEVELOP_TOOL`/`VERIFY_TOOL`.
- **New `tests/plan-source.spec.ts`:** (a) a directory with two `.md` files → two Triggers on two Threads, actor `operator`, `addressed: 'direct'`, Tickets after an accept; (b) a second poll with no changes → no Trigger; (c) editing a file → one new Trigger on the same Thread that reaches the open Ticket as the operator's message; (d) `channel.send` appends to `.superagent/<path>.log.md` and the log file never produces a Trigger; (e) directory missing → health `planDirectoryMissing`, restored on the next successful poll; (f) `threadContext.read('thread')` returns one message with the file text; (g) `find('docs/plans/x.md')` → `plan:docs/plans/x.md`.
- **Rename (step 8):** `tests/service-script.spec.ts` fakes run the renamed script; `tests/bundle-patch.spec.ts` ids and preset ids; `tests/environment.spec.ts` and `tests/views.spec.ts` variable names `SUPER_CODING_AGENT_*`; `tests/prompts.spec.ts` section name; DoD grep in §13.
- **Delegation prompt (step 4):** `tests/prompts.spec.ts` asserts the worker prompt contains the checkpoint/rewind sentences and the role tool variables, and that the orchestrator prompt does not contain the delegation part.
- **Edge cases:** plan file deleted while its Ticket is open (no Trigger; Ticket continues); a file larger than `TRIGGER_CHARS` is capped with a `trigger/<id>` read pointer (existing behaviour); `maxSubtaskMinutes` bounds; provider CLI present but exits non-zero on `--version`.
- **Regression:** `pnpm check` (typecheck + 59→~57 spec files + build); `tests/docs.spec.ts` on every step; `tests/model-surface.spec.ts` worker budget after adding `delegation.md` (GitHub/Feishu text removal in steps 6–7 frees budget; if step 4 overflows, shorten `work.md` in the same step).
- **Verification commands:** `pnpm typecheck`, `pnpm test`, `pnpm vitest run tests/<name>.spec.ts`, `pnpm build`, `pnpm check` (all exist in `package.json`).
- **Manual (after step 9, operator machine):** `scripts/dsh-superagent restart`; in the panel enable Claude Code and Codex, save (probe), drop a plan file into the watched directory, observe a Ticket within one poll, a worker Session that calls `subagent_claude_code` then `subagent_codex`, and a `ready` report in `.superagent/<file>.log.md`.

## 9. Risk and Impact Analysis

- **`Commands` d=1 dependents (35, exact):** deleted with their files — `github.ts` (`intakeComments`, `pollBranchCi`, `pollChecks`, `pollNotifications`, `pollThread`, `readNotified`, `readStream`), `github-pull.ts` (`readPull`), `github-channel.ts`, `github-read.ts`, `feishu-channel.ts`, `feishu-image.ts`, `feishu-loops.ts` (`backfillChat`, `pollThread`, `refreshChatNames`), `feishu-read.ts`; kept and edited — `src/app/assessment.ts` (`MasterAssessor.read`/`seed` keep `commands.withSignal` for `admissionContext`; `readRepositoryPath` replaced), `links.ts` (`sourceLink` simplified), `outbox.ts` (still passes `commands` to `registry.send`), `resources.ts` (GitHub/Feishu reads removed), `runtime.ts` (`Runtime.constructor` still builds `Commands`), `source-context.ts` (`sourceContextOf` still exposes `commands`), `infra/environment.ts`, `sources/admission-context.ts`, `host.ts`, `kind.ts`, `registry.ts` (types only), `Commands.withSignal` (kept).
- **`SourceRegistry` d=1 (26) untouched:** registry API unchanged; only its kinds change. Management routes keep their shapes except `setup.accounts` and `feishuProblem` removal (`tests/http.spec.ts`, panel fixtures).
- **High-risk symbols:** `Settings.save` (new block + probe; keep the stale-revision checks around the async probe), `Runtime.constructor` (new component ordering: `Subagents` before `Settings`), `Sessions.WORK_TOOLS` (a missing tool name silently drops the tool: `workOnly` filters by `agent.ctx.tools.get`), `writeEnvironment` (shim directory semantics), `migration.ts` (database refusal path).
- **Compatibility:** existing state directories (schema 11, GitHub Tickets) are refused by `tooOld` → operators start a new state directory (§12 decision). The deployed `superagent` profile at `~/.dsh/profiles/superagent/cordis.patch.yml` references `dsh-superagent-yunxiao`, a Source from the `feat/yunxiao-source` branch not on `main`; the operator must drop that row and add `dsh-superagent-plan` config (`SETUP.md` upgrade note).
- **Provider compatibility:** the Codex provider's wire evidence is pinned to codex 0.147.0 while the machine has 0.158.0; the Claude Code provider pins `@anthropic-ai/claude-agent-sdk` and resolves the native `claude` 2.1.327. Failures surface as run errors, not at mount; the probe only proves the CLI exists. Document in `docs/006`.
- **Credential scrubbing:** both providers run under DSH's subprocess seam which strips credential-shaped variables; API keys must be entered in `subagents.*.env` (panel only). The `env` values are stored in the settings history (`src/app/settings-history.ts`, `KV.settings.version`) — mask `env` values in `policyHistory`/panel history (add to step 2).
- **Concurrency:** no new transactions; the provider remount on settings change must not race a worker mid-call — remount only when `env`/`command`/`enabled` change, and keep the old fiber until the new one is active (dispose old after `await ctx.plugin(...)`).
- **Rename:** mechanical but wide (≈545 occurrences, ~70 files); the DSH profile entry id, preset ids and the service script name change together, so a half-applied rename leaves the bundle unloadable — one commit, `pnpm check` plus `tests/bundle-patch.spec.ts` guard it. The hourly check prompt in `docs/006` names the script path; update it.
- **Observability:** `subagents` health entry; `plan` health entry; settings history records role changes; worker transcript keeps the subtask briefs.
- **Performance:** polling a plan directory every 30 s with hashing is negligible; cap files to 2 MiB and skip binaries.

## 10. Files Expected to Change

| File | Symbols | Reason |
| ---- | ------- | ------ |
| `package.json`, `tsdown.config.ts`, `cordis.patch.yml` | deps, entries, inserts, worker preset | providers, `plan-watch`, remove `github-watch`/`feishu-watch`/skills |
| `src/app/sessions.ts` | `WORK_TOOLS`, `bindSkills` | external delegation tools; no bundled skills |
| `src/app/subagents.ts` (new) | `Subagents` | mount providers, probe, health, status |
| `src/policy.ts`, `src/limits.ts` | `SubagentsConfigSchema`, `SettingsSchema`, `SettingsBlock`, limits | new block |
| `src/app/settings.ts`, `src/app/views/settings.ts`, `src/app/api.ts`, `src/app/http.ts`, `src/app/settings-history.ts` | `BLOCKS`, `save`, `settingsView`, `Api`, history masking | new block, env masking, remove `feishuProblem`/accounts |
| `src/core/errors.ts` | `USER_ERRORS` | `subagentUnavailable`, `panelOnlySubagents` |
| `src/app/runtime.ts` | `Runtime` constructor/`initialize`/`shutdown`/`links`/`httpHost` | wire `Subagents`; drop GitHub/Feishu wiring |
| `src/app/prompts.ts`, `src/app/context.ts`, `src/app/skill-files.ts`, `prompts/*.md`, `prompts/team/*.md`, `prompts/delegation.md` (new), `prompts/cli.md` (deleted), `skills/` (deleted) | `builtInParts`, `promptParts`, `Prompts` | coordinator protocol; Source-neutral text |
| `src/app/execution-environment.ts` | `EXECUTOR_VARIABLES`, `environmentOf` | role tools and bound |
| `src/sources/plan.ts`, `plan-files.ts`, `plan-channel.ts` (new) | `planKind`, plugin entry | the Source |
| `src/sources/github*.ts`, `src/sources/feishu*.ts` (deleted); `src/sources/poll.ts`, `host.ts`, `kind.ts` | `HEALTH_TEXT`, `ChannelLinks`, `pause` | removal, plan health text |
| `src/kv.ts` | `KV.plan`, remove `KV.github`/`KV.feishu` | cursors |
| `src/deployment.ts`, `src/setup.ts`, `src/app/setup.ts` | `Deployment`, `resolveDeployment`, `SETUP_FIELDS`, `SETUP_PROBLEMS`, `Setup` | local checkout setup |
| `src/infra/environment.ts`, `src/infra/commands.ts` | `WORKER_COMMANDS`, `writeEnvironment`, `verifyEnvironment`, `Commands` | git-only transport, blocked-command shims |
| `src/app/tools/executor.ts`, `src/app/tools/main.ts`, `src/app/cards.ts`, `src/app/links.ts`, `src/app/resources.ts`, `src/app/assessment.ts`, `src/app/outbox.ts`, `src/app/source-context.ts`, `src/app/views/sources.ts`, `src/app/views/overview.ts` | listed in §6 D17–D18 | remove GitHub/Feishu coupling |
| `src/app/migration.ts` | `SCHEMA_VERSION`, `OLDEST_SCHEMA`, `tooOld` | schema 12 |
| `src/client/execution.tsx`, `overview.tsx`, `deployment.tsx`, `app.tsx`, `ticket.tsx`, `text.ts`, `locales.ts` | panel sections and copy | Subagents UI; cleanup |
| every file naming the product (≈70, §3 footprint), `scripts/dsh-superagent` → `scripts/super-coding-agent` | `WORKER_PRESET`, `ROUTER_PRESET`, `SKILL_PREFIX`, `EXECUTOR_VARIABLES`, `DshSuperagentKey`, bundle ids | rename |
| `tests/**` per §8; `docs/*.md`, `README.md`, `SETUP.md`, `CLAUDE.md`, `examples/profile.cordis.patch.yml`, `scripts/super-coding-agent` | — | tests and documentation |

## 11. Reusable Implementation Context

```yaml
implementation_context:
  task_summary: >-
    Replace the GitHub and Feishu Sources with one `plan` Source (watched directory of operator plan files in a local git
    checkout), add a `subagents` settings block that mounts and availability-checks DSH's Claude Code and Codex subagent
    providers with role preferences, give the worker preset the two external delegation tools, and rewrite the worker
    prompts into a coordinator that delegates bounded, checkpointed subtasks and verifies acceptance; rename the product to
    super-coding-agent. Keep the panel, Engine, Executor.
  acceptance_criteria:
    - '`pnpm check` passes at every step; docs/007 Modules and Tests tables match the tree.'
    - 'Worker preset exposes `subagent_claude_code` and `subagent_codex` (dsh-tool-subagent rows with providers claude-code / codex, maxDepth provider-managed) and no spawn/fork delegation.'
    - 'Settings block `subagents` (panel + tool) with per-provider enabled/command/env (+ model for Claude Code), roles develop/verify/review, maxSubtaskMinutes; enabling an unavailable CLI is refused with `subagentUnavailable`; `subagents` health entry visible in the overview.'
    - 'A new or changed file under the configured plan directory becomes a Trigger from `operator`, then a Ticket; replies land in `.superagent/<path>.log.md`; the plan file is never written.'
    - 'No `gh`, `lark-cli`, GitHub or Feishu code or prompt text remains under src/, prompts/, skills/; `resolveDeployment` validates a local git checkout.'
    - 'Worker prompt contains the delegation protocol (self-contained briefs, one concern per subtask, bounded by maxSubtaskMinutes, develop/verify roles, checkpoint before / rewind after, at most three rounds, progress reports).'
    - 'The product is named super-coding-agent in package.json, plugin ids, presets, env prefix SUPER_CODING_AGENT_, scripts/super-coding-agent, UI label; `grep -rIE "dsh-superagent|DSH_SUPERAGENT" --exclude-dir=node_modules --exclude-dir=lib --exclude-dir=.git .` returns only docs/plans and git history.'
  evidence_provenance: |
    {
      "schema_version": 2,
      "head_commit": "8c32a9dc5d72c033816c6a8110b37f40cf94fba4",
      "generated_plan_path": "docs/plans/2026-11-19-gitnexus-plan-superagent-plan-source-subagents.md",
      "global_dirty_digest": {
        "algorithm": "sha256",
        "canonicalization": "gitnexus-evidence-provenance-v2 NUL-framed UTF-8 records",
        "value": "0a4f8bba3f5a61b346e729aea1bbfb4d6ce8f94b0505a27d655a671e82f85ec4"
      },
      "cited_path_manifest": [
        {
          "path": "CLAUDE.md",
          "object_kind": {
            "head": "absent",
            "index": "absent",
            "worktree": "absent",
            "untracked": "regular"
          },
          "state": "untracked",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "absent",
          "index_digest": "absent",
          "worktree_digest": "absent",
          "untracked_digest": "sha256:6d4971b5aaea91434356a330461e1728bdffff90a3e2b01becca51f54e19c100"
        },
        {
          "path": "README.md",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:737997cf5b7d4129f12ed5485ebbdd5e9d2ce3859a82ded6ac535d222327b713",
          "index_digest": "sha256:737997cf5b7d4129f12ed5485ebbdd5e9d2ce3859a82ded6ac535d222327b713",
          "worktree_digest": "sha256:737997cf5b7d4129f12ed5485ebbdd5e9d2ce3859a82ded6ac535d222327b713",
          "untracked_digest": "absent"
        },
        {
          "path": "SETUP.md",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:75ff78359142dad8bf257b732c1b11313a96c8d1bf0621c73fd4f160460a25ba",
          "index_digest": "sha256:75ff78359142dad8bf257b732c1b11313a96c8d1bf0621c73fd4f160460a25ba",
          "worktree_digest": "sha256:75ff78359142dad8bf257b732c1b11313a96c8d1bf0621c73fd4f160460a25ba",
          "untracked_digest": "absent"
        },
        {
          "path": "cordis.patch.yml",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:fc9271cdf9b3d96bcb7febffe194f92cb427a88044168f83b3fb7522ab5c9bce",
          "index_digest": "sha256:fc9271cdf9b3d96bcb7febffe194f92cb427a88044168f83b3fb7522ab5c9bce",
          "worktree_digest": "sha256:fc9271cdf9b3d96bcb7febffe194f92cb427a88044168f83b3fb7522ab5c9bce",
          "untracked_digest": "absent"
        },
        {
          "path": "docs/001-domain.md",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:cd010379e65cc428ffb335aee46529f2a524b8f573fc72359223060fb5a5111b",
          "index_digest": "sha256:cd010379e65cc428ffb335aee46529f2a524b8f573fc72359223060fb5a5111b",
          "worktree_digest": "sha256:cd010379e65cc428ffb335aee46529f2a524b8f573fc72359223060fb5a5111b",
          "untracked_digest": "absent"
        },
        {
          "path": "docs/006-deployment.md",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:92c5a1c6aecab6782a64b3847a2d6f36a48dc9865fa7b04b892fcdaf04f7de9d",
          "index_digest": "sha256:92c5a1c6aecab6782a64b3847a2d6f36a48dc9865fa7b04b892fcdaf04f7de9d",
          "worktree_digest": "sha256:92c5a1c6aecab6782a64b3847a2d6f36a48dc9865fa7b04b892fcdaf04f7de9d",
          "untracked_digest": "absent"
        },
        {
          "path": "docs/007-architecture.md",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:e3747665587fdf88b28d4e9c1a1f8ac40cbc2c65a9999be1fce14b69ec44d748",
          "index_digest": "sha256:e3747665587fdf88b28d4e9c1a1f8ac40cbc2c65a9999be1fce14b69ec44d748",
          "worktree_digest": "sha256:e3747665587fdf88b28d4e9c1a1f8ac40cbc2c65a9999be1fce14b69ec44d748",
          "untracked_digest": "absent"
        },
        {
          "path": "examples/profile.cordis.patch.yml",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:db41555406a3f2dd7a77f7c40f565d0b9572984db8b9dcd6dcb9c6dce7004067",
          "index_digest": "sha256:db41555406a3f2dd7a77f7c40f565d0b9572984db8b9dcd6dcb9c6dce7004067",
          "worktree_digest": "sha256:db41555406a3f2dd7a77f7c40f565d0b9572984db8b9dcd6dcb9c6dce7004067",
          "untracked_digest": "absent"
        },
        {
          "path": "package.json",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:f5170d812137dd370c568decb481e19f4da9a3d1fd7bad341a0f07942020a559",
          "index_digest": "sha256:f5170d812137dd370c568decb481e19f4da9a3d1fd7bad341a0f07942020a559",
          "worktree_digest": "sha256:f5170d812137dd370c568decb481e19f4da9a3d1fd7bad341a0f07942020a559",
          "untracked_digest": "absent"
        },
        {
          "path": "prompts/handoff-worker.md",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:ff68068b528ae8f0140965d73f24af6be8e3462506aae40efbc4e054becf7f94",
          "index_digest": "sha256:ff68068b528ae8f0140965d73f24af6be8e3462506aae40efbc4e054becf7f94",
          "worktree_digest": "sha256:ff68068b528ae8f0140965d73f24af6be8e3462506aae40efbc4e054becf7f94",
          "untracked_digest": "absent"
        },
        {
          "path": "prompts/work.md",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:b36fbc7ed4cf2d6f91ef2981a31fd5a70e11e2f3304afb921ab94ba135c69a2e",
          "index_digest": "sha256:b36fbc7ed4cf2d6f91ef2981a31fd5a70e11e2f3304afb921ab94ba135c69a2e",
          "worktree_digest": "sha256:b36fbc7ed4cf2d6f91ef2981a31fd5a70e11e2f3304afb921ab94ba135c69a2e",
          "untracked_digest": "absent"
        },
        {
          "path": "prompts/worker.md",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:3c6e02fbd2050bb17d4adf644909acc9903b603bfc7248d46df5ef0aa9ef846e",
          "index_digest": "sha256:3c6e02fbd2050bb17d4adf644909acc9903b603bfc7248d46df5ef0aa9ef846e",
          "worktree_digest": "sha256:3c6e02fbd2050bb17d4adf644909acc9903b603bfc7248d46df5ef0aa9ef846e",
          "untracked_digest": "absent"
        },
        {
          "path": "scripts/dsh-superagent",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:e561ea08c2e017467562cfa55012147c2dd0d20fe872dcbb241be8cfee8985da",
          "index_digest": "sha256:e561ea08c2e017467562cfa55012147c2dd0d20fe872dcbb241be8cfee8985da",
          "worktree_digest": "sha256:e561ea08c2e017467562cfa55012147c2dd0d20fe872dcbb241be8cfee8985da",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/api.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:ceb0c76cb2d8680e2be4edf0f6ac42c90e6a4ff78e0e14ce4aa277357606ff04",
          "index_digest": "sha256:ceb0c76cb2d8680e2be4edf0f6ac42c90e6a4ff78e0e14ce4aa277357606ff04",
          "worktree_digest": "sha256:ceb0c76cb2d8680e2be4edf0f6ac42c90e6a4ff78e0e14ce4aa277357606ff04",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/assessment.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:5b2c2cf71093fd560f1f3a57cc476f122241b780fbeb2f6007e727943142b545",
          "index_digest": "sha256:5b2c2cf71093fd560f1f3a57cc476f122241b780fbeb2f6007e727943142b545",
          "worktree_digest": "sha256:5b2c2cf71093fd560f1f3a57cc476f122241b780fbeb2f6007e727943142b545",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/cards.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:9d3522b787612ba129058b89f8a4c5f9a4e980321f69c3cc68607c5b111d8ef6",
          "index_digest": "sha256:9d3522b787612ba129058b89f8a4c5f9a4e980321f69c3cc68607c5b111d8ef6",
          "worktree_digest": "sha256:9d3522b787612ba129058b89f8a4c5f9a4e980321f69c3cc68607c5b111d8ef6",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/context.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:7442ebc5acc1267fc801665e36351e13a91d0bb97c2674b045330b5b8bb6d2cd",
          "index_digest": "sha256:7442ebc5acc1267fc801665e36351e13a91d0bb97c2674b045330b5b8bb6d2cd",
          "worktree_digest": "sha256:7442ebc5acc1267fc801665e36351e13a91d0bb97c2674b045330b5b8bb6d2cd",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/delivery.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:2a4f531e6ceca4fc98ed0203247f4abeaa10776e5b26909eb93f347b479f7a73",
          "index_digest": "sha256:2a4f531e6ceca4fc98ed0203247f4abeaa10776e5b26909eb93f347b479f7a73",
          "worktree_digest": "sha256:2a4f531e6ceca4fc98ed0203247f4abeaa10776e5b26909eb93f347b479f7a73",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/execution-environment.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:82aae39bd65141df80f6a85991e35d05c9f0dfc748be88f78b7520ce97883b3f",
          "index_digest": "sha256:82aae39bd65141df80f6a85991e35d05c9f0dfc748be88f78b7520ce97883b3f",
          "worktree_digest": "sha256:82aae39bd65141df80f6a85991e35d05c9f0dfc748be88f78b7520ce97883b3f",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/http.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:5da39830429559975cae7ae6d39416acb2322ac8e31cfb4da3436df602cb7ec4",
          "index_digest": "sha256:5da39830429559975cae7ae6d39416acb2322ac8e31cfb4da3436df602cb7ec4",
          "worktree_digest": "sha256:5da39830429559975cae7ae6d39416acb2322ac8e31cfb4da3436df602cb7ec4",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/links.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:7d17aef4fb89936467ad99d6c25417b03d7b4a66ad02e3b0981aed3cb2f0ffc2",
          "index_digest": "sha256:7d17aef4fb89936467ad99d6c25417b03d7b4a66ad02e3b0981aed3cb2f0ffc2",
          "worktree_digest": "sha256:7d17aef4fb89936467ad99d6c25417b03d7b4a66ad02e3b0981aed3cb2f0ffc2",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/migration.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:b479546845852ac670ae8fe592b8564f96bb78d30dd2370f767ba2050bab8d9b",
          "index_digest": "sha256:b479546845852ac670ae8fe592b8564f96bb78d30dd2370f767ba2050bab8d9b",
          "worktree_digest": "sha256:b479546845852ac670ae8fe592b8564f96bb78d30dd2370f767ba2050bab8d9b",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/outbox.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:48d20062dd8c34c2b95e851c78265c9e403d1040894e97c7d9d0fa190d54415e",
          "index_digest": "sha256:48d20062dd8c34c2b95e851c78265c9e403d1040894e97c7d9d0fa190d54415e",
          "worktree_digest": "sha256:48d20062dd8c34c2b95e851c78265c9e403d1040894e97c7d9d0fa190d54415e",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/prompts.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:fd22f1b1e7c1571f2eae4299995a13cc0b04cb212e18ef23e9b27ed28a1a1de6",
          "index_digest": "sha256:fd22f1b1e7c1571f2eae4299995a13cc0b04cb212e18ef23e9b27ed28a1a1de6",
          "worktree_digest": "sha256:fd22f1b1e7c1571f2eae4299995a13cc0b04cb212e18ef23e9b27ed28a1a1de6",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/resources.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:cc09f56669b2ccacfc889aa98132590b618f77e6648a7ff8fe8454106c8c663f",
          "index_digest": "sha256:cc09f56669b2ccacfc889aa98132590b618f77e6648a7ff8fe8454106c8c663f",
          "worktree_digest": "sha256:cc09f56669b2ccacfc889aa98132590b618f77e6648a7ff8fe8454106c8c663f",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/role-models.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:cdb07d492a3edf3e5f49c313136b706b95b9f6a8982930737b032a7f181333c6",
          "index_digest": "sha256:cdb07d492a3edf3e5f49c313136b706b95b9f6a8982930737b032a7f181333c6",
          "worktree_digest": "sha256:cdb07d492a3edf3e5f49c313136b706b95b9f6a8982930737b032a7f181333c6",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/runtime.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:5befef035b4a70978cd881b32282680260c6d2561679f890dd911214664cf515",
          "index_digest": "sha256:5befef035b4a70978cd881b32282680260c6d2561679f890dd911214664cf515",
          "worktree_digest": "sha256:5befef035b4a70978cd881b32282680260c6d2561679f890dd911214664cf515",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/sessions.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:ca2b98e57e9f27b2abb0afab59d44ea744a96d8be4cf81d7b3776901b56cd36b",
          "index_digest": "sha256:ca2b98e57e9f27b2abb0afab59d44ea744a96d8be4cf81d7b3776901b56cd36b",
          "worktree_digest": "sha256:ca2b98e57e9f27b2abb0afab59d44ea744a96d8be4cf81d7b3776901b56cd36b",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/settings.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:2c7cd780dd24ab6a99ddfd30f80b921db035e0d56e3e1d42a86371fe20423f3f",
          "index_digest": "sha256:2c7cd780dd24ab6a99ddfd30f80b921db035e0d56e3e1d42a86371fe20423f3f",
          "worktree_digest": "sha256:2c7cd780dd24ab6a99ddfd30f80b921db035e0d56e3e1d42a86371fe20423f3f",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/setup.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:d1de51b048d352345d4837a5911ba4d0158979c8073575feddc064670c8a697a",
          "index_digest": "sha256:d1de51b048d352345d4837a5911ba4d0158979c8073575feddc064670c8a697a",
          "worktree_digest": "sha256:d1de51b048d352345d4837a5911ba4d0158979c8073575feddc064670c8a697a",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/skill-files.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:c95a1bb606bb9c7d932c807c4a9597ed7e0f8a02dbb1e16adb4133c0f1bfccf1",
          "index_digest": "sha256:c95a1bb606bb9c7d932c807c4a9597ed7e0f8a02dbb1e16adb4133c0f1bfccf1",
          "worktree_digest": "sha256:c95a1bb606bb9c7d932c807c4a9597ed7e0f8a02dbb1e16adb4133c0f1bfccf1",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/source-context.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:909ad5cb9739e4143ddc9ad1d38a6b1b46b18d52c0bcd2b4f8e25b691d0b9047",
          "index_digest": "sha256:909ad5cb9739e4143ddc9ad1d38a6b1b46b18d52c0bcd2b4f8e25b691d0b9047",
          "worktree_digest": "sha256:909ad5cb9739e4143ddc9ad1d38a6b1b46b18d52c0bcd2b4f8e25b691d0b9047",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/tools/executor.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:9869d8a5043725847f18814e23b29c11ae93aa974defa72d2eab62c61a6def47",
          "index_digest": "sha256:9869d8a5043725847f18814e23b29c11ae93aa974defa72d2eab62c61a6def47",
          "worktree_digest": "sha256:9869d8a5043725847f18814e23b29c11ae93aa974defa72d2eab62c61a6def47",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/tools/main.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:88603eb5a94c67e93141e07bd09bde85d65f980a1f42503c53ab9c22ec5c538d",
          "index_digest": "sha256:88603eb5a94c67e93141e07bd09bde85d65f980a1f42503c53ab9c22ec5c538d",
          "worktree_digest": "sha256:88603eb5a94c67e93141e07bd09bde85d65f980a1f42503c53ab9c22ec5c538d",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/views/settings.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:5740ad427457aa501fa6cc706573ce5b6882c53d4cdc646f1ac6f02787cd25a3",
          "index_digest": "sha256:5740ad427457aa501fa6cc706573ce5b6882c53d4cdc646f1ac6f02787cd25a3",
          "worktree_digest": "sha256:5740ad427457aa501fa6cc706573ce5b6882c53d4cdc646f1ac6f02787cd25a3",
          "untracked_digest": "absent"
        },
        {
          "path": "src/app/views/sources.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:d81bbdba84c2a7bc49a53c95b0b96a340cc2231135f065eff59da648d0ec6798",
          "index_digest": "sha256:d81bbdba84c2a7bc49a53c95b0b96a340cc2231135f065eff59da648d0ec6798",
          "worktree_digest": "sha256:d81bbdba84c2a7bc49a53c95b0b96a340cc2231135f065eff59da648d0ec6798",
          "untracked_digest": "absent"
        },
        {
          "path": "src/client/api.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:800b0347183c39601b8b7cd33607dee2538eb8da5feb5f1c7e13a1a7c2268f36",
          "index_digest": "sha256:800b0347183c39601b8b7cd33607dee2538eb8da5feb5f1c7e13a1a7c2268f36",
          "worktree_digest": "sha256:800b0347183c39601b8b7cd33607dee2538eb8da5feb5f1c7e13a1a7c2268f36",
          "untracked_digest": "absent"
        },
        {
          "path": "src/client/deployment.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:c37ebd5a24d0319a28d3d98a76dde23d9694b0fad4a7900df0eff85de82afb4b",
          "index_digest": "sha256:c37ebd5a24d0319a28d3d98a76dde23d9694b0fad4a7900df0eff85de82afb4b",
          "worktree_digest": "sha256:c37ebd5a24d0319a28d3d98a76dde23d9694b0fad4a7900df0eff85de82afb4b",
          "untracked_digest": "absent"
        },
        {
          "path": "src/client/execution.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:8d9200aab40f092972234fc5712a78f1db0c1ad581517d574f8b8143c289959c",
          "index_digest": "sha256:8d9200aab40f092972234fc5712a78f1db0c1ad581517d574f8b8143c289959c",
          "worktree_digest": "sha256:8d9200aab40f092972234fc5712a78f1db0c1ad581517d574f8b8143c289959c",
          "untracked_digest": "absent"
        },
        {
          "path": "src/client/index.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:6a7e5a0295ecbbd047dbb619e0cdf9d1489a46c8dfcc56dbfd1cfe6f6d866529",
          "index_digest": "sha256:6a7e5a0295ecbbd047dbb619e0cdf9d1489a46c8dfcc56dbfd1cfe6f6d866529",
          "worktree_digest": "sha256:6a7e5a0295ecbbd047dbb619e0cdf9d1489a46c8dfcc56dbfd1cfe6f6d866529",
          "untracked_digest": "absent"
        },
        {
          "path": "src/client/locales.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:d172c86d672b9244effe3590bc7c25ac71b80d3ccbb7d6c5fe76848ce31eba12",
          "index_digest": "sha256:d172c86d672b9244effe3590bc7c25ac71b80d3ccbb7d6c5fe76848ce31eba12",
          "worktree_digest": "sha256:d172c86d672b9244effe3590bc7c25ac71b80d3ccbb7d6c5fe76848ce31eba12",
          "untracked_digest": "absent"
        },
        {
          "path": "src/client/overview.tsx",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:316efe735bdfd6e109483916a5a2ba2f78a10618eff0caff59389af541c98f48",
          "index_digest": "sha256:316efe735bdfd6e109483916a5a2ba2f78a10618eff0caff59389af541c98f48",
          "worktree_digest": "sha256:316efe735bdfd6e109483916a5a2ba2f78a10618eff0caff59389af541c98f48",
          "untracked_digest": "absent"
        },
        {
          "path": "src/client/route.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:457b3cf37c9678c085cf4685ae412ff92bc5510b4a5401e805e4762ad12a3a4c",
          "index_digest": "sha256:457b3cf37c9678c085cf4685ae412ff92bc5510b4a5401e805e4762ad12a3a4c",
          "worktree_digest": "sha256:457b3cf37c9678c085cf4685ae412ff92bc5510b4a5401e805e4762ad12a3a4c",
          "untracked_digest": "absent"
        },
        {
          "path": "src/core/errors.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:aa7532a2d1f8c443608683ef1231bf3d81b842f67a87d9b77742b5c76d515009",
          "index_digest": "sha256:aa7532a2d1f8c443608683ef1231bf3d81b842f67a87d9b77742b5c76d515009",
          "worktree_digest": "sha256:aa7532a2d1f8c443608683ef1231bf3d81b842f67a87d9b77742b5c76d515009",
          "untracked_digest": "absent"
        },
        {
          "path": "src/core/model.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:982155fe6a03c887a7ac4475c6d1592d12aa23c5fe3698403c93bbfd6469d44a",
          "index_digest": "sha256:982155fe6a03c887a7ac4475c6d1592d12aa23c5fe3698403c93bbfd6469d44a",
          "worktree_digest": "sha256:982155fe6a03c887a7ac4475c6d1592d12aa23c5fe3698403c93bbfd6469d44a",
          "untracked_digest": "absent"
        },
        {
          "path": "src/core/ports.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:0b44f1cd716d64776b0e3ea74a158cf0effd92e763b1b13c7705e766e9225a43",
          "index_digest": "sha256:0b44f1cd716d64776b0e3ea74a158cf0effd92e763b1b13c7705e766e9225a43",
          "worktree_digest": "sha256:0b44f1cd716d64776b0e3ea74a158cf0effd92e763b1b13c7705e766e9225a43",
          "untracked_digest": "absent"
        },
        {
          "path": "src/deployment.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:9984953f17592b267e386d4028552d413cfe9c9ac4df6dfb730b6be5115dbf77",
          "index_digest": "sha256:9984953f17592b267e386d4028552d413cfe9c9ac4df6dfb730b6be5115dbf77",
          "worktree_digest": "sha256:9984953f17592b267e386d4028552d413cfe9c9ac4df6dfb730b6be5115dbf77",
          "untracked_digest": "absent"
        },
        {
          "path": "src/executor/background.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:60b98302d412426cda7df12ed69d750183f60fb00ac802a01ae2c963cfc79420",
          "index_digest": "sha256:60b98302d412426cda7df12ed69d750183f60fb00ac802a01ae2c963cfc79420",
          "worktree_digest": "sha256:60b98302d412426cda7df12ed69d750183f60fb00ac802a01ae2c963cfc79420",
          "untracked_digest": "absent"
        },
        {
          "path": "src/executor/dsh.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:6445a03121fa9bd15fc437736bcc2acc6ab950c5fe732e5b99eb8ee2c8a9476b",
          "index_digest": "sha256:6445a03121fa9bd15fc437736bcc2acc6ab950c5fe732e5b99eb8ee2c8a9476b",
          "worktree_digest": "sha256:6445a03121fa9bd15fc437736bcc2acc6ab950c5fe732e5b99eb8ee2c8a9476b",
          "untracked_digest": "absent"
        },
        {
          "path": "src/index.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:fbe2a1290be6f92f641592754e813a1fc0ffc164072a8ef2f1e57f8c151d44ec",
          "index_digest": "sha256:fbe2a1290be6f92f641592754e813a1fc0ffc164072a8ef2f1e57f8c151d44ec",
          "worktree_digest": "sha256:fbe2a1290be6f92f641592754e813a1fc0ffc164072a8ef2f1e57f8c151d44ec",
          "untracked_digest": "absent"
        },
        {
          "path": "src/infra/commands.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:9d7593c5022e0c1813731c1f1cd8471b1536b0b5f42974a08ef2b2930c1e62b2",
          "index_digest": "sha256:9d7593c5022e0c1813731c1f1cd8471b1536b0b5f42974a08ef2b2930c1e62b2",
          "worktree_digest": "sha256:9d7593c5022e0c1813731c1f1cd8471b1536b0b5f42974a08ef2b2930c1e62b2",
          "untracked_digest": "absent"
        },
        {
          "path": "src/infra/environment.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:413680e755ed36b74157f364a38cb5dbe81e4af0db0fa88c8376c682e2282a7c",
          "index_digest": "sha256:413680e755ed36b74157f364a38cb5dbe81e4af0db0fa88c8376c682e2282a7c",
          "worktree_digest": "sha256:413680e755ed36b74157f364a38cb5dbe81e4af0db0fa88c8376c682e2282a7c",
          "untracked_digest": "absent"
        },
        {
          "path": "src/infra/health.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:dcd84306e795866ffb66ecb5274edf50114ba77052d260b4b530a1a81022d76e",
          "index_digest": "sha256:dcd84306e795866ffb66ecb5274edf50114ba77052d260b4b530a1a81022d76e",
          "worktree_digest": "sha256:dcd84306e795866ffb66ecb5274edf50114ba77052d260b4b530a1a81022d76e",
          "untracked_digest": "absent"
        },
        {
          "path": "src/infra/text.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:70c9edb98139e3091d5e63d2ccf31d308c045f0510087a87517fbb3635cdd9e7",
          "index_digest": "sha256:70c9edb98139e3091d5e63d2ccf31d308c045f0510087a87517fbb3635cdd9e7",
          "worktree_digest": "sha256:70c9edb98139e3091d5e63d2ccf31d308c045f0510087a87517fbb3635cdd9e7",
          "untracked_digest": "absent"
        },
        {
          "path": "src/kv.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:c6dd38e1ef7b19ae5a0440e11c4a713103a318e0df3fc2fc3b12cbd9a8f4eea7",
          "index_digest": "sha256:c6dd38e1ef7b19ae5a0440e11c4a713103a318e0df3fc2fc3b12cbd9a8f4eea7",
          "worktree_digest": "sha256:c6dd38e1ef7b19ae5a0440e11c4a713103a318e0df3fc2fc3b12cbd9a8f4eea7",
          "untracked_digest": "absent"
        },
        {
          "path": "src/policy.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:01cff8c333b341ee2943e644046f0da3ed9675af1c0029489b5f4bc8226d293d",
          "index_digest": "sha256:01cff8c333b341ee2943e644046f0da3ed9675af1c0029489b5f4bc8226d293d",
          "worktree_digest": "sha256:01cff8c333b341ee2943e644046f0da3ed9675af1c0029489b5f4bc8226d293d",
          "untracked_digest": "absent"
        },
        {
          "path": "src/setup.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:eae13507edd63c331ccde9e979835202e742378cca2eb35fcd12af60e48fc6f2",
          "index_digest": "sha256:eae13507edd63c331ccde9e979835202e742378cca2eb35fcd12af60e48fc6f2",
          "worktree_digest": "sha256:eae13507edd63c331ccde9e979835202e742378cca2eb35fcd12af60e48fc6f2",
          "untracked_digest": "absent"
        },
        {
          "path": "src/sources/admission-context.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:c13b421c479f02dfc5846ef266081586afe33d685c742c37e62d69ccd182557f",
          "index_digest": "sha256:c13b421c479f02dfc5846ef266081586afe33d685c742c37e62d69ccd182557f",
          "worktree_digest": "sha256:c13b421c479f02dfc5846ef266081586afe33d685c742c37e62d69ccd182557f",
          "untracked_digest": "absent"
        },
        {
          "path": "src/sources/host.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:b07998dad9194319a95a9436084cf1612aef9c4c6de22288cfa04258bbfbb1ce",
          "index_digest": "sha256:b07998dad9194319a95a9436084cf1612aef9c4c6de22288cfa04258bbfbb1ce",
          "worktree_digest": "sha256:b07998dad9194319a95a9436084cf1612aef9c4c6de22288cfa04258bbfbb1ce",
          "untracked_digest": "absent"
        },
        {
          "path": "src/sources/kind.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:4ea3d8eee14707e0ee9b67289a62b1a568bab64732bd04041da5ad89bc9a7e98",
          "index_digest": "sha256:4ea3d8eee14707e0ee9b67289a62b1a568bab64732bd04041da5ad89bc9a7e98",
          "worktree_digest": "sha256:4ea3d8eee14707e0ee9b67289a62b1a568bab64732bd04041da5ad89bc9a7e98",
          "untracked_digest": "absent"
        },
        {
          "path": "src/sources/poll.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:bc4ac0428ce3b379353dd5e02607a4d79b7c9e18d7d13e179cc5b6ba8626d6c8",
          "index_digest": "sha256:bc4ac0428ce3b379353dd5e02607a4d79b7c9e18d7d13e179cc5b6ba8626d6c8",
          "worktree_digest": "sha256:bc4ac0428ce3b379353dd5e02607a4d79b7c9e18d7d13e179cc5b6ba8626d6c8",
          "untracked_digest": "absent"
        },
        {
          "path": "src/sources/registry.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:fe8a8fce0b00b65d4fb69b7cd2e5fbf4950b8dc32f0891169f9150c4a16eb5cd",
          "index_digest": "sha256:fe8a8fce0b00b65d4fb69b7cd2e5fbf4950b8dc32f0891169f9150c4a16eb5cd",
          "worktree_digest": "sha256:fe8a8fce0b00b65d4fb69b7cd2e5fbf4950b8dc32f0891169f9150c4a16eb5cd",
          "untracked_digest": "absent"
        },
        {
          "path": "tests/bundle-patch.spec.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:308b71e4ae4096b03ad18541e5775a86e44979987f081ad8c1b679a3c517af35",
          "index_digest": "sha256:308b71e4ae4096b03ad18541e5775a86e44979987f081ad8c1b679a3c517af35",
          "worktree_digest": "sha256:308b71e4ae4096b03ad18541e5775a86e44979987f081ad8c1b679a3c517af35",
          "untracked_digest": "absent"
        },
        {
          "path": "tests/docs.spec.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:097b973c5fc8c5a7496f8aed66f11da2e612f0af36c5bcd2f8bfbebc64d96b03",
          "index_digest": "sha256:097b973c5fc8c5a7496f8aed66f11da2e612f0af36c5bcd2f8bfbebc64d96b03",
          "worktree_digest": "sha256:097b973c5fc8c5a7496f8aed66f11da2e612f0af36c5bcd2f8bfbebc64d96b03",
          "untracked_digest": "absent"
        },
        {
          "path": "tests/fixtures/deployment.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:48a7af52fa153b2da58e952cce726bb40f4a4f5b59dbf41b0409fa581425faf7",
          "index_digest": "sha256:48a7af52fa153b2da58e952cce726bb40f4a4f5b59dbf41b0409fa581425faf7",
          "worktree_digest": "sha256:48a7af52fa153b2da58e952cce726bb40f4a4f5b59dbf41b0409fa581425faf7",
          "untracked_digest": "absent"
        },
        {
          "path": "tests/fixtures/host.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:d2ffcc23240a5327a477e330c153ba55d14012fd2dfd21f77ae3d5fd35db5b1b",
          "index_digest": "sha256:d2ffcc23240a5327a477e330c153ba55d14012fd2dfd21f77ae3d5fd35db5b1b",
          "worktree_digest": "sha256:d2ffcc23240a5327a477e330c153ba55d14012fd2dfd21f77ae3d5fd35db5b1b",
          "untracked_digest": "absent"
        },
        {
          "path": "tests/locales.spec.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:18d918f19e0fa5c129f51027d13fc1b7980f751bd31cbbe5b5db1e5e60684545",
          "index_digest": "sha256:18d918f19e0fa5c129f51027d13fc1b7980f751bd31cbbe5b5db1e5e60684545",
          "worktree_digest": "sha256:18d918f19e0fa5c129f51027d13fc1b7980f751bd31cbbe5b5db1e5e60684545",
          "untracked_digest": "absent"
        },
        {
          "path": "tests/model-surface.spec.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:aa1226f72359a42764c2c58f1681b93693e6909a9e2f9ea521cf47e1ee778114",
          "index_digest": "sha256:aa1226f72359a42764c2c58f1681b93693e6909a9e2f9ea521cf47e1ee778114",
          "worktree_digest": "sha256:aa1226f72359a42764c2c58f1681b93693e6909a9e2f9ea521cf47e1ee778114",
          "untracked_digest": "absent"
        },
        {
          "path": "tests/service-script.spec.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:57bf507d5bb7e8fd98beb6d250c7f459ff042eacbc39491d678138e07beaa84d",
          "index_digest": "sha256:57bf507d5bb7e8fd98beb6d250c7f459ff042eacbc39491d678138e07beaa84d",
          "worktree_digest": "sha256:57bf507d5bb7e8fd98beb6d250c7f459ff042eacbc39491d678138e07beaa84d",
          "untracked_digest": "absent"
        },
        {
          "path": "tsdown.config.ts",
          "object_kind": {
            "head": "regular",
            "index": "regular",
            "worktree": "regular",
            "untracked": "absent"
          },
          "state": "clean",
          "rename_from": null,
          "rename_to": null,
          "head_digest": "sha256:39163d8b6b8bd8e7eb723e535da60ce6840fa83930f4c92e1de916d3cfdfd211",
          "index_digest": "sha256:39163d8b6b8bd8e7eb723e535da60ce6840fa83930f4c92e1de916d3cfdfd211",
          "worktree_digest": "sha256:39163d8b6b8bd8e7eb723e535da60ce6840fa83930f4c92e1de916d3cfdfd211",
          "untracked_digest": "absent"
        }
      ]
    }
  primary_symbols:
    - { symbol: 'Sessions', file: 'src/app/sessions.ts', lines: '93-352', role: 'WORK_TOOLS allow list, preset selection, skill binding' }
    - { symbol: 'Settings.save', file: 'src/app/settings.ts', lines: '148-200', role: 'block save with async checks; add subagents block and probe' }
    - { symbol: 'Runtime', file: 'src/app/runtime.ts', lines: '59-254', role: 'composition root; add Subagents, remove GitHub/Feishu wiring' }
    - { symbol: 'resolveDeployment', file: 'src/deployment.ts', lines: '87-106', role: 'rewrite for a local checkout' }
    - { symbol: 'SourceKind', file: 'src/sources/kind.ts', lines: '85-113', role: 'contract the plan kind implements' }
  related_symbols:
    - { symbol: 'DshExecutor.launch', relationship: 'unchanged consumer', relevance: 'guards only; no Source branch (PDG)' }
    - { symbol: 'executorTools', relationship: 'edited', relevance: 'drop pr_number/readPull/claimPull/host.github' }
    - { symbol: 'builtInParts / promptParts', relationship: 'edited', relevance: 'add runtime/delegation; drop skill/feishu, skill/github' }
    - { symbol: 'EXECUTOR_VARIABLES / environmentOf', relationship: 'edited', relevance: 'role tool variables for the prompt' }
    - { symbol: 'HealthBoard.claim', relationship: 'used', relevance: 'claim subagents and plan entries once' }
    - { symbol: 'SourceRegistry', relationship: 'unchanged', relevance: '26 direct dependents; keep API' }
    - { symbol: 'Commands', relationship: 'shrunk', relevance: '35 direct dependents listed in plan §9' }
    - { symbol: 'writeEnvironment / WORKER_COMMANDS', relationship: 'edited', relevance: 'blocked-command shims only' }
    - { symbol: 'KV', relationship: 'edited', relevance: 'remove github/feishu, add plan.file' }
    - { symbol: 'tests/docs.spec.ts listed()', relationship: 'test-of docs', relevance: 'forces table updates per step' }
  execution_path:
    - 'Plan poll: planKind reads directory → hash per file vs KV.plan.file → SourceContext.receive(Trigger) → Passes → Engine.receive → Eval (MasterAssessor reads threadContext) → accept → Ticket + Assignment'
    - 'Launch: Effects launch → DshExecutor.launch (guards 426-429) → prepareDirectory → Sessions.ensure(WORKER_PRESET) → decorate → workOnly(WORK_TOOLS incl. subagent_claude_code/subagent_codex) → first message'
    - 'Work: worker reads delegation part → subagent_claude_code(brief) → completion notice → subagent_codex(verify brief) → orchestrator_report progress/ready → reportRelay → main Session → orchestrator_reply → Outbox → planKind.channel.send appends log'
    - 'Settings: PUT settings/subagents → Settings.save → Subagents.check (probe) → store.saveSettings → Subagents remount providers → health'
  pdg_constraints:
    - description: 'Sessions.decorate guard exits precede tool registration'
      affected_statements: ['src/app/sessions.ts:233', 'src/app/sessions.ts:237', 'src/app/sessions.ts:259', 'src/app/sessions.ts:261']
      implementation_consequence: 'Only WORK_TOOLS changes; tool availability is filtered by agent.ctx.tools.get(name, parent) at sessions.ts:292, so tool names must match the preset toolName exactly.'
    - description: 'DshExecutor.launch runs unconditionally after live-ticket guards'
      affected_statements: ['src/executor/dsh.ts:426', 'src/executor/dsh.ts:427', 'src/executor/dsh.ts:429']
      implementation_consequence: 'No Executor edits required for delegation; do not add Source branches there.'
  architectural_patterns:
    - { pattern: 'Narrow Pick host interface per class', example_location: 'src/app/sessions.ts SessionsHost', usage_guidance: 'Subagents receives a SubagentsHost Pick; Runtime passes itself only behind it.' }
    - { pattern: 'Single-writer health entry', example_location: 'src/infra/health.ts HealthBoard.claim', usage_guidance: 'Subagents claims `subagents`; planKind declares `health: [plan]`.' }
    - { pattern: 'Fixed refusal codes', example_location: 'src/core/errors.ts USER_ERRORS', usage_guidance: 'Add codes; locales.spec requires zh/en words.' }
    - { pattern: 'Settings block rules', example_location: 'src/app/settings.ts BLOCKS', usage_guidance: 'parse/merge/guard triple; panel-only guard for secrets.' }
    - { pattern: 'SourceKind plugin', example_location: 'src/sources/kind.ts, src/sources/registry.ts', usage_guidance: 'plan kind exported as a plugin entry like the deleted github.ts; registered via ctx.orchestrator (SourceHost).' }
    - { pattern: 'Prompt files one sentence per line', example_location: 'prompts/work.md, src/app/skill-files.ts promptFile', usage_guidance: 'delegation.md follows it; model-surface budget applies.' }
  files_to_modify: see plan §10
  tests: see plan §8
  verification_commands: ['pnpm typecheck', 'pnpm test', 'pnpm vitest run tests/<name>.spec.ts', 'pnpm build', 'pnpm check']
  risks: see plan §9
  assumptions:
    - 'Claude Code honours ANTHROPIC_MODEL from env — check at runtime: `ANTHROPIC_MODEL=<id> claude -p "reply with your model id" --output-format json` and read the reported model; Codex model selection stays native (~/.codex/config.toml).'
    - 'The fake host in tests/fixtures/host.ts exposes `subagents` and `subprocess` services (verified) so ctx.plugin(provider, { env }) can be exercised there; if the provider module cannot be imported under vitest, mount through an injectable factory and stub it.'
    - 'Workers commit with the operator git identity (no agent account) — confirm with the user if an agent identity is wanted.'
  open_questions:
    - 'Project name spelling: the user wrote `super-codeing-agent`; the plan uses `super-coding-agent` — confirm at the gate.'
    - 'Existing state directories (schema 11) are refused rather than migrated — acceptable for a prototype? (decision taken: refuse)'
    - 'Should the plan Source mark a file done (e.g. frontmatter status) or is the log file enough? (plan: log only; plan files untouched)'
    - 'Codex 0.158.0 vs provider evidence pinned to 0.147.0 — verify a real one-shot run before relying on it.'
    - '`enableRunInBackground` appears in the provider README but not in the installed tool config type — do not set it unless the pinned version declares it.'
  avoid:
    - 'Do not repeat full repository discovery'
    - 'Do not replace established patterns without evidence'
    - 'Do not change src/core or SourceRegistry/SourceKind APIs'
    - 'Do not write to plan files from the Channel; append only under .superagent/'
    - 'Do not add provider plugin rows to cordis.patch.yml; Runtime mounts them from settings'
    - 'Do not commit without updating docs/007 Modules/Tests tables (tests/docs.spec.ts)'
    - 'Do not store or display env secrets unmasked in settings history or the panel'
    - 'Do not rename orchestrator_* tools, the orchestrator service, /orchestrator/api or orchestrator.sqlite: those are role names'
    - 'Do not set enableRunInBackground on dsh-tool-subagent rows; it is not in the installed config type'
```

## 12. Assumptions and Open Questions

**Assumptions (re-verify cheaply in Lane 3):**
- [verified in Deepen, was assumed] Provider packages at `0.2.1-alpha.2` with matching peers; `apply()` registers the provider on `ctx.subagents`; `dsh-tool-subagent` tolerates a provider that mounts later. Residual: run one real delegation after step 2 to confirm the Codex 0.158 ↔ provider (evidence at 0.147/0.153) wire still works.
- [assumed] `ANTHROPIC_MODEL` selects the Claude Code model (runtime check in §11 assumptions); Codex model stays native.
- [assumed] The spelling of the new name is `super-coding-agent` (user wrote `super-codeing-agent`).
- [assumed] Workers commit as the operator; the isolated git config keeps only `GIT_LOCATION` clearing and blocked-command shims.
- [inferred] `admission-context.ts` and `MasterAssessor` keep working with a kind whose `threadContext` returns one message; `images` returns `[]`.

**Decisions:**
- Schema 12 refuses older databases (no migration of GitHub/Feishu records). Operators start a new state directory.
- Provider plugins are owned by dsh-superagent (mounted from settings), not by the bundle patch, so enable/env/model are editable in the panel without touching YAML.
- Spawn/fork DSH subagents are removed from the worker preset: delegation goes only to Claude Code / Codex (or the worker itself via role `worker`).

**Open questions for the user:**
- Confirm the project name spelling `super-coding-agent`.
- Should the plan Source also support a "done" marker in the file (or a `tasks` list format from BMAD/speckit) to split one plan into several Tickets? v1 treats one file as one Ticket.
- Is a dedicated agent git identity required for commits?

**References consulted (Deepen):** TransformerOptimus/SuperCoder — `README.md`, `ARCHITECTURE.md` (core-as-spine, Ask/Plan/Coding modes fixed per session, `git-ops` turn checkpoints with restore bounded to the project root, `SUPERCODER_` env prefix, optional graph retrieval service); yashdev9274/superCli (Nova) — `README.md`, `AGENTS.md`, `apps/supercode-cli/server/README.md` (threads binding model+tools+context, approvals before consequential actions, native Codex installed separately and connected locally, repo-root `AGENTS.md` conventions). Neither is a dependency; ideas are adopted as prompt rules and naming only.

**Deferred follow-ups (not in scope):** `feat/yunxiao-source` branch reconciliation; a `plan` Source "done" marker; Codex model selection via a managed `CODEX_HOME`; removing `limitSubagent` and `src/executor/background.ts` subagent handling if external children prove not to appear in `ctx.subagents` catalogs; GitNexus stale-index note: process coverage was budget-truncated (657 of 857 entry points unranked) — not load-bearing here.

## 13. Definition of Done

- `pnpm check` green; `tests/docs.spec.ts` passes with every new/deleted file reflected in `docs/007-architecture.md`.
- `cordis.patch.yml` worker preset has exactly two `@deepseek-ai/dsh-tool-subagent` rows (`claude-code`/`subagent_claude_code`, `codex`/`subagent_codex`, `maxDepth: provider-managed`) and no `dsh-tool-subagent-control`; `tests/bundle-patch.spec.ts` asserts it; row ids are `dsh-superagent`, `dsh-superagent-plan`, the two presets.
- `GET settings` returns `blocks.subagents` and `subagents.status`; `PUT settings/subagents` with an unavailable command → 400 `subagentUnavailable`; with an available one → provider mounted, `subagents` health `ready`; panel Execution tab shows the Subagents section and overview shows the health.
- A plan file saved under the configured directory yields a Trigger (`source: plan`, actor `operator`) and, with the operator on the allowed list, a Ticket and a worker Session whose prompt contains the delegation protocol and the role tools; replies are appended under `.superagent/`.
- `grep -riE 'github|feishu|lark|\bgh\b' src prompts skills` returns only historical comments the user accepts, or nothing; `src/sources` contains `plan*.ts`, `kind.ts`, `host.ts`, `registry.ts`, `admission-context.ts`, `poll.ts` only.
- The repository, package, plugin ids, presets, env prefix, service script and UI label say `super-coding-agent` / `SUPER_CODING_AGENT_` / "Super Coding Agent"; `grep -rIE 'dsh-superagent|DSH_SUPERAGENT|Superagent' --exclude-dir=node_modules --exclude-dir=lib --exclude-dir=.git --exclude-dir=plans .` returns nothing.
- `README.md`, `SETUP.md`, `docs/000`–`008`, `CLAUDE.md` describe the plan Source, the coordinator worker and the subagents settings; `SETUP.md` tells an upgrading operator to start a new state directory and to fix the profile row.

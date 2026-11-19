# 001 Domain model

This document names the concepts of super-coding-agent and the rules each one keeps. The code, the tools the agents call, the panel and the other documents use these terms and no others. Following [000 Philosophy](000-philosophy.md), the model holds only concepts the work needs, and a need becomes an attribute of one of them.

## Flow

Work moves from Trigger to Eval to execution. The plan Source produces a Trigger for each new or changed plan file. A Trigger fans out as context to the Tickets subscribed to its Thread. A person's message that reached a Ticket this way stays with that Ticket; every other Trigger enters Eval, which decides whether it asks for new work. When Eval accepts, it creates a Ticket with a Mandate. An Assignment hands the Ticket to an Executor, and results go back to the plan's log through a Channel.

```mermaid
flowchart LR
  S[Source] -->|Trigger| T[Thread]
  T -->|batch| E[Eval]
  T -->|Subscription fan-out| K[Ticket]
  E -->|accept with Mandate / stop| K
  E -->|ignore / unavailable| X[recorded]
  P[Policy change] -->|notice| K
  K -->|Assignment| W[Executor]
  K -->|Channel| S
```

## Concepts

Source, Thread, Eval, Mandate and Subscription form the core domain; the rest supports them. The middle column says what each concept is for the plan Source, the only Source in this repository.

| Concept | With plan files | Rules it keeps | Why it exists |
| --- | --- | --- | --- |
| Source | The plan files of one local git checkout, found anywhere in it by path pattern. A Source kind is a reusable implementation; a Source instance is one configuration of a kind: whether it runs and what it reads | Holds its read position: the content hash of each plan file it has seen. Defines what counts as an event: a Markdown file that is new or whose content changed. Translates each Trigger into the Thread it belongs to and the Channel address to reply on | A restart must not replay events |
| Trigger | One revision of one plan file, sent by `operator` and addressed directly to the agent | Belongs to one or more Threads. Its id derives from the file's path and content, so reading the same revision twice creates one Trigger, and accepting it twice creates one Ticket | The unit of audit and of idempotence |
| Thread | Every revision of one plan file, by its path in the repository | At most one Eval runs on it at a time. It may have several Tickets. It holds its Subscriptions, the running Eval and its Decision history | Gives Eval a consistent view and its context |
| Correlation | The relation between Threads that one Trigger belongs to; a plan Trigger is on one Thread | Adds context; never routes | Lets Eval follow related evidence |
| Channel | The plan's log, `<repository>/.super-coding-agent/logs/<path>.log.md` | A Thread may have several Channels; a Ticket holds a set of them. Each message is appended once; the plan file itself is never written | Acknowledgements, answers and results are all writes |
| Policy | The versioned assessment rules, the accept mode, and each Source's part: who may originate work through that Source. The plan Source's part lists `operator` | The Policy version covers the rules, the accept mode and the Source parts. A change that bears on a live Ticket is delivered to its Assignment; it does not revoke Mandates | When the rules change, a running Eval must be discarded |
| Eval | The judgement on a batch of Triggers, in two layers: gate and assessment | Input: the Trigger batch, a Thread snapshot, every Ticket on the Thread including ended ones, and the current Policy. Output: a Decision. Holds no state | Decides whether new work starts, goes on or stops |
| Mandate | What an accept grants: the Policy version, the scope, the strength, the matched rules, the sender's identity and how the Source received the Trigger | Immutable; wider scope means a new Ticket. A Ticket's end does not end it: only a person's stop withdraws it, and a Policy that no longer holds it revokes it. Revalidated against the current Policy before an ended Ticket resumes | States why the work may be done, and how far it may go |
| Ticket | The work one plan asks for | Only Eval creates one. Refers to its Mandate; holds its Channels and Inputs. Goes open → ended, and back to open when a later revision of its plan resumes it, unless a person stopped it. Defines its own state instead of following the Executor's | Owns the execution and its reports |
| Assignment | The binding of a Ticket to one Executor instance | A Ticket has several over time. Goes pending → running → ended independently of the Ticket. Only its final report may end the Ticket on the Executor's side | The Executor is outside the domain, but who executes must be inside it |
| Subscription | A many-to-many relation between Tickets and Threads, held by the Thread | A Ticket subscribes to the Thread of its plan. A later revision of the plan fans out to every live subscribed Ticket and takes no Eval. A Thread an Executor follows for context, such as another plan, reaches its Ticket the same way, but lends it no authority and does not resume it. An ended Ticket keeps its Subscriptions, and a later revision of its plan resumes it under the same Mandate, with no Eval or Decision. A Ticket a person stopped receives nothing. The main Session attaches a Thread to an existing Ticket only when its plan points at that Ticket explicitly. A person can drop every Subscription on a Thread; an Executor can drop only its own Ticket's Subscription to a Thread it finds unrelated, except the Thread its Ticket started on | Editing a plan reaches the work on it without a new request |

A person is not a domain concept. A Trigger carries its actor's identifier as the Source gives it; the plan Source names every plan's sender `operator`, the person who writes the plan files. An allowed list is a Source's part of the Policy, in that Source's identities.

The Executor, with its Sessions and directories, is outside the domain and connects through Assignments.

Aggregates: a Source holds its read position. A Thread holds its Subscriptions, its running Eval, which runs serially and merges Triggers that arrive meanwhile into the next batch, and its Decision history. A Ticket holds its Assignments, Channels and Inputs, and refers to Decisions by id.

## Rejected concepts

| Rejected | Reason |
| --- | --- |
| Principal or Membership as an entity, or mapping identities across Sources | A person is Trigger metadata; an allowed list is a Source's part of the Policy |
| Eval scheduling its own delayed Triggers | A condition that needs waiting is an ordinary Source, so Eval never depends back on Sources |
| Waiting or revoked Eval states | Waiting belongs to Sources; an Eval that runs out of time queues its Triggers again, or ends `unavailable` |
| At most one live Ticket per Thread | One Thread can carry several independent pieces of work; the assessment avoids duplicates from the Ticket list |
| An "append to Ticket" Decision | Appending is Subscription fan-out and needs no Eval |
| Correlation that routes | Subscriptions route; Correlation only adds context |
| Ticket state that follows the DSH Session | A Ticket can be handed off, resumed, or run by several Executors, so it defines its own state |
| Writing replies into the plan file | The plan is the operator's text; a reply in it would change the plan and produce a new Trigger. Replies go to the plan's log |
| An Executor declaring that a person asked it to stop | Only Eval decides the strength of an end |
| Cancelling running Tickets on a Policy change | A cancelled change leaves half-finished work; the change is recorded and delivered instead |
| Inferring "waiting on a person" from a report's free text | The classification needs structured facts; the Executor asks through a structured field |

## What is reusable

The concepts above and their rules are reusable. The Source implementations, the Policy contents, the Executor and the Channel implementations belong to a deployment. Each Source keeps its own words internally, such as plan file, and translates them into Triggers.

| Part | In this repository |
| --- | --- |
| Source | Plan files: every Markdown file whose repository path matches one of the plan Source's patterns, such as `PLAN.md`, `docs/superpowers/plans/**/*.md` or `specs/**/tasks.md`, outside hidden directories, dependencies and build output, checked every 30 seconds by default |
| Policy | Assessment rules, the accept mode, and the plan Source's allowed list |
| Executor | A DSH Executor Session and a git worktree per Ticket, in an execution environment whose variables the Executor and the Sources register; it only coordinates, and delegates all engineering in bounded subtasks to Claude Code and Codex |
| Channel | The plan's log under `.super-coding-agent/logs/` in the repository, a directory that ignores itself in git |

## Glossary

A reference list of the terms this and the later documents use, with their Chinese names; the later documents explain the terms not introduced above. The panel shows one language at a time; its (?) button opens this glossary with both languages. The messages the agent writes to the plan log use plain language, not these terms.

| Term | 中文 | Meaning |
| --- | --- | --- |
| Agent | 智能体 | The virtual colleague super-coding-agent runs: it reads plan files, commits in the local repository under the operator's git identity, and writes results to the plan log |
| Main Session | 主 Session | The DSH Session that evaluates Triggers, accepts and dispatches Tickets, and replies; `orchestrator` in code and prompts |
| Executor Session | 执行器 Session | The DSH Session an Executor runs for one Ticket; `worker` in code and prompts |
| Source | 来源 | A stream of events: a kind that a plugin provides, plus one instance configuration |
| Trigger | 触发 | One immutable event from a Source |
| Thread | 线程 | Triggers in time order; the unit within which Evals run one at a time |
| Correlation | 关联 | The relation between Threads that share a Trigger; it adds context only |
| Channel | 渠道 | The write side of a Thread |
| Policy | 策略 | The versioned rules for accepting work, and each Source's part of it, such as who may ask for work there |
| Policy version | 策略版本 | The identifier of one combination of rules, Source parts and accept mode; every Mandate records it |
| Eval | 评估 | The process that turns a batch of Triggers into a Decision |
| Gate | 准入 | The deterministic first layer of Eval: who may originate work, and with what strength |
| Assessment | 研判 | The model's judgement during Eval |
| Decision | 决定 | The result of Eval |
| Mandate | 授权 | What an accept grants: strength, scope and the Policy version it relied on |
| Ticket | 工单 | A unit of authorized work |
| Assignment | 派工 | The binding of a Ticket to one Executor instance |
| Subscription | 订阅 | The relation between a Ticket and a Thread |
| Fan-out | 扇出 | Delivering Triggers of a subscribed Thread to a Ticket as context |
| Executor | 执行器 | The port that runs Assignments: one Executor Session and one directory per Ticket |
| Execution environment | 执行环境 | Where Executor Sessions and the prepare command run: variables that the Executor and the Sources register, each with a key, a value and a description |
| Report | 报告 | The state an Assignment reports to its Ticket |
| Attention | 待人工决定 | A question on a Ticket that waits for a person's answer |
| Disposition | 去向 | The record of a Trigger being filtered, evaluated or fanned out |
| Input | 输入 | Context delivered to a Ticket: fanned-out Triggers, Policy changes, resumes and text |
| Scope | 范围 | The work a Mandate allows |
| Strength | 强度 | How strong the basis of a Mandate or an Eval is |

| Group | Values |
| --- | --- |
| Decision | accept 接单 · stop 停止 · ignore 忽略 · unavailable 未完成 |
| Strength | explicit 明确 · inferred 推断 |
| Assignment | pending 待启动 · running 执行中 · ended 已结束 |
| Report | progress 进展 · waiting 等待 · ready 就绪 · blocked 受阻 · failed 失败 · dropped 无需处理 |

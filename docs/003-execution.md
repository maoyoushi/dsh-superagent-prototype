# 003 Execution

This document follows an accepted Ticket through execution, delegation, delivery and recovery. It builds on [001 Domain model](001-domain.md) and [002 Authorization](002-authorization.md).

## Ticket stages

Each open Ticket has one stage, determined by what it is waiting for. Read the table from top to bottom; the first matching row wins.

| Stage | Condition | Panel label |
| --- | --- | --- |
| person / delivery | Delivering an Input to the Executor Session failed; it is retried after 2 seconds, then after a delay that doubles up to a minute, and a success, a new Assignment or the Ticket's end clears it | Input undelivered |
| person / answer | It has an Attention | Awaiting answer |
| person / review | The latest Report is `ready` while the Ticket still follows a Source's Thread | Awaiting review |
| person / blocked, failed | The latest Report is `blocked` or `failed`, and no person's message reached the Ticket since | Blocked · Failed |
| working / queued | No Assignment, or a pending one | Queued |
| idle | The latest Report is `waiting`, or the Assignment ended | Waiting for a Trigger |
| working | Everything else | Working |

A `person` stage means the Ticket cannot continue without human input. A new revision of the plan releases a `blocked` or `failed` Ticket to its Executor, so it moves to the next matching stage, usually `working`.

An `idle` Ticket has finished its turn without an outstanding question. A revision of its plan can continue it.

## The Executor

Each Ticket gets an Executor Session named `worker-<ticket id>` and a directory named after the Ticket's short name. Directories are created under the configured execution root, which defaults to `<stateDir>/work`.

Executor Sessions run commands without approval as the operator's OS user. Their `super-coding-agent-worker` preset contains the tools needed for work and moves foreground shell commands to background jobs after 5 seconds. This lets a worker take a new revision of its plan at the next step instead of waiting for a long command to finish.

The main Session uses `super-coding-agent-router`, with the same 5-second shell and job-wait limits and a smaller tool set for routing. Sessions retain the preset selected at creation.

### Preparing a Ticket directory

Before the first Assignment, if the Ticket directory does not exist, the prepare command runs once with `sh` in the execution root. It has ten minutes to finish. The default makes the directory a git worktree of the plan Source's checkout, on a branch named after the Ticket:

```sh
git -C "$SUPER_CODING_AGENT_REPOSITORY" worktree prune && { git -C "$SUPER_CODING_AGENT_REPOSITORY" worktree add "$SUPER_CODING_AGENT_DIR" "agent/$SUPER_CODING_AGENT_NAME" 2>/dev/null || git -C "$SUPER_CODING_AGENT_REPOSITORY" worktree add -b "agent/$SUPER_CODING_AGENT_NAME" "$SUPER_CODING_AGENT_DIR"; }
```

A new branch starts from the commit the checkout has checked out. When an earlier attempt already created the branch, its worktree is checked out again rather than failing. With an empty prepare command, the worker starts in an empty directory.

A failed command fails the Ticket and records its output. A retry or a new revision of the plan tries preparation again.

### Delegation to Claude Code and Codex

The worker is a coordinator. It splits the Ticket into subtasks that each finish within the configured bound (20 minutes by default), one concern each, such as one module or one failing test. It never delegates the whole plan, an open-ended investigation, or a decision the plan leaves open.

Each subtask has three steps: develop, verify and review. The Subagents settings say who takes each step: Claude Code, Codex, or the worker itself. By default Claude Code develops, and Codex verifies and reviews. A step whose provider is off falls to the worker.

The worker delegates through two one-shot tools, `subagent_claude_code` and `subagent_codex`. Each runs the external CLI once in the Ticket directory with one self-contained brief: the goal, the files it touches, the constraints from the plan and the repository's `AGENTS.md`, the acceptance checks with exact commands, and what to answer. The delegated agent has no Session of its own, accepts no follow-up messages, and returns only its final answer. A verify brief asks for pass or fail on each acceptance criterion with evidence; a review brief asks for findings on the diff by severity; neither changes code. The worker does not spawn DeepSeek Harness subagents.

Around each subtask the worker:

1. commits a checkpoint (`git add -A`, then `git commit --allow-empty -m "checkpoint: <subtask>"`) and notes its commit;
2. reads the diff of a develop step itself, since an answer's claim is not evidence;
3. sends verification failures back in a new develop brief, and after two failed rounds restores the directory to the checkpoint, then splits the subtask or reports `blocked` with the evidence;
4. reports progress: the subtask, who did each step, the verdict.

It delegates one subtask at a time unless two touch disjoint files. It reports `ready` only when every acceptance criterion of the plan passed a verify step or its own check, naming each with its evidence.

The providers use each CLI's own installation and sign-in, and run as the operator's OS user. Claude Code takes its model from the Subagents settings, passed as `ANTHROPIC_MODEL`; Codex takes its model from its own configuration.

### Delivery

The deliverable of a Ticket is one or more commits on its branch, verified against the plan's acceptance criteria. Workers commit with the git identity the Ticket directory has, which is the operator's own. They never push, merge the branch into another branch, delete branches, or edit the plan file or its log. A person reviews the branch and integrates it.

These rules are the **Delivery requirements** prompt section, which a team can change.

### Background work and worker slots

When a turn ends with shell jobs or delegated tasks still running, the Ticket keeps its worker slot and stays working. It is not reported as waiting. A completed job or delegated task wakes the Executor with its result in the same slot. Once a turn ends with no background work, the Executor reports waiting normally.

After each turn, background work has at most 30 minutes to finish. At that limit, shell jobs are killed and the Ticket is reported waiting. The report includes the Executor's last words and which jobs were killed or delegated tasks remain active. The Executor reads killed-job results on its next turn.

A handoff to a person frees the slot immediately and leaves the Report in effect. This applies after a `ready` Report or a question, unless another Input arrived since, and after any `blocked` or `failed` Report. At handoff, delegated tasks stop. Shell jobs, such as a server offered for review, may continue until the Assignment ends; they hold no slot and do not wake the Executor.

A person can also start a turn by writing directly in the Executor Session. Its background work follows the same rules.

When an Assignment ends, its shell jobs are killed without waking the Session, and its delegated tasks are released. The replacement Assignment and its waiting Inputs start after that shutdown finishes.

Stopping or restarting the plugin inside the DeepSeek Harness process uses the same shutdown path. Inputs not yet taken into Session history are retained. Shutdown waits up to 10 seconds for each worker's background work; a process restart ends that work outright.

### Concurrency

A Ticket holds a worker slot from the start of a launch, including preparation, or from the delivery that wakes its idle Executor. It also holds the slot throughout an active turn.

The configured concurrency limit applies to these slots, with one extra slot for a person's message, such as a plan revision, or a status request. Such a wake can use the extra slot when normal slots are full, and takes the next free slot before a new launch. New work therefore cannot prevent a person from continuing an existing Ticket. A launch waits in `working / queued` until a slot is free.

### Execution variables

The prepare command and Executor instructions receive the same execution variables. The command reads environment variables; the Executor reads their values and descriptions in its prompt. None contains credentials.

| Variable | Registered by | Value |
| --- | --- | --- |
| `SUPER_CODING_AGENT_DIR`, `SUPER_CODING_AGENT_NAME`, `SUPER_CODING_AGENT_TICKET` | Executor | The Ticket's directory, short name and id |
| `SUPER_CODING_AGENT_DEVELOP_TOOL`, `SUPER_CODING_AGENT_VERIFY_TOOL`, `SUPER_CODING_AGENT_REVIEW_TOOL` | Executor | The tool that takes each step of a subtask: `subagent_claude_code`, `subagent_codex`, or `worker` |
| `SUPER_CODING_AGENT_SUBTASK_MINUTES` | Executor | Minutes one delegated subtask should finish within |
| `SUPER_CODING_AGENT_BLOCKED_COMMANDS` | Executor | Commands the Executor may not run |
| `SUPER_CODING_AGENT_REPOSITORY` | Executor | The checkout, as an absolute path, also while the plan Source is off |
| `SUPER_CODING_AGENT_PLAN_DIR` | plan | The plan directory, as an absolute path |
| `SUPER_CODING_AGENT_PLAN_FILE` | plan | The absolute path of the plan file that started the Ticket |

Ticket-specific values come from its directory and originating Trigger. Other values come from the current settings. Only the panel can change the execution environment and the Subagents settings; text sent to the main Session cannot change the configured shell command.

Blocked commands fail when invoked by name; `git`, `claude` and `codex` cannot be blocked. These shims and directories establish defaults, not a security boundary. A worker can still execute a program by absolute path.

## How a Ticket ends

- **Ready:** a `ready` Report ends the Ticket as completed. Its branch waits for a person.
- **Nothing to do:** an Executor that finds no work for a person to act on, such as a plan already done on the branch or superseded, reports `dropped`. The Ticket ends without a message.
- **Stopped:** a person stops it in the panel, or a revision of the plan asks to stop and Eval decides stop.

An ended Ticket that a person did not stop keeps its Subscription: a later revision of its plan resumes it in the same Session, directory and branch.

A Source can also make a Ticket follow one of its Threads until that Thread closes, so that the close, not a `ready` Report, ends it; the Ticket then shows **Awaiting review** after `ready`. The plan Source does not use this.

### Follow-ups and context Threads

The Executor decides revisions of its own plan. It handles in-scope changes and hands back changes beyond its scope or for another Ticket. Once no Executor owns the revision, it becomes a candidate for the main Session.

An Input counts as read after the Session takes it into a step and subsequently reports or ends a turn. When a Ticket ends, unread revisions that were not acknowledged, answered or handed back return to Eval, as described in [002 Authorization](002-authorization.md).

Threads followed only for context still deliver revisions, but do not give the Ticket ownership of them or resume ended Tickets.

## Failure and recovery

### Executor blocked or failed

When an Executor Session reports `blocked` or `failed`, or fails to start or errors, which records `failed`, the Ticket takes no automatic Input. Its tools stay available, so a person can continue in the Session directly.

A passing failure of the model provider or the network, an HTTP 408, 429 or 5xx or a refused, reset or timed-out connection, is tried again first, three times with a growing backoff: a launch runs again, and a worker whose turn failed is told to go on. A failed prepare command is not tried again, and neither is a launch that failed otherwise.

A new revision of the plan, a later Report that is neither `blocked` nor `failed`, or a retry ends the hold. It is worked out from the stored Reports and Inputs, so a restart keeps it.

### Retry

Available while an open Ticket is in `person / delivery`, `person / blocked` or `person / failed`. A retry ends the current Assignment and starts a new one in the same Executor Session, directory and branch, which takes the Inputs that wait.

The Executor model applies only when a Session is created; an existing Session keeps its model.

### Restart

Running Assignments end with "super-coding-agent restarted", and new ones start with a recovery note that tells the Executor to inspect its worktree and git history before continuing and not to repeat a completed operation, oldest Ticket first. A worker can also return to its last checkpoint commit.

Assignments that are waiting, ready, blocked or failed stay as they are, unless an Input reached them after that Report, in which case they start again too.

Sessions, directories, Subscriptions, pending messages and the stored work below survive a restart, and so does the record of which messages each Executor Session took into its history.

### Stored work

What super-coding-agent does after a decision, such as relaying a candidate, a follow-up or a report to the main Session, launching an Assignment or delivering an Input, is stored first and done afterwards.

A relay or a delivery that fails is retried after 2 seconds, then after a delay that doubles up to a minute; a launch that fails fails its Ticket, unless the failure was a passing one, as above.

Each kind of work reports an error among the overview's system problems only after one item failed three times in a row; a failed Input delivery shows on its Ticket instead. Relays to the main Session keep their order, and so do notices.

### Source failure

The plan Source reads the whole plan directory on each check. A check that fails is tried again on the next one; after three failed checks in a row by default, the `plan` health entry reports an error, and a successful check clears it. A missing plan directory is reported at once. A plan file over 2 MiB is skipped and named in the Source's state.

### Channel failure

Replies are stored and sent as stored work, retried with backoff from 5 seconds, doubling up to 300. Each reply is appended to the plan's log once: a resend of the same message finds its marker and appends nothing.

A Ticket's messages to one log go out in the order they were queued, so its acknowledgement comes before its later answer or result. Messages of other Tickets do not wait for it. A message with failed attempts is a system problem until it goes out or is withdrawn. While its Source is off, it waits.

### Subagent failure

Saving the Subagents settings checks each enabled CLI with `<command> --version` and refuses a save whose CLI does not start. At startup the same check runs before each provider is mounted; a failure is reported in the `subagents` health entry, and that provider's tool is missing until the CLI works and the settings are saved again or super-coding-agent restarts. The worker takes the steps of a missing provider itself.

### Pause processing

Stops dispatch, new Evals, Eval timeouts, Input delivery and replies; a launch already under way waits until processing resumes.

The plan Source keeps recording Triggers, and a running Executor turn is not interrupted.

A revision of an ended Ticket's plan waits: the first pass after the pause resumes the Ticket, if its Mandate holds under the Policy then.

An Eval in progress does not expire during a pause; its deadline moves later by the pause's length.

### Invalid configuration

A stored Source configuration that its kind rejects disables that Source instance.

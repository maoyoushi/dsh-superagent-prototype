# 006 Deployment

Use this guide to install, configure and operate super-coding-agent. It covers the machine, startup checks, upgrades and troubleshooting, building on [001 Domain model](001-domain.md) through [005 Panel](005-panel.md).

## What runs

- **A dedicated DeepSeek Harness profile**, called `super-coding-agent` in this guide. Create it from the Web profile template. It loads the bundle and serves its panel on `127.0.0.1`. Keep it separate from the profile you work in: the plugin changes the process-wide `PATH` and git environment, and its process needs independent restarts and upgrades.
- **A local git checkout** of the repository the agent works on; plans are Markdown files anywhere in it that match the plan Source's patterns. Each Ticket gets a worktree of it on its own branch. There are no agent accounts: workers commit with your git identity, and nothing is pushed.
- **Claude Code and Codex,** optional but recommended: the CLIs `claude` and `codex`, installed and signed in as you. The worker delegates subtasks to them.

Plugin configuration holds the state directory and machine limits. Use the panel for everything else: the plan Source for the checkout and the plan file patterns, the Policy for who may ask, and Execution for worker directories, commands and subagents.

### Permissions and isolation

The bundle defines `super-coding-agent-worker` for Executors and `super-coding-agent-router` for the main Session. They appear in the DeepSeek Harness preset list but are intended only for super-coding-agent. Do not select them for personal Sessions or disable their configuration rows. The application needs them to create and resume its Sessions.

Opening a blank managed Session in the Web UI can select the profile's default preset. super-coding-agent restores its role-specific preset before the first turn.

Both presets run with `danger-full-access` as the operator's OS user, and so do Claude Code and Codex when a worker delegates to them. A worker can execute programs by path and read the operator's home directory. For isolation, run the profile under a dedicated OS account with its own checkout and CLI logins.

## Prerequisites

- Node.js 22.19+ or 24+, pnpm, git 2.32+, Python 3.8+ and tmux.
- A local git checkout of the repository, with `git-lfs` installed if it uses Git LFS.
- A model provider configured for DeepSeek Harness. super-coding-agent uses the profile's default model unless the Eval or Execution settings name another.
- For delegation: Claude Code (`claude`) and Codex (`codex`) on `PATH`, each signed in with its own login (`claude`, then its login prompt; `codex login`).

## Install

Run this block once, on a machine that has no `super-coding-agent` profile yet:

```sh
npm install -g @deepseek-ai/dsh@0.2.1-rc.3
git clone <this repository> super-coding-agent && cd super-coding-agent
pnpm install && pnpm build
dsh super-coding-agent --from-default-profile web --dump-config > /dev/null
dsh plugin --profile super-coding-agent add "link:$PWD"
```

The pinned version above is public; other versions must satisfy `engines.dsh` in `package.json`. The bundle depends on DeepSeek Harness's subagent providers, `@deepseek-ai/dsh-subagent-claude-code` and `@deepseek-ai/dsh-subagent-codex`, which `pnpm install` installs.

The fourth command creates `~/.dsh/profiles/super-coding-agent` from the DeepSeek Harness Web template. The fifth installs this bundle. Set `DSH_HOME` to relocate the default `~/.dsh` directory.

Run the profile-creation command only for a new installation. If the profile already exists, that command replaces it and deletes its `cordis.patch.yml`, including machine configuration. Do not use it for upgrades.

## Machine configuration

Copy [examples/profile.cordis.patch.yml](../examples/profile.cordis.patch.yml) to `~/.dsh/profiles/super-coding-agent/cordis.patch.yml`, replacing that file, and replace every `<placeholder>`. The `webserver` entry sets the panel's port.

| Key | Required | Meaning |
| --- | --- | --- |
| `stateDir` | yes | Absolute path: the database, the lock, the command shims in `worker-bin` and, by default, the Ticket directories in `work`. Back it up before upgrades |
| `promptMaxChars`, `admissionContextMaxPages`, `admissionContextTimeoutMs` | no | The largest saved prompt configuration, and how many Thread pages one assessment reads within what time |

After the first start, edit machine limits in **Settings → Deployment** or the DeepSeek Harness Plugin Manager. Changes apply without restart. `stateDir` cannot be changed there. Invalid values or unknown configuration keys prevent startup; the log identifies the key.

## Start and stop

```sh
scripts/super-coding-agent start
scripts/super-coding-agent status
```

`start` runs `dsh --profile super-coding-agent` in tmux session `super-coding-agent`, or `dsh-<profile>` for another profile. It waits up to one minute for the runtime to become ready or report a setup requirement. On a first run it prints the missing setup information. It refuses duplicate instances, including ones started outside this script.

`stop` and `restart` request graceful shutdown and wait up to five minutes for Executors. They never force-kill the process or touch other tmux sessions.

`status` prints process ids, health and setup problems. For a different profile or port, use `--profile` and `--url`, or set `SUPER_CODING_AGENT_PROFILE` and `SUPER_CODING_AGENT_URL`.

`status`, `start` and `restart` exit with one of four codes:

| Code | Meaning |
| --- | --- |
| 0 | The service runs normally |
| 1 | It does not run, runs twice, does not answer, or its runtime reports an error; a restart may fix it |
| 2 | It runs, but a part other than the runtime, such as the plan Source or the subagents, reports an error; a restart does not fix it |
| 3 | It runs and waits for setup; a restart does not fix it |

A part that is still starting counts as normal operation.

`status` returns failed parts and their details under `errors`, and setup requirements under `setup`. `start` and `restart` print those problems as lines; they exit 1 if the service never comes up. Only an intentional `stop` pauses automatic recovery.

Each profile stores logs and control files under `.artifacts/`:

- Startup logs: `super-coding-agent-<profile>-<date>-<time>-<pid>.log`, where the pid belongs to the script. The newest 20 are kept.
- Control files: `control/profiles/<profile>/`, containing the stop marker, lock and process id.

Open the URL printed in the log, then choose **Super Coding Agent** in the sidebar.

### Hourly check

Create the hourly check in the DeepSeek Harness profile you normally use, not in `super-coding-agent`. It must keep running when the agent service is down. Ask an agent in that profile to create an hourly schedule using this prompt, with the checkout path filled in:

```text
Check super-coding-agent: run `scripts/super-coding-agent --profile super-coding-agent status` in <checkout>. Exit 0: do nothing and say nothing. Exit 2: do not restart; tell me each part under `errors` with its detail, unless you already told me about the same ones. Exit 3: do not restart; tell me what `setup` says setup needs, unless you already told me. If it reports manually_stopped: true, leave it stopped. Otherwise (exit 1) run `scripts/super-coding-agent --profile super-coding-agent --respect-stop restart`, which exits the same way: 0 means it recovered, so say nothing; 2 and 3 are reported as above; if it exits 1 or fails otherwise, read the newest .artifacts/super-coding-agent-super-coding-agent-*.log and the Troubleshooting section of docs/006-deployment.md, fix what you can, and tell me what was wrong and what you did.
```

`--respect-stop` preserves an intentional stop. Only `stop` writes the marker; `start` clears it. `restart` writes no marker, so the check can recover a restart whose shutdown timed out.

## Settings

Setup must succeed before the plan Source reads anything or work starts. Overview lists missing requirements and links to their settings. A settings change to the repository runs setup again. If you fix something outside the application, such as running `git init` in the checkout, choose **Check again**.

1. **Source.** On the plan card, set the repository directory, the absolute path of the checkout, and the plan file patterns: globs from the repository root, case-insensitive, where `**` spans directories and `*` stays within one. The defaults are `PLAN.md`, `PLANS.md`, `TASKS.md`, `TODO.md`, `plans/**/*.md`, `tasks/**/*.md`, `docs/plans/**/*.md`, `docs/superpowers/plans/**/*.md`, `docs/stories/**/*.md`, `_bmad-output/**/stories/**/*.md` and `specs/**/tasks.md`, which cover superpowers, BMAD, speckit and plain plan or task files. Hidden directories, `node_modules`, `vendor` and build output such as `dist`, `build`, `out`, `target` and `coverage` are never read. **Receive existing plans** is off by default: the plans present at the first check are a baseline, and only plans added or changed afterwards become work; a change of the patterns takes the plans they newly match as a baseline in the same way. Replies go to `<repository>/.super-coding-agent/logs/<plan path>.log.md`; the first reply writes `.super-coding-agent/.gitignore`, which ignores the whole directory, so the logs never show up as changes.
2. **Policy.** The plan Source's allowed list holds `operator`, the sender of every plan; remove it to stop all new work from plans. The two example rules apply only to proactive candidates, which plan files never are.
3. **Execution.** The directory root and the prepare command. The default prepare command creates a worktree of the checkout on branch `agent/<ticket name>`; the branch starts from the commit the checkout has checked out. List personal CLIs that workers must not run as blocked commands.
4. **Subagents.** Turn on Claude Code and Codex, set their commands if they are not `claude` and `codex` on `PATH`, Claude Code's model if it should not use its own setting, and the roles. Put an API key a CLI needs in its environment, as `NAME=value`; DeepSeek Harness does not pass credential-shaped variables such as `ANTHROPIC_API_KEY` to child processes otherwise. Codex takes its model from its own configuration. When the profile already registers a provider itself, as DeepSeek Harness Desktop does with its `@deepseek-ai/dsh-subagent-claude-code` and `@deepseek-ai/dsh-subagent-codex` bundles, super-coding-agent uses that provider instead of mounting a second one; the command and environment set here then do not apply to it, and the `subagents` health entry says so.
5. **Prompts.** The team sections hold the communication style, the Ticket scope and the Delivery requirements; change them to name another commit author or more evidence.

### Management API

The panel uses a local HTTP API that agents can also call. `SETUP.md` uses it to save settings, and the service script reads `GET state`.

Send requests to `http://127.0.0.1:<port>/orchestrator/api/` with `x-orchestrator-request: 1`. The host must be `127.0.0.1:<port>` or `localhost:<port>`. Missing headers or an `Origin` from another site receive 403.

API saves have the panel's permissions. They can change the execution environment, the Subagents settings and the plan Source's setup fields, unlike saves made through the main Session's tools.

Agents may rely on these routes and fields. The other routes in `src/app/api.ts` serve the panel and change with it.

| Request | Answer |
| --- | --- |
| `GET state` | What every page reads: `setup`, with `problem`, `null` or a setup problem with `place`, `code`, `values` and `detail`, and `accounts`, the resolved `repository` once setup succeeded; `health`, an entry per part, below, with `state` (`starting`, `ready`, `paused` or `error`), `detail` and `at`; `load`, the Executor Sessions `running`, the Tickets `queued` and `maxWorkers`; `paused`; and `masterId` |
| `GET settings` | `blocks`: `policy`, `eval`, `executor` and `subagents`, each with its `value` and its `revision`; `subagents`: each provider's `enabled`, `mounted`, `available`, `version` and `error`; `sources`: the Source instances, each with `id`, `kind`, `installed`, its block's `value`, `{"enabled": …, "config": {…}}`, and `revision`, its kind's form, and its setup `problem` when it has one; `policyVersion`; and `environment`, the execution environment's `root` and `variables` |
| `GET sources` | Each Source's status: `state` (`missing`, `off`, `error`, `setup`, `starting`, `paused` or `ready`), the `health` of its parts, its setup `problem`, the last day's `stats`, the Triggers it `filtered` in that day, and the messages it `dropped` in that day |
| `PUT settings/<block>` with `{"value": …, "revision": n}` | Saves one block: `saved`, the block's new `revision`, `policy_changed` and `restarting`. `value` is the whole block, as `GET settings` holds it; a missing key takes its default |
| `POST executor/pause` with `{"paused": true}` or `false` | Pauses or resumes processing: `paused` |
| `POST setup/check` | Runs setup again by restarting super-coding-agent: `restarting: true`. Refused when setup has nothing to fix |
| `GET prompts`, `PUT prompts` with `{"config", "baseRevision"}` | Reads the prompt configuration: `current`, with its `revision` and `config`, `defaults`, `sections`, the team sections in the order Sessions read them, `skillName`, the pattern of a team skill's name, `builtin`, the names a team skill cannot take, and `skillPrefix`, which Sessions load a skill's name under. Or saves it: the new `revision` |
| `POST tickets/<id>/retry`, `POST tickets/<id>/stop` | Retries or stops a Ticket, as the panel does |

Health entries are grouped by responsibility:

| Entry | Reports |
| --- | --- |
| `runtime` | The application itself |
| `models` | Sessions waiting on a model-budget retry |
| `evals` | Unavailable Evals from the last hour with no later judgement or dismissal |
| `assessment`, `launch`, `delivery`, `relay`, `notice`, `reply` | Stored work described in [003 Execution](003-execution.md); delivery counts waiting work, while reply covers Channel messages |
| `worker` | Executor Session event handling; appears after its first failure |
| `subagents` | The Claude Code and Codex providers: the versions of the mounted ones, or why one could not start |
| `plan` | The plan Source's checks of the repository for plan files |

A refusal has a status and `error`, its English text:

- 400: an invalid value (`issues`, each with its `path`), a failed setup check (`setup`), a fixed refusal (`code` and `values`), or a body that is not JSON or is too large.
- 404: something that does not exist.
- 409: a stale revision.
- 500: anything else.

The blocks:

- `source:plan`: `{"enabled": true, "config": {"repository": "/home/me/src/widgets", "patterns": [{"pattern": "docs/plans/**/*.md"}], "includeExisting": false}}`, where `patterns` defaults to the list above, with `pollSeconds` (30) and `failuresBeforeError` (3) as advanced fields.
- `policy`: `{"rules": […], "sources": {"plan": {"allowed": [{"id": "operator", "name": "Operator"}]}}}`.
- `eval`: `mode`, `timeoutSeconds` and `model`.
- `executor`: `model`, `maxWorkers`, `directory`, `prepare` and `blockedCommands`. The processing pause is a setting of its own, `paused`, which `POST executor/pause` sets.
- `subagents`: `{"claudeCode": {"enabled": true, "command": "claude", "env": {}, "model": ""}, "codex": {"enabled": true, "command": "codex", "env": {}}, "roles": {"develop": "claude-code", "verify": "codex", "review": "codex"}, "maxSubtaskMinutes": 20}`. A role is `claude-code` or `codex`; the worker itself only coordinates. A save that turns a provider on, or changes its command, checks that the command names the provider's executable and runs `<command> --version` first and is refused with `subagentUnavailable` if it does not start.

Changing the repository runs the setup check first. A failed check returns 400 with details in `setup`. A successful change, or any save while setup is pending, returns `restarting: true`. The API is temporarily unavailable while the application restarts.

```sh
api=http://127.0.0.1:3082/orchestrator/api
rev=$(curl -s -H 'x-orchestrator-request: 1' $api/settings | jq '.sources[] | select(.id == "plan") | .revision')
curl -s -X PUT -H 'x-orchestrator-request: 1' -H 'content-type: application/json' $api/settings/source:plan \
  -d "{\"value\": {\"enabled\": true, \"config\": {\"repository\": \"$HOME/src/widgets\", \"patterns\": [{\"pattern\": \"docs/plans/**/*.md\"}]}}, \"revision\": $rev}"
```

## Setup checks

Setup uses the DeepSeek Harness subprocess service, as worker shells do. It removes environment variables whose names contain KEY, PASSWORD, SECRET or TOKEN.

Setup checks that the repository directory is an absolute path to an existing directory, and that `git rev-parse --show-toplevel` succeeds in it. It then writes the worker environment and checks that workers can run git.

The process environment that setup writes:

- **Command shims** in `<stateDir>/worker-bin`, first on `PATH`: each blocked command fails with a message. `git`, `claude` and `codex` cannot be blocked.
- **git variables:** variables that would point git at another repository, git configuration passed through the environment, and credential prompts are cleared. Your global git configuration, including `user.name` and `user.email`, stays in effect, so workers commit as you.

A file in `worker-bin` that super-coding-agent did not write stops setup.

These changes apply to the whole DeepSeek Harness process, because its shell tools take no per-Session environment: Claude Code and Codex inherit them, and so does every Session of the profile, which matters when the profile is DeepSeek Harness Desktop's own. With no blocked commands the shim directory is empty, and the git variables only stop git from prompting for credentials; a blocked command is blocked for the subagents too.

## Try it

Write a small plan as a new Markdown file at a path the plan Source's patterns match, such as `docs/plans/first.md`, with the change it asks for and its acceptance criteria, such as a command that must pass. Within a check interval (30 seconds by default), Overview shows a Ticket. The agent acknowledges the plan in its log, works in its own Session and worktree, delegates subtasks to Claude Code and Codex, and writes the result, with the branch `agent/<ticket name>`, to the log. Edit the plan to change or continue the work.

## Upgrade

1. Wait until no Executor is in the middle of a turn.
2. Back up `<stateDir>/orchestrator.sqlite`.
3. Run `git pull && pnpm install && pnpm build`.
4. Run `scripts/super-coding-agent restart` and inspect its status.

A restart ends running Assignments and starts replacements with recovery notes. Team text and overridden prompt parts are retained; parts without overrides follow the new defaults. Review parts marked **Default updated** after upgrading.

A database migrated by a newer version cannot be opened by an older one. Rollback therefore requires the pre-upgrade backup. After upgrading DeepSeek Harness itself, restart the running instance so the panel loads matching artifacts.

### From the project's earlier name

This version uses database schema 12 and opens no older database. An installation of the project under its earlier name, `dsh-superagent`, starts again: choose a new `stateDir`, rename the profile entry to `id: super-coding-agent` as in the example, and remove the old `dsh-superagent` entry and any `dsh-superagent-yunxiao` row from the profile's `cordis.patch.yml`. Then save the settings again.

### Agent presets

The worker and router presets move shell commands to the background after 5 seconds. A Session cannot load without its preset. Keep the `super-coding-agent-worker` and `super-coding-agent-router` rows in `cordis.patch.yml` while their Sessions are in use; otherwise resume fails with `agent-preset/not-found`.

## Troubleshooting

Setup problems appear on the overview with a link to the fix, in the panel's language; the log and the API show the English text below.

| Symptom | Cause and fix |
| --- | --- |
| `The plan Source names no repository directory.` | Set the repository directory on the plan card |
| `The repository directory … does not exist or is not an absolute path.` | Set the absolute path of an existing checkout |
| `… is not a git checkout.` | Point the plan card at the top of a git checkout, or run `git init` there |
| `… was not written by super-coding-agent; move it, or choose another state directory.` | Move the named file out of `<stateDir>/worker-bin`, or choose another `stateDir` |
| `Preparing the agent environment failed.` | The details name the cause, usually that git does not run; install git 2.32 or later |
| A Ticket fails with `The prepare command failed: …` | The output names the cause, such as a branch `agent/<name>` that already exists or a checkout that is not a git repository; fix it, then retry the Ticket |
| `The … subagent cannot start: …` | The CLI is not installed, not on `PATH`, or its command is wrong; run `<command> --version` as the operator's user, fix it, and save the Subagents settings again |
| `subagents` health shows an error | A provider failed its check or its mount at startup; fix the CLI, then save the Subagents settings |
| A delegated task fails with an authentication error | Sign the CLI in again (`claude`, `codex login`), or set its API key in its Subagents environment |
| `status` exits 2 | A part reports an error, which a restart does not fix: `errors` names each part, as listed under Management API, with its detail; each part clears its own entry once it works again |
| `status` exits 3 | Setup waits: `setup` says what is missing, and the overview links to the setting that fixes it |
| `status` exits 1 | The service does not run, runs twice, does not answer, or its runtime reports an error; the output and the newest log say which |
| `Orchestrator database schema … predates schema 12` (log) | The state directory belongs to an older version; start with a new `stateDir`, as in From the project's earlier name |
| The panel says super-coding-agent is not answering | It is restarting, or did not start because of its configuration; the DeepSeek Harness log names the cause |
| `super-coding-agent configuration has keys it does not use` (log) | Remove the named keys; the message says where each value lives now |
| The log says the plugin is incompatible with the running dsh | Install a DeepSeek Harness version within the `engines.dsh` range |
| The panel shows "Failed to load plugins" after a DeepSeek Harness upgrade | Restart the running instance |
| Nothing happens after writing a plan | Check that the file ends in `.md`, its path from the repository root matches one of the plan Source's patterns, it is outside hidden directories, dependencies and build output, it is under 2 MiB, and was added or changed after the first check; that `operator` is on the plan Source's allowed list; that the Source is on; and that processing is not paused |

# SETUP

Instructions for an agent that sets up super-coding-agent with its operator. If you are a person, ask your coding agent to read this file and follow it.

## How to run the setup

The setup follows [docs/000-philosophy.md](docs/000-philosophy.md): it takes as little of the operator's attention as possible.

- **Before the first question,** read only this file and `docs/000-philosophy.md`, and run the probe below once. Read nothing else until every answer is collected.
- **Ask one question per message,** about one thing. Wait for the answer before the next one. Skip a question the probe already answers.
- **Keep each message under 300 words,** unless the operator asks for more. Give each question a recommended answer the operator can accept with one word, and one sentence on why it matters.
- **Do not execute while asking.** Collect every answer, then send one message with the full plan, and execute only after the operator confirms it.
- **Never ask for a secret in the chat.** Steps that need the operator's hands, such as signing a CLI in or entering an API key in the panel, go into one message with the exact commands or places.
- **Teach the philosophy through the questions,** one sentence at a time, not as a lecture.

## 1. Probe

Run from this checkout, once, and keep the result to yourself:

```sh
node -v; pnpm -v; git --version; tmux -V; python3 --version; dsh --version
claude --version; codex --version
grep -l -E 'id: super-coding-agent\b' "${DSH_HOME:-$HOME/.dsh}"/profiles/*/cordis.patch.yml 2>/dev/null
```

- **Prerequisites:** Node.js 22.19+ or 24+, pnpm, git 2.32+, tmux, Python 3.8+, and DSH within the `engines.dsh` range of `package.json`. A missing one becomes an item of the plan, not a question. DSH also needs a model provider; if the operator has never run DSH with a model, configuring one is an operator step.
- **Subagents:** `claude` is Claude Code and `codex` is Codex. A version line means the CLI is installed; whether it is signed in is question 4.
- **Existing profile:** a profile with a `super-coding-agent` entry is an earlier setup: ask whether to continue it, keep its configuration, and read Upgrade in `docs/006-deployment.md`.

## 2. Questions

Ask in this order, one per message, following the flow of work in [docs/001-domain.md](docs/001-domain.md): first where plans come from, then who does the work. Recommendations are in brackets.

**Source: where plans come from.**

1. **Repository.** Which local git checkout should the agent work on, as an absolute path? Every Ticket gets its own worktree of it, on a branch `agent/<ticket>`; the checkout itself is not changed except for the reply logs.
2. **Plan directory.** Where in that checkout do the plans live? [`docs/plans`: every Markdown file below it is a plan; hidden directories are skipped.] Setup creates it if it does not exist.
3. **Existing plans.** Should plans already in the directory become work? [No: they are taken as a baseline, and only plans added or changed afterwards start work, so nothing starts that the operator did not just write.]

**Execution: who does the work.**

4. **Subagents.** Which of Claude Code and Codex are installed and signed in, with each CLI's own login? [Both, when the probe found both.] A CLI that is missing or not signed in is an operator step; one that signs in with an API key gets it in the panel, never in the chat.
5. **Roles.** Who develops, verifies and reviews each subtask? [Claude Code develops, Codex verifies and reviews: a second model checks the first one's work.] With one CLI, it takes every role, or the Executor itself (`worker`) takes the step it cannot.
6. **Claude Code model.** Which model should Claude Code use? [Empty: Claude Code's own setting.] Codex takes its model from its own configuration.

Do not ask about values with a good default; list them in the plan instead:

- profile `super-coding-agent`, a copy of DSH's Web profile kept apart from the profile the operator works in, so it restarts without closing their Sessions; port `3082`; state directory `<home>/.dsh/state/super-coding-agent` as an absolute path;
- an hourly check from the operator's own profile, which repairs super-coding-agent when it is not running;
- the default prepare command, which makes each Ticket's directory a git worktree of the checkout on branch `agent/<ticket name>`;
- workers commit as the operator's own git identity and never push or merge;
- the sender `operator` on the plan Source's allowed list, three workers at once, a 20-minute bound per subtask, and the default prompt sections.

## 3. Plan

Send one message, under 300 words: what will be installed, the settings to save, the operator steps, and the defaults. Ask for one confirmation.

## 4. Execute

1. **Operator steps first.** Send one message with what only the operator can do: install or sign in Claude Code (run `claude` and follow its login) and Codex (`codex login`) as question 4 needs, and configure a DSH model provider if there is none. Wait until the operator says it is done, then run the probe's version lines again.
2. **Install and start.** Follow the Install, Machine configuration, and Start and stop sections of `docs/006-deployment.md`. Skip the `git clone` of this repository: you are in its checkout. With an existing profile, skip the `dsh super-coding-agent --from-default-profile` command, which would replace the profile and delete its `cordis.patch.yml`, and edit that file instead of replacing it. Create the plan directory of question 2 if it does not exist.
3. **Settings.** Save them through the Management API of `docs/006-deployment.md`, in this order: the `source:plan` block with the answers to questions 1 to 3, then the `subagents` block with the answers to questions 4 to 6, leaving `env` empty. A save that returns `restarting: true` restarts super-coding-agent: wait until `scripts/super-coding-agent status` no longer exits 1 before the next request, and read the revisions again from `GET settings`. If a CLI signs in with an API key, ask the operator to enter it in **Settings → Execution → Subagents** in the panel.
4. **Failures.** A refused save names the problem in its response body. Find it in the Troubleshooting table of `docs/006-deployment.md`, fix it, and continue. Ask the operator only for what you cannot fix yourself.

## 5. Verify and hand over

`scripts/super-coding-agent status` exits 0 with no setup problem, and its `health` shows `plan` and `subagents` as `ready`. If you run in the operator's own DSH profile, create the hourly check of the Hourly check section of `docs/006-deployment.md` with your schedule tool; otherwise give the operator its prompt to schedule there. Then send one message, under 300 words:

- The panel URL, and that the **Super Coding Agent** entry in the sidebar is where to look.
- How to try it: write a small plan, with its acceptance criteria, as a new Markdown file in the plan directory. A Ticket appears on the overview within a minute, the answers appear in `<plan directory>/.super-coding-agent/<file>.log.md`, and the result is a branch `agent/<ticket name>`.
- Three rules for the operator, from the Responsibility section of `docs/000-philosophy.md`: start small, tune for less noise, own what the agent commits.
- Where to read more: the numbered documents in `docs/`, in order.

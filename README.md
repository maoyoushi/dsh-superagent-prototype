# super-coding-agent

> **Research prototype for reference only, not an official DeepSeek product.** This code grew out of our team's day-to-day development work, with much of the engineering done by coding agents. Treat it as research code, not production-ready software. It may still contain bugs, and its coding style and engineering practices may be inconsistent. Review and adapt it before using it in your own environment.
>
> We have adapted it for publication, so it is not identical to our internal version or the implementation described in *Exploring Super-agent Design: Towards a More Autonomous Agent System*. Some designs discussed in the article are directions for future development and are not implemented in this prototype.

super-coding-agent is a coding agent for one local git repository, packaged as a bundle for [DeepSeek Harness](https://www.deepseek.com/en/harness/). You write a plan as a Markdown file in the repository, by hand or with a tool such as superpowers, BMAD or speckit; the agent finds it anywhere in the checkout by path pattern, such as `PLAN.md`, `docs/superpowers/plans/`, BMAD stories or speckit's `tasks.md`. The agent picks up each new or changed plan, works on it in its own agent session and its own git worktree, and commits the result on a branch named `agent/<ticket>`. It only plans and coordinates: Claude Code and Codex do all the engineering in bounded subtasks, developing, verifying the result against the plan's acceptance criteria and reviewing it. The agent writes its answers to a log under `.super-coding-agent/logs/` in the repository, which git ignores. A web panel shows what needs a person.

It is also a way of working with an agent: **take as little human attention as possible, and give as much value as possible.** The agent acts only on a plan you wrote, and writes only when you must act or can use a result. [docs/000-philosophy.md](docs/000-philosophy.md) explains the principle and what it asks of the operator.

## Setup

Setup has several steps, so an agent does it with you. Ask your coding agent:

> Read SETUP.md in this repository and set up super-coding-agent with me.

It asks one short question at a time, shows the full plan once, and then installs and configures everything. [SETUP.md](SETUP.md) is what it follows.

## Documentation

Read the numbered documents in order; each builds only on the ones before it.

- [000 Philosophy](docs/000-philosophy.md)
- [001 Domain model](docs/001-domain.md)
- [002 Authorization](docs/002-authorization.md)
- [003 Execution](docs/003-execution.md): Tickets, worktrees and delegation to Claude Code and Codex
- [004 Prompts](docs/004-prompts.md)
- [005 Panel](docs/005-panel.md)
- [006 Deployment](docs/006-deployment.md): manual setup, configuration, upgrades and troubleshooting
- [007 Architecture](docs/007-architecture.md)
- [008 Cookbook](docs/008-cookbook.md): how a Source is built, with the plan Source as the example

## Development

`pnpm check` runs the typecheck, the tests and the build.

## License

[MIT](LICENSE)

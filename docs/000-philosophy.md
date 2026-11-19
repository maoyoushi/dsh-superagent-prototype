# 000 Philosophy

super-coding-agent is a framework, and also a way of working with an agent. Its core principle:

**Take as little human attention as possible, and give as much value as possible.**

Every part of the project is judged by the attention it costs. A log entry, a question, a setting, a panel element and a paragraph of documentation each cost someone's attention, and each has to give more value than that, or it is removed.

## What follows for the agent

- **It acts only when asked.** A request is a plan file the operator wrote in the plan directory. The agent never starts work from a file it found elsewhere, and a plan that was already there when it started watching is not a request unless the operator says so.
- **It speaks only when a person must act or can use a result.** It confirms a plan once and names what it will do. It stays quiet while it works. It writes again when a result is ready, when it needs a decision, or when it cannot finish. Its messages are short and go to the plan's log.
- **It asks one concrete question at a time,** in a structured form, so the question reaches the person instead of staying inside a long report.
- **It stops by impact, not by effort.** A local change goes as far as a verified commit. A change that needs a design decision the plan left open stops with a clear question.
- **It reports honestly.** A draft is marked unfinished, a failure is reported as a failure, a result is ready only with evidence for each acceptance criterion, and a limit is never bypassed to avoid asking.

## What follows for the design

- **Few concepts.** The design has only its domain concepts, such as a Source, and their concrete implementations, such as plan files. A need becomes an attribute of one of them, or a prompt the agent follows. The design does not add a concept for it.
- **Few settings.** A default replaces a setting when one value suits almost every operator. Behaviour that can be described in words is prompt text, not a setting.
- **A panel that shows only what needs a person.** It lists first what waits for a person. A healthy state takes no space.
- **Documents read in order.** Each numbered document builds only on the ones before it, so a reader never needs a concept that has not been introduced yet.

## Responsibility

The agent runs commands as your OS user and commits under your git identity, with coding agents you signed in. What it commits is yours. The more it can do, the more care its operator owes:

- **Start small.** Begin with small plans that name their acceptance criteria. Give it larger plans once its results look right.
- **Tune for less noise.** When the agent writes too much, make its prompts shorter and stricter, or pause it. Do not add more messages to explain the noise.
- **Do not use it to produce volume.** Many unreviewed branches cost more than they give.
- **Own what it commits.** Review its branches before you merge them, and correct its prompts when it is wrong.

The goal is the right help at the right time, and nothing at any other time.

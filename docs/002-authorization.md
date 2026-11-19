# 002 Authorization

Authorization determines who may start work and what that work may include. This document builds on [001 Domain model](001-domain.md).

The host enforces allowed lists, rules and Mandates. A plan's text, and the documents and code it quotes, are inputs to a decision; they cannot change those permissions.

## A plan file as a request

The plan Source marks every plan Trigger as addressed to the agent (`direct`) and names its sender `operator`. The gate checks the sender against the plan Source's part of the Policy:

- With `operator` on the allowed list, the default, every new or changed plan is an explicit request.
- With `operator` removed from the list, no plan is admitted; its Trigger is recorded with the reason, and nothing starts.

An explicit request needs no assessment: the main Session reads the plan and the Tickets on its Thread, and accepts it, attaches it to an existing Ticket it points at, or ignores it, through `orchestrator_route`. One call can carry several such decisions. Each item is processed independently: a refused item or a missing field does not prevent the others from running.

## Strength

| Strength | Cases |
| --- | --- |
| explicit | A sender on the Source's allowed list addresses the agent, or follows up on a Thread that already has a Ticket. Every admitted plan Trigger is explicit |
| inferred | A candidate the Source produces without an explicit request, such as an unaddressed message or a listed bot's message on a Source that reads them. The plan Source produces none |
| not admitted | A sender not on the list, and every inferred case while the accept mode is `off` |

The Policy also holds, per Source, an admission table with a row per receiving scope, and a list of bots that may produce inferred candidates. Both serve Sources that read conversations; the plan Source defines no receiving scopes and no bots, so its senders follow the defaults: a sender not on the list who addresses the agent is not admitted. A new Source declares them in its kind, as the cookbook in 008 shows.

## Follow-ups: changing a plan that has a Ticket

A Ticket subscribes to the Thread of its plan. A later revision of that plan is a person's message on a subscribed Thread: it reaches the Ticket as an Input, takes no Eval and gets no Decision, and the Ticket's Executor decides it. It handles a change within the Ticket's scope, and hands back, once, a change that asks for work beyond it or belongs to another Ticket. The Ticket keeps its Subscription.

Ownership continues while the Ticket is live, even if a person removes its Subscription. It also covers an ended Ticket that was not stopped by a person: the revision resumes it.

The main Session receives a follow-up notice. While an Executor owns the revision, the main Session may only stop work on the person's request; accept, attach, ignore and requeue are refused.

A revision goes to a fresh Eval only after no Ticket still owns it. Its candidate includes the Executors' reasons, and the main Session can accept it as new work, attach it elsewhere or ignore it.

When a Ticket ends, it releases revisions its Executor did not read or take up: those never delivered, and those delivered after its last Report or turn end that it neither acknowledged, answered nor handed back. Each released revision goes to Eval when no other Ticket owns it.

A person can send an owned revision to Eval from the panel. If the main Session then attaches it back to a live Ticket, the Executor receives it again. The panel also offers re-evaluation when no effective judgement covers a Trigger.

### Context-only subscriptions

An Executor can follow a related Thread, such as another plan, for context. Its revisions reach the Ticket but grant no authority and do not resume an ended Ticket. Notes from the main Session about other work are also context only.

Revisions that reach no Ticket, including those of plans whose Tickets a person stopped, take the Eval path.

## Accept mode and rules

The accept mode and the rules decide inferred candidates. They are part of the Policy, and they matter only for a Source that produces such candidates; plan files are explicit requests, which work in every mode.

| Mode | Effect |
| --- | --- |
| `off` | Nothing inferred becomes a candidate |
| `observe` (default) | Inferred candidates are assessed; a positive assessment is recorded as ignore marked "would accept", and nothing is accepted |
| `auto` | A positive assessment of an inferred candidate accepts it |

Each rule describes a kind of proactive work. An assessment judges every enabled rule exactly once, and a proactive accept requires at least one matching rule. The Ticket's Mandate records the matched rules, and its Executor receives their names and instructions, which for that Ticket override the default process and communication requirements.

## Policy version

Rules, accept mode and each Source's part of the Policy form the Policy version. Every Mandate records the version under which it was accepted.

A version change discards running Evals and queues their Triggers again. It also sends a policy-changed Input to each affected live Ticket. The Input explains whether:

- a matched rule changed, including its new text, or no longer applies;
- the requester may no longer start work; or
- proactive work is no longer accepted, for example because the mode changed from `auto`.

Unaffected Tickets receive no notice. The change does not immediately revoke live Tickets' Mandates.

Source configuration is separate from Policy. It controls what enters the system, such as which directory holds the plans. Replies wait while their Source is off.

A condition on what the Executor may do with its own result, such as never pushing, does not decide who may authorize work. It is part of the agent's instructions, not of the Policy.

## Resume and stop

An ended Ticket keeps its Mandate. A later revision of its plan resumes the same work without a new Eval or Decision. The Executor decides whether the change fits the scope and ends the round if it does not.

Only three operations change a Mandate: accept creates it, a person's stop withdraws it, and failed revalidation revokes it. A Ticket stopped by a person stays ended and receives nothing more. Work requested there needs a new accept.

Before an ended Ticket resumes, its Mandate is revalidated against today's Policy:

- An explicit Mandate requires the sender to remain on the Source's allowed list.
- An inferred Mandate also needs `auto` mode and its matched rules still enabled.

If revalidation fails, the Ticket stays ended and takes none of its waiting revisions. Each is treated as having reached no Ticket and goes to Eval, which applies the same Policy.

- **A plan that says "stop" is an ordinary Trigger,** and Eval decides stop. An Executor cannot declare that a person asked it to stop.
- **Stop in the panel is a command.** It acts on the Ticket directly and is recorded as a manual stop.
- **Waiting conditions belong to Sources.** A condition such as "no change for N hours" would be a Source that waits and checks again itself; Eval never waits.

## When Eval does not finish

The time limit starts when the candidate reaches the main Session. Time spent waiting for delivery does not count, and an undelivered candidate never expires.

An expired Eval queues its Triggers for another attempt. After two consecutive retries, the third expiry records `unavailable`. An assessment failure also records `unavailable`; a later Trigger can start a new Eval. A Policy change or a decision made against an outdated Policy records `unavailable` and immediately queues the batch under the current version.

The `evals` health entry reports unresolved unavailable Decisions from the last hour. `scripts/super-coding-agent status` includes that error.

The panel asks for human attention only when the unavailable Decision is less than 24 hours old, is still the latest Decision on its Thread, has not been dismissed, and the Thread is neither queued nor evaluating. A person can evaluate the Trigger again or dismiss the problem.

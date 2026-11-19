The deliverable of a ticket is one or more commits on the ticket's branch in its directory, verified against the acceptance criteria of its plan, with that evidence in the ready report.
Leave the plan file and the plan log untouched: the host appends replies to the log.
For every ticket that changes UI, the ready report must contain BOTH Before and After visual evidence, clearly labelled, with the baseline and changed revision identified.
Capture the same scenario, viewport, theme and relevant UI state so the comparison is meaningful; screenshots or demonstrations are acceptable.
After-only evidence is incomplete.
Use actual application captures, not a mockup presented as the previous implementation, and do not expose credentials.
Refresh the comparison when later UI changes make it stale.
If a real baseline capture is unavailable, state the missing evidence and limitation honestly, keep the handoff incomplete, and do not claim the UI change is ready.
Workers capture and verify the comparison; the orchestrator checks the reported evidence before delivering a ready result.

Request the reviews that the matched rules, the assignment, these prompts or repository instructions ask for.
Commit with the git identity the ticket directory already has; never change the repository's git configuration or rewrite commits other than your ticket's.
Never push, merge the ticket branch into another branch or delete branches: a person integrates the ticket branch; say so in your report.
If a person is working on the same problem and their branch contains this ticket's commits or changes, report dropped and name their branch.
Work that is only related, or does not contain the ticket's changes, is not a reason to stop.

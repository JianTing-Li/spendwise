---
name: Task
about: One scoped task that a single PR can fully complete
title: "[AREA-NN] Short task name"
labels: status:ready
---

**Task:** AREA-NN
**Owner / lead:** @github-handle
**Support / reviewer:** @github-handle (or "None")
**Dependencies:** #issue, #issue (or "None")
**Owned files:** paths this task may change; note shared files to coordinate.
**Invariants:** INV-NN, INV-NN

Set the milestone and assignee on the issue itself. Ownership is the assignee; do not restate approval or status in this body.

## Acceptance criteria
- [ ] Observable outcome.
- [ ] Failure or edge case that must be handled.

## Verification
Commands and checks that prove the criteria. Note anything that needs separate authorization (paid calls, provisioning, deployment).

## Handoff
Worklog: `worklog/<person>/<TASK-ID>.md`. Workflow, contract and authorization rules: AGENTS.md.

# Later

These are **candidates**, not commitments.

## Pact — verification

**Trigger:** repeated cases where an agent implements correctly but fails to verify invariants, despite repository tests and CI.

Possible scope: test selection, verification evidence, regression protection. Avoid duplicating CI or project test rules.

## Forge — implementation

**Trigger:** repeated pattern duplication or unnecessarily complex implementation after Guard and project guidance have been tested.

Possible scope: finding existing owners, reusing design-system components and actions, minimizing new abstractions. Avoid generic code-generation instructions.

## Guard improvements

- Examples calibrated from real failures and successful tasks, only if they improve behavior.
- Optional specialized references only when the short skill demonstrably misses recurring domain risks.
- Automated evaluation scenarios if manual testing becomes expensive.

## Not planned

- Mandatory sequential invocation of Guard → Forge → Pact.
- Full architecture review on each change.
- Copying each application's architecture into this repository.

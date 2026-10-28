# Now

## Guard v0.1 — initial release

- [x] Define a lightweight, reusable `guard` skill.
- [x] Keep project-specific architecture and copy rules out of the shared skill.
- [ ] Test on one low-risk copy or style change; confirm no unnecessary planning.
- [ ] Test on a medium-risk form/business-logic change; confirm relevant patterns and checks are discovered.
- [ ] Test on a high-risk data/delete/permission change; confirm missing lifecycle or security requirements are raised before coding.
- [ ] Record actual elapsed time, unnecessary tool calls, missed concerns, and false positives.
- [ ] Refine only rules that fail these tests.

## Acceptance

Guard is useful if it catches consequential omissions and drift while leaving routine changes nearly as fast as before. Do not declare success from a drafted skill alone.

## Feature-review-loop — generalization

- [x] Move app-specific values into a Project setup table.
- [ ] Run it once in a second project; confirm the setup table is complete and `n/a` keys skip their checks without hiding unproven requirements.

# Feature Review Loop — Verification Techniques

> **2026-10-28:** feature-review-loop is renamed **forge**. Decisions: `plan/decisions.md`; skillset: `docs/proposals/skillset.md`.

**Question:** which software-engineering techniques make sure a feature meets its scope and expectations, and how should the skill use them?
**Companion to:** [FEATURE_REVIEW_LOOP_RESEARCH.md](FEATURE_REVIEW_LOOP_RESEARCH.md).
**Date:** 2026-10-28.

Today the skill verifies mostly by reading: four reviewers read code and write some tests during review. Software engineering separates three questions, and each has its own techniques:

| Question | Name | Fails as |
|---|---|---|
| Did we build what was asked, no more, no less? | Scope (traceability) | Missing requirement, gold plating |
| Did we build the right thing? | Validation (Boehm: "the right product") | Works as written, wrong for the user |
| Did we build it right? | Verification (Boehm: "the product right") | Bugs, broken rules, leaks |

---

## 1. Scope: bidirectional traceability

**Pattern.** A requirements traceability matrix links each requirement forward to its code and tests (nothing missing) and each change back to a requirement (nothing extra). Work beyond the agreed scope is *gold plating*, treated as an anti-pattern in PMBOK and PRINCE2 because it skips change control and adds untested surface.

**Today.** Forward links exist: R-IDs with PASS/FAIL/NOT_PROVEN. Backward links are file-level only (drift check, line 150), which flags tests and lockfiles (B S2) and misses extra behaviour inside planned files.

**Change.**
- Forward: each R-ID lists its tests. Exit criterion: every R-ID has evidence (research doc §2).
- Backward: the fresh-context reviewer maps every diff hunk to an R-ID or to *supporting* (tests, docs, migrations, wiring). Unmapped hunks are the drift finding. The mechanical file check stays as a cheap first pass with `drift-ignore`.

---

## 2. Validation: agree examples before building, explore after

**Patterns**
- **Example mapping** (Wynne, Three Amigos): per story, write *rules*, concrete *examples* per rule, and *questions* nobody can answer yet. Too many rules or questions means split the story. Examples become acceptance tests; questions go to the business owner.
- **Specification by example / ATDD:** agreed examples become automated acceptance tests before development.
- **Session-based exploratory testing** (Bach): time-boxed sessions against a *charter*, "Explore <area> with <tools> to discover <information>", guided by heuristics such as SFDPOT (structure, function, data, platform, operations, time). Finds what no one specified.
- **User acceptance:** the person who owns the need confirms it.

**Today.** The plan has "Behaviour rules" and R-IDs but no examples; spec questions are capped at 4 (line 81). Tester c walks every flow by script (line 158), which repeats what automated tests should cover and does not fit 60 tool calls (B E2).

**Change.**
- Plan each R-ID as *rule + 2–4 examples* (happy path, boundary, refusal). Open questions become the spec questions. More than ~8 rules or ~4 open questions: propose a split.
- Scripted flows become automated tests. Real-app QA (High tier, isolated environment only) runs **exploratory charters** on the riskiest areas, reporting what it tried, what it found, and what it did not reach.
- The merge approval is the user's acceptance step: the PR leads with the R-ID table and the examples, so they approve against what they agreed.

---

## 3. Verification: choose the technique by the shape of the requirement

Each technique proves a different kind of claim. The plan names one per R-ID as its proof method.

| Requirement shape | Technique | Evidence |
|---|---|---|
| Limits, amounts, dates, rounding | **Equivalence partitioning + boundary values** | Tests at each boundary and just past it |
| Outcome depends on several conditions (role, ownership, record state, scope) | **Decision table** (the permission matrix is one) | One test per cell; pairwise when the table is too large |
| Status or stage lifecycle | **State-transition table, including invalid transitions** | Every valid transition once; every security-relevant invalid one refused |
| Must always hold (idempotency, totals, undo restores, scope filters) | **Property-based test** | Generated inputs; failing case shrunk |
| No exact expected output (search, filters, permissions across roles) | **Metamorphic relation** | e.g. adding a filter returns a subset; a role with more permissions sees a superset |
| Locks, races, double submit | **Concurrent integration test on a rolled-back DB** | Parallel calls; one record, no partial write |
| Data integrity, cascades | **Database constraint + integration test** | Constraint rejects the bad write; test proves it |
| End-to-end outcome a user sees | **E2E in an isolated app** | Run log at the sha |
| Unknowns | **Exploratory charter** | Session report |
| Docs, copy | **Reading** | file:line |

**Evidence behind the choices**
- **Combinatorial testing** (NIST, Kuhn et al.): most failures involve one or two interacting parameters; NIST reports no failure involving more than six. A full role × action table is cheap; extra dimensions (state, ownership) can be covered pairwise.
- **State-transition testing:** a diagram shows only valid transitions; a *table* also shows invalid ones, which is where authorization and lifecycle bugs live ("approve a draft that was never submitted").
- **Property-based testing:** in a study of 426 Python projects, each property-based test killed about 50× as many mutants as an average unit test (OOPSLA 2025). Agents can write them: an agentic Hypothesis run across 100 Python packages found reports of which 56% were valid bugs (Anthropic / NeurIPS 2025 workshop). AWS uses property-based testing on S3's ShardStore throughout development.
- **Metamorphic testing** addresses the *oracle problem*, when the correct output is unknown, by checking how outputs relate under input changes (Segura et al., IEEE TSE 2016).
- **Constraints over tests where possible:** a database constraint or type makes the illegal state impossible; a test only samples it.
- **Formal methods** (TLA+, P at AWS) suit distributed protocols. Out of scope for typical feature work; the state table is the lightweight version.

---

## 4. Test the tests

**Patterns**
- LLM-written tests tend to encode the code's *actual* behaviour rather than the *expected* one; models struggle to judge assertions when the code under test is buggy (arXiv 2410.21136). "Design choices made by LLM-based test generators prevent them from finding bugs" (arXiv 2412.14137).
- **Mutation testing** answers "would this test notice a bug?" Meta's ACH generates realistic faults and keeps tests that catch them; 277 of its 571 tests would have been discarded under a line-coverage goal. AugmenTest keeps only oracles that pass on the original and fail on a mutant. PROBE checks generated properties against deliberately wrong implementations.
- **TDD's red step:** a test seen failing before the code exists has proved it can fail.

**Today.** Reviewer b asks "Do the tests prove what they claim?" (line 157) by reading. Line coverage is not used, which is good: it is a weak signal.

**Change.** Every test cited as evidence for a High-tier R-ID must have been **seen failing**:
- *Red first:* the implementer commits the High-tier acceptance test before the code and records the failing run.
- *Or a targeted mutant:* remove or invert the guard the test protects (the permission check, the scope filter, the lock) and confirm the test fails. A mutation tool scoped to changed files (Stryker, mutmut, PIT) does this mechanically if the project sets a `mutation` command.

A test never seen failing is reading-level evidence, not test-level.

---

## 5. Above expectations, without gold plating

"Exceeding expectations" by adding unrequested features is gold plating: unreviewed scope, untested surface. In the Kano model, delighters are *planned*. Exceed through quality and proof instead:

1. **Surface the missing requirement.** At plan time ask guard's question, "What must remain true after this change?", and propose the invariants the brief did not state: refusals, undo, audit, concurrency, lifecycle side effects. The user accepts each as an R-ID or declines it. This is where most of the value is.
2. **Robust beyond the happy path.** Each R-ID's examples include a boundary and a refusal, not only success.
3. **Prove it.** The PR shows per-R-ID evidence that was seen failing, so the approver need not trust the agent.
4. **Leave the system simpler.** Reuse the owner of a rule, replace rather than add (the consuming project's rules already ask this).
5. **Anything extra is a proposal** in the plan or a Backlog issue, never code in this PR.

---

## 6. How this reshapes the skill

| Stage | Adds | Replaces |
|---|---|---|
| Plan | Example mapping per R-ID; proof method per R-ID from §3; decision and state tables for High R-IDs; proposed invariants for the user to accept | Free-form "Behaviour rules"; reviewer a writing the matrix during review |
| Plan review | Checks every R-ID has examples and a proof method that runs in this project; checks tables include invalid cells | — |
| Implement | High-tier acceptance tests committed red first | — |
| Mechanical (per round) | Re-run cited evidence at the sha; mutation check on High-tier guards | — |
| Review | Hunk → R-ID traceability; missing table cells; tests seen failing | File-only drift as the drift verdict; "do tests prove it" by reading |
| Real-app QA | Exploratory charters on High-risk areas | Scripted walk of every flow; DB checks (move to integration tests) |
| PR | R-ID table with examples and evidence first | Rounds table first |

This also changes what reviewers do: less "read and give an opinion", more "check the tables are complete, the tests can fail, and every hunk traces to a requirement". Those checks have yes/no answers, so reviewer variance matters less (research doc §2).

The technique table (§3) and test-strength rule (§4) fit a reference file loaded on demand (`skills/feature-review-loop/reference/verification.md`). Guard could link to it later, which covers most of what the planned **pact** skill describes without adding a skill.

---

## Decisions to make

| # | Question | Recommendation |
|---|---|---|
| 11 | Plan R-IDs as rule + examples (example mapping), with a proof method per R-ID from §3? | Yes |
| 12 | High-tier evidence must be seen failing (red first or targeted mutant)? | Yes |
| 13 | Replace file-level drift verdict with hunk → R-ID traceability by the reviewer? | Yes, keep file check as first pass |
| 14 | Real-app QA runs exploratory charters, not scripted flows? | Yes |
| 15 | "Above expectations" means proposed invariants and proof, never unrequested features? | Yes |
| 16 | Technique catalogue as a skill reference file, shared with guard later instead of building pact? | Yes, after the refactor |

## Confidence

- Strong: traceability, boundary values, decision and state tables, mutation testing (long-established; Meta ACH peer-reviewed); property-based effectiveness (OOPSLA 2025, NeurIPS 2025 workshop).
- Moderate: LLM tests encoding actual behaviour (2024–2026 preprints, consistent with each other).
- Practice, not measured: example mapping and exploratory charters (practitioner sources, not studies).

## Sources

- Boehm, verification vs validation — https://en.wikipedia.org/wiki/Software_verification_and_validation
- Gold plating — https://en.wikipedia.org/wiki/Gold_plating_(project_management)
- Example mapping — https://www.cucumber.io/blog/bdd/gherkin-rules ; https://barkingiguana.com/writing/the-workshop-example-mapping/
- Session-based exploratory testing references — https://tessl.io/registry/testland/exploratory-testing
- NIST combinatorial testing — https://csrc.nist.gov/Projects/automated-combinatorial-testing-for-software/Our-Research-Program
- State-transition testing — https://tmap.net/wiki/state-transition-testing
- Property-based testing in practice, ICSE 2024 — https://cis.upenn.edu/~bcpierce/papers/icse24-pbt-in-practice ; effectiveness, OOPSLA 2025 — https://2025.splashcon.org/details/OOPSLA/102
- Agentic property-based testing — https://arxiv.org/abs/2510.09907 ; https://red.anthropic.com/2026/property-based-testing
- PROBE, adversarial refinement of properties — https://preview.aclanthology.org/ingest-acl/2026.findings-acl.683/
- AWS systems correctness practices — https://cacm.acm.org/practice/systems-correctness-practices-at-amazon-web-services ; formal methods at AWS — https://cacm.acm.org/magazines/2015/4/184701-how-amazon-web-services-uses-formal-methods/fulltext
- Segura et al., survey on metamorphic testing — https://eprints.whiterose.ac.uk/110335/ ; Barr et al., the oracle problem — https://web.eecs.umich.edu/~weimerw/2018-481/readings/testoracles.pdf
- Do LLMs generate oracles for actual or expected behaviour? — https://arxiv.org/abs/2410.21136
- Design choices in LLM test generators prevent finding bugs — https://arxiv.org/abs/2412.14137
- AugmenTest — https://arxiv.org/abs/2501.17461
- Meta ACH — https://arxiv.org/abs/2501.12862
- Hermetic ephemeral test environments at Google — https://conf.researchr.org/details/icst-2023/cciw-2023-papers/3/How-we-use-Hermetic-Ephemeral-Test-Environments-at-Google-to-reduce-Test-Flakiness

> Research brief written by a Claude research agent on 2026-11-05 for the grading decision in [inspect-and-build.md](../proposals/inspect-and-build.md#grade). Claims about external systems link their sources; `[inferred]` marks the agent's own reasoning. The owner's decisions are recorded in the design doc, not here.

# Grading a repository's trustworthiness: research brief for Imagineer

Prepared 2026-11-05 for the "Grade" section of `docs/proposals/inspect-and-build.md`. Research only; no code.

Labels used below:
- **[cited]**: the claim comes from the linked source.
- **[observed]**: I ran it on the bench app copy in the scratchpad.
- **[inferred]**: my own reasoning or recommendation, not from a source.

---

## 0. Recommendation in one page

1. **Six dimensions.** Four are *trust* dimensions: Test strength, Matches your intent, Security and permissions, Data safety. Two are *care* dimensions: Structure, Foundations.
2. **Scale.** Each dimension gets one of four states, always shown as icon + word + colour, never colour alone: **Strong** (green ✓), **Weak** (amber !), **Failing** (red ✕), **Not checked** (grey ?). The numbers (for example "catches 31 of 100 breaks") sit one click down, for the owner.
3. **Aggregation: weakest link, no averaging.** The overall verdict is the worst state among the trust dimensions. A care dimension can pull the overall down to **Weak** but never to **Failing**. Any trust dimension that is **Not checked** means the overall cannot be **Strong**: it reads "Not proven yet". There is no headline number.
4. **Confidence is shown per dimension.** Each one shows how it was measured: the repo's own tool config, Imagineer defaults, a human claim that was not re-run, or not at all. It also shows the commit it was measured at, and whether it is stale.
5. **The grade is computed by a deterministic script from an evidence ledger, never written by an agent.** This is the main defence against gaming, and it follows directly from "evidence over claims".

On the bench app this gives **overall: Failing**. Structure is Weak (Fallow 81 B, with one critical complexity finding). Test strength is Failing (30.5%; 0% on `config.ts` and `server.ts`). Data safety is Failing (prod/dev data separation is untested; the backup restore is a human claim only). Intent is Not checked. Fallow's "B" alone would have said "good".

---

## 1. Existing grading systems

### 1.1 Summary table

| System | What it measures | Scale | How it combines | Main criticism |
|---|---|---|---|---|
| SonarQube ratings | Maintainability (tech-debt ratio), reliability (bugs), security (vulnerabilities) | A–E per dimension | **Worst issue decides** for reliability and security; ratio bands for maintainability | Rule-based, so it measures only what rules catch; exclusions can shrink the scope [inferred] |
| SonarQube quality gate | Conditions on *new code* | Pass/Fail | **Any condition failing fails the gate** | Gate on new code only, so legacy risk is invisible by design |
| Code Climate (now Qlty) | Maintainability: remediation time vs implementation time | A–F per file; repo rating from tech-debt ratio (replaced the old GPA) | Ratio across the repo | Averaging over files; product being retired into Qlty |
| CodeScene Code Health | 25+ code smells per file | 1–10 per file; green/yellow/red | LOC-weighted averages, plus a separate **Worst Performer** KPI | Vendor admits plain averages mislead (7.33 vs weighted 2.18) |
| Fallow health | Dead code, complexity, maintainability index, duplication, cycles, deps, hotspots | 0–100, A–F | **100 minus capped penalties** | Says nothing about tests; a failed input adds 0, and "a zero looks like a clean measurement" |
| OpenSSF Scorecard | Supply-chain practices (branch protection, pinned deps, and so on) | 0–10 per check | **Risk-weighted average**; inconclusive checks are dropped | Aggregate barely predicts vulnerabilities; dropping unknowns changes the score |
| Stryker | Share of deliberate code changes (mutants) that tests catch | % with high/low/break thresholds (80/60/none by default) | Killed+timeout ÷ valid mutants | Excluded files and ignored mutants inflate the score; equivalent mutants deflate it |
| ISO/IEC 25010:2023 | Taxonomy of 9 product quality characteristics | None (a model, not a scale) | None | Gives no metrics or thresholds; it is a checklist of *what* to judge |
| OWASP ASVS 5.0 | Security requirements | Levels L1/L2/L3, cumulative | All requirements of a level must be met | Mostly manual verification; L1 is not black-box testable |
| Google Test Certified | Team testing practice | Levels 1–5, cumulative | Each level's requirements must all be met | Numeric coverage goals were contentious; most teams stalled at level 3 |
| OpenSSF Best Practices badge | Project practices | Passing / Silver / Gold | All criteria of a level must be met; N/A needs a justification | Self-reported form |
| SSL Labs (outside software quality, a useful analogue) | TLS configuration | A+–F, plus T | Weighted score, then **caps**: a known flaw caps the grade at B, C or F | Rules need constant upkeep |

### 1.2 Notes per system

**SonarQube ratings.** [cited: [metric definitions](https://docs.sonarsource.com/sonarqube-server/latest/user-guide/code-metrics/metrics-definition/)]
- Maintainability rating uses the technical-debt ratio: A ≤5%, B 5–10%, C 10–20%, D 20–50%, E ≥50%.
- Reliability and security ratings are **driven by the single worst issue**: "A = 0 vulnerability … E = at least one blocker vulnerability".
- This is the key precedent: for risk dimensions, Sonar does not average. One blocker makes the rating E, however clean the rest is.
- The old Security Review rating (share of hotspots reviewed: A ≥80%, E <30%) is deprecated.

**SonarQube quality gate "Sonar way".** [cited: [introduction to quality gates](https://docs.sonarsource.com/sonarqube-server/latest/quality-standards-administration/managing-quality-gates/introduction-to-quality-gates/)]
- Four conditions on new code: no new issues, all new security hotspots reviewed, coverage ≥80% on new code, duplication ≤3% on new code.
- "If one of the conditions is met, the quality gate fails": a conjunctive gate.
- A "fudge factor" ignores coverage and duplication until there are at least 20 new lines.
- Sonar's "Clean as You Code" deliberately focuses on new code and discourages overall-code conditions [cited: [SonarQube 10.3 Clean as You Code](https://docs.sonarsource.com/sonarqube-server/10.3/user-guide/clean-as-you-code/)].
- Relevance: this fits `/build` (judge each change), but not `/inspect`, whose whole job is the legacy code.
- Criticism [inferred]: coverage is a gate condition, but coverage is a weak proxy for test strength (§2.2). Exclusion settings can also shrink what is measured without the grade showing it.

**Code Climate maintainability.** [cited: [docs (now redirect to Qlty)](https://docs.codeclimate.com/docs/maintainability)]
- File ratings A–F, based on the remediation time of the issues found.
- The repo rating comes from a technical-debt ratio: remediation time ÷ estimated implementation time.
- The old 0–4 "GPA" was replaced by letter ratings.
- A project page cites "below 5% → A". I could not verify the full B–F bands, because the docs now redirect to [Qlty](https://docs.qlty.sh/).
- Criticism: a GPA is a mean of file grades, which inherits the averaging problem in §2. The service is being replaced by Qlty Cloud.

**CodeScene Code Health.** [cited: [code health guide](https://codescene.io/docs/guides/technical/code-health.html), [3 KPIs blog](https://codescene.com/blog/3-code-health-kpis)]
- 25+ factors (Brain Method, DRY violations, nested complexity, low cohesion…) give each file a score from 1 to 10, shown as green/yellow/red.
- Three project KPIs: **Hotspot Code Health** (weighted average over frequently changed files), **Average Code Health** (LOC-weighted over all files), and **Worst Performer** (the lowest file).
- The vendor's own example: a plain average of 7.33 versus a weighted average of 2.18, because one large file at 2.0 dominates. They report a separate worst-performer number precisely because averages hide low files.
- Relevance: "report the worst part next to the average" is a pattern Imagineer should copy inside dimensions.

**Fallow health score.** [cited: [fallow docs, health](https://fallow.tools/docs/explanations/health/); observed: `npx fallow@3.40.0 health --score --explain`]
- `score = 100 − Σ penalties`, with each penalty capped:
  - dead files ≤15
  - dead exports ≤15
  - complexity ≤20
  - maintainability (1.5 per % of low-MI files) ≤15
  - hotspots ≤10
  - unused deps ≤25
  - cycles ≤25
  - unit size ≤10
  - coupling ≤5
  - duplication (above 5%) ≤10
- Grades: A ≥85, B 70–84, C 55–69, D 40–54, F <40.
- Bench app [observed]: `score 81, grade B, penalties maintainability 15, dead_files 4`, `formula_version 3`. There is one critical complexity finding. Hotspots show "N/A" because there is no git history in the copy.
- Fallow is honest about gaps. Its output says "N/A means a metric was unavailable and added no deduction; it does not mean the project has no issue in that area." Its JSON lists `workspace_diagnostics` such as `node-modules-missing` (`degrades_analysis: true`), and "boundaries-not-configured … counts are zero because nothing was measured." The docs warn that a failed input "adds zero, and a zero looks like a clean measurement".
- Trend: Fallow compares scores only between snapshots with the same `formula_version`.
- Criticism [inferred]: the score is subtractive with caps, so an F needs many problems at once. It measures structure only. Nothing about whether tests catch breaks lowers it, which is exactly the bench-app gap.
- Note [observed]: Fallow 3.40 has an opt-in `fallow mutation` command, and `health --mutation-report` can show mutation scores next to findings. Per its help, "The score never changes CRAP or the health score."
- Note [observed]: `fallow mutation --all --plan` on the bench app planned only 25 mutants. It **pruned 82 as "side-effect-sink"**: by default it drops mutants in functions that reach the file system or database, unless you pass `--allow-side-effects`. Those are exactly the data and permission paths. A mutation score from Fallow defaults is therefore not comparable with Stryker's, and the scope must be shown (§5).

**OpenSSF Scorecard.** [cited: [README](https://github.com/ossf/scorecard/blob/main/README.md), [checks](https://github.com/ossf/scorecard/blob/main/docs/checks.md), [aggregation code](https://github.com/ossf/scorecard/blob/main/pkg/scorecard/scorecard_result.go)]
- About 20 checks, each scored 0–10, with risk levels Critical/High/Medium/Low weighted 10/7.5/5/2.5.
- The aggregate is "a weight-based average of the individual checks weighted by risk".
- In the code, inconclusive checks (score −1) are skipped with `continue`, next to the comment "aggregate score changes depending on which checks are run". **Unknowns silently drop out of the denominator** instead of lowering the score: the opposite of what Imagineer wants.
- Its own docs admit limits, for example: "A low score is therefore not a definitive indication that the project is at risk"; "The check does not verify the signatures".
- Empirical criticism: Zahan et al., ICSE-SEIP 2023, studied npm and PyPI. They found the number of reported vulnerabilities *increased* with the aggregate score, and their models explained only 9–12% of the variance [cited: [arXiv 2210.14884](https://arxiv.org/abs/2210.14884)]. Another npm study reportedly found the opposite direction, so the evidence is mixed. Either way, the averaged score is a weak predictor.
- The OpenSSF's own comparison says Scorecard "focuses on what can be automatically measured (not necessarily what's important)" [cited: [badge-vs-scorecards](https://github.com/coreinfrastructure/best-practices-badge/blob/main/docs/badge-vs-scorecards.md)]. Imagineer must say the same thing about itself, honestly.

**Stryker mutation score.** [cited: [configuration](https://stryker-mutator.io/docs/stryker-js/configuration/), [mutant states and metrics](https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/)]
- Score = detected ÷ valid × 100, where detected = killed + timeout and valid = detected + undetected (survived + no coverage).
- "Score based on covered code" = detected ÷ (detected + survived).
- CompileError, RuntimeError and Ignored mutants are excluded from the score.
- Thresholds default to `{high: 80, low: 60, break: null}`: green ≥80, amber 60–80, red <60. With `break: null` the build never fails.
- Criticism:
  - Papadakis et al. (ICSE 2018) found mutation score correlates only weakly with real fault detection once suite size is controlled for. They still found that raising the mutation score improves fault detection, and that mutants "provide good guidance" [cited: [ICSE 2018 page](https://conf.researchr.org/details/icse-2018/icse-2018-Technical-Papers/78/Are-Mutation-Scores-Correlated-with-Real-Fault-Detection-A-Large-Scale-Empirical-stu)].
  - Google computes no whole-codebase score at all. It surfaces individual surviving mutants in code review, which is more actionable than a percentage [cited: [Petrović et al., TSE 2021](https://arxiv.org/abs/2102.11378)].
  - Gaming routes [inferred]: narrowing `mutate` globs, disabling mutators, `// Stryker disable` comments, and "covered-code" scores that hide NoCoverage mutants.

**ISO/IEC 25010:2023.** [cited: [ISO catalogue](https://www.iso.org/standard/78176.html), [iso25000.com summary](https://iso25000.com/en/iso-25000-standards/iso-25010)]
- A product quality model of nine characteristics, each with sub-characteristics. It defines no scores.
- The 2023 list, from secondary sources and my own knowledge (I could not read the paid standard): functional suitability, performance efficiency, compatibility, interaction capability (formerly usability), reliability, security, maintainability, flexibility (formerly portability) and safety.
- Use [inferred]: as a coverage map, so the panel can say plainly what Imagineer does **not** grade:
  - performance
  - compatibility
  - interaction capability / accessibility
  - flexibility
- Those should appear as "Not graded by Imagineer", not be left out silently.

**OWASP ASVS 5.0** (May 2025). [cited: [asvs.owasp.org](https://asvs.owasp.org/), [What is the ASVS (5.0)](https://github.com/OWASP/ASVS/blob/master/5.0/en/0x03-What-is-the-ASVS.md)]
- Three cumulative levels. L1 is about 20% of requirements, "the minimum … a critical starting point". L2 adds about 50% more: "Most applications should be striving to achieve this level". L3 adds the last ~30%.
- "Level 1 is not necessarily penetration testable by an external tester without internal access". Many requirements need code or document access, so they are not mechanical.
- Use [inferred]: a later, optional checklist source for the Security dimension, for example the V8 Authorization and V2 Business Logic requirements as attack-round prompts. Not a scale for v1.

**Google Test Certified.** [cited: [Mike Bland, "Test Certified"](https://mike-bland.com/2011/10/18/test-certified.html)]
- Level 1 sets up measurement: continuous build, coverage, test size classes, flaky test list.
- Level 2 sets policy and goals.
- Level 3 sustains practice.
- Levels 4–5 were added later.
- Why it worked: measurement itself motivated teams ("bathroom scale"); goals were achievable and incremental; peer mentoring.
- Criticisms: numeric coverage goals were contentious and led to debates; most teams stalled at level 3 (per secondary summaries).
- Lesson [inferred]: a ladder communicates progress better than a score, and "Level 1 = we can measure" maps directly onto Imagineer's "Not checked → measured" step.

**OpenSSF Best Practices badge.** [cited: [criteria](https://github.com/coreinfrastructure/best-practices-badge/blob/main/docs/criteria.md)]
- Levels Passing → Silver → Gold. "You must achieve the 'passing' criteria before you can achieve silver or gold".
- Many criteria allow N/A, but "Justification required for 'N/A'".
- Lesson: N/A is allowed only with a recorded reason. Imagineer's "deferred with a recorded reason" already matches this.

**Analogue: SSL Labs.** [cited: [SSL Server Rating Guide](https://github.com/ssllabs/research/wiki/SSL-Server-Rating-Guide)]
- A weighted numeric score (protocol 30%, key exchange 30%, cipher 40%).
- Then: "A zero in any category will push the overall score to zero."
- Then explicit **cap rules**: "If the server supports TLS 1.0 or TLS 1.1 then grade will be capped to B", "Cap to C if vulnerable to POODLE", "If vulnerable to the Heartbleed attack, it will be given F".
- A separate T grade for no trust: "When there is no certificate trust, the actual security grade doesn't matter."
- This is the clearest worked example of **severity-tiered caps on top of a score**.

**Analogues outside software** (useful because they are designed for lay readers):
- **Euro NCAP** star ratings follow a "worst score principle": a car must reach the threshold in *each* of four areas to earn a star level, so the rating is limited by the lowest pillar, "to encourage … balanced safety performance" [cited: [Euro NCAP overall assessment protocol](https://www.euroncap.com/media/88128/euro-ncap-protocol-overall-assessment-v100.pdf), [how to read the stars](https://www.euroncap.com/en/about-euro-ncap/how-to-read-the-stars/)].
- **UK Food Hygiene Rating**: the 0–5 rating depends on both the total score and the **highest single-area score**. One council's example: a total of 30 with one area at 15 drops the rating from 3 to 2 [cited: [Blackpool FHRS](https://www.blackpool.gov.uk/business/food-hygiene/food-hygiene-rating-scheme), [York calculation sheet](https://www.york.gov.uk/downloads/file/674/how-your-hygiene-rating-is-calculated)].

---

## 2. Aggregation: average or weakest link?

### 2.1 Evidence that averages mislead

- **Skewed distributions hide risk.** Van Deursen, citing Heitlager, Kuipers and Visser (SIG, QUATIC 2007): software metrics "follow a power law, and taking the average tends to mask the presence of high-risk parts" [cited: [Think twice before using the Maintainability Index](https://avandeursen.com/2014/08/29/think-twice-before-using-the-maintainability-index/), [Heitlager et al. 2007](https://www.di.uminho.pt/~joost/publications/HeitlagerKuipersVisser-Quatic2007.pdf)]. SIG's model answers with *risk profiles*: the share of code in low/moderate/high/very-high risk bands, not means [cited: [Baggen et al. 2012](https://link.springer.com/doi/10.1007/s11219-011-9144-9)].
- **Vendors concede it.** CodeScene's 7.33 vs 2.18 example, and its separate Worst Performer KPI (above).
- **Aggregation method changes conclusions.** Vasilescu, Serebrenik and van den Brand, "By no means: a study on aggregating software metrics" (WETSoM 2011), and the companion ICSM 2011 paper compare mean and median with inequality indices (Gini, Theil…) and show that the choice of aggregator matters for skewed metrics [cited: [researchr record](https://researchr.org/publication/VasilescuSB11-0/bibtex)]. I could not read the full text, so treat the details as unverified.
- **Weighted averages of practices barely predict outcomes.** See the Scorecard study above (R² 9–12%).
- **Bench app, observed.** The overall Stryker score of 30.5% hides that `db.ts` is 100% while `config.ts` and `server.ts` are 0%. The averaged structure score (81 B) hides that test strength is failing. Two levels of averaging, two masked failures.
- **Compensation is the core problem [inferred].** An average lets strength in one place pay for weakness in another. For trust, that trade is invalid: well-factored code does not make a missing permission test less dangerous.

### 2.1b What the 80% rests on (2026-11-07)

The owner asked what backs the 80% test-strength threshold. Searched for a research-backed standard; there is none.

- **Real projects vary widely.** StrykerJS scores on 13 JavaScript projects ran from about 12% to about 95% [cited: [LLMorpheus](https://arxiv.org/pdf/2404.09952)]. No study found reports a population distribution of mutation scores.
- **The research avoids fixed cutoffs.** Mutation score correlates only weakly with real fault detection once suite size is controlled for, though raising it helps (Papadakis et al., ICSE 2018). Google computes no whole-codebase score and surfaces surviving mutants in review [cited: [Petrović et al.](https://arxiv.org/abs/2102.11378)]; Facebook's study sets no threshold either [cited: [Mutation Monkey](https://arxiv.org/pdf/2010.13464)].
- **Practitioner convention, not validated cutoffs:** 60–70% as a general gate, with advice to run without a gate for a few weeks first [cited: [CircleCI](https://circleci.com/blog/what-is-mutation-testing/)]; about 80% for critical code; above 90% exceptional [cited: [industrial robotics study](https://arxiv.org/pdf/2511.14432)]; 75% called "very good" for real-world code [cited: [Jain et al.](https://clairelegoues.com/assets/papers/jainOracleGap.pdf)].
- **Safety standards** (ISO 26262, DO-178C) mandate coverage criteria such as MC/DC, not a mutation score [cited: [Clang mutation paper](https://arxiv.org/pdf/2210.17215)].
- **Stryker's own bands** are 60 (amber) and 80 (green), where Imagineer's 80% came from.

**Decision.** The default stays at 80% overall and 80% in critical code, so real projects show whether it fits, and the user can set their own per repository (`--tests`, `--critical`, or in words). Bands follow the threshold: Strong at or above it, Weak within 20 points below (Stryker's band width), At risk below that. Revisit once a few real projects have been inspected: practitioner convention would put a general default nearer 70%.



Inozemtseva and Holmes (ICSE 2014, later an ICSE Most Influential Paper) found that once suite size is controlled for, coverage is "not strongly correlated" with a suite's ability to catch faults [cited: [paper PDF](https://cs.ubc.ca/~rtholmes/papers/icse_2014_inozemtseva.pdf)]. Mutation is not perfect either (Papadakis 2018), but it directly measures "would a test notice this break?", which is the question the user cares about. The project's own research reaches the same conclusion: "A test never seen failing is reading-level evidence" (`docs/archive/feature-review-loop/FEATURE_REVIEW_LOOP_VERIFICATION.md`).

### 2.3 What credible systems do

| Pattern | Who | Fits Imagineer? |
|---|---|---|
| Any condition fails → whole thing fails | Sonar quality gate | Yes, for the **stop bar** |
| Worst single issue sets the rating | Sonar reliability and security ratings | Yes, inside the Security and Data dimensions |
| Lowest pillar limits the overall | Euro NCAP, FHRS | Yes, for the **overall verdict** |
| Score plus severity-tiered caps | SSL Labs | Yes: trust dimensions cap hard, care dimensions cap soft |
| Average, plus a separate worst part | CodeScene | Inside a dimension's drill-down |
| Weighted average, unknowns dropped | OpenSSF Scorecard | **No**: it is the failure mode to avoid |
| Cumulative levels, all criteria required | ASVS, Test Certified, OpenSSF badge | Yes, as the long-term ladder |

### 2.4 Recommended rule [inferred]

```
state(dim) ∈ {Strong, Weak, Failing, NotChecked}   # computed from the evidence ledger

trust = [TestStrength, Intent, SecurityPermissions, DataSafety]
care  = [Structure, Foundations]

overall =
  if any trust dim is Failing                → Failing
  elif any trust dim is NotChecked           → "Not proven yet" (grey, never green)
  elif any trust dim is Weak                 → Weak
  elif any care dim is Failing or Weak       → Weak         # soft cap: care can't make it Failing
  elif any care dim is NotChecked            → "Strong, except <dim> not checked"
  else                                        → Strong
```

- There is no headline number, so an 81 cannot be read as "B, fine".
- The Inspect stop bar is "every trust dimension Strong, and Structure has no unresolved findings". That is the doc's current bar, expressed in these terms.
- Inside a dimension, the state is also worst-of. The overall mutation score *and* the score on user-confirmed critical areas must each clear the bar.

---

## 3. Dimensions for Imagineer (JS/TS)

Plain-language labels in quotes are what the non-technical user sees.

### 3.1 Test strength: "Would the tests notice if something broke?"

- **Evidence:** Stryker run in a throwaway copy (repo config if present), or `fallow mutation`.
  - Record the score, the per-file scores, the surviving mutants, the ignored/excluded counts and the `mutate` scope.
- **States:**
  - Strong: overall ≥80%, *and* every user-confirmed critical area (permissions, money, data) ≥80% with each survivor resolved (killed, or recorded as equivalent with a reason).
  - Weak: 60–80%, or a critical area between 60% and the bar.
  - Failing: <60% overall or in any critical area.
  - Not checked: no mutation run at this commit.
  - Uses Stryker's default bands [cited], applied worst-of [inferred].
- **Which areas are critical:** a recorded user answer (from an Ask round), not an agent judgment. Fallow's `side-effect-sink` detection can *propose* the list.
- **Bench app:** 30.5% overall; `server.ts` 0%, `config.ts` 0%, `auth.ts` 6% → **Failing**.
- **Drill-down:** surviving mutants as plain sentences, Google-style. For example: "If the dev-only sign-in check were removed, no test would notice."

### 3.2 Matches your intent: "Does it do what you meant?"

- **Evidence:**
  - the question ledger: each question's ID, topic (data/money/permissions/behaviour/wording), status (open / answered / decided with reason / deferred with reason) and answer text;
  - for each confirmed answer, a test named after the question, **seen failing then passing**, with both runs recorded (commit SHA and test output), or a targeted mutant that the test kills.
- **States:**
  - Strong: no open questions, and every confirmed answer has a red→green test.
  - Weak: all data/money/permission questions resolved, but behaviour or wording questions are open, or some answers lack a test.
  - Failing: any open data/money/permission question, or any intent test now failing.
  - Not checked: no Ask round run yet.
- **Mechanical?** Partly. The *answer* is the user's recorded word. Its *enforcement* is a test result. Whether the right questions were asked is agent judgment, so the panel shows "N questions asked" as context, not as a score (see gaming, §6).
- **Bench app:** Not checked (the Inspect Ask round has not run).

### 3.3 Security and permissions: "Can someone see or do what they shouldn't?"

- **Evidence:**
  1. **Permission matrix:** role × action table, from `docs/permissions.md` plus user answers. Each cell has a test seen failing (red-first, or a targeted mutant removing the guard).
  2. **Dependency vulnerabilities:** `npm audit --json` or `osv-scanner`. A high or critical issue in a production dependency means Failing (Sonar's worst-issue rule).
  3. **Secrets in the repo:** `gitleaks` or `trufflehog`; any verified secret means Failing.
  4. **`fallow security` candidates:** each must be resolved. Bench app [observed]: 3 items, two in `public/app.js`, which Fallow also flags as unused. Fallow calls them "CANDIDATES for verification, NOT verified vulnerabilities". A candidate alone never lowers the state. An *unresolved* candidate keeps the state from being Strong.
  5. **Attack rounds:** each break found becomes a test. The stop bar needs 2 rounds with nothing new.
- **States:**
  - Strong: matrix fully proven, no high/critical vulnerabilities, no secrets, no unresolved candidates, attack bar met.
  - Failing: a known break still open, a high/critical vulnerability, or a secret.
  - Weak: anything in between.
- **Later:** ASVS L1/L2 requirements, for example V8 Authorization, as attack checklists.
- **Bench app:** the dev-only sign-in guard (`auth.ts`, 6%) is untested → at least **Weak**, and **Failing** if the user confirms that the guard matters in production. That is an Ask-round question, which itself shows that the states depend on recorded answers.

### 3.4 Data safety: "Could you lose or mix up your data?"

- **Evidence:**
  1. **Prod/dev separation** proven by tests: the mutants in data-directory and environment selection are killed.
  2. **Backup restore drill run by Imagineer** in a throwaway copy: back up, restore to a scratch location, compare row counts and a checksum. A human-written restore log (the bench has `ops/restore-log.md`) is shown as **"Claimed"**, never as Strong.
  3. **Partial saves and double submits:** transaction and idempotency tests from attack rounds, seen failing.
  4. **Migrations, where present:** apply to a scratch DB, then roll back or re-apply.
- **States:**
  - Strong: all applicable items proven.
  - Failing: separation unproven *and* the code reads an environment variable to choose the data location; or a reproduced data-loss break.
  - Weak: the backup is claimed but not drilled, or other partial gaps.
  - "N/A, reason recorded" when, for example, there is no persistent data.
- **Bench app:** `config.ts` at 0% mutants → separation unproven → **Failing**. Backup: **Claimed** (log entry dated 2026-10-20, not re-run).

### 3.5 Structure: "Is the code tidy enough to change safely?" (care dimension)

- **Evidence:** Fallow (`health`, `dupes`, `dead-code`, `architecture`) with the repo's config if present. knip or jscpd add evidence when the repo already uses them.
- **States:**
  - Strong: no unresolved findings (each one fixed, or dismissed with a recorded reason such as "`public/app.js` is loaded by the HTML") *and* a Fallow score ≥70 (Fallow's B) [inferred threshold].
  - Weak: unresolved findings or a score of 55–69.
  - Failing: score <55, or a circular dependency in critical code.
  - Caps the overall at Weak at worst.
- **Report:** Fallow's number and grade in the drill-down, with its `formula_version` and any `degrades_analysis` diagnostics.
- **Bench app:** 81 B, one critical complexity finding, dead file `public/app.js` (a false positive) → **Weak** until resolved.

### 3.6 Foundations: "Can someone else run and check it?" (care dimension)

- **Mechanical checks:**
  - `npm ci` succeeds from the lockfile;
  - `tsc --noEmit` passes;
  - the test command passes;
  - CI runs the tests (workflow file present *and* a step invokes the test script);
  - the README's run and test commands work when executed as written;
  - every `process.env.X` read in the code appears in `.env.example` (grep);
  - dependencies are pinned (Scorecard's Pinned-Dependencies idea).
- **Not mechanical:** whether the docs are *good*. Show only "exists" and "commands in it work".
- **Bench app:** typecheck and tests run in CI, a lockfile and `.env.example` are present, and the docs folder exists → likely **Strong**, pending an actual `npm ci && npm test` run.

### 3.7 What is not graded

Following ISO 25010, the panel lists "Not graded by Imagineer: speed, compatibility, ease of use, accessibility", so the grade does not imply completeness [inferred].

---

## 4. Presenting to non-technical users

### 4.1 Letters, traffic lights or levels

| Option | For | Against |
|---|---|---|
| Letter grades (A–F) | Familiar; Sonar, Fallow and SSL Labs all use them | School-grade intuition reads B and C as "fine", which is the bench-app trap. They invite averaging, and they clash with Fallow's own letter shown nearby |
| Traffic lights | Fastest to read. Food-label studies found traffic lights beat number-only labels for lay comprehension [cited: [Kelly et al. 2009 via search summary](https://www.foodnavigator.com/Legislation/Traffic-light-GDA-combo-best-in-UK-labelling-study); the 2009 UK FSA study found colour+text+numbers best] | Colour alone fails colour-blind users ([WCAG 1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)); only three states |
| Maturity levels | Show progress and what to do next (Test Certified, ASVS, OpenSSF badge) | Abstract ("Level 2" means nothing without a legend); slow to move, so less satisfying in a live panel |

**Recommendation [inferred]:** use traffic lights *with words and shapes* per dimension. The food-label evidence says colour + words + numbers works best, so put the number in a secondary line:

```
IMAGINEER  ·  bench-expenses  ·  at a1b2c3d  ·  2 min ago
───────────────────────────────────────────────
✕  NOT TRUSTWORTHY YET
   Tests would miss 7 of 10 deliberate breaks.
   1 of 6 checks not done yet.

✕ Failing   Would tests notice breaks?        31 of 100 caught   ●
? Not yet   Does it do what you meant?        not asked yet      ○
! Weak      Who can see or do what?           sign-in guard untested ●
✕ Failing   Could data be lost or mixed?      prod/dev split untested ● · backup claimed
! Weak      Tidy enough to change safely?     1 finding open      ◐
✓ Strong    Can someone else run it?          5 of 5 checks       ◐

● repo's own setup   ◐ Imagineer defaults   ○ not measured   ⟳ stale
```

- Headline wording uses outcomes, not jargon: "Not trustworthy yet", "Almost there", "Trustworthy for what was checked".
- "Trustworthy" is always qualified by "for what was checked".
- Use **levels as the long-run ladder** the owner can track across repos, derived from the states [inferred]:
  - L0 "Unmeasured"
  - L1 "Measured" (every dimension checked)
  - L2 "Safe" (no trust dimension Failing)
  - L3 "Proven" (all trust dimensions Strong = Inspect's stop bar)
  - L4 "Kept proven" (tools added to the repo's CI with the user's agreement, so the bar holds on every change)
  - This mirrors Test Certified: L1 is "we can measure".

### 4.2 Showing "not measured" honestly

- Use a **distinct fourth state**, grey with a "?" and a hollow marker. It is never blank, never green and never dropped from the overall. Scorecard dropping −1 checks is the anti-pattern [cited above].
- It always comes with a reason and a next step: "Not checked: needs a test run (about 3 min). Run it?"
- **"Claimed"** is a sub-state for human or document assertions that were not re-run (the restore log). It shows a quote icon and never counts as Strong.
- **"N/A, with reason"** is allowed, following the OpenSSF badge's "Justification required for N/A". The reason is a recorded user answer.
- **Degraded runs** are shown as such. Fallow's `degrades_analysis` (for example, missing `node_modules`) downgrades confidence, because "a zero looks like a clean measurement" [cited, Fallow docs].
- The headline counts unknowns: "1 of 6 checks not done yet".

### 4.3 Showing change over time

- **Per-dimension history as steps, not a line:** "Test strength: ✕ 31% → ! 64% → ✓ 83%", each step labelled with the round or Build change that caused it ("after Inspect round 2: 9 new tests").
- **Compare like with like.** Show a delta only when tool, version, config and scope match; otherwise say "measured differently, not comparable". This follows Fallow's rule of omitting the delta when `formula_version` differs [cited].
- **Scope changes are visible.** If the score rises because files were excluded or mutants ignored, the drill-down says so.
- **For `/build`:** add a "this change" row in the spirit of Sonar's Clean as You Code. Did the change meet the bar *and* leave every dimension no worse? The whole-repo grade stays alongside.
- **Ratchet, as an option:** once a dimension is Strong, a later Weak result is flagged as a regression ("got worse in change X"), in the style of Fallow's `--fail-on-regression`.

---

## 5. Confidence: how each dimension was measured

Each dimension carries a small provenance record. The panel shows it as an icon, and the owner can expand it:

| Field | Values | Display |
|---|---|---|
| **Evidence class** | Tool result · Test seen failing then passing · Your answer · Claimed (not re-run) · Not measured | icon |
| **Config source** | Repo's own (version + file, e.g. "repo Fallow 3.38, `.fallowrc.json`") · Imagineer defaults (e.g. "one-off Fallow 3.40, defaults") · Mixed (repo threshold looser than the bar: both shown) | ● / ◐ / ○ |
| **Scope** | What was measured vs what exists: files mutated / source files, mutants ignored or excluded, pruned categories (e.g. Fallow's 82 side-effect-sink mutants), questions asked | "5 of 6 files; 82 mutants skipped by default" |
| **Freshness** | Commit SHA + time; **stale** if any file in scope changed since the run (Fallow mutation already does this: "A function whose file changed since the run gets no score") | ⟳ |
| **Diagnostics** | Tool warnings that degrade results (missing `node_modules`, no git history → no hotspots, boundaries not configured) | ⚠ with text |

Rules [inferred]:
- **Defaults are not worse evidence than the repo's config.** They are *different* evidence: the repo's config holds decisions, such as ignores and entry points, that the user may not have approved. Show both when they differ, as the design doc already says.
- **Stale or degraded evidence can never be Strong.** It becomes Weak, labelled "needs re-check".
- Confidence never changes the state silently. It is a separate visible axis, so a user can see "Strong ◐" (good, with defaults) as distinct from "Strong ●".

Precedents: Fallow's `workspace_diagnostics` and N/A semantics; Scorecard's per-check `reason` and `details` fields; the project's own evidence-ledger design `{rid, method, artifact, sha}` (`docs/archive/feature-review-loop/FEATURE_REVIEW_LOOP_FEEDBACK_B.md`).

---

## 6. Gaming and how the design resists it

| Route | Example | Mitigation [inferred] |
|---|---|---|
| Shrink the scope | Narrow Stryker `mutate`; Sonar exclusions; Fallow ignores | Scope and suppressions shown in provenance; `fallow suppressions` counted; any scope reduction since the baseline flagged |
| Ignore mutants | `// Stryker disable`, claiming mutants are equivalent | Each ignore needs a recorded reason, visible in the drill-down; ignored count shown |
| Tests that assert nothing | High coverage, no assertions | Mutation instead of coverage; intent tests must be seen failing |
| Ask fewer questions | Intent looks "100% resolved" | Question count is context, not a score; attack rounds and mutation survivors generate questions mechanically |
| Agent grades itself | An agent writes "all good" | The grade is computed by a deterministic script from ledger entries that point at artifacts (tool JSON, test logs at a SHA); agents can add evidence but never set a state |
| Averaging away a failure | Strong areas offset a weak one | Worst-of aggregation at both levels |
| Stale green | Code changed after the run | Freshness by SHA; stale cannot be Strong |

Goodhart's law still applies. Mutation scores correlate only weakly with real faults (Papadakis 2018), so the grade is a floor of proven protection, not a guarantee. The panel's wording ("for what was checked") should say so.

---

## 7. Worked example: bench app at `main`

| Dimension | State | Evidence | Confidence |
|---|---|---|---|
| Test strength | ✕ Failing | Stryker 30.5%; `server.ts` 0%, `config.ts` 0%, `auth.ts` 6%, `expenses.ts` 76%, `db.ts` 100% | ◐ Imagineer defaults (repo has no Stryker) |
| Intent | ? Not checked | No Ask round yet | ○ |
| Security and permissions | ! Weak (✕ if the user says the sign-in guard matters in prod) | Dev-only sign-in guard untested; 3 `fallow security` candidates unresolved; matrix not built | ◐ |
| Data safety | ✕ Failing | Prod/dev data-directory selection untested (0% mutants); backup restore *Claimed* in `ops/restore-log.md`, not drilled | ◐ |
| Structure | ! Weak | Fallow 81 B, 1 critical complexity finding, dead file `public/app.js` (false positive, needs a recorded reason) | ◐ one-off Fallow 3.40; ⚠ no `node_modules`, no git history in the copy |
| Foundations | ✓ Strong (pending a run) | CI runs typecheck and tests; lockfile; `.env.example`; docs folder | ◐ |
| **Overall** | **✕ Not trustworthy yet** | worst trust dimension = Failing | |

Fallow's "81 B" is still visible, but only inside Structure, where it belongs.

---

## 8. Open questions for the owner

**The three biggest:**
1. **Which dimensions can fail the overall?** I propose that the four trust dimensions cap hard and that Structure and Foundations cap only at Weak. Should messy code ever make the overall verdict "Failing"? And are six dimensions too many for the panel? Four trust dimensions plus one "care" summary is a possible alternative.
2. **What counts as "critical code", and what bar applies there?** Is 80% enough on permission, money and data code, or must every survivor there be killed or explained? Who confirms the critical list: the user in an Ask round (the recommendation), or a mechanical rule such as Fallow's side-effect-sink detection? Related: Stryker or `fallow mutation`? Fallow's defaults skip exactly the database and file-system paths (82 of 139 mutants in live code on the bench app: 25 planned, 32 with no test reach, 82 pruned).
3. **Scale vocabulary and headline.** Traffic-light states with words and no headline number (the recommendation), or letters, or levels? And is "Claimed" evidence, such as a human restore log, ever enough for Strong, or must Imagineer always re-run it, at a cost in time and side effects?

**Also to decide:**
- Should a `/build` change be judged on new code only (Sonar's way) or also never make the whole-repo grade worse?
- Restore drills and migration checks run real operations. Are they allowed in a throwaway copy by default?
- Should Imagineer use OpenSSF Scorecard for GitHub-hosted repos? It mostly measures team process, such as branch protection and code review, which matters less for a solo owner.
- Should the long-run levels L0–L4 be shown now, or only per-dimension states?

---

## 9. Sources

- SonarQube metric definitions: https://docs.sonarsource.com/sonarqube-server/latest/user-guide/code-metrics/metrics-definition/
- SonarQube quality gates: https://docs.sonarsource.com/sonarqube-server/latest/quality-standards-administration/managing-quality-gates/introduction-to-quality-gates/
- SonarQube Clean as You Code (10.3): https://docs.sonarsource.com/sonarqube-server/10.3/user-guide/clean-as-you-code/
- Code Climate maintainability (redirects to Qlty): https://docs.codeclimate.com/docs/maintainability · https://docs.qlty.sh/
- CodeScene Code Health: https://codescene.io/docs/guides/technical/code-health.html · https://codescene.com/blog/3-code-health-kpis
- Fallow health docs: https://fallow.tools/docs/explanations/health/ · CLI `npx fallow@3.40.0 health --help`, `mutation --help`, `security --help` (run locally)
- OpenSSF Scorecard: https://github.com/ossf/scorecard/blob/main/README.md · https://github.com/ossf/scorecard/blob/main/docs/checks.md · https://github.com/ossf/scorecard/blob/main/pkg/scorecard/scorecard_result.go
- Zahan et al., Do Software Security Practices Yield Fewer Vulnerabilities? (ICSE-SEIP 2023): https://arxiv.org/abs/2210.14884
- OpenSSF Best Practices badge criteria: https://github.com/coreinfrastructure/best-practices-badge/blob/main/docs/criteria.md · badge vs Scorecard: https://github.com/coreinfrastructure/best-practices-badge/blob/main/docs/badge-vs-scorecards.md
- Stryker config and thresholds: https://stryker-mutator.io/docs/stryker-js/configuration/ · metrics: https://stryker-mutator.io/docs/mutation-testing-elements/mutant-states-and-metrics/
- Papadakis et al., ICSE 2018: https://conf.researchr.org/details/icse-2018/icse-2018-Technical-Papers/78/Are-Mutation-Scores-Correlated-with-Real-Fault-Detection-A-Large-Scale-Empirical-stu
- Petrović et al., Practical Mutation Testing at Scale (Google): https://arxiv.org/abs/2102.11378
- Inozemtseva and Holmes, ICSE 2014: https://cs.ubc.ca/~rtholmes/papers/icse_2014_inozemtseva.pdf
- ISO/IEC 25010:2023: https://www.iso.org/standard/78176.html · https://iso25000.com/en/iso-25000-standards/iso-25010
- OWASP ASVS 5.0: https://asvs.owasp.org/ · https://github.com/OWASP/ASVS/blob/master/5.0/en/0x03-What-is-the-ASVS.md
- Mike Bland, Test Certified: https://mike-bland.com/2011/10/18/test-certified.html
- SSL Labs rating guide: https://github.com/ssllabs/research/wiki/SSL-Server-Rating-Guide
- Euro NCAP overall rating protocol: https://www.euroncap.com/media/88128/euro-ncap-protocol-overall-assessment-v100.pdf · https://www.euroncap.com/en/about-euro-ncap/how-to-read-the-stars/
- UK Food Hygiene Rating calculation: https://www.blackpool.gov.uk/business/food-hygiene/food-hygiene-rating-scheme · https://www.york.gov.uk/downloads/file/674/how-your-hygiene-rating-is-calculated
- Van Deursen, Think twice before using the Maintainability Index: https://avandeursen.com/2014/08/29/think-twice-before-using-the-maintainability-index/
- Heitlager, Kuipers, Visser, A Practical Model for Measuring Maintainability (2007): https://www.di.uminho.pt/~joost/publications/HeitlagerKuipersVisser-Quatic2007.pdf · Baggen et al. 2012: https://link.springer.com/doi/10.1007/s11219-011-9144-9
- Vasilescu et al., By no means (WETSoM 2011): https://researchr.org/publication/VasilescuSB11-0/bibtex
- Front-of-pack label comprehension: https://www.foodnavigator.com/Legislation/Traffic-light-GDA-combo-best-in-UK-labelling-study
- WCAG 2.2, 1.4.1 Use of Color: https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html
- Internal: `docs/archive/feature-review-loop/FEATURE_REVIEW_LOOP_VERIFICATION.md`, `docs/archive/feature-review-loop/FEATURE_REVIEW_LOOP_FEEDBACK_B.md`

**Not verified directly:** Code Climate's B–F bands; the full text of Heitlager 2007 and Vasilescu 2011 (cited via secondary sources); the exact ISO 25010:2023 characteristic list (paid standard; from secondary sources and my own knowledge); Test Certified levels 4–5.

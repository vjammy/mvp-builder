# Quality Score Rubric (per-use-case, 100 points)

This rubric defines how each use case in the autoresearch benchmark is scored from 0 to 100. The implementation lives in `scripts/mvp-builder-autoresearch.ts` (`scoreUseCase`).

The rubric is deliberately additive across eight categories so a high score requires breadth, not just one strong area.

## Categories and weights

| Category | Max | What it measures |
| -------- | --- | ---------------- |
| Use-case specificity | 20 | The package mentions the actual product name, must-have features, and audience in core artifacts. |
| Phase usefulness | 15 | START_HERE explains entry/exit gates; PHASE_BRIEF tells the user what to do; VERIFY_PROMPT has functional checks. |
| Beginner clarity | 10 | Beginner-facing files explain what to do, what to ignore, and how to use Codex / Claude Code / OpenCode. |
| Agent executability | 15 | `auto-improve/PROGRAM.md` defines editable / fixed files, validation commands, keep-or-discard loop, and stop conditions. |
| Verification strength | 15 | Acceptance criteria require evidence, VERIFY_PROMPT explains evidence and final decision rules, TESTING_STRATEGY uses pass/fail. |
| Regression coverage | 10 | Regression suite scripts exist; TEST_SCRIPT_INDEX is real; recursive testing is wired in. |
| Handoff quality | 10 | HANDOFF says what to read first; per-phase HANDOFF_SUMMARY has completion update; NEXT_PHASE_CONTEXT explains what next phase inherits. |
| Simplicity | 5 | No microservices / Kubernetes / multi-region / hosted-backend overbuild; auto-improve forbids those additions. |

Total max: **100**.

## How each category is scored

### Use-case specificity (max 20)

- Counts how many product-specific signals (product name + first four must-have features) appear in `PROJECT_BRIEF.md`, `PHASE_PLAN.md`, `HANDOFF.md`, and `requirements/ACCEPTANCE_CRITERIA.md` combined.
- Score = `clamp(8 + hits * 3, 0, 20)`.
- A score of 8 means the package barely names the product; 20 means it is consistently anchored.

### Phase usefulness (max 15)

- Awards points for these structural sections existing:
  - "## 1. Decide" or "## Package status" in PHASE_PLAN (4 pts)
  - "Entry gate:" in START_HERE (3 pts)
  - "Exit gate:" in START_HERE (3 pts)
  - "## What you should do now" in `phases/phase-01/PHASE_BRIEF.md` (3 pts)
  - "## Functional checks" in `phases/phase-01/VERIFY_PROMPT.md` (2 pts)

### Beginner clarity (max 10)

- "do not need to open every folder" in START_HERE (3 pts)
- "## Commands to know" in START_HERE (3 pts)
- "For you:" in `BUSINESS_USER_START_HERE.md` (2 pts)
- "What to paste into Codex" in `CODEX_START_HERE.md` (2 pts)

### Agent executability (max 15)

- "## Editable files" in `auto-improve/PROGRAM.md` (4 pts)
- "## Fixed files" in `auto-improve/PROGRAM.md` (3 pts)
- "## Validation commands" in `auto-improve/PROGRAM.md` (3 pts)
- "## Keep or discard loop" in `auto-improve/PROGRAM.md` (3 pts)
- "## Stop conditions" in `auto-improve/PROGRAM.md` (2 pts)

### Verification strength (max 15)

- "Evidence required" in `requirements/ACCEPTANCE_CRITERIA.md` (4 pts)
- "## What evidence means" in `phases/phase-01/VERIFY_PROMPT.md` (4 pts)
- "## Final decision rules" in `phases/phase-01/VERIFY_PROMPT.md` (4 pts)
- "pass/fail" in `TESTING_STRATEGY.md` (3 pts)

### Regression coverage (max 10)

- `regression-suite/scripts/run-regression.ts` exists in the package (3 pts)
- "regression" mentioned in `REGRESSION_TEST_PLAN.md` (3 pts)
- `TEST_SCRIPT_INDEX.md` mentions itself / lists scripts (2 pts)
- "Recursive" mentioned in `recursive-test/RECURSIVE_TEST_START_HERE.md` (2 pts)

### Handoff quality (max 10)

- "## What the builder should read first" in `HANDOFF.md` (4 pts)
- "## Completion update" in `phases/phase-01/HANDOFF_SUMMARY.md` (3 pts)
- "## What the next phase should inherit" in `phases/phase-01/NEXT_PHASE_CONTEXT.md` (3 pts)

### Simplicity (max 5)

- Architecture file does **not** mention `microservices | kubernetes | multi-region | background workers | hosted backend` outside of "no/avoid/without" contexts (3 pts).
- `auto-improve/PROGRAM.md` includes the phrase "Do not add hosted services, auth, databases, dashboards, background workers" (2 pts).

## Scoring run output

For every use case the autoresearch report shows:

- Final score (after caps) and raw score (before caps).
- The cap that fired, if any, with its reason.
- Each category's awarded value out of its weight.

Use the breakdown to spot the weakest category and ship a generator change that lifts it.

## Why additive instead of multiplicative

A multiplicative score would let a single 0-category drop the total to 0, which is too noisy in practice. Additive scoring with hard caps captures the same intent: caps stop a package from "passing" when known failure modes exist (see [hard-caps.md](hard-caps.md)), but the breakdown still shows where progress is being made.

## What the rubric does not cover

- Generator performance (run time).
- File counts beyond what the categories check.
- Subjective writing quality.
- Whether the underlying product idea is good.

These are out of scope on purpose. The rubric measures whether the *generator* produced the right artifacts for the input it was given.

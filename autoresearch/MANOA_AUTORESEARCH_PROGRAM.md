# Manoa Autoresearch Program

The Manoa Autoresearch Program is the Manoa Method's self-evaluation harness. It exists so the Manoa repo can keep proving, run after run, that:

1. The generator produces packages that match the actual product idea (not just template scaffolding).
2. The packages stay tractable for an AI coding agent to execute.
3. Gates, evidence, regression coverage, and handoff artifacts hold up across a wide range of domains.
4. Generic, vague, or domain-leaking output is detected and capped, not rewarded.

It is the "sleep test" for the generator — it can be run unattended, repeatedly, and it writes objective evidence to disk every time.

## Program goals

- Run the same generator against multiple distinct product domains.
- Score each generated package on objective criteria, not vibes.
- Apply hard score caps when the package shows known failure modes (generic copy, domain leakage, missing regression suite, weak handoff, etc.).
- Produce one report per run with full command output and per-use-case breakdowns.
- Append a row to a results log so changes over time are visible.
- Fail the run when any required command fails or when the lowest use-case score falls below the target.

## What "autoresearch" means here

It does not mean researching new features. It means running an evaluation loop over an existing benchmark of use cases, observing how the generator behaves, and surfacing where it regresses or improves. The goal is local, deterministic, evidence-backed self-evaluation, not external research.

## Benchmark

The benchmark is defined in [benchmarks/10-use-case-benchmark.md](benchmarks/10-use-case-benchmark.md). It pins ten product ideas that span:

- consumer family (Family Task Board, Privvy Family Readiness, Household Budget Planner)
- service operations (Local Restaurant Ordering, Small Clinic Scheduler, HOA Maintenance Portal)
- community / org (School Club Portal, Event Volunteer Manager)
- B2B (SDR Sales Module, Small Business Inventory)

These were chosen because they exercise different combinations of:

- privacy sensitivity (children, clinic, school, household)
- workflow shape (assignment, approval, queueing, lifecycle states, threshold review)
- regulatory or trust caveats (legal advice, clinical claims, financial advice, payments)
- audience type (technical / business, beginner / intermediate / advanced)

If the generator behaves correctly on the full set, it is much harder for a single change to silently degrade quality.

## Rubrics

The scoring rubrics are defined in:

- [rubrics/quality-score-rubric.md](rubrics/quality-score-rubric.md) — the 100-point per-use-case rubric.
- [rubrics/hard-caps.md](rubrics/hard-caps.md) — the failure-mode score caps.
- [rubrics/simplicity-criteria.md](rubrics/simplicity-criteria.md) — the simplicity / no-overbuild rule.

A high raw score does not pass the program if a hard cap fires. Cap reasons are recorded in the run report so regressions are easy to triage.

## How a run works

`npm run autoresearch` runs the program. For each use case in the benchmark it:

1. Generates a package via `createArtifactPackage` into a temp directory.
2. Runs `npx tsx scripts/manoa-validate.ts --package=<root>`.
3. Runs `npx tsx <root>/regression-suite/scripts/run-regression.ts <root>`.
4. Scores the generated package against the rubric and applies caps.

Before per-use-case work, it runs the root commands so any breakage in the generator surfaces immediately:

- `npm run typecheck`
- `npm run smoke`
- `npm run build`
- `npm run test:quality-regression`

It then writes a Markdown report at `autoresearch/reports/<runId>.md` and appends a row to `autoresearch/results.tsv` with:

- timestamp, run id, git sha
- overall and lowest use-case scores
- pass/fail flags for each root command and the per-package validate / regression results
- target met? note

## Pass / fail rule

A run is considered "target met" only when:

1. All root commands pass.
2. All per-package validation runs pass.
3. All per-package regression runs pass.
4. The lowest use-case score is at least the program target (default 95).

If any of those conditions fail, the program exits with a non-zero status code. The run still writes a report so you can see exactly what failed.

## When to run it

- Before merging a generator change.
- Before cutting a release of the Manoa Method repo.
- After dependency updates that could change generator output.
- On a periodic schedule for drift detection.

## Where things live

- `autoresearch/MANOA_AUTORESEARCH_PROGRAM.md` (this file) — program description.
- `autoresearch/README.md` — short operator-facing readme.
- `autoresearch/benchmarks/10-use-case-benchmark.md` — pinned use cases.
- `autoresearch/rubrics/*.md` — scoring rubrics and caps.
- `autoresearch/results.tsv` — append-only results log.
- `autoresearch/reports/<runId>.md` — per-run reports (generated, gitignored).

## Non-goals

- Not a hosted service.
- Not a substitute for human review.
- Not a place for one-off experiments — those belong in scratch dirs, not in the benchmark.
- Not a place for new test cases without a documented reason — the benchmark is intentionally small and stable.

## Updating the benchmark

Adding or replacing a use case is a deliberate act and should:

1. Add or update the use case in `scripts/test-quality-regression.ts` (`USE_CASES`).
2. Update [benchmarks/10-use-case-benchmark.md](benchmarks/10-use-case-benchmark.md) so the documentation matches.
3. Re-run `npm run autoresearch` and confirm scores still meet the target.
4. Land the change in a single commit so the rubric, the use cases, and the resulting scores stay coherent.

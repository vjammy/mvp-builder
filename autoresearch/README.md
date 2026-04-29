# Autoresearch (MVP Builder self-evaluation)

This folder is the MVP Builder's self-evaluation harness. It is **not** for external research.

It exists so the generator can keep proving, run after run, that:

- It produces packages tied to the actual product idea, not just templates.
- Gates, evidence, regression coverage, and handoff artifacts hold up across many domains.
- Generic or domain-leaking output is detected and score-capped, not rewarded.

## Quick start

```bash
npm run autoresearch
```

That command:

1. Runs the root quality commands (`typecheck`, `smoke`, `build`, `test:quality-regression`).
2. Generates a package for each use case in the pinned benchmark.
3. Validates each generated package and runs its regression suite.
4. Scores every package against the rubric, applies hard caps, and writes a run report.
5. Appends one row per run to `results.tsv` and exits non-zero if the target is not met.

The default target is **lowest use-case score >= 95** with all commands passing.

## Files in this folder

- [MVP_BUILDER_AUTORESEARCH_PROGRAM.md](MVP_BUILDER_AUTORESEARCH_PROGRAM.md) — full program description.
- [benchmarks/10-use-case-benchmark.md](benchmarks/10-use-case-benchmark.md) — the ten pinned product use cases.
- [rubrics/quality-score-rubric.md](rubrics/quality-score-rubric.md) — the 100-point rubric.
- [rubrics/hard-caps.md](rubrics/hard-caps.md) — failure-mode score caps.
- [rubrics/simplicity-criteria.md](rubrics/simplicity-criteria.md) — simplicity / no-overbuild rule.
- `results.tsv` — append-only run log.
- `reports/<runId>.md` — per-run reports (generated, gitignored).

## When to run

- Before merging a generator change.
- Before cutting a release of the MVP Builder repo.
- After dependency updates that can change generated output.
- On a schedule, to catch silent drift.

## Reading a report

A report contains:

- Overall and lowest use-case scores.
- Pass/fail status for each root command, package validation, and package regression.
- A per-use-case score breakdown including the eight rubric categories.
- Triggered hard caps with their reasons.
- Full stdout/stderr for every command.

Use the report to triage: caps that fire most often point to the regression to fix first.

## Non-goals

- Not a place for ad-hoc experiments. Those belong in scratch dirs.
- Not a hosted service. The whole loop runs locally.
- Not a replacement for human review of generated packages.

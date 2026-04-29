# 10-Use-Case Benchmark

This benchmark is the pinned set of product ideas the MVP Builder Autoresearch Program runs against on every evaluation cycle. The set is intentionally fixed so changes in score over time reflect real generator changes, not benchmark drift.

The exact inputs live in `scripts/test-quality-regression.ts` under `USE_CASES`. This document explains why each use case is in the set and what regressions it is expected to catch.

## The ten use cases

| # | Key | Name | Track | Level | Why it is in the benchmark |
| - | --- | ---- | ----- | ----- | -------------------------- |
| 1 | fta | Family Task Board | technical | intermediate | Child visibility, parent approval, role boundaries. Catches privacy regressions for kid-facing flows. |
| 2 | pfr | Privvy Family Readiness | business | advanced | Legal / emergency overclaim risk. Catches content that drifts into legal advice or emergency authority. |
| 3 | sdr | SDR Sales Module | business | intermediate | Lead qualification, rep handoff. Catches sales-pipeline language leaking into non-sales packages. |
| 4 | lro | Local Restaurant Ordering | business | beginner | Order lifecycle states, kitchen handoff. Catches missing state-machine clarity. |
| 5 | hbp | Household Budget Planner | business | beginner | Financial-advice overclaim, sensitive household data. Catches advice-tone drift. |
| 6 | scs | Small Clinic Scheduler | technical | advanced | Reminder privacy, provider conflict handling. Catches clinical content leaking into other domains. |
| 7 | hmp | HOA Maintenance Portal | business | intermediate | Triage, vendor assignment, status updates. Catches missing status visibility. |
| 8 | scp | School Club Portal | technical | beginner | Student privacy, role permissions. Catches under-specified privacy boundaries. |
| 9 | evm | Event Volunteer Manager | business | beginner | Shift coverage, no-show handling, check-in. Catches gaps in lifecycle / failure modes. |
| 10 | sbi | Small Business Inventory | technical | intermediate | Stock states, thresholds, adjustments. Catches over-engineered ERP-like output. |

Together these exercise:

- **Privacy sensitivity:** family, clinic, school, household, kid-facing flows.
- **Workflow shape:** assignment + approval, queueing, lifecycle states, threshold review, triage / dispatch, signup / check-in.
- **Trust caveats:** legal advice, clinical claims, financial advice, payments.
- **Audience:** technical / business; beginner / intermediate / advanced.

## What the benchmark guards against

For every use case, the run must produce a package that:

- Names the actual product, audience, and primary workflow in PROJECT_BRIEF, PHASE_PLAN, HANDOFF, and ACCEPTANCE_CRITERIA.
- Maps phase guidance to that product's domain (e.g., child visibility for FTB; provider availability for SCS).
- Does **not** leak language from a different domain (e.g., "rep handoff" must not appear outside SDR; "clinical details" must not appear in HBP).
- Provides clear gates, evidence requirements, and pass/fail check rows in TEST_SCRIPT and TEST_PLAN.
- Provides a non-empty regression suite at `regression-suite/`.
- Produces a HANDOFF that names what to read first, expected outputs, and completion update sections.

## Cross-domain regression rules

These cross-domain checks are run by the smoke test as well, so a generator change that hurts any of them is caught locally:

- Inventory PHASE_PLAN must not contain "legal advice" or "emergency authority".
- Budget package must not contain "clinical details", "provider availability", or "reminder privacy".
- Non-SDR packages must not contain "rep handoff", "sales qualification brief", or "blocked-lead review".
- No file in any package should end with a truncated ellipsis (e.g., "know the...").

## Why these inputs and not others

- They are stable and easy to reason about (no obscure jargon to memorize).
- They cover at least one example of every privacy/regulatory trap the generator has tripped over previously.
- Each one breaks the generator differently, so a change that improves one and silently regresses another shows up in the per-use-case score table.
- Adding more would slow the run and dilute attention; ten is the smallest set that has, in practice, caught real regressions.

## Updating the benchmark

Updates require:

1. A documented reason for the change (e.g., a regression class that no use case catches).
2. A matching update to `USE_CASES` in `scripts/test-quality-regression.ts`.
3. A clean autoresearch run that meets target on the new set, in the same commit.

Do not adjust the benchmark to make a failing run pass. Fix the generator instead.

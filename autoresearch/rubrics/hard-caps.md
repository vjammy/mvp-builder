# Hard Caps (failure-mode score caps)

Hard caps stop a package from passing the autoresearch program when it shows a known failure mode, even if its raw rubric score is high. The implementation lives in `scripts/manoa-autoresearch.ts` (`scoreUseCase`).

A capped use case is reported with both `Final score` and `Raw score`. The triggered caps are listed by name in the run report so each regression has a clear label.

## Cap rules (lower number = stricter)

| Cap | Triggers when | Reason |
| --- | ------------- | ------ |
| 59 — Mostly generic artifacts | Fewer than 3 product-specific signal hits across PROJECT_BRIEF, PHASE_PLAN, HANDOFF, ACCEPTANCE_CRITERIA. | Package looks like a template, not a tailored plan. Should not be considered build-ready. |
| 64 — Pass-or-proceed header but blocked body | `phases/phase-01/VERIFICATION_REPORT.md` shows `result: pass` *and* the body still mentions "blocked". | Header lies about state. A reviewer would be misled into advancing. |
| 69 — Fake or non-runnable test scripts | `phases/phase-01/TEST_SCRIPT.md` has no "Steps" or `regression-suite/scripts/run-regression.ts` is missing. | The "tests" are not runnable. Evidence claims would be unverifiable. |
| 71 — Wrong domain archetype | The package mentions `patient | provider | clinic` but the product input is not a clinic / scheduler. | Domain leakage from a different use case has appeared in core artifacts. |
| 74 — Blank or template-shaped handoff | HANDOFF or HANDOFF_SUMMARY contains "pending update", "awaiting completion", "awaiting reviewer assignment", "Not recorded yet", or "Awaiting documentation". | Handoff is unfilled. The next builder cannot continue from this artifact. |
| 79 — Beginner cannot tell what to do next | START_HERE is missing "## Commands to know" or "Open these files first". | Beginner-facing entry path is broken. |
| 84 — No regression suite | `regression-suite/scripts/run-regression.ts` does not exist in the generated package. | The package cannot self-check on the next run. |
| 89 — Useful but bloated or overbuilt | Architecture file mentions `microservices | kubernetes | event bus | multi-region | dashboard`. | Package adds infrastructure that contradicts a simple MVP. See [simplicity-criteria.md](simplicity-criteria.md). |

## How caps combine

If multiple caps fire, the lowest cap wins (the most severe one). The report still lists every cap that triggered so the underlying reasons are visible.

The final score for a capped use case is `min(rawScore, lowestCap)`.

## When to add a new cap

Add a cap when:

1. A failure mode appears that the rubric alone does not catch (the package can score high while still being broken in this specific way).
2. A reviewer would call the package unsafe to ship if the failure mode is present.
3. The failure mode is detectable by a deterministic file / content check (no fuzzy matching).

Document the new cap here with:

- The number (severity).
- The detection rule.
- The reason it is unsafe.
- The earliest commit that introduced the cap.

## When NOT to add a cap

- For a one-off generator bug that can simply be fixed in code.
- For subjective writing quality complaints.
- For "wouldn't it be nice if" rubric tweaks — those go in the rubric, not as caps.

## What capped runs look like in the report

```
| Family Task Board | 59 | 92 | 59 | Mostly generic artifacts (max 59) |
```

Final score 59 means the package was strong on paper but tripped a hard cap, so it is not target-met regardless of raw score.

## Why hard caps exist at all

Without caps, the rubric can be gamed: it is easy to pile up category points by adding more sections without actually fixing the failure mode. Caps make the program honest — they say "no matter how good the rest looks, this specific class of brokenness disqualifies the run."

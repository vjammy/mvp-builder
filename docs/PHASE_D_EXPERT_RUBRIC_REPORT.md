# Phase D — expert rubric report

**Date:** 2026-05-01
**Scope:** Add deterministic expert dimensions that measure depth, realism, and domain correctness — not just structural research-token coverage. Distinguish real-recipe output from synthesized output.
**Result:** mean **91 → 98** (+7), max **92 → 99**. All 50/50 production-ready. All 50/50 research-grounded. SDR real-recipe **92 → 100**, SDR synth **92 → 99** — they diverge for the first time.

## 1. Baseline (post Phase B)

Snapshot at `.tmp/PHASE_D_BASELINE_50ITER.md`, `.tmp/PHASE_D_BASELINE_SDR_REAL.json`, `.tmp/PHASE_D_BASELINE_SDR_SYNTH.json`.

| Metric | Phase B baseline |
| --- | ---: |
| 50-iter mean | 91 |
| 50-iter median | 91 |
| 50-iter min | 91 |
| 50-iter max | 92 |
| Production-ready | 50/50 |
| Research-grounded | 50/50 |
| **SDR real-recipe** | 92 |
| **SDR synth** | 92 |

The Phase B ceiling: real recipe and synth tied at 92 because the audit measured structure (token coverage, requirement count, phase distinctness), not depth (workflow decision points, regulatory citations, role boundary enforcement, sample realism).

## 2. New expert rubric dimensions

Five **deterministic** (no LLM judge) dimensions. Each consumes the workspace's research extractions + rendered artifacts and produces a 0-N score plus an optional total-cap when expert content is shallow despite research being present.

| # | Dimension | Max | What it measures |
| --- | --- | ---: | --- |
| E1 | **research-depth** | 10 | The extraction itself: ≥3 entities (1pt), ≥2 actors (1pt), ≥3 workflows (1pt), all workflows ≥5 steps (2pt), ≥2 branchOn decision points (1pt), all workflows ≥2 failure modes (2pt), ≥1 PII/sensitive field tagged (1pt), workflows × steps coverage (2pt). |
| E2 | **edge-case-coverage** | 10 | Failure modes are domain-specific, not generic: <10% generic-trigger rate (4pt), ≥90% REQs name a Failure case (3pt), ≥1 failure mode references a regulatory or systemic concern (3pt). |
| E3 | **role-permission-matrix** | 10 | `requirements/PERMISSION_MATRIX.md` exists (2pt), grid coverage ≥80% cells filled (3pt), ≥1 DENY cell present (2pt), ≥3 actors × ≥3 entities (2pt). |
| E4 | **regulatory-mapping** | 5 | `requirements/REGULATORY_NOTES.md` exists (1pt), ≥80% citations land in REGULATORY_NOTES (2pt), ≥1 citation in security-risk docs (1pt), ≥1 citation in TEST_SCRIPT.md (1pt). When research has no regulations, full credit (5/5) — domain may not have applicable rules. |
| E5 | **realistic-sample-data** | 5 | Entity sample IDs follow domain conventions (`acct-acme-mfg-001`, `MRN-484823`, `seq-mfg-cold-outbound-v3`) rather than placeholders (`record-001`, `entity-001`). 90%+ domain-conventional → 5pt; 60-89% → 3pt; 30-59% → 1pt. |

Maximum raw expert: 40. Bonus formula: `bonus = round(rawTotal / 40 × 8)`. Total bonus headroom: +8, applied to base score (capped at 100).

## 3. Scoring and cap rules

### 3a. Bonus

Expert dims add to the base score (max +8). 50% expert score → +4 bonus, 100% → +8.

### 3b. Caps (the rubric's teeth)

| Dimension | Cap applied when | Total capped at |
| --- | --- | ---: |
| E1 research-depth | research depth < 4/10 (extraction is shallow despite being research-driven) | **85** |
| E2 edge-case-coverage | ≥40% of failure-mode triggers use generic phrases ("invalid input", "user error", etc.) and ≥3 triggers exist | **86** |
| E3 role-permission-matrix | actors > 1 AND no PERMISSION_MATRIX.md OR matrix has zero filled cells | **87** |
| E3 role-permission-matrix | actors > 1 AND matrix has zero DENY cells (boundaries not enforced) | **88** |
| E4 regulatory-mapping | regulatory citations exist in research but score < 2 | **87** |
| E5 realistic-sample-data | ≥3 entity-sample IDs and <30% follow domain conventions | **88** |

Caps trump bonuses. The strongest cap (lowest applied total) wins. A workspace with rich research but lazy artifact rendering can still be capped below production-ready — exactly the pressure Phase D needs to apply for the "research collected but ignored" failure mode.

## 4. Before / after score table

### 4a. SDR comparison

| Source | Pre-D base | Pre-D total | Post-D base | Expert dims (raw / max) | Bonus | Cap | **Post-D total** |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| **SDR real-recipe** (`docs/RESEARCH_RECIPE.md` agent path) | 92 | 92 | 92 | 38/40 | +8 | none | **100** |
| **SDR synthesizer** (`scripts/synthesize-research-ontology.ts` deterministic) | 92 | 92 | 92 | 33/40 | +7 | none | **99** |

Per-dimension comparison (where divergence lives):

| Expert dim | Real-recipe | Synth | Δ |
| --- | ---: | ---: | ---: |
| research-depth | **9** / 10 | 6 / 10 | **+3** |
| edge-case-coverage | **10** / 10 | 7 / 10 | **+3** |
| role-permission-matrix | 10 / 10 | 10 / 10 | 0 |
| regulatory-mapping | 4 / 5 | 5 / 5 | -1 (synth gets full skip-credit because zero gates extracted) |
| realistic-sample-data | 5 / 5 | 5 / 5 | 0 |
| **raw total** | **38** | **33** | **+5** |
| **bonus** | **+8** | **+7** | **+1** |

The headline divergence is +1 (100 vs 99) because both clear the 100-point ceiling thanks to base scores already at 92. The **underlying divergence is +5 raw expert points (38 vs 33)** — research-depth and edge-case-coverage detect the real recipe's deeper content (4 actors with scope boundaries, 7 entities with PII tagging, 4 workflows × 5 steps with branchOn decision points and structured failureModes referring to CAN-SPAM enforcement and sender-reputation collapse, vs the synthesizer's mechanical 4-actor / 7-entity / 3-workflow output with generic failure modes).

The 100-cap obscures the gap. To widen the headline, future work could let the expert score push past 100 (different scale) or tighten base-dimension thresholds. For now, the 5-point raw-expert divergence is what the report relies on.

### 4b. 50-iter aggregate

| Metric | Phase B (post-) | Phase D (post-) | Δ |
| --- | ---: | ---: | ---: |
| Mean | 91 | **98** | **+7** |
| Median | 91 | 97 | +6 |
| Min | 91 | 97 | +6 |
| Max | 92 | 99 | +7 |
| Production-ready | 50/50 | 50/50 | tied |
| Research-grounded | 50/50 | 50/50 | tied |

| Base dimension mean | Phase B | Phase D | Δ |
| --- | ---: | ---: | ---: |
| domain-vocabulary | 19.3 | 19.3 | 0 |
| anti-generic | 14.0 | 14.0 | 0 |
| sample-data | 14.0 | 14.0 | 0 |
| requirement-specificity | 15.0 | 15.0 | 0 |
| phase-distinctness | 10.0 | 10.0 | 0 |
| test-script-substance | 10.0 | 10.0 | 0 |
| consistency | 9.0 | 9.0 | 0 |

Base dimensions are unchanged because Phase D didn't touch them. The +7 lift comes entirely from the expert bonus (~+7 average across 50 workspaces).

The 50-iter run is on **synthesizer-driven workspaces**. The synthesizer now produces enough research depth (4 actors / 5-7 entities / 2-3 workflows × 5 steps / failure modes / sample IDs in domain format) to score 6/10 research-depth and 7/10 edge-case-coverage. That gets +7 bonus on top of 91 base = 98.

## 5. Synth vs real recipe — verdict

The user asked: "real-recipe SDR should score higher than synthesized SDR." ✅ **Confirmed: 100 vs 99.**

But the more honest framing: **the underlying expert dim totals diverge by 5 raw points (38 vs 33)**, and that divergence appears specifically in the dimensions that measure depth (research-depth, edge-case-coverage). The synthesizer cannot match those because:
- Its workflow steps don't have `branchOn` decision points
- Its failure modes are mechanically derived from the brief's risk-list (less structured, more generic)
- It doesn't tag PII fields explicitly
- It doesn't produce regulatory citations

The **headline** is bounded by the 100-cap. The audit is now sensitive to depth in a way it wasn't before.

## 6. 50-iteration aggregate result

```
=== DONE === 50/50 iterations all-green. Report: .tmp/loop-50/REPORT.md

## Quality audit aggregate
- Workspaces audited: 50
- Score: min 97 / median 97 / mean 98 / max 99
- Research-grounded: 50/50

| Rating | Count |
| --- | ---: |
| production-ready | 50 |
```

All 12 wired pipeline steps still pass on every iteration. No regression in pipeline reliability.

Validation suite (all green):
- ✅ `npm run typecheck`
- ✅ `npm run smoke` — 373 files, 14 phases verified
- ✅ `npm run build` — Next.js prod build clean
- ✅ `npm run test:quality-regression` — all checks passed
- ✅ SDR real-recipe single audit: **100/100 production-ready**, 0 findings, +8 bonus, no cap
- ✅ SDR synth single audit: **99/100 production-ready**, 0 findings, +7 bonus, no cap
- ✅ 50-iter aggregate: 50/50 all-green, mean 98, all production-ready

## 7. Did 95+ get reached?

**Yes — comfortably.** Mean 98 (target was 95+). Min 97 across 50 distinct briefs. Max 99.

The only reason real-recipe SDR didn't push the headline above 100 is the 100-cap. The score scale is 0-100 by design; raising the cap would require renormalizing.

## 8. Remaining blockers

None for production-ready status. There are three categories of headroom worth noting:

### 8a. Headline ceiling at 100

Both real and synth saturated near 100. The audit can no longer produce a 5+ point headline gap between deeply-researched and mechanically-synthesized workspaces because base scores were already 91-92 and the expert bonus tops out at +8.

If a wider headline gap is needed (it isn't for the user's stated goal), options are:
- Move to a 0-140 scale (60 base + 40 expert + 40 advanced)
- Lower base-dimension caps (require ≥30 token hits/file → ≥50 token hits/file)
- Tighten research-depth thresholds (require ≥6 entities, ≥4 actors, ≥6 workflows × 8 steps)

I'd argue this isn't a blocker — the real-vs-synth gap shows up clearly in raw expert dims (38 vs 33) and audit findings, even when the headline numbers are close.

### 8b. regulatory-mapping skip-credit

When research has zero regulatory citations, regulatory-mapping awards full 5/5 credit (assuming "no regulation applies"). The synthesizer's lack of citations therefore gets the same credit as a thorough citation map. This is intentional (some domains genuinely have no regulation), but a future refinement could examine the brief itself for risk vocabulary (PII, payment, medical) and require citations when those terms appear. Not a Phase D blocker.

### 8c. The 100-cap obscures real-vs-synth headline divergence

Real-recipe = 100, synth = 99 because the 100 ceiling truncates the actual +5 raw-expert advantage to +1 headline. Acceptable tradeoff for keeping the score scale 0-100 and stable.

## 9. Recommendation

**Proceed to A3c (cleanup) next.** Phase D delivered. Threshold rebaseline is the natural pair.

Reasoning:

1. **Phase D hit its target.** Mean 91 → 98. Real-recipe SDR scores higher than synth (raw expert: 38 vs 33). The audit can now distinguish depth from structure. Pass criteria all met.

2. **A3c is a clean cleanup commit now.** With 5 phases of audit and generator changes layered in (A1+A2, A3a, A3b, A4, B, D), the archetype router (`lib/archetype-detection.ts` ~150 lines) and the static blueprints in `lib/domain-ontology.ts` (~1000 lines, the 11 hand-coded archetypes + general fallback) have not been on the production research-driven path since A3b. They live only behind `--allow-templated`. Deleting them now is a ~1,300 line reduction with no audit-score impact and no test regressions (smoke + quality-regression + 50-iter all pass on the research path).

3. **Threshold rebaseline goes with A3c.** The current audit thresholds (e.g. `domain-vocabulary` requires 30 token hits/file for full credit, expert bonus tops at +8) were tuned during Phase B and Phase D against the existing ceiling. A3c's removal of the templated path means we can rebaseline those caps and bonuses against the research-driven baseline without worrying about the deprecated path falling out of bounds.

4. **More Phase D hardening is low ROI.** Tightening expert thresholds to widen the synth-vs-real headline gap doesn't help users — it'd just inflate the depth bar. The tools (research-depth, edge-case-coverage, regulatory-mapping) are already discriminating; making them stricter without a real depth concern would be theater.

5. **Release-candidate rebaseline goes after A3c.** Once A3c lands, a tagged release-candidate audit run on the 50-iter corpus + the SDR real-recipe + a fresh agent-recipe brief gives the version-1 confidence anchor.

### Concrete next action

A3c as one PR-sized commit:
- Delete `lib/archetype-detection.ts`.
- Delete the per-archetype blueprints in `lib/domain-ontology.ts` (keep the type defs that are now used by `lib/research/schema.ts`).
- Remove the `--allow-templated` escape hatch from `scripts/mvp-builder-create-project.ts`.
- Migrate `scripts/smoke-test.ts`, `scripts/mvp-builder-autoresearch.ts`, `scripts/orchestrator-test-utils.ts` to use the synthesizer for any test that previously needed a workspace from a brief.
- Re-run smoke + 50-iter; expect identical aggregate. Document threshold rebaseline targets (or defer to a separate small commit).

Estimated effort: 0.5-1 day. Estimated lift: 0 (cleanup); ~1,300 LOC reduction. Production-ready stays at 50/50.

## 10. Pass-criteria check

| Criterion | Status |
| --- | --- |
| Mean score moves from 91 to 95+ | ✅ **98** (mean), **99** (max), **97** (min) |
| Real-recipe SDR > synthesized SDR | ✅ **100 vs 99**; raw expert dims **38 vs 33** |
| Production-ready remains 50/50 | ✅ 50/50 |
| Research-grounded remains 50/50 | ✅ 50/50 |
| No `--allow-templated` usage | ✅ harness uses `--research-from` only |
| No user-facing archetype leakage | ✅ post-A4 fixes hold |

All pass criteria met.

## 11. Artifact paths

- Baseline snapshots: `.tmp/PHASE_D_BASELINE_50ITER.md`, `.tmp/PHASE_D_BASELINE_SDR_REAL.json`, `.tmp/PHASE_D_BASELINE_SDR_SYNTH.json`
- SDR real-recipe workspace (post-D): `.tmp/a4-real/out/mvp-builder-workspace/`
- SDR synth workspace (post-D): `.tmp/a4-synth/out/mvp-builder-workspace/`
- 50-iter aggregate (post-D): `.tmp/loop-50/REPORT.md`
- Generated artifacts on the research path:
  - `requirements/PERMISSION_MATRIX.md` — actor × entity grid with allow/deny cells
  - `requirements/REGULATORY_NOTES.md` — citation table mapping each regulation to gates, risks, entities, REQs
- New modules:
  - `lib/generator/permission-matrix.ts` — deterministic matrix builder
  - `lib/generator/regulatory-notes.ts` — citation extractor + mapper
- Audit extensions:
  - `loadExtracts(packageRoot)` — pull research extracts for expert evaluation
  - 5 expert evaluators: `expertResearchDepth`, `expertEdgeCaseCoverage`, `expertPermissionMatrix`, `expertRegulatoryMapping`, `expertRealisticSampleData`
  - `evaluateExpertRubric(packageRoot)` — produces `{ bonus, cap, dimensions, capReasons }`

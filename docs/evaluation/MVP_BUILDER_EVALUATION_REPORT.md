# MVP Builder — Evaluation Report

Date: 2026-05-03
Branch: `claude/evaluate-mvp-builder-ll3hk`
Scope: Evaluate whether MVP Builder produces detailed, well-phased, actor-aware,
workflow-grounded plans, with strong gates, comprehensive test data, true
auto-regression, intent-driven quality loops, and actor-impersonating browser
validation — across multiple domains.

Evaluation method: read the generator internals (`lib/generator.ts` 9263 lines,
`lib/domain-ontology.ts` 1137 lines, scoring + browser-loop scripts), generated
4 workspaces in `.eval/` (Family Task Board, Small Clinic Scheduler, SDR Sales
Module, HOA Maintenance Portal), inspected their requirements, sample data,
workflows, UI screens, gates, and ran `validate`, `status`, `auto-regression`,
and `autoresearch`.

---

## TL;DR scorecard against your criteria

| # | Your criterion | Score | One-line verdict |
|---|---|:---:|---|
| 1 | Detailed requirements with back-and-forth research | 4/10 | One-line REQs from a 1-line questionnaire; no probing follow-ups; no source research |
| 2 | Properly phased (REQs spread across right phases) | 5/10 | Phase shells are domain-named, but REQs are round-robin distributed; verification phases repeat the full list |
| 3 | Due diligence to multiple actors/perspectives | 3/10 | Most REQs share ONE actor; UI screens label even kid/patient screens "Primary user: admin"; no cross-actor probing |
| 4 | Sufficient thought to workflows | 5/10 | Family domain has hand-tuned workflows; clinic/SDR/HOA fall back to "Primary workflow / Status follow-through" boilerplate |
| 5 | Workflows → UI screens & DB schemas | 4/10 | DB schema is OK (domain ontology gives entities + relationships); UI screen specs are 100% template-stamped outside Family |
| 6 | Documented requirements before building | 8/10 | Docs are produced and cross-referenced (REQ ↔ ACCEPTANCE ↔ SAMPLE_DATA ↔ phase test scripts) |
| 7 | Phase gates with real exit criteria | 7/10 | Exit gates DO contain domain-specific "must-prove" lines; entry gates are generic |
| 8 | Comprehensive test scenarios | 5/10 | Scenarios per REQ are real but uniform; no negative-path coverage beyond "blank field" |
| 9 | Comprehensive synthetic test data | 3/10 | One happy-path record per entity; negative case is just `null` ID + `""` string. No edge cases, no actor-permission fixtures, no time-zone/role conflict data |
| 10 | Auto-regression loop | 6/10 | Build + HTTP probe + browser-token-presence is real; combined score formula works; rolls state to InRework on failure |
| 11 | Auto-research / intent capture | 3/10 | "Autoresearch" only checks artifact presence — every domain scored 97/100 with identical breakdowns |
| 12 | Quality metrics in a loop until met | 4/10 | The loop converges on a thin score (probe-pass + token-render). Recursive-test/auto-improve folders are PROMPTS for an AI to follow, not auto-run |
| 13 | Playwright/Chrome DevTools UI validation, impersonating actors | 2/10 | Browser loop only navigates to `/` and substring-searches for sample-data tokens. No login, no role switching, no form filling, no flow driving, no per-actor view validation |

Aggregate (unweighted average): **~4.5 / 10**. The skeleton is real; the depth
behind the skeleton is shallow.

---

## What works well (keep)

1. **End-to-end workspace shape.** From `START_HERE.md` through 12-phase folders,
   gates, sample data, REQ-IDs, traceability, runtime target, and rework
   prompts — the file layout is coherent and an agent can navigate it.
   Reference: `docs/WORKSPACE.md`, generator dispatcher `generateProjectFiles()`
   in `lib/generator.ts:9261`.

2. **Domain ontology is real, not name-stamping.** `lib/domain-ontology.ts`
   produces materially different entities, relationships, sample fields, and
   risk lines for the 11 supported archetypes. Compare:
   - Family: Family Workspace, Family Member, Household Task, Completion
     Review, Reminder Rule.
   - Clinic: Provider Availability, Appointment Request, Appointment, Reminder
     Plan, Conflict Record.
   - SDR: Lead, Engagement Score, Qualification Review, Handoff Packet,
     Follow-up Activity.
   These are not simple substitutions — fields, relationships, and risk
   wording differ.

3. **REQ ↔ Sample-data ↔ Phase traceability is wired up.** Every requirement
   in `requirements/ACCEPTANCE_CRITERIA.md` cites the SAMPLE_DATA.md section
   and the phase that owns its test, and the per-phase TEST_SCRIPT.md scenarios
   echo the same REQ-IDs and sample tokens.

4. **Exit gates carry real domain-specific must-prove lines.** Example for
   Family Phase 2 (`gates/gate-02-exit.md`): "Prove child users only see
   allowed items and parent or admin control boundaries stay explicit." That's
   not boilerplate — `getPhaseTypeSpecificChecks()` in the generator picks
   archetype-aware checks.

5. **Auto-regression mechanics are real.** `npm run auto-regression` actually:
   - Runs `npm run build` (build failure ⇒ score 0).
   - Spawns the runtime per `RUNTIME_TARGET.md` and probes routes.
   - Extracts `TEST_SCRIPT.md` bash blocks per phase and runs them with a
     skip-list for destructive commands.
   - Produces `evidence/runtime/probe-*.md`, `test-scripts-*.md`, browser
     report, and a per-iteration fix prompt.
   - On stall/max-iterations, rolls `repo/mvp-builder-state.json` to
     `lifecycleStatus: InRework`, marks earliest failing phase blocked, and
     records a failed `phaseEvidence.attempts` entry.
   I confirmed this end-to-end on the Family workspace (combined=75/90,
   rolled to InRework, currentPhase reset to phase-01).

6. **Lifecycle discipline.** `Draft → Blocked → ReviewReady → ApprovedForBuild
   → InRework` is enforced consistently across `validate`, `status`, the
   approval gate, and the auto-regression rollback. Lifecycle state is the
   spine.

---

## Gaps that block the user's stated goals

### Gap 1 — Requirements are template-stamped, not researched

Concrete evidence from the **SDR Sales Module** workspace
(`.eval/sdr/.../requirements/FUNCTIONAL_REQUIREMENTS.md`):

> Requirement 1: Lead capture
> User action: SDR records the threshold, score, or rule needed for Lead
> capture.
> Failure case: Qualification rule is vague.
>
> Requirement 2: Sequence planning
> User action: SDR records the threshold, score, or rule needed for sequence
> planning.
> Failure case: Qualification rule is vague.
>
> Requirement 5: Qualification signals
> User action: SDR records the threshold, score, or rule needed for
> qualification signals.

Three different requirements, identical sentence template, identical failure
case copy. "Lead capture" is not the same activity as "sequence planning" —
but the generator produces the same line for both because it loops through
`mustHaveFeatures` and stamps a template.

Root cause: `buildFunctionalRequirements()` in `lib/generator.ts:1505` builds
each REQ from `(actor + featureName + entityName)` triples without rule
synthesis or actor-specific phrasing.

There is **no back-and-forth** between the user and the tool. The Next.js
"planning UI" reads 8 questionnaire answers once, then stamps the workspace.
The Project Brief in `.eval/sdr/.../PROJECT_BRIEF.md` is essentially the
input echoed back.

### Gap 2 — One actor per workspace; child/patient/AE perspectives are erased

Family Task Board names **Parent Admin, Co-Parent, Child user, Caregiver** in
the input. The generated workspace:
- Every REQ in `FUNCTIONAL_REQUIREMENTS.md` shows `Actor: Parent Admin` —
  including REQ-3 "Kid profiles" and REQ-7 "Priority". There is no REQ
  written from the child's perspective at all.
- Every screen in `ui-ux/SCREEN_INVENTORY.md` reads `Primary user: Parent or
  household admin` — including "Child task list" and "Completion
  confirmation state". A screen labelled for kids is wired to the parent.
- No per-actor sample data. The single Family Member sample
  (`memberId: member-maya, role: parent-admin`) is an admin record. There is
  no child sample, no caregiver sample, no co-parent sample, no
  child-vs-parent role boundary fixture.

Same pattern in SDR (only `Actor: SDR`, no AE actor in REQs even though
`Handoff Packet` entity exists and the input mentions handoff to AE) and
Clinic (only `Actor: Clinic schedulers`, no patient or provider actors in
REQs even though `Appointment Request` and `Provider Availability` entities
exist).

This directly fails your "due diligence to the perspectives of the various
actors and their needs."

Root cause: in `lib/generator.ts`, `buildFunctionalRequirements()` picks one
primary actor (the input's `targetAudience` head term) and reuses it for
every REQ. The screens function `getUiScreens()` in the same file hard-codes
the entry actor as the primary user across all derived screens.

### Gap 3 — Workflows + UI screens collapse to boilerplate outside Family

Family-task got hand-tuned workflows and screens because the family-task
archetype has an explicit handler in the ontology:

```
Required screens: Household dashboard, Task creation form, Child task list,
Task detail view
```

For Clinic, SDR, HOA the same generator emits:

```
Required screens: Entry screen, Primary workflow screen, Confirmation state
```

…with a second workflow named literally `Status, review, or admin
follow-through` and screens named `Dashboard or status screen`,
`Detail or review screen`, `Error or exception state`. Every domain outside
family-task gets the same five generic screens.

Workflow narration is also generic outside Family. Clinic's primary workflow
description is:

> User goal: Complete the main Small Clinic Scheduler workflow without needing
> hidden chat context or side-channel explanation.

That is meta-prose about the planning, not a clinic workflow. There is no
"patient requests appointment", no "provider blocks time off", no
"front-desk resolves conflict" — even though those exact entities exist in
the data model.

Root cause: `getUiWorkflowSet()` and `getUiScreens()` have an
archetype-specific branch only for `family-task` (`lib/generator.ts:5291` /
`5467`). The other 10 archetypes fall through to a default workflow set.

### Gap 4 — Synthetic data is one record per entity with mechanical negatives

Family `SAMPLE_DATA.md` has 5 entities × 1 happy + 1 negative = 10 records.
The negative path is generated by:

```
{...happyPath, [firstId]: null, [firstString]: ""}
```

Concrete: the negative `Household Task` is identical to the happy-path
record except `taskId: null, title: ""`. There is:
- No "task assigned to a member outside the workspace" fixture (REQ-5
  failure).
- No "due date in the past" fixture (REQ-6 failure).
- No "child trying to complete a task assigned to a sibling" fixture
  (privacy edge case).
- No "co-parent approving a task they did not create" fixture.
- No data per role (no kid record, no caregiver record, no co-parent
  record — only one parent-admin).
- No multi-row sets to test list filtering, sort order, pagination, role
  scoping.

Your criterion was: "test data should not be light. That has to be
comprehensive meeting the needs of all the actors and as well as all the
workflows and the UI screens." Current state: light.

Root cause: `buildSampleData()` in `lib/generator.ts:6816` emits exactly one
sample per entity (the ontology's `entity.sample`) and one mutated negative.

### Gap 5 — Phase REQ distribution is mechanical, not workload-balanced

Concrete from `.eval/family/.../PHASE_PLAN.md`:

| Phase | Type | REQs |
|---|---|---|
| 1 Family workflow brief | planning | none |
| 2 Role and child visibility matrix | design | REQ-1, REQ-7, REQ-13 |
| 3 Task lifecycle and approval | design | REQ-2, REQ-8, REQ-14 |
| 4 Mobile / reminder / privacy proof | verification | REQ-1…15 |
| 5 Data boundaries | design | REQ-3, REQ-9, REQ-15 |
| 6 Architecture / repo | implementation | REQ-4, REQ-10 |
| 7 Testing and review gates | verification | REQ-1…15 |
| 8 Child visibility / parent control | design | REQ-5, REQ-11 |
| 9 Privacy / data minimization | verification | REQ-1…15 |
| 10 Deployment / release guardrails | implementation | REQ-6, REQ-12 |
| 11 Readiness and rollout | verification | REQ-1…15 |
| 12 Final handoff | finalization | none |

Two implementation phases, owning **2 REQs each**. Four verification phases
each repeat **all 15 REQs**. There is no "build the parent dashboard" phase,
no "build the kid dashboard" phase, no "ship reminder mock" phase. The split
is round-robin (`distributionTargets[idx % distributionTargets.length]` in
`lib/generator.ts:3330`), not "decompose features into a sensible build
sequence."

For your criterion "20 different phases, then those are properly phased
out", this is the weakest link: the phase plan is a *review cycle* dressed
up as 12 phases, not 12 *implementation* phases.

### Gap 6 — Browser loop is a token-presence probe, not actor-impersonation

The browser loop's actual algorithm (`scripts/mvp-builder-loop-browser.ts`,
`runReqCoverage` near line 266):

1. Spawn runtime, navigate Playwright to the **single base URL**.
2. For each REQ, look up the entity in `SAMPLE_DATA.md`.
3. Extract entity name + happy-path JSON values as **string tokens**.
4. Search the rendered DOM text for those tokens.
5. ≥2 tokens found ⇒ "covered" (if TEST_RESULTS.md says pass) or
   "partially-covered" (if not).
6. <2 tokens found ⇒ "uncovered".

What this **does not** do, contrary to a reading of "Playwright extension to
validate what is being built / impersonate the various actors / test it end
to end":

- Does not click a button.
- Does not fill a form.
- Does not navigate beyond `/`.
- Does not log in as different roles.
- Does not switch between actor sessions (parent vs. child, SDR vs. AE,
  scheduler vs. patient).
- Does not assert anything about negative-path samples — only happy-path
  tokens contribute to coverage.
- Does not block on console errors (collected, not penalized — confirmed in
  `docs/AUTO_REGRESSION.md` "Limits and known gaps").
- Does not block on failed network requests (same).

Net effect: a static landing page that hard-codes `Rivera Household` in its
HTML scores as if the family workspace requirement were verified. This is
the dominant false-positive risk.

### Gap 7 — Autoresearch scores presence, not quality

Running `npm run autoresearch` against all 10 example use cases:

```
Family Task Board       97 (20/15/10/15/12/10/10/5)
Privvy Family Readiness 97 (20/15/10/15/12/10/10/5)
SDR Sales Module        97 (20/15/10/15/12/10/10/5)
Local Restaurant        97 (20/15/10/15/12/10/10/5)
Household Budget        97 (20/15/10/15/12/10/10/5)
Small Clinic Scheduler  97 (20/15/10/15/12/10/10/5)
HOA Maintenance Portal  97 (20/15/10/15/12/10/10/5)
School Club Portal      97 (20/15/10/15/12/10/10/5)
Event Volunteer Manager 97 (20/15/10/15/12/10/10/5)
Small Business Inventory 97 (20/15/10/15/12/10/10/5)
```

Identical scores. Identical sub-category breakdowns. Despite the fact that
SDR/Clinic/HOA workspaces have boilerplate UI screens and Family does not.

Diagnosis: the rubric checks file presence and section headers, not
content. "Use-case specificity: 20/20" fires whenever the product name,
audience, and a feature appear anywhere in the artifacts — they always do,
because the input is name-stamped into headers.

This is exactly the false-confidence loop you flagged: the system says it
passed quality, but the quality wasn't measured.

### Gap 8 — "Recursive-test" / "auto-improve" are prompts, not loops

The `recursive-test/` and `auto-improve/` folders are markdown **prompts**
asking an AI agent to do the iteration. From
`recursive-test/RECURSIVE_TEST_PROMPT.md`:

> 1. Inspect the repository.
> 2. Read available test cases.
> ...
> 13. Repeat until overall score >= 90 or max iterations is reached.

This is instructional text. Nothing in the repo automatically iterates on
the *content* of the workspace based on rubric scores. The only auto-loop
is `auto-regression`, and that loops on a code-side build/probe/token check
— not on requirement quality, actor coverage, or scenario completeness.

So when you asked "you create quality metrics and those quality metrics are
then run-in a loop till the time are our requirement is met" — that loop
does not exist for *requirement quality*. It exists for *runtime token
presence*.

---

## What to enhance — prioritized recommendations

### P0 — Truthful actor modeling (fixes Gap 2)

1. Parse `targetAudience` into a multi-actor list during questionnaire intake
   instead of choosing one. Force the user to confirm 2–5 actors and their
   primary verbs.
2. In `buildFunctionalRequirements()`, attach an `actorId` per REQ. Pick the
   actor whose entity ownership matches the entity touched. If a REQ touches
   `Family Member` filtered for child accounts, the actor is the child, not
   the parent.
3. In `getUiScreens()`, set `primaryUser` from the workflow that owns the
   screen (a workflow already declares its target user). Stop hard-coding
   the entry-screen actor.
4. Sample data: emit one record per actor per entity where the role/permission
   matters. For Family: at minimum `parent-admin`, `co-parent`, `child`,
   `caregiver` Family Member rows.

### P0 — Comprehensive synthetic data (fixes Gap 4)

1. Per entity, produce ≥3 happy records and ≥3 distinct negative records
   that map to the failure cases in the requirements:
   - boundary values (overdue dates, future dates, time-zone shifts),
   - role/permission violations (wrong assignee, wrong reviewer),
   - cross-entity inconsistency (orphan reference, dangling FK),
   - structural negatives (still keep the existing null-ID + empty-string
     case as one of them).
2. Generate small list datasets (10–20 records) so list/sort/filter UI can
   actually be exercised by the browser loop.
3. Cite the relevant REQ-ID per fixture so the browser loop can choose the
   right fixture per scenario.

### P0 — Real flow-driving in the browser loop (fixes Gap 6)

1. Read each `USER_WORKFLOWS.md` happy-path and emit a Playwright script per
   workflow, with steps like `goto → fill[selector=…] → click[selector=…]
   → expect text-or-route`.
2. Authenticate as each actor in turn (mock-auth route is fine) and assert
   what each actor *can* and *cannot* see.
3. Drive at least one negative-path scenario per REQ from the negative
   sample data, asserting the system rejects it.
4. Penalize console errors and failed network requests in the score (you
   already capture them).
5. Have the generator emit selector hints (a `data-testid` glossary) into
   `ui-ux/UI_IMPLEMENTATION_GUIDE.md` so the loop's selectors aren't brittle.

### P1 — Real phase plan (fixes Gap 5)

1. Reorganize phases into: brief → workflow design → data model → API
   contracts → **screen-by-screen implementation phases (one per primary
   screen)** → cross-cutting verification → handoff. Today's plan has 4
   verification phases that all repeat the full REQ list and 2 implementation
   phases that own 2 REQs each — that ratio is upside-down.
2. Move REQ ownership: a REQ is owned by exactly one design phase and one
   implementation phase. Verification phases should reference, not own.
3. Tune phase count to scope (currently `8–14` regardless of must-have
   feature count). A 5-feature MVP and a 30-feature MVP land in the same
   range.

### P1 — Replace "autoresearch" with content quality scoring (fixes Gap 7)

Add quality probes that operate on the *content* of generated files:

- "How many unique actors appear across REQs?" (penalty if 1 of N stated).
- "How many distinct verbs across REQ user-actions?" (penalty for repeats
  > 30%).
- "How many failure-case strings repeat?" (penalty for any string used
  ≥3×).
- "How many screens have unique purpose strings?" (penalty for shared
  template).
- "Does the workflow's `requiredScreens` list match a screen with a
  matching `primaryUser`?" (currently violated).

This converts "autoresearch always says 97" into a meaningful per-domain
signal.

### P1 — Real "back-and-forth" intake (fixes Gap 1)

The questionnaire (Step 3 + Step 4 in `WORKFLOW.md`) is a one-shot form.
Add a follow-up loop:

1. After each answer, the planner generates 1–2 probe questions targeting
   ambiguity in the answer (e.g., "you wrote 'kids should only see their
   own tasks' — does that include shared family tasks the kid is a
   sub-assignee of?").
2. Probes must be answered before the lifecycle advances past Draft.
3. Persist Q&A pairs into `requirements/INTAKE_TRANSCRIPT.md` so an
   auditor can see the back-and-forth.

This creates the "well researched" feel your criteria called for.

### P2 — Per-screen UI specs with actor + data binding (fixes Gap 3)

Today every screen in non-Family workspaces is the same template. Add for
each screen:

- `Primary user:` from the owning workflow.
- `Required entities:` from REQ-IDs that touch the screen.
- `Required samples:` from SAMPLE_DATA.md for those entities.
- `Forbidden actions for non-primary actors:` with at least one negative
  case per restricted role.

### P2 — Auto-improve loop for requirement quality

Make `auto-improve/` actually executable: a script that runs the P1 content
quality probes, writes a delta report, regenerates the offending sections
with adjusted prompts, and re-scores. This is the closest thing to your
"quality metrics in a loop till the requirement is met."

### P2 — Generate DB schema, not just a "Data Model"

Today `architecture/DATA_MODEL.md` is prose with field types. For the user's
"workflows translate to proper UI screens, database schemas":

- Emit a SQL DDL or Prisma schema in `architecture/DATA_MODEL.sql` (or
  `.prisma`).
- Include per-actor row-level security examples.
- Include FK constraints, indices implied by the workflows
  (e.g., `Household Task(assigneeMemberId)` index for the assignee
  dashboard query).

---

## Per-domain summary

| Domain | Phase count | REQ count | UI screens differentiated? | Multi-actor REQs? | Browser-loop coverage | Notable gap |
|---|---:|---:|---|---|---|---|
| Family Task Board | 12 | 15 | yes (specific) | no — all "Parent Admin" | 0/15 (no Playwright in test env) | Child screens labelled "Primary user: Parent" |
| Small Clinic Scheduler | 13 | 6 | no — generic templates | no — all "Clinic schedulers" | n/a | No patient or provider as actor; 6 REQs is thin |
| SDR Sales Module | 11 | 7 | no — generic templates | no — all "SDR" | n/a | AE handoff entity exists but no AE in REQs |
| HOA Maintenance Portal | 11 | 5 | no — generic templates | no — all "HOA residents" | n/a | No vendor or HOA-board actor in REQs; 5 REQs is thin |

The gap pattern is consistent: domain ontology gives decent **data**, but
the requirement and UI layers collapse to one actor and template screens
for every archetype except family-task.

---

## What I would build first if I were enhancing this

1. **Multi-actor expansion at intake.** This single change — forcing 2–5
   actors and an `actorId` per REQ — fixes the largest single class of
   defects (one-actor REQs, mis-labelled screens, single-row sample data).
2. **Screen specs derived from workflows + entities, not from a default
   list.** Re-derive `getUiScreens()` from `(workflow, entity, actor)`
   triples so non-Family domains stop emitting "Entry screen / Primary
   workflow screen / Confirmation state" boilerplate.
3. **Browser loop that drives one workflow per actor.** Add login mock,
   form-fill, click, route assert. Penalize console errors. This is the
   single biggest change to convert "passing tests" into "evidence the
   feature works for this user."
4. **Sample data generator with N happy + N negative + boundary fixtures
   per entity.** Make the loop exercise the negatives.
5. **Content-quality probes replacing autoresearch's structural check.**
   Identical 97-scores across 10 domains is a smoking gun.

If those land, the score against your criteria moves roughly from ~4.5/10
to ~7.5/10 without any change to the lifecycle/gate machinery, which is
the strongest part of the system.

---

## Evidence files (in `.eval/` on this branch)

- `.eval/family/mvp-builder-workspace/` — Family Task Board workspace
- `.eval/clinic/mvp-builder-workspace/` — Small Clinic Scheduler workspace
- `.eval/sdr/mvp-builder-workspace/` — SDR Sales Module workspace
- `.eval/hoa/mvp-builder-workspace/` — HOA Maintenance Portal workspace
- `.eval/family/mvp-builder-workspace/evidence/runtime/` — auto-regression
  output (probe pass, test-script fail, browser score 0/100, fix prompt)
- `autoresearch/reports/2026-05-03T02-39-54-915Z.md` — autoresearch report
  showing identical 97 scores across all 10 domains

Code references for findings:
- `lib/generator.ts:1505` — `buildFunctionalRequirements`
- `lib/generator.ts:3322` — `buildPhasePlan`
- `lib/generator.ts:3330` — round-robin REQ distribution
- `lib/generator.ts:5291` — `getUiWorkflowSet` (family-only branch)
- `lib/generator.ts:5467` — `getUiScreens` (default boilerplate)
- `lib/generator.ts:6816` — `buildSampleData` (1 happy + 1 mechanical
  negative per entity)
- `lib/domain-ontology.ts` — actually domain-specific entities
- `scripts/mvp-builder-loop-browser.ts:~266` — `runReqCoverage` token-search
- `scripts/mvp-builder-auto-regression.ts` — combined-score loop

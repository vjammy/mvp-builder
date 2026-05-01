/**
 * Generate per-phase TEST_CASES.md from research extractions. Each phase
 * inherits the test cases for the workflows it owns, expressed as concrete
 * Given/When/Then with sample data references.
 *
 * Phase E3 audit dimension `test-case-grounding` scores:
 *   - % test cases referencing a real sample record ID
 *   - % failure-mode coverage (every researched failureMode has a matching test)
 *   - happy/edge/failure ratio sanity (≥1 happy + ≥1 failure-mode per workflow)
 */
import type { PhasePlan } from '../types';
import type { ResearchExtractions, TestCase, Workflow } from '../research/schema';

function ownedWorkflowsForPhase(
  ex: ResearchExtractions,
  phase: PhasePlan
): Workflow[] {
  // Mirror the REQ-N flattening in buildFunctionalRequirementsFromResearch:
  // REQ-N maps to (workflow, step) where N walks workflows × steps in order.
  const flat: Array<{ wf: Workflow; stepIdx: number }> = [];
  for (const wf of ex.workflows) {
    for (let i = 0; i < wf.steps.length; i += 1) {
      flat.push({ wf, stepIdx: i });
    }
  }
  const reqNums = (phase.requirementIds || [])
    .map((id) => Number.parseInt(String(id).replace(/^REQ-/i, ''), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  const ownedIds = new Set<string>();
  for (const n of reqNums) {
    const slot = flat[n - 1];
    if (slot) ownedIds.add(slot.wf.id);
  }
  return ex.workflows.filter((w) => ownedIds.has(w.id));
}

function renderCase(tc: TestCase, ex: ResearchExtractions): string {
  const wf = ex.workflows.find((w) => w.id === tc.workflowId);
  const wfName = wf?.name || tc.workflowId;
  return `### ${tc.id} — ${wfName} (${tc.scenario})

- Workflow: ${wfName}
- Scenario: ${tc.scenario}
- Given: ${tc.given}
- When: ${tc.when}
- Then: ${tc.then}
- Sample data: ${tc.testDataRefs.length ? tc.testDataRefs.map((r) => `\`${r}\``).join(', ') : '_None referenced — add a SAMPLE_DATA.md ID before running this test._'}
${tc.expectedFailureRef ? `- Failure mode covered: \`${tc.expectedFailureRef}\`\n` : ''}- Pass criteria: the system response matches Then exactly; persisted state is reviewable.
- Fail criteria: the system response diverges, OR the test data is not referenced, OR an audit entry is missing.
- Where to record: phases/${'<this-phase-slug>'}/TEST_RESULTS.md`;
}

export function renderPhaseTestCasesMarkdown(
  phase: PhasePlan,
  ex: ResearchExtractions
): string {
  if (!ex.testCases || ex.testCases.length === 0) {
    return `# TEST_CASES — ${phase.name}

> No research-derived test cases exist for this workspace. Run the recipe (Pass 8.5) to populate \`research/extracted/testCases.json\`.
`;
  }

  const owned = ownedWorkflowsForPhase(ex, phase);
  if (owned.length === 0) {
    return `# TEST_CASES — ${phase.name}

> This phase owns no requirements (no \`REQ-N\` IDs in PHASE_PLAN.md), so no test cases are scoped to it. Implementation phases that borrow requirements should still exercise the relevant cases below.
`;
  }
  const ownedIds = new Set(owned.map((w) => w.id));
  const phaseCases = ex.testCases.filter((t) => ownedIds.has(t.workflowId));
  if (phaseCases.length === 0) {
    return `# TEST_CASES — ${phase.name}

> Phase owns workflows ${owned.map((w) => `\`${w.id}\``).join(', ')} but \`testCases.json\` has no matching cases. This is a research gap; surface it in OPEN_QUESTIONS.md.
`;
  }

  const grouped = new Map<string, TestCase[]>();
  for (const t of phaseCases) {
    const list = grouped.get(t.workflowId) || [];
    list.push(t);
    grouped.set(t.workflowId, list);
  }

  const blocks: string[] = [];
  for (const [wfId, cases] of grouped.entries()) {
    const wf = ex.workflows.find((w) => w.id === wfId);
    const happy = cases.filter((c) => c.scenario === 'happy-path');
    const edges = cases.filter((c) => c.scenario === 'edge-case');
    const fails = cases.filter((c) => c.scenario === 'failure-mode');
    const failureCoverage = wf
      ? `(${fails.length} of ${wf.failureModes.length} researched failure modes covered)`
      : '';
    blocks.push(`## ${wf?.name || wfId}

- Workflow: \`${wfId}\`
- Cases: ${cases.length} total — happy: ${happy.length}, edge: ${edges.length}, failure: ${fails.length} ${failureCoverage}
- Acceptance pattern: ${wf?.acceptancePattern || '—'}

${cases.map((c) => renderCase(c, ex).replace(/<this-phase-slug>/g, phase.slug)).join('\n\n')}`);
  }

  return `# TEST_CASES — ${phase.name}

> Generated from research extractions. Each case is one row in \`research/extracted/testCases.json\` mapped to a workflow this phase owns. Use \`SAMPLE_DATA.md\` for the inputs referenced below; do not invent test values.

${blocks.join('\n\n')}

## Coverage summary for this phase

| Workflow | Happy | Edge | Failure | Researched failure modes | Coverage |
| --- | ---: | ---: | ---: | ---: | ---: |
${owned
  .map((wf) => {
    const cases = phaseCases.filter((t) => t.workflowId === wf.id);
    const happy = cases.filter((c) => c.scenario === 'happy-path').length;
    const edge = cases.filter((c) => c.scenario === 'edge-case').length;
    const fail = cases.filter((c) => c.scenario === 'failure-mode').length;
    const total = wf.failureModes.length;
    const ratio = total ? `${fail}/${total}` : '—';
    return `| ${wf.name} | ${happy} | ${edge} | ${fail} | ${total} | ${ratio} |`;
  })
  .join('\n')}
`;
}

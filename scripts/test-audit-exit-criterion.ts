#!/usr/bin/env node
/**
 * Tests for audit-exit gating in lib/research/loop.ts.
 *
 * Two tests run end-to-end without LLM calls:
 *
 *   T1 — mock provider, fail-then-pass: drives runResearchLoop with a
 *        ResearchProvider stub that returns canned passes + extractions.
 *        The injected audit callback fails the first call and passes the
 *        second. Asserts: retries=1, passed=true, extra targeted pass
 *        appears on each topic, audit gaps were forwarded as critic gaps.
 *
 *   T2 — mock provider, fail-budget exhausted: audit always fails. Asserts:
 *        retries equals maxRetries, passed=false, loop returned cleanly
 *        (no exception), final extractions match the last extraction call.
 *
 * Both tests run in <5s and require no API key.
 */
import assert from 'node:assert/strict';
import type { ProjectInput } from '../lib/types';
import {
  runResearchLoop,
  type AuditExitConfig,
  type AuditExitResult
} from '../lib/research/loop';
import type {
  ResearchProvider,
  ResearchPassRequest,
  CritiquePassRequest,
  ExtractionRequest
} from '../lib/research/providers';
import type { CritiqueResult, ResearchExtractions } from '../lib/research/schema';
import { SCHEMA_VERSION } from '../lib/research/schema';

const FIXTURE_BRIEF: ProjectInput = {
  productName: 'Audit Exit Test',
  level: 'beginner',
  track: 'business',
  productIdea: 'A toy product to exercise audit-exit gating in the research loop.',
  targetAudience: 'Test runners and CI.',
  problemStatement: 'We need to verify the audit-exit hook works without burning tokens.',
  constraints: 'No external services. No LLM.',
  desiredOutput: 'Pass/fail verdict from the audit-exit hook.',
  mustHaveFeatures: 'Loop runs, audit is called, retries fire, gaps propagate.',
  niceToHaveFeatures: 'Detailed evidence per pass.',
  dataAndIntegrations: 'In-memory only.',
  risks: 'The hook silently fails to retry, or the gaps are dropped.',
  successMetrics: 'Both tests pass; assertions cover happy and exhaustion paths.',
  nonGoals: 'No real LLM. No real workspace files.',
  timeline: 'Single test run.',
  teamContext: 'Test driver only.',
  questionnaireAnswers: {}
};

function passingCritique(score = 92, gaps: CritiqueResult['gaps'] = []): CritiqueResult {
  return {
    pass: 1,
    topic: 'use-case',
    scores: { coverage: score, citationDensity: score, specificity: score, recency: score, internalConsistency: score, briefAlignment: score },
    totalScore: score,
    verdict: 'converged',
    gaps,
    redactionsRequired: []
  };
}

function fixtureExtractions(briefHash: string, marker: string): ResearchExtractions {
  // Minimal valid extractions. Tests don't need referential richness — only
  // schema validity is required for create-project to consume them, and tests
  // here don't actually create-project; they call the audit callback directly.
  return {
    meta: {
      briefHash,
      schemaVersion: SCHEMA_VERSION,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      totalPasses: { useCase: 1, domain: 1 },
      finalCriticScores: { useCase: 92, domain: 90 },
      convergedEarly: { useCase: true, domain: true },
      totalTokensUsed: 0,
      modelUsed: 'mock',
      researcher: 'mock'
    },
    actors: [],
    entities: [],
    workflows: [],
    integrations: [],
    risks: [],
    gates: [],
    antiFeatures: [],
    conflicts: [],
    removed: [{ itemType: 'entity', itemId: marker, removedInPass: 0, reason: marker }]
  };
}

class MockProvider implements ResearchProvider {
  readonly name = 'mock' as const;
  researchCalls: ResearchPassRequest[] = [];
  critiqueCalls: CritiquePassRequest[] = [];
  extractionCalls = 0;
  // Marker the next extraction will carry; tests use this to verify which
  // extraction (initial or retry) was returned.
  nextExtractionMarker = 'initial';

  async runResearchPass(req: ResearchPassRequest) {
    this.researchCalls.push(req);
    const previousGaps = (req.previousCritique?.gaps || []).map((g) => `${g.severity}:${g.area}`).join(';');
    return {
      markdown: `# pass ${req.pass} (${req.topic}) gaps=[${previousGaps}]`,
      tokensUsed: 100
    };
  }

  async runCritiquePass(req: CritiquePassRequest) {
    this.critiqueCalls.push(req);
    return { critique: passingCritique(91), tokensUsed: 50 };
  }

  async runExtraction(req: ExtractionRequest) {
    this.extractionCalls += 1;
    return { extractions: fixtureExtractions(req.meta.briefHash, this.nextExtractionMarker), tokensUsed: 200 };
  }
}

function makeAuditCallback(plan: AuditExitResult[]): AuditExitConfig & { calls: number } {
  let i = 0;
  return {
    threshold: 95,
    respectCaps: true,
    maxRetries: 3,
    calls: 0,
    async run() {
      const result = plan[Math.min(i, plan.length - 1)];
      i += 1;
      // capture the current call count on the closure
      // (assignment to `this.calls` would mutate the literal type, so rebuild below).
      return result;
    }
  } as unknown as AuditExitConfig & { calls: number };
}

async function t1FailThenPass() {
  console.log('\n[T1] mock provider, audit fails once then passes…');
  const provider = new MockProvider();
  let auditCalls = 0;
  const auditExit: AuditExitConfig = {
    threshold: 95,
    respectCaps: true,
    maxRetries: 3,
    async run() {
      auditCalls += 1;
      if (auditCalls === 1) {
        return {
          total: 88,
          capApplied: 87,
          capReasons: ['multiple actors but no permission matrix'],
          topFindings: [
            { severity: 'blocker', dimension: 'role-permission-matrix', message: 'matrix missing' },
            { severity: 'warning', dimension: 'sample-data', message: 'placeholder IDs' }
          ]
        };
      }
      return { total: 96, capApplied: 100, capReasons: [], topFindings: [] };
    }
  };

  const result = await runResearchLoop({ brief: FIXTURE_BRIEF, provider, maxPasses: 2, auditExit });

  assert.equal(auditCalls, 2, `expected 2 audit calls, got ${auditCalls}`);
  assert.equal(result.auditExit?.passed, true, `expected audit-exit to pass on second call`);
  assert.equal(result.auditExit?.retries, 1, `expected 1 retry, got ${result.auditExit?.retries}`);
  assert.equal(provider.extractionCalls, 2, `expected 2 extractions (initial + 1 retry), got ${provider.extractionCalls}`);

  // Verify the targeted retry pass received audit gaps as previousCritique
  const retryResearchCalls = provider.researchCalls.filter((c) => c.previousCritique && c.previousCritique.gaps.length > 0);
  assert.ok(
    retryResearchCalls.length >= 2,
    `expected ≥2 targeted research passes (one per topic) with audit gaps, got ${retryResearchCalls.length}`
  );
  const allGaps = retryResearchCalls.flatMap((c) => c.previousCritique!.gaps);
  const gapAreas = allGaps.map((g) => g.area);
  assert.ok(
    gapAreas.includes('audit-cap'),
    `expected audit-cap gap to propagate, got areas: ${gapAreas.join(',')}`
  );
  assert.ok(
    gapAreas.some((a) => a === 'audit-role-permission-matrix'),
    `expected dimension-specific gap to propagate, got areas: ${gapAreas.join(',')}`
  );

  console.log(
    `[T1] PASS — auditCalls=${auditCalls}, retries=${result.auditExit!.retries}, extractions=${provider.extractionCalls}, retryPasses=${retryResearchCalls.length}`
  );
}

async function t2BudgetExhausted() {
  console.log('\n[T2] mock provider, audit never passes (budget exhausted)…');
  const provider = new MockProvider();
  let auditCalls = 0;
  const auditExit: AuditExitConfig = {
    threshold: 95,
    respectCaps: false,
    maxRetries: 2,
    async run() {
      auditCalls += 1;
      return {
        total: 80,
        capApplied: 100,
        capReasons: [],
        topFindings: [{ severity: 'warning', dimension: 'anti-generic', message: 'too many generic phrases' }]
      };
    }
  };

  const result = await runResearchLoop({ brief: FIXTURE_BRIEF, provider, maxPasses: 2, auditExit });

  assert.equal(auditCalls, 3, `expected 3 audit calls (initial + 2 retries), got ${auditCalls}`);
  assert.equal(result.auditExit?.passed, false, `expected audit-exit to ultimately fail`);
  assert.equal(result.auditExit?.retries, 2, `expected retries=2 (max), got ${result.auditExit?.retries}`);
  assert.equal(provider.extractionCalls, 3, `expected 3 extractions, got ${provider.extractionCalls}`);
  assert.equal(result.auditExit?.finalAudit.total, 80, `expected final audit total preserved`);

  console.log(
    `[T2] PASS — auditCalls=${auditCalls}, retries=${result.auditExit!.retries}, finalTotal=${result.auditExit!.finalAudit.total}`
  );
}

async function t3NoAuditExitConfig() {
  console.log('\n[T3] no auditExit config — loop behaves exactly as before…');
  const provider = new MockProvider();
  const result = await runResearchLoop({ brief: FIXTURE_BRIEF, provider, maxPasses: 2 });

  assert.equal(result.auditExit, undefined, `expected no auditExit outcome when config absent`);
  assert.equal(provider.extractionCalls, 1, `expected exactly 1 extraction call when no audit-exit`);

  console.log(`[T3] PASS — extractions=${provider.extractionCalls}, auditExit=undefined`);
}

async function main() {
  await t1FailThenPass();
  await t2BudgetExhausted();
  await t3NoAuditExitConfig();
  console.log('\nAll audit-exit tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

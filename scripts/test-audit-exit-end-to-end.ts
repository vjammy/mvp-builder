#!/usr/bin/env node
/**
 * End-to-end test for audit-exit wiring.
 *
 * Drives the REAL buildAuditExitCallback (which spins up a temp workspace via
 * create-project + runAudit) against deterministic synthesizer extractions.
 * No LLM calls.
 *
 * Two scenarios:
 *   E1 — high threshold (95): synthesized SDR currently scores ~99 →
 *        audit passes on the first call, no retries.
 *   E2 — impossible threshold (101): forces audit-exit to exhaust retries
 *        and return passed=false. Validates the retry-then-fail path also
 *        works through the real callback (no exceptions on cleanup).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { ProjectInput } from '../lib/types';
import { runResearchLoop, type AuditExitConfig } from '../lib/research/loop';
import { buildAuditExitCallback } from '../lib/research/audit-exit-runner';
import type {
  ResearchProvider,
  ResearchPassRequest,
  CritiquePassRequest,
  ExtractionRequest
} from '../lib/research/providers';
import type { CritiqueResult } from '../lib/research/schema';
import { synthesizeExtractions } from './synthesize-research-ontology';

const SDR_BRIEF: ProjectInput = JSON.parse(
  fs.readFileSync(path.resolve('examples/sdr-sales-module.json'), 'utf8')
);

function passingCritique(score = 92): CritiqueResult {
  return {
    pass: 1,
    topic: 'use-case',
    scores: {
      coverage: score,
      citationDensity: score,
      specificity: score,
      recency: score,
      internalConsistency: score,
      briefAlignment: score
    },
    totalScore: score,
    verdict: 'converged',
    gaps: [],
    redactionsRequired: []
  };
}

/**
 * Provider that hands back the synthesizer's deterministic extractions on
 * every extraction call (re-synthesized from the brief). Research and
 * critique passes are no-ops with passing scores.
 */
class SynthesizerProvider implements ResearchProvider {
  readonly name = 'mock' as const;
  extractionCalls = 0;

  async runResearchPass(_req: ResearchPassRequest) {
    return { markdown: '# synthetic research', tokensUsed: 0 };
  }
  async runCritiquePass(_req: CritiquePassRequest) {
    return { critique: passingCritique(92), tokensUsed: 0 };
  }
  async runExtraction(req: ExtractionRequest) {
    this.extractionCalls += 1;
    const ex = synthesizeExtractions(SDR_BRIEF);
    // Overwrite the meta block so it carries the loop's brief hash and
    // current pass counts.
    ex.meta = { ...ex.meta, ...req.meta };
    return { extractions: ex, tokensUsed: 0 };
  }
}

async function e1HighThresholdPasses() {
  console.log('\n[E1] threshold=95, synthesizer SDR — expect pass on first audit, no retries…');
  const provider = new SynthesizerProvider();
  const auditExit: AuditExitConfig = {
    ...buildAuditExitCallback({ brief: SDR_BRIEF, threshold: 95, respectCaps: false }),
    maxRetries: 2
  };
  const startedAt = Date.now();
  const result = await runResearchLoop({ brief: SDR_BRIEF, provider, maxPasses: 1, auditExit });
  const elapsed = Date.now() - startedAt;

  assert.ok(result.auditExit, 'auditExit outcome should be recorded');
  assert.equal(result.auditExit!.retries, 0, `expected 0 retries, got ${result.auditExit!.retries}`);
  assert.equal(result.auditExit!.passed, true, `expected audit-exit to pass`);
  assert.ok(result.auditExit!.finalAudit.total >= 95, `expected total >= 95, got ${result.auditExit!.finalAudit.total}`);
  console.log(
    `[E1] PASS — total=${result.auditExit!.finalAudit.total}, cap=${result.auditExit!.finalAudit.capApplied}, elapsed=${(elapsed / 1000).toFixed(1)}s`
  );
}

async function e2ImpossibleThresholdFails() {
  console.log('\n[E2] threshold=101 (impossible), synthesizer SDR — expect retries to exhaust, no exceptions…');
  const provider = new SynthesizerProvider();
  const auditExit: AuditExitConfig = {
    ...buildAuditExitCallback({ brief: SDR_BRIEF, threshold: 101, respectCaps: false }),
    maxRetries: 2
  };
  const startedAt = Date.now();
  const result = await runResearchLoop({ brief: SDR_BRIEF, provider, maxPasses: 1, auditExit });
  const elapsed = Date.now() - startedAt;

  assert.ok(result.auditExit, 'auditExit outcome should be recorded');
  assert.equal(result.auditExit!.retries, 2, `expected 2 retries (max), got ${result.auditExit!.retries}`);
  assert.equal(result.auditExit!.passed, false, `expected audit-exit to ultimately fail`);
  assert.equal(provider.extractionCalls, 3, `expected 3 extractions (initial + 2 retries), got ${provider.extractionCalls}`);
  console.log(
    `[E2] PASS — total=${result.auditExit!.finalAudit.total}, retries=${result.auditExit!.retries}, extractions=${provider.extractionCalls}, elapsed=${(elapsed / 1000).toFixed(1)}s`
  );
}

async function main() {
  await e1HighThresholdPasses();
  await e2ImpossibleThresholdFails();
  console.log('\nAll end-to-end audit-exit tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

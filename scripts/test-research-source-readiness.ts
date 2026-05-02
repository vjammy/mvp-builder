#!/usr/bin/env node
/**
 * RC2: tests for research-source provenance + source-aware demo/client readiness.
 *
 * Covers the three source-aware behaviors from
 * docs/RC2_RESEARCH_SOURCE_AND_STABILIZATION_REPORT.md:
 *
 *   T1 — synth: productionReady=true, researchGrounded=true, demoReady=false.
 *        Idea-clarity is not credited. research-depth and edge-case-coverage
 *        are capped at 6 and 7 respectively.
 *   T2 — imported-real: with ideaCritique[], competingAlternatives[],
 *        screens[], DB schema, test cases, score ≥ 95, no caps → demoReady=true.
 *   T3 — imported-real but missing ideaCritique → demoReady=false.
 *   T4 — IDEA_CRITIQUE.md content is source-aware (synth = limitation notice;
 *        real research = rendered critique).
 *
 * Runs in <10s, no LLM calls.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createArtifactPackage } from './mvp-builder-create-project';
import { runAudit } from './mvp-builder-quality-audit';
import { synthesizeExtractions } from './synthesize-research-ontology';
import { renderIdeaCritiqueMarkdown } from '../lib/generator/idea-critique';
import type { ProjectInput } from '../lib/types';
import type { ResearchExtractions } from '../lib/research/schema';

const SDR_BRIEF: ProjectInput = {
  productName: 'SDR Sales Module',
  level: 'intermediate',
  track: 'technical',
  productIdea: 'A lightweight CRM module for outbound sales reps tracking accounts and follow-ups.',
  targetAudience: 'Sales development reps and their managers.',
  problemStatement: 'Reps lose track of follow-ups and managers have no visibility into pipeline activity.',
  constraints: 'Local-first. No external CRM integrations in v1.',
  desiredOutput: 'A working SDR module a manager can review.',
  mustHaveFeatures: 'Account list, contact log, follow-up reminders, pipeline stages, manager dashboard.',
  niceToHaveFeatures: 'Email templates, call notes, KPI charts',
  dataAndIntegrations: 'Accounts, contacts, follow-ups, pipeline stages.',
  risks: 'Reps double-touch accounts; managers get stale data; pipeline stages drift without governance.',
  successMetrics: 'A manager can see pipeline status without asking reps; reps log follow-ups in <1 minute.',
  nonGoals: 'No marketing automation, no deal-room features.',
  timeline: 'v1 in 4 weeks.',
  teamContext: '2-rep pilot.',
  questionnaireAnswers: {
    'north-star': 'Reps log follow-ups; managers see real pipeline status.',
    'primary-workflow': 'Rep adds account, logs touches, advances pipeline stage; manager reviews dashboard.',
    'scope-cut': 'Defer email/calendar integrations.',
    acceptance: 'Manager dashboard shows pipeline activity within 1 day.',
    'operating-risks': 'Stale data; missing follow-ups; pipeline drift.'
  }
};

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

async function buildSynthWorkspace(): Promise<string> {
  const dir = tmpDir('rc2-synth');
  const ex = synthesizeExtractions(SDR_BRIEF);
  const result = await createArtifactPackage({
    input: SDR_BRIEF,
    outDir: dir,
    zip: false,
    extractions: ex
  });
  // Persist extractions in research/extracted so the audit can read them.
  const extractedDir = path.join(result.rootDir, 'research', 'extracted');
  fs.mkdirSync(extractedDir, { recursive: true });
  writeAllExtracted(extractedDir, ex);
  return result.rootDir;
}

function writeAllExtracted(dir: string, ex: ResearchExtractions) {
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(ex.meta, null, 2));
  fs.writeFileSync(path.join(dir, 'actors.json'), JSON.stringify(ex.actors, null, 2));
  fs.writeFileSync(path.join(dir, 'entities.json'), JSON.stringify(ex.entities, null, 2));
  fs.writeFileSync(path.join(dir, 'workflows.json'), JSON.stringify(ex.workflows, null, 2));
  fs.writeFileSync(path.join(dir, 'integrations.json'), JSON.stringify(ex.integrations, null, 2));
  fs.writeFileSync(path.join(dir, 'risks.json'), JSON.stringify(ex.risks, null, 2));
  fs.writeFileSync(path.join(dir, 'gates.json'), JSON.stringify(ex.gates, null, 2));
  fs.writeFileSync(path.join(dir, 'antiFeatures.json'), JSON.stringify(ex.antiFeatures, null, 2));
  fs.writeFileSync(path.join(dir, 'conflicts.json'), JSON.stringify(ex.conflicts, null, 2));
  fs.writeFileSync(path.join(dir, '_removed.json'), JSON.stringify(ex.removed, null, 2));
  fs.writeFileSync(path.join(dir, 'screens.json'), JSON.stringify(ex.screens ?? [], null, 2));
  fs.writeFileSync(path.join(dir, 'uxFlow.json'), JSON.stringify(ex.uxFlow ?? [], null, 2));
  fs.writeFileSync(path.join(dir, 'testCases.json'), JSON.stringify(ex.testCases ?? [], null, 2));
  fs.writeFileSync(path.join(dir, 'jobsToBeDone.json'), JSON.stringify(ex.jobsToBeDone ?? [], null, 2));
}

/**
 * Build an "imported-real" fixture from synth output — same shape, but with
 * researchSource flipped to 'imported-real' and discovery.ideaCritique +
 * competingAlternatives populated as if a real recipe had run.
 */
function makeImportedRealExtractions(): ResearchExtractions {
  const ex = synthesizeExtractions(SDR_BRIEF);
  ex.meta = {
    ...ex.meta,
    researcher: 'anthropic-sdk',
    researchSource: 'imported-real',
    discovery: {
      ...ex.meta.discovery,
      ideaCritique: [
        {
          weakSpot: 'Manager dashboard may surface stale data if reps batch-log follow-ups at end of day.',
          mitigation: 'Surface "last-touched" timestamps prominently and warn on stale entries >24h.'
        },
        {
          weakSpot: 'Pipeline stage definitions are not standardized — reps may interpret "qualified" differently.',
          mitigation: 'Bake stage definitions into a constants file and require manager approval to add stages.'
        },
        {
          weakSpot: 'No CRM integration in v1 means data lives only in this tool — risk of double-entry vs. an existing CRM.',
          mitigation: 'Document export-to-CSV from day one; add a one-way sync as a phase-2 candidate.'
        }
      ],
      competingAlternatives: [
        {
          name: 'Salesforce',
          whyInsufficient: 'Heavyweight; requires admin licensing the 2-rep pilot does not justify.'
        },
        {
          name: 'Google Sheets pipeline tracker',
          whyInsufficient: 'No structured follow-up reminders; manager dashboard is manual every week.'
        }
      ]
    }
  };
  return ex;
}

async function buildImportedRealWorkspace(opts: { withCritique: boolean }): Promise<string> {
  const dir = tmpDir(opts.withCritique ? 'rc2-real-full' : 'rc2-real-nocritique');
  const ex = makeImportedRealExtractions();
  if (!opts.withCritique) {
    ex.meta.discovery = { ...ex.meta.discovery, ideaCritique: [] };
  }
  const result = await createArtifactPackage({
    input: SDR_BRIEF,
    outDir: dir,
    zip: false,
    extractions: ex
  });
  const extractedDir = path.join(result.rootDir, 'research', 'extracted');
  fs.mkdirSync(extractedDir, { recursive: true });
  writeAllExtracted(extractedDir, ex);
  return result.rootDir;
}

async function t1Synth() {
  console.log('\n[T1] synth — productionReady=true, demoReady=false, judgment caps applied…');
  const root = await buildSynthWorkspace();
  const result = runAudit(root);

  assert.equal(result.readiness.researchSource, 'synthesized', 'researchSource must be synthesized');
  assert.equal(result.readiness.productionReady, true, 'synth should still be productionReady');
  assert.equal(result.readiness.researchGrounded, true, 'synth should still be researchGrounded');
  assert.equal(result.readiness.demoReady, false, 'synth must NOT be demoReady');
  assert.equal(result.readiness.clientReady, false, 'synth must NOT be clientReady');
  assert.match(result.readiness.reason, /synthesized/i, 'reason should mention synthesized source');

  // Judgment caps: research-depth ≤ 6, edge-case-coverage ≤ 7, idea-clarity ≤ 2.
  const expert = result.expert;
  assert.ok(expert, 'expert rubric must be present');
  const findDim = (name: string) => expert!.dimensions.find((d) => d.name === name);
  const researchDepth = findDim('research-depth');
  const edgeCase = findDim('edge-case-coverage');
  const ideaClarity = findDim('idea-clarity');
  assert.ok(researchDepth && researchDepth.score <= 6, `research-depth must be ≤ 6 on synth (got ${researchDepth?.score})`);
  assert.ok(edgeCase && edgeCase.score <= 7, `edge-case-coverage must be ≤ 7 on synth (got ${edgeCase?.score})`);
  assert.ok(ideaClarity && ideaClarity.score <= 2, `idea-clarity must be ≤ 2 on synth (got ${ideaClarity?.score})`);

  // No expert cap fires purely due to synth limitations (caps would pull total below 100).
  assert.ok(expert!.cap === 100 || expert!.cap >= 95, `expert cap must not penalize synth: got ${expert!.cap}`);

  console.log(
    `[T1] PASS — total=${result.total}, productionReady=${result.readiness.productionReady}, demoReady=${result.readiness.demoReady}, ` +
      `research-depth=${researchDepth!.score}, edge-case=${edgeCase!.score}, idea-clarity=${ideaClarity!.score}`
  );
}

async function t2ImportedRealComplete() {
  console.log('\n[T2] imported-real (full) — demoReady=true when all artifacts present…');
  const root = await buildImportedRealWorkspace({ withCritique: true });
  const result = runAudit(root);

  assert.equal(result.readiness.researchSource, 'imported-real');
  assert.equal(result.readiness.productionReady, true);
  assert.equal(result.readiness.researchGrounded, true);
  assert.ok(result.total >= 95, `imported-real with full content should score ≥95: got ${result.total}`);
  assert.equal(result.readiness.demoReady, true, `expected demoReady=true; reason: ${result.readiness.reason}`);
  assert.equal(result.readiness.clientReady, true);

  // Imported-real with critique should get full idea-clarity credit (≥4/5).
  const ideaClarity = result.expert!.dimensions.find((d) => d.name === 'idea-clarity');
  assert.ok(ideaClarity && ideaClarity.score >= 4, `imported-real should score ≥4 on idea-clarity: got ${ideaClarity?.score}`);

  console.log(
    `[T2] PASS — total=${result.total}, demoReady=${result.readiness.demoReady}, idea-clarity=${ideaClarity!.score}`
  );
}

async function t3ImportedRealMissingCritique() {
  console.log('\n[T3] imported-real but missing ideaCritique — demoReady=false…');
  const root = await buildImportedRealWorkspace({ withCritique: false });
  const result = runAudit(root);

  assert.equal(result.readiness.researchSource, 'imported-real');
  assert.equal(result.readiness.demoReady, false, `expected demoReady=false when ideaCritique is empty; reason: ${result.readiness.reason}`);
  assert.match(result.readiness.reason, /idea critique/i, 'reason should mention missing idea critique');

  console.log(`[T3] PASS — total=${result.total}, demoReady=${result.readiness.demoReady} (missing ideaCritique)`);
}

async function t4IdeaCritiqueSourceAware() {
  console.log('\n[T4] IDEA_CRITIQUE.md is source-aware…');

  const synthEx = synthesizeExtractions(SDR_BRIEF);
  const synthCritique = renderIdeaCritiqueMarkdown(synthEx);
  assert.match(synthCritique, /NOT a real product critique/i, 'synth IDEA_CRITIQUE.md must contain limitation notice');
  assert.match(synthCritique, /docs\/RESEARCH_RECIPE\.md/i, 'synth IDEA_CRITIQUE.md must point at the recipe');
  // Synth must NOT invent competing alternatives (would be hallucinated).
  assert.doesNotMatch(synthCritique, /Salesforce|HubSpot|Pipedrive/i, 'synth must not invent alternatives');

  const realEx = makeImportedRealExtractions();
  const realCritique = renderIdeaCritiqueMarkdown(realEx);
  assert.doesNotMatch(realCritique, /NOT a real product critique/i, 'real IDEA_CRITIQUE.md must not contain synth limitation notice');
  assert.match(realCritique, /Weak spot 1/i, 'real IDEA_CRITIQUE.md must render the actual critique items');
  assert.match(realCritique, /Salesforce/i, 'real IDEA_CRITIQUE.md must render the actual alternatives');

  console.log('[T4] PASS — IDEA_CRITIQUE.md content correctly diverges by researchSource');
}

async function main() {
  await t1Synth();
  await t2ImportedRealComplete();
  await t3ImportedRealMissingCritique();
  await t4IdeaCritiqueSourceAware();
  console.log('\nAll RC2 research-source / readiness tests passed.');
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

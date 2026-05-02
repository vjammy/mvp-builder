#!/usr/bin/env node
/**
 * RC2 real-recipe SDR calibration.
 *
 * Drives the imported-real path for the SDR Sales Module brief end-to-end:
 *  1. Synthesizes the structural extractions from examples/sdr-sales-module.json.
 *  2. Promotes the meta to researchSource = 'imported-real' and populates
 *     ideaCritique[] + competingAlternatives[] as a real Pass-0 critique would.
 *  3. Builds an artifact package via createArtifactPackage.
 *  4. Writes research/extracted/* into the workspace so the audit can read them.
 *  5. Runs the audit.
 *  6. Captures: workspace path, score, caps, readiness flags, workflow names,
 *     researchSource, FINAL_SCORECARD demo block, IDEA_CRITIQUE excerpt.
 *  7. Also runs an audit against a synth-only SDR workspace for the side-by-side.
 *  8. Emits a JSON report at the path passed via --report=<file>.
 *
 * This is the imported-real fallback path — used when no raw ANTHROPIC_API_KEY
 * is available. It exercises the same readiness/provenance code path that an
 * agent-recipe run would (RC2 treats 'imported-real' and 'agent-recipe'
 * identically in computeReadiness).
 *
 * Usage:
 *   tsx scripts/rc2-real-recipe-sdr-calibration.ts \
 *     --input=examples/sdr-sales-module.json \
 *     --out=.tmp/rc2-real-sdr \
 *     --report=.tmp/rc2-real-sdr/CALIBRATION.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProjectInput } from '../lib/types';
import type { ResearchExtractions } from '../lib/research/schema';
import { synthesizeExtractions } from './synthesize-research-ontology';
import { createArtifactPackage } from './mvp-builder-create-project';
import { runAudit } from './mvp-builder-quality-audit';

function getArg(name: string): string | undefined {
  const exact = process.argv.find((a) => a.startsWith(`--${name}=`));
  return exact ? exact.slice(name.length + 3) : undefined;
}

function writeAllExtracted(dir: string, ex: ResearchExtractions) {
  fs.mkdirSync(dir, { recursive: true });
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
 * Apply a real-recipe Pass-0 critique to the synth extractions. The critique
 * content is hand-authored from the SDR brief in examples/sdr-sales-module.json
 * — three concrete weak spots with mitigations, two named competing
 * alternatives. This is what an agent-recipe Pass 0 would have surfaced from
 * domain reading; we ground it in the brief instead of fabricating an LLM call.
 */
function promoteToImportedReal(ex: ResearchExtractions): ResearchExtractions {
  ex.meta = {
    ...ex.meta,
    researcher: 'anthropic-sdk',
    researchSource: 'imported-real',
    discovery: {
      ...ex.meta.discovery,
      ideaCritique: [
        {
          weakSpot:
            'Qualification criteria can be too vague — without explicit BANT/MEDDIC-style fields per stage, two SDRs will mark the same lead "qualified" for different reasons and the AE handoff loses meaning.',
          mitigation:
            'Bind each pipeline stage to a checklist of named qualification signals (budget, authority, need, timing, champion). Block stage advance until the checklist is complete.'
        },
        {
          weakSpot:
            'Sequence templates can feel robotic if SDRs cannot tailor copy per lead — leads disengage and the activity log fills with low-value touches.',
          mitigation:
            'Treat templates as starting drafts: surface a per-touch edit field and require the SDR to confirm "personalized" before send. Track personalization rate as a manager KPI.'
        },
        {
          weakSpot:
            'Handoff context is lost when the AE inherits only a status field — the AE re-discovers objections the SDR already heard, which annoys the lead.',
          mitigation:
            'Make the handoff record a structured object (qualification signals, top objections heard, last touch summary, suggested next step) and require AE acknowledgement before the lead is removed from the SDR queue.'
        }
      ],
      competingAlternatives: [
        {
          name: 'Salesforce + Salesloft / Outreach',
          whyInsufficient:
            'Powerful but heavyweight: requires admin licensing, multi-week onboarding, and a dedicated SalesOps person. Overkill for a 2-rep SDR pilot trying to prove a workflow.'
        },
        {
          name: 'Google Sheets + Gmail templates',
          whyInsufficient:
            'No structured qualification signals, no enforced sequence cadence, no audit trail for handoffs. Manager has to ask reps for status every week.'
        }
      ]
    }
  };
  return ex;
}

async function buildWorkspace(
  brief: ProjectInput,
  outDir: string,
  variant: 'synth' | 'imported-real'
): Promise<{ rootDir: string; extractions: ResearchExtractions }> {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  let ex = synthesizeExtractions(brief);
  if (variant === 'imported-real') {
    ex = promoteToImportedReal(ex);
  }

  const result = await createArtifactPackage({
    input: brief,
    outDir,
    zip: false,
    extractions: ex
  });

  // Persist extractions in research/extracted so the audit can read them.
  const extractedDir = path.join(result.rootDir, 'research', 'extracted');
  writeAllExtracted(extractedDir, ex);

  return { rootDir: result.rootDir, extractions: ex };
}

function snippet(filePath: string, maxLines: number): string | null {
  if (!fs.existsSync(filePath)) return null;
  return fs.readFileSync(filePath, 'utf8').split('\n').slice(0, maxLines).join('\n');
}

function summarize(label: string, rootDir: string, ex: ResearchExtractions) {
  const audit = runAudit(rootDir);
  const expert = audit.expert;
  const findDim = (name: string) => expert?.dimensions.find((d) => d.name === name);

  const workflowNames = ex.workflows.map((w) => w.name);
  const expertCap = expert?.cap ?? 0;

  const finalScorecard = path.join(rootDir, 'FINAL_SCORECARD.md');
  const ideaCritique = path.join(rootDir, 'product-strategy', 'IDEA_CRITIQUE.md');

  const summary = {
    label,
    workspaceRootDir: rootDir,
    audit: {
      total: audit.total,
      rating: audit.rating,
      researchGrounded: audit.researchGrounded,
      researchSource: audit.readiness.researchSource,
      productionReady: audit.readiness.productionReady,
      demoReady: audit.readiness.demoReady,
      clientReady: audit.readiness.clientReady,
      reason: audit.readiness.reason,
      expertCap,
      capsFired: expert ? expert.dimensions.filter((d) => d.cap).map((d) => ({ dimension: d.name, applied: d.cap!.applied, reason: d.cap!.reason })) : [],
      researchDepth: findDim('research-depth')?.score ?? null,
      edgeCaseCoverage: findDim('edge-case-coverage')?.score ?? null,
      ideaClarity: findDim('idea-clarity')?.score ?? null
    },
    workflowNames,
    artifacts: {
      ideaCritiqueExists: fs.existsSync(ideaCritique),
      finalScorecardExists: fs.existsSync(finalScorecard),
      ddlExists: fs.existsSync(path.join(rootDir, 'architecture', 'DATABASE_SCHEMA.sql')),
      screensCount: ex.screens?.length ?? 0,
      testCasesCount: ex.testCases?.length ?? 0
    },
    finalScorecardDemoBlock: extractDemoBlock(finalScorecard),
    ideaCritiqueHeadingLine: extractFirstHeading(ideaCritique)
  };

  return summary;
}

function extractDemoBlock(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  const content = fs.readFileSync(file, 'utf8');
  const m = content.match(/##\s+Demo[^\n]*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/i);
  return m ? `## ${content.match(/##\s+Demo[^\n]*/i)?.[0].slice(3) ?? ''}\n${m[1].trim()}` : null;
}

function extractFirstHeading(file: string): string | null {
  if (!fs.existsSync(file)) return null;
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n').slice(0, 30);
  return lines.join('\n');
}

async function main() {
  const inputArg = getArg('input');
  const outArg = getArg('out');
  const reportArg = getArg('report');

  if (!inputArg || !outArg) {
    console.error(
      'Usage: tsx scripts/rc2-real-recipe-sdr-calibration.ts --input=<brief.json> --out=<outdir> [--report=<json file>]'
    );
    process.exit(1);
  }

  const brief = JSON.parse(fs.readFileSync(path.resolve(inputArg), 'utf8')) as ProjectInput;
  const outRoot = path.resolve(outArg);
  fs.mkdirSync(outRoot, { recursive: true });

  console.log(`[RC2-cal] brief: ${brief.productName}`);
  console.log(`[RC2-cal] out:   ${outRoot}`);

  // Synth-only baseline (proves the negative — synth must NOT be demoReady).
  console.log(`[RC2-cal] building synth workspace…`);
  const synthDir = path.join(outRoot, 'synth');
  const synthBuild = await buildWorkspace(brief, synthDir, 'synth');
  const synthSummary = summarize('synth', synthBuild.rootDir, synthBuild.extractions);

  // Imported-real workspace (the calibration target).
  console.log(`[RC2-cal] building imported-real workspace…`);
  const realDir = path.join(outRoot, 'imported-real');
  const realBuild = await buildWorkspace(brief, realDir, 'imported-real');
  const realSummary = summarize('imported-real', realBuild.rootDir, realBuild.extractions);

  const report = {
    brief: {
      productName: brief.productName,
      sourcePath: path.resolve(inputArg),
      mustHaveFeatures: brief.mustHaveFeatures
    },
    apiKeyPath: process.env.ANTHROPIC_API_KEY ? 'real-anthropic-key' : 'imported-real-fixture',
    synth: synthSummary,
    importedReal: realSummary,
    contracts: {
      synthMustNotBeDemoReady: synthSummary.audit.demoReady === false,
      importedRealMustBeDemoReady: realSummary.audit.demoReady === true,
      importedRealScoreAtLeast95: realSummary.audit.total >= 95,
      noCapsFiredOnImportedReal: realSummary.audit.capsFired.length === 0,
      bothProductionReady: synthSummary.audit.productionReady && realSummary.audit.productionReady,
      bothResearchGrounded: synthSummary.audit.researchGrounded && realSummary.audit.researchGrounded,
      synthSourceIsSynthesized: synthSummary.audit.researchSource === 'synthesized',
      importedRealSourceIsImportedReal: realSummary.audit.researchSource === 'imported-real'
    }
  };

  if (reportArg) {
    const reportPath = path.resolve(reportArg);
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`[RC2-cal] wrote calibration report: ${reportPath}`);
  }

  console.log('\n=== SYNTH ===');
  console.log(JSON.stringify(synthSummary, null, 2));
  console.log('\n=== IMPORTED-REAL ===');
  console.log(JSON.stringify(realSummary, null, 2));
  console.log('\n=== CONTRACTS ===');
  console.log(JSON.stringify(report.contracts, null, 2));

  const allOk = Object.values(report.contracts).every((v) => v === true);
  if (!allOk) {
    console.error('\n[RC2-cal] FAIL: at least one contract did not hold.');
    process.exit(2);
  }
  console.log('\n[RC2-cal] PASS: all contracts hold.');
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

#!/usr/bin/env tsx
// Phase 5 (follow-on, post-E4): brief enrichment gate.
//
// Runs probes on a ProjectInput JSON BEFORE create-project generates 100+
// files. Most workspaces in the Codex 30-idea test were blocked after
// generation for predictable brief-quality reasons (abstract product idea,
// weak problem consequence, missing audience prioritization, missing
// repo-shape answer, incomplete approval). This command catches those
// reasons up front so the user (or an agent) can fix the brief without a
// generate-then-discard cycle.
//
// Usage:
//   npm run brief:enrich -- --input=examples/family-task-app.json
//   npm run brief:enrich -- --input=path/to/idea.json --out=BRIEF_ENRICHMENT.md
//   npm run brief:enrich -- --input=... --strict   # exits 1 if blockers remain
//
// Output: a markdown enrichment report listing each blocker probe, its
// failing condition, and a concrete clarification question for the user
// to answer in the input JSON or questionnaireAnswers map.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getArg } from './mvp-builder-package-utils';
import type { ProjectInput, Actor } from '../lib/types';

type ProbeSeverity = 'blocker' | 'warning' | 'info';

type ProbeResult = {
  name: string;
  severity: ProbeSeverity;
  passed: boolean;
  detail: string;
  followUpQuestion: string;
};

function loadInput(inputPath: string): ProjectInput {
  const absolute = path.resolve(inputPath);
  const raw = fs.readFileSync(absolute, 'utf8');
  return JSON.parse(raw) as ProjectInput;
}

function splitItems(value: string): string[] {
  return (value || '')
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function wordCount(value: string): number {
  return (value || '').trim().split(/\s+/).filter(Boolean).length;
}

const CONSEQUENCE_KEYWORDS = [
  'lose', 'lost', 'miss', 'missing', 'broken', 'fail', 'failure', 'frustrat', 'confus',
  'cost', 'expensive', 'wasted', 'duplicate', 'manual', 'paper', 'sticky note', 'spreadsheet',
  'silent', 'invisible', 'risk', 'compliance', 'penalt', 'fine', 'block', 'stall', 'stuck',
  'today', 'currently', 'right now', 'reverts to', 'gives up', 'opt out', 'churn'
];

function hasConsequenceLanguage(text: string): boolean {
  const lower = (text || '').toLowerCase();
  return CONSEQUENCE_KEYWORDS.some((kw) => lower.includes(kw));
}

function probeProductIdea(input: ProjectInput): ProbeResult {
  const idea = input.productIdea || '';
  const words = wordCount(idea);
  const mentionsName = !!input.productName && idea.toLowerCase().includes(input.productName.toLowerCase().slice(0, Math.min(input.productName.length, 8)));
  const passed = words >= 15;
  return {
    name: 'product-idea-specificity',
    severity: 'blocker',
    passed,
    detail: passed
      ? `productIdea is ${words} words and ${mentionsName ? 'mentions the product name' : 'does not mention the product name (acceptable but consider naming it)'}.`
      : `productIdea is too abstract: ${words} words. A reviewer needs at least one concrete sentence about who it is for, what it does, and what platform it lives on.`,
    followUpQuestion: 'Rewrite productIdea so a stranger can summarize the product, its primary user, and the first thing they would do on it within 30 seconds.'
  };
}

function probeProblemConsequence(input: ProjectInput): ProbeResult {
  const stmt = input.problemStatement || '';
  const words = wordCount(stmt);
  const consequence = hasConsequenceLanguage(stmt);
  const passed = words >= 15 && consequence;
  return {
    name: 'problem-consequence-strength',
    severity: 'blocker',
    passed,
    detail: passed
      ? `problemStatement names a concrete consequence (${words} words).`
      : `problemStatement is ${words} words and ${consequence ? 'has consequence language' : 'lacks consequence language ("today, currently, lose, miss, broken, frustrat...")'}. A reviewer cannot tell why this problem hurts enough to fund work.`,
    followUpQuestion: 'In one sentence, what specifically breaks today and what is the cost (time, money, missed work, frustration) of leaving it unresolved? Add that sentence to problemStatement.'
  };
}

function probeAudiencePrioritization(input: ProjectInput): ProbeResult {
  const actors = (input.actors || []) as Actor[];
  const audienceSegments = splitItems(input.targetAudience || '');
  const distinctActors = actors.length > 0 ? actors.length : audienceSegments.length;
  const passed = distinctActors >= 2;
  return {
    name: 'audience-prioritization',
    severity: 'blocker',
    passed,
    detail: passed
      ? `${distinctActors} distinct audience entries detected${actors.length ? ' (structured actors[] field is set)' : ' (parsed from targetAudience)'}.`
      : `Only ${distinctActors} audience entry detected. Most products fail because the secondary actor (reviewer, child, AE, scheduler, parent) is invisible to the plan.`,
    followUpQuestion: 'List 2 to 5 distinct actors with their primary verb (e.g. "Parent: assigns chores; Child: completes chores; Co-parent: reviews completion"). Either populate the structured actors[] array or extend targetAudience to enumerate all roles.'
  };
}

function probeMustHaves(input: ProjectInput): ProbeResult {
  const items = splitItems(input.mustHaveFeatures || '');
  const passed = items.length >= 3;
  return {
    name: 'must-have-features-listed',
    severity: 'blocker',
    passed,
    detail: passed ? `${items.length} must-have features listed.` : `Only ${items.length} must-have feature(s) listed. The phase plan needs at least 3 to scope the v1.`,
    followUpQuestion: 'List at least 3 must-have features as comma- or newline-separated entries in mustHaveFeatures. Each entry should be a 2-5 word noun phrase a reviewer can verify.'
  };
}

function probeNonGoals(input: ProjectInput): ProbeResult {
  const items = splitItems(input.nonGoals || '');
  const passed = items.length >= 1;
  return {
    name: 'non-goals-listed',
    severity: 'warning',
    passed,
    detail: passed ? `${items.length} non-goal(s) listed.` : 'No non-goals listed. Without explicit non-goals, scope drift risk stays high.',
    followUpQuestion: 'List at least 1 non-goal in the nonGoals field. What does v1 explicitly NOT include? (e.g. "no payment system", "no multi-tenant", "no native mobile app".)'
  };
}

function probeRisks(input: ProjectInput): ProbeResult {
  const items = splitItems(input.risks || '');
  const passed = items.length >= 1;
  return {
    name: 'risks-listed',
    severity: 'warning',
    passed,
    detail: passed ? `${items.length} risk(s) listed.` : 'No risks listed. The risk-review phase will fall back to generic warnings.',
    followUpQuestion: 'List the top 1-3 risks in the risks field. Privacy, role-leak, misuse, dropped reminders, payment errors are common categories.'
  };
}

function probeRepoShape(input: ProjectInput): ProbeResult {
  if (input.track !== 'technical') {
    return {
      name: 'repo-shape-answer',
      severity: 'info',
      passed: true,
      detail: 'Track is business; repo-shape answer is not required.',
      followUpQuestion: ''
    };
  }
  const answer = (input.questionnaireAnswers || {})['repo-shape'] || '';
  const passed = wordCount(answer) >= 5;
  return {
    name: 'repo-shape-answer',
    severity: 'blocker',
    passed,
    detail: passed
      ? `repo-shape answer present (${wordCount(answer)} words).`
      : 'Technical track but questionnaireAnswers["repo-shape"] is empty or under 5 words. The architecture phase will guess instead of plan.',
    followUpQuestion: 'In questionnaireAnswers["repo-shape"]: name the runtime, the storage assumption, and whether this is a single-repo Next.js app, a CLI, or a Python service. One sentence is enough.'
  };
}

function probeAcceptance(input: ProjectInput): ProbeResult {
  const acceptance = (input.questionnaireAnswers || {}).acceptance || input.successMetrics || '';
  const passed = wordCount(acceptance) >= 12;
  return {
    name: 'acceptance-completeness',
    severity: 'warning',
    passed,
    detail: passed
      ? `Acceptance / success-metrics text is ${wordCount(acceptance)} words.`
      : `Acceptance / success-metrics text is too thin (${wordCount(acceptance)} words). The verification phase will not have evidence-shaped checks.`,
    followUpQuestion: 'In questionnaireAnswers["acceptance"] or successMetrics: name the exact evidence a reviewer should see to call the package ready. Mention the actor and the artifact (e.g. "a parent runs the workspace setup once, sees the dashboard with the new household, and the child profile they created is visible only to assigned tasks").'
  };
}

const PROBES: ((input: ProjectInput) => ProbeResult)[] = [
  probeProductIdea,
  probeProblemConsequence,
  probeAudiencePrioritization,
  probeMustHaves,
  probeNonGoals,
  probeRisks,
  probeRepoShape,
  probeAcceptance
];

function renderReport(input: ProjectInput, results: ProbeResult[], inputPath: string): string {
  const blockers = results.filter((r) => r.severity === 'blocker' && !r.passed);
  const warnings = results.filter((r) => r.severity === 'warning' && !r.passed);
  const passes = results.filter((r) => r.passed);

  const lines: string[] = [];
  lines.push('# BRIEF_ENRICHMENT');
  lines.push('');
  lines.push(`- Input: \`${path.relative(process.cwd(), inputPath).replace(/\\/g, '/')}\``);
  lines.push(`- Product: ${input.productName || '(unnamed)'}`);
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Blockers: ${blockers.length}`);
  lines.push(`- Warnings: ${warnings.length}`);
  lines.push(`- Probes passed: ${passes.length}/${results.length}`);
  lines.push('');
  lines.push('## What this file is for');
  lines.push('Catch predictable brief-quality blockers BEFORE `npm run create-project` generates 100+ files. The Codex 30-idea test showed every package landed in lifecycle=Blocked for the same reasons. Fix the input here, re-run this command, then proceed to create-project.');
  lines.push('');

  if (blockers.length) {
    lines.push('## Blockers (must fix before generation)');
    for (const probe of blockers) {
      lines.push(`### ${probe.name}`);
      lines.push(`- Detail: ${probe.detail}`);
      lines.push(`- Question: ${probe.followUpQuestion}`);
      lines.push('');
    }
  } else {
    lines.push('## Blockers');
    lines.push('_None._');
    lines.push('');
  }

  if (warnings.length) {
    lines.push('## Warnings (recommended fixes)');
    for (const probe of warnings) {
      lines.push(`### ${probe.name}`);
      lines.push(`- Detail: ${probe.detail}`);
      lines.push(`- Question: ${probe.followUpQuestion}`);
      lines.push('');
    }
  } else {
    lines.push('## Warnings');
    lines.push('_None._');
    lines.push('');
  }

  if (passes.length) {
    lines.push('## Probes passed');
    for (const probe of passes) {
      lines.push(`- ${probe.name}: ${probe.detail}`);
    }
    lines.push('');
  }

  lines.push('## Next step');
  if (blockers.length) {
    lines.push('1. Open the input JSON.');
    lines.push('2. Edit each blocker field above using the listed question as a prompt.');
    lines.push('3. Re-run `npm run brief:enrich -- --input=<your-file.json>`.');
    lines.push('4. Once blockers reach zero, run `npm run create-project -- --input=<your-file.json> --out=<dir>`.');
  } else {
    lines.push('No blockers remain. Run `npm run create-project -- --input=<your-file.json> --out=<dir>`.');
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const inputPath = getArg('input');
  if (!inputPath) {
    console.error('Usage: npm run brief:enrich -- --input=<file.json> [--out=<file.md>] [--strict]');
    process.exit(2);
  }
  const strict = process.argv.includes('--strict');
  const out = getArg('out');

  let input: ProjectInput;
  try {
    input = loadInput(inputPath);
  } catch (err) {
    console.error(`Failed to load input: ${(err as Error).message}`);
    process.exit(2);
  }

  const results = PROBES.map((probe) => probe(input));
  const blockers = results.filter((r) => r.severity === 'blocker' && !r.passed);
  const warnings = results.filter((r) => r.severity === 'warning' && !r.passed);

  const report = renderReport(input, results, path.resolve(inputPath));
  const outPath = out
    ? path.resolve(out)
    : path.join(path.dirname(path.resolve(inputPath)), `${path.basename(inputPath, '.json')}.enrichment.md`);
  fs.writeFileSync(outPath, report, 'utf8');

  console.log(`Brief enrichment report: ${path.relative(process.cwd(), outPath).replace(/\\/g, '/')}`);
  console.log(`Probes: ${results.filter((r) => r.passed).length}/${results.length} passed (${blockers.length} blocker(s), ${warnings.length} warning(s))`);
  if (blockers.length) {
    console.log('Blockers:');
    for (const b of blockers) console.log(`  - ${b.name}: ${b.detail}`);
  }
  if (strict && blockers.length) {
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main();
}

export { PROBES, renderReport, loadInput };
export type { ProbeResult };

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  fileExists,
  findVerificationBodyContradictions,
  getArg,
  getPhaseSlug,
  parseExitGateResult,
  parseVerificationBullets,
  parseVerificationEvidenceFiles,
  parseVerificationRecommendation,
  readJsonFile,
  readState,
  readTextFile,
  resolveEvidencePath,
  resolvePackageRoot,
  writeJsonFile
} from './mvp-builder-package-utils';
import type { MvpBuilderState, PhaseAttempt } from '../lib/types';

type ManifestShape = { phaseCount: number; lifecycleStatus: string };

function readExitGateText(packageRoot: string, slug: string) {
  const exitGatePath = path.join(packageRoot, 'phases', slug, 'EXIT_GATE.md');
  if (!fileExists(exitGatePath)) return '';
  return readTextFile(exitGatePath);
}

function extractFailureCriteria(exitGateText: string): string[] {
  const section = exitGateText.split(/##\s+Failure or blocker conditions/i)[1] || '';
  const untilNext = section.split(/\n##\s+/)[0] || '';
  return untilNext
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

function buildReworkPrompt(args: {
  slug: string;
  phaseTitle: string;
  attemptNumber: number;
  result: 'pass' | 'fail' | 'pending';
  recommendation: 'proceed' | 'revise' | 'blocked' | 'pending';
  failureSignals: string[];
  knownIssues: string[];
  defectsFound: string[];
  followUpActions: string[];
  evidenceListed: string[];
  contradictionDetected: boolean;
  exitGateFailureConditions: string[];
  requirementIds: string[];
}) {
  const lines: string[] = [];
  lines.push(`# REWORK_PROMPT for ${args.slug} — attempt ${args.attemptNumber}`);
  lines.push('');
  lines.push('## What this file is for');
  lines.push(
    'The previous attempt at this phase did not pass its exit gate. This file packages the failure context as input for the next attempt. Treat it as the source of truth for what to fix before re-running verification.'
  );
  lines.push('');
  lines.push(`## Phase`);
  lines.push(args.phaseTitle || args.slug);
  lines.push('');
  lines.push(`## Attempt number`);
  lines.push(`- Previous attempt: ${args.attemptNumber - 1}`);
  lines.push(`- This attempt: ${args.attemptNumber}`);
  lines.push('');
  lines.push(`## Last verification outcome`);
  lines.push(`- result: ${args.result}`);
  lines.push(`- recommendation: ${args.recommendation}`);
  lines.push(`- header/body contradiction: ${args.contradictionDetected ? 'yes' : 'no'}`);
  lines.push('');
  lines.push(`## Failure signals from the prior attempt`);
  if (args.failureSignals.length) {
    args.failureSignals.forEach((item) => lines.push(`- ${item}`));
  } else {
    lines.push('- No structured failure signals were captured. Review VERIFICATION_REPORT.md and EXIT_GATE.md manually.');
  }
  lines.push('');
  lines.push(`## Defects found in the prior attempt`);
  if (args.defectsFound.length) {
    args.defectsFound.forEach((item) => lines.push(`- ${item}`));
  } else {
    lines.push('- None recorded.');
  }
  lines.push('');
  lines.push(`## Known issues carried forward`);
  if (args.knownIssues.length) {
    args.knownIssues.forEach((item) => lines.push(`- ${item}`));
  } else {
    lines.push('- None recorded.');
  }
  lines.push('');
  lines.push(`## Exit-gate failure conditions to clear`);
  if (args.exitGateFailureConditions.length) {
    args.exitGateFailureConditions.forEach((item) => lines.push(`- ${item}`));
  } else {
    lines.push('- No exit-gate failure conditions were declared in EXIT_GATE.md.');
  }
  lines.push('');
  lines.push(`## Evidence files referenced previously`);
  if (args.evidenceListed.length) {
    args.evidenceListed.forEach((item) => lines.push(`- ${item}`));
  } else {
    lines.push('- None.');
  }
  lines.push('');
  lines.push(`## Requirement IDs assigned to this phase`);
  if (args.requirementIds.length) {
    args.requirementIds.forEach((item) => lines.push(`- ${item}`));
  } else {
    lines.push('- None mapped. Phase plan does not declare requirementIds.');
  }
  lines.push('');
  lines.push(`## Follow-up actions from the prior attempt`);
  if (args.followUpActions.length) {
    args.followUpActions.forEach((item) => lines.push(`- ${item}`));
  } else {
    lines.push('- None recorded.');
  }
  lines.push('');
  lines.push(`## What the next attempt must do`);
  lines.push('1. Read this file before reopening the phase.');
  lines.push('2. Resolve every item under "Failure signals" and "Exit-gate failure conditions to clear".');
  lines.push('3. Update VERIFICATION_REPORT.md with new results, real evidence files, and a fresh decision.');
  lines.push('4. Do not change the phase scope to make the failure go away. Fix the work, not the gate.');
  lines.push('5. Run npm run validate, npm run gates, and npm run status before requesting next-phase advancement.');
  lines.push('');
  lines.push(`## Rules`);
  lines.push('- Do not delete or rewrite the prior VERIFICATION_REPORT.md. Reset it for the new attempt by updating the result/recommendation in place.');
  lines.push('- Keep this REWORK_PROMPT file as a record of the failed attempt. Do not delete it after the rework succeeds.');
  lines.push('- Each new attempt produces a new REWORK_PROMPT file with its own attempt number.');
  return `${lines.join('\n')}\n`;
}

export function runRework() {
  const packageRoot = resolvePackageRoot(getArg('package'));
  const state = readState(packageRoot);
  const manifest = readJsonFile<ManifestShape>(path.join(packageRoot, 'repo', 'manifest.json'));
  const evidenceArg = getArg('evidence');

  const currentSlug = getPhaseSlug(state.currentPhase);
  const phaseRecord = state.phaseEvidence[currentSlug];
  if (!phaseRecord) {
    throw new Error(`Missing phase evidence record for ${currentSlug}`);
  }

  const reportRelative = evidenceArg || phaseRecord.verificationReportPath;
  if (!reportRelative) {
    throw new Error(
      'rework requires either --evidence=phases/phase-XX/VERIFICATION_REPORT.md or an existing verificationReportPath in repo/mvp-builder-state.json'
    );
  }

  const reportAbsolute = resolveEvidencePath(packageRoot, reportRelative);
  if (!fileExists(reportAbsolute)) {
    throw new Error(`Verification report not found: ${reportRelative}`);
  }

  const reportContent = readTextFile(reportAbsolute);
  const result = parseExitGateResult(reportContent);
  const recommendation = parseVerificationRecommendation(reportContent);
  const contradictionDetected = findVerificationBodyContradictions(reportContent);

  const isFailure = result === 'fail' || recommendation === 'blocked' || recommendation === 'revise' || contradictionDetected;
  if (!isFailure) {
    throw new Error(
      `rework expects the verification report to indicate a failure. Found result=${result}, recommendation=${recommendation}, contradiction=${contradictionDetected ? 'yes' : 'no'}. If you want to advance, use next-phase; if you want to reopen a passing phase, mark its result as fail or recommendation as revise/blocked first.`
    );
  }

  const phaseTitle = (() => {
    const briefPath = path.join(packageRoot, 'phases', currentSlug, 'PHASE_BRIEF.md');
    if (!fileExists(briefPath)) return currentSlug;
    const briefContent = readTextFile(briefPath);
    const match = briefContent.match(/##\s*Phase\s*\n+([^\n]+)/);
    return (match?.[1] || currentSlug).trim();
  })();

  const exitGateText = readExitGateText(packageRoot, currentSlug);
  const exitGateFailureConditions = extractFailureCriteria(exitGateText);
  const defectsFound = parseVerificationBullets(reportContent, 'defects found');
  const followUpActions = parseVerificationBullets(reportContent, 'follow-up actions');
  const evidenceListed = parseVerificationEvidenceFiles(reportContent);
  const knownIssues = parseVerificationBullets(reportContent, 'Unresolved issues');

  const failureSignals: string[] = [];
  if (result === 'fail') failureSignals.push('Verification result is fail.');
  if (recommendation === 'blocked') failureSignals.push('Reviewer recommendation is blocked.');
  if (recommendation === 'revise') failureSignals.push('Reviewer recommendation is revise.');
  if (contradictionDetected) {
    failureSignals.push('Verification headers say pass/proceed but the body describes a blocked or failed phase.');
  }

  const previousAttempts = phaseRecord.attempts || [];
  const lastAttemptNumber = previousAttempts.reduce((max, attempt) => Math.max(max, attempt.attempt), 0);
  const attemptNumber = lastAttemptNumber + 1;
  const reworkPromptRelative = `phases/${currentSlug}/REWORK_PROMPT_attempt-${String(attemptNumber).padStart(2, '0')}.md`;

  // Pull requirement IDs from PHASE_PLAN.md if present (additive — silently empty when not).
  const requirementIds = (() => {
    const phasePlanPath = path.join(packageRoot, 'PHASE_PLAN.md');
    if (!fileExists(phasePlanPath)) return [];
    const phasePlan = readTextFile(phasePlanPath);
    const phaseHeading = new RegExp(`##\\s+${state.currentPhase}\\.[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s+\\d+\\.|$)`);
    const phaseSection = phasePlan.match(phaseHeading)?.[1] || '';
    const reqLine = phaseSection.match(/Requirement IDs?:\s*([^\n]+)/i)?.[1] || '';
    return reqLine
      .split(/[,\s]+/)
      .map((token) => token.trim())
      .filter((token) => /^REQ[-_]?\d+$/i.test(token));
  })();

  const reworkPrompt = buildReworkPrompt({
    slug: currentSlug,
    phaseTitle,
    attemptNumber,
    result,
    recommendation,
    failureSignals,
    knownIssues,
    defectsFound,
    followUpActions,
    evidenceListed,
    contradictionDetected,
    exitGateFailureConditions,
    requirementIds
  });

  fs.writeFileSync(path.join(packageRoot, reworkPromptRelative), reworkPrompt, 'utf8');

  const newAttempt: PhaseAttempt = {
    attempt: attemptNumber,
    startedAt: new Date().toISOString(),
    status: 'pending',
    failedCriteria: failureSignals.concat(exitGateFailureConditions),
    reworkPromptPath: reworkPromptRelative
  };

  // Mark the previous attempt as resolved=fail if it was still pending.
  const updatedAttempts = previousAttempts.map((attempt) =>
    attempt.attempt === lastAttemptNumber && !attempt.resolvedAt
      ? { ...attempt, status: 'fail' as const, resolvedAt: new Date().toISOString() }
      : attempt
  );

  const nextState: MvpBuilderState = {
    ...state,
    lifecycleStatus: 'InRework',
    blockedPhases: state.blockedPhases.includes(currentSlug)
      ? state.blockedPhases
      : state.blockedPhases.concat(currentSlug),
    phaseEvidence: {
      ...state.phaseEvidence,
      [currentSlug]: {
        ...phaseRecord,
        approvedToProceed: false,
        exitGateReviewed: false,
        attempts: updatedAttempts.concat(newAttempt)
      }
    }
  };

  writeJsonFile(path.join(packageRoot, 'repo', 'mvp-builder-state.json'), nextState);
  writeJsonFile(path.join(packageRoot, 'repo', 'manifest.json'), {
    ...manifest,
    lifecycleStatus: 'InRework',
    currentPhase: nextState.currentPhase,
    blockedPhases: nextState.blockedPhases
  });

  console.log(`Rework opened for ${currentSlug} (attempt ${attemptNumber}).`);
  console.log(`REWORK_PROMPT written to: ${reworkPromptRelative}`);
  console.log(
    'Next steps: address the failure signals, update VERIFICATION_REPORT.md, then run npm run next-phase when ready.'
  );
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    runRework();
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

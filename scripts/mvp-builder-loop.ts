#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileExists, getArg, readJsonFile, resolvePackageRoot, writeJsonFile } from './mvp-builder-package-utils';
import { runProbe } from './mvp-builder-probe';
import { runTestScripts } from './mvp-builder-test-scripts';

type LoopState = {
  iterations: Array<{
    iteration: number;
    startedAt: string;
    finishedAt: string;
    outcomeScore: number;
    target: number;
    probePassed: boolean;
    probeEvidence: string;
    testScriptsPassed: boolean;
    failingPhases: string[];
    stalledFromPrevious: boolean;
    fixPromptPath: string;
  }>;
  lastOutcomeScore: number;
  status: 'running' | 'converged' | 'stalled' | 'max-iterations' | 'aborted';
};

type LoopOptions = {
  packageRoot: string;
  target: number;
  maxIterations: number;
  skipStart: boolean;
  dryRunTestScripts: boolean;
};

const LOOP_STATE_RELATIVE = 'repo/mvp-builder-loop-state.json';

function readLoopState(packageRoot: string): LoopState {
  const filePath = path.join(packageRoot, LOOP_STATE_RELATIVE);
  if (!fileExists(filePath)) {
    return { iterations: [], lastOutcomeScore: 0, status: 'running' };
  }
  return readJsonFile<LoopState>(filePath);
}

function writeLoopState(packageRoot: string, state: LoopState) {
  writeJsonFile(path.join(packageRoot, LOOP_STATE_RELATIVE), state);
}

function calculateOutcomeScore(probePassed: boolean, testScriptsPassed: boolean, totalSteps: number, passedSteps: number) {
  if (probePassed && testScriptsPassed) return 100;
  let score = 0;
  if (probePassed) score += 50;
  if (totalSteps > 0) score += Math.round((passedSteps / totalSteps) * 50);
  return Math.min(100, score);
}

function buildFixPrompt(args: {
  iteration: number;
  outcomeScore: number;
  target: number;
  probeOutcome: Awaited<ReturnType<typeof runProbe>>;
  testScriptsOutcome: ReturnType<typeof runTestScripts>;
  stalled: boolean;
}): string {
  const { iteration, outcomeScore, target, probeOutcome, testScriptsOutcome, stalled } = args;
  const failingRoutes = probeOutcome.routes.filter((route) => !route.ok);
  const failingPhases = testScriptsOutcome.phases.filter((phase) => !phase.passed);

  const lines: string[] = [];
  lines.push(`# LOOP_FIX_PROMPT — iteration ${iteration}`);
  lines.push('');
  lines.push('## What this file is for');
  lines.push(
    'MVP Builder convergence loop ran outcome-based checks (HTTP probe and per-phase test scripts) and the result is below target. This file is the structured fix prompt for the next iteration.'
  );
  lines.push('');
  lines.push(`## Outcome score`);
  lines.push(`- This iteration: ${outcomeScore}/100`);
  lines.push(`- Target: ${target}/100`);
  lines.push(`- Stalled from previous iteration: ${stalled ? 'yes' : 'no'}`);
  lines.push('');
  lines.push(`## Probe outcome`);
  lines.push(`- Base URL: ${probeOutcome.baseUrl}`);
  lines.push(`- Start succeeded: ${probeOutcome.startSucceeded ? 'yes' : 'no'}`);
  lines.push(`- Probe passed: ${probeOutcome.passed ? 'yes' : 'no'}`);
  lines.push(`- Probe evidence: ${probeOutcome.evidencePath || 'n/a'}`);
  lines.push('');
  if (failingRoutes.length) {
    lines.push('### Failing routes');
    for (const route of failingRoutes) {
      lines.push(`- ${route.route} → status=${route.status ?? 'no response'}, error=${route.error || 'none'}`);
    }
    lines.push('');
  }
  if (probeOutcome.notes.length) {
    lines.push('### Probe notes');
    probeOutcome.notes.forEach((note) => lines.push(`- ${note}`));
    lines.push('');
  }
  lines.push(`## Test-scripts outcome`);
  lines.push(`- Phases attempted: ${testScriptsOutcome.phases.length}`);
  lines.push(`- Total steps: ${testScriptsOutcome.totalSteps}`);
  lines.push(`- Passed steps: ${testScriptsOutcome.passedSteps}`);
  lines.push(`- Skipped steps: ${testScriptsOutcome.skippedSteps}`);
  lines.push('');
  if (failingPhases.length) {
    lines.push('### Failing phases');
    for (const phase of failingPhases) {
      lines.push(`- ${phase.slug} (${phase.scriptPath})`);
      const failingSteps = phase.steps.filter((step) => !step.passed && !step.skipped);
      for (const step of failingSteps) {
        lines.push(`  - command: \`${step.command}\` exited with ${step.exitCode ?? 'no exit code'}`);
      }
    }
    lines.push('');
  }
  lines.push('## What the next iteration must do');
  lines.push('1. Read this file before making any changes.');
  lines.push('2. Resolve every failing route and every failing test-script step.');
  lines.push('3. If the failure points to UI behavior, follow BROWSER_AUTOMATION_GUIDE.md and capture browser evidence.');
  lines.push('4. Do not change RUNTIME_TARGET.md or test-script content to make the failure go away. Fix the application.');
  lines.push('5. After applying changes, re-run `npm run loop` to score the next iteration.');
  lines.push('');
  if (stalled) {
    lines.push('## Stall warning');
    lines.push(
      'The previous iteration produced the same outcome score as this one. If the next iteration also stalls, the loop will exit without converging and a human reviewer must triage.'
    );
    lines.push('');
  }
  lines.push('## Rules');
  lines.push('- Do not delete prior LOOP_FIX_PROMPT files. They are the trail of attempts.');
  lines.push('- The loop refuses to mark convergence unless probe passes and every test-script step passes.');
  lines.push('- Forbidden shell commands inside TEST_SCRIPT.md remain skipped; do not whitelist them.');
  return `${lines.join('\n')}\n`;
}

async function runOneIteration(options: LoopOptions, iteration: number, lastScore: number) {
  const probeOutcome = await runProbe();
  const testScriptsOutcome = runTestScripts();
  const outcomeScore = calculateOutcomeScore(
    probeOutcome.passed,
    testScriptsOutcome.passed,
    testScriptsOutcome.totalSteps,
    testScriptsOutcome.passedSteps
  );
  const stalled = iteration > 1 && outcomeScore === lastScore && outcomeScore < options.target;

  if (outcomeScore >= options.target) {
    return {
      outcomeScore,
      probeOutcome,
      testScriptsOutcome,
      stalled,
      fixPromptPath: ''
    };
  }

  const fixPrompt = buildFixPrompt({
    iteration,
    outcomeScore,
    target: options.target,
    probeOutcome,
    testScriptsOutcome,
    stalled
  });
  const evidenceDir = path.join(options.packageRoot, 'evidence', 'runtime');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const fixPromptPath = path.join(evidenceDir, `LOOP_FIX_PROMPT_iteration-${String(iteration).padStart(2, '0')}.md`);
  fs.writeFileSync(fixPromptPath, fixPrompt, 'utf8');
  return {
    outcomeScore,
    probeOutcome,
    testScriptsOutcome,
    stalled,
    fixPromptPath: path.relative(options.packageRoot, fixPromptPath).replace(/\\/g, '/')
  };
}

export async function runLoop() {
  const packageRoot = resolvePackageRoot(getArg('package'));
  const target = Number.parseInt(getArg('target') || '90', 10);
  const maxIterations = Number.parseInt(getArg('max-iterations') || '5', 10);
  const skipStartArg = (getArg('skip-start') || '').toLowerCase();
  const skipStart = skipStartArg === 'true' || skipStartArg === '1';
  const dryRunTestScriptsArg = (getArg('dry-run-test-scripts') || '').toLowerCase();
  const dryRunTestScripts = dryRunTestScriptsArg === 'true' || dryRunTestScriptsArg === '1';

  const state = readLoopState(packageRoot);
  let lastScore = state.lastOutcomeScore;

  for (let iteration = state.iterations.length + 1; iteration <= maxIterations; iteration += 1) {
    const startedAt = new Date().toISOString();
    const result = await runOneIteration({ packageRoot, target, maxIterations, skipStart, dryRunTestScripts }, iteration, lastScore);
    const finishedAt = new Date().toISOString();
    const failingPhases = result.testScriptsOutcome.phases.filter((phase) => !phase.passed).map((phase) => phase.slug);
    state.iterations.push({
      iteration,
      startedAt,
      finishedAt,
      outcomeScore: result.outcomeScore,
      target,
      probePassed: result.probeOutcome.passed,
      probeEvidence: result.probeOutcome.evidencePath,
      testScriptsPassed: result.testScriptsOutcome.passed,
      failingPhases,
      stalledFromPrevious: result.stalled,
      fixPromptPath: result.fixPromptPath
    });
    state.lastOutcomeScore = result.outcomeScore;
    if (result.outcomeScore >= target) {
      state.status = 'converged';
      writeLoopState(packageRoot, state);
      console.log(`Loop converged on iteration ${iteration} with outcome score ${result.outcomeScore}/${target}.`);
      return state;
    }
    if (result.stalled) {
      state.status = 'stalled';
      writeLoopState(packageRoot, state);
      console.log(
        `Loop stalled on iteration ${iteration}: outcome score ${result.outcomeScore} did not improve over ${lastScore}. Fix prompt: ${result.fixPromptPath}`
      );
      return state;
    }
    lastScore = result.outcomeScore;
    writeLoopState(packageRoot, state);
    console.log(
      `Iteration ${iteration} complete. Outcome score ${result.outcomeScore}/${target}. Fix prompt: ${result.fixPromptPath}`
    );
  }
  state.status = 'max-iterations';
  writeLoopState(packageRoot, state);
  console.log(`Loop hit max iterations (${maxIterations}) without converging. Last score ${state.lastOutcomeScore}/${target}.`);
  return state;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runLoop()
    .then((state) => {
      process.exitCode = state.status === 'converged' ? 0 : 1;
    })
    .catch((error) => {
      console.error((error as Error).message);
      process.exit(1);
    });
}

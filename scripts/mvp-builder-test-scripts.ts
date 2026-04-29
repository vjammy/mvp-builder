#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fileExists, getArg, getPhaseSlug, readState, readTextFile, resolvePackageRoot } from './mvp-builder-package-utils';

type TestScriptStep = {
  command: string;
  forbidden: boolean;
  reason?: string;
};

type PhaseRun = {
  slug: string;
  scriptPath: string;
  steps: Array<{
    command: string;
    skipped: boolean;
    skipReason?: string;
    exitCode: number | null;
    stdoutSnippet: string;
    stderrSnippet: string;
    durationMs: number;
    passed: boolean;
  }>;
  passed: boolean;
};

type TestScriptsOutcome = {
  startedAt: string;
  finishedAt: string;
  phases: PhaseRun[];
  passed: boolean;
  totalSteps: number;
  passedSteps: number;
  skippedSteps: number;
};

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+-rf\b/i, reason: 'rm -rf is destructive' },
  { pattern: /\bsudo\b/i, reason: 'sudo is not allowed' },
  { pattern: /\bcurl\b/i, reason: 'curl to arbitrary endpoints is blocked' },
  { pattern: /\bwget\b/i, reason: 'wget is blocked' },
  { pattern: /\bssh\b/i, reason: 'ssh is blocked' },
  { pattern: /\bscp\b/i, reason: 'scp is blocked' },
  { pattern: /\bnc\b/i, reason: 'nc is blocked' },
  { pattern: /:\(\)\s*\{/, reason: 'fork bomb shape blocked' },
  { pattern: /\bshutdown\b/i, reason: 'shutdown is blocked' },
  { pattern: /\bdd\s+if=/i, reason: 'dd is blocked' },
  { pattern: /\bmkfs/i, reason: 'mkfs is blocked' },
  { pattern: /\bchmod\s+(?:-R\s+)?7/i, reason: 'broad chmod is blocked' },
  { pattern: /\b\/dev\/sd[a-z]/i, reason: 'raw block device access blocked' },
  { pattern: />[\s]*\/etc\//i, reason: 'writes to /etc/ are blocked' },
  { pattern: /\bgit\s+push\s+(--force|-f)\b/i, reason: 'force push is blocked' },
  { pattern: /\bnpm\s+publish\b/i, reason: 'npm publish is blocked' },
  { pattern: /\bdocker\s+(rmi|rm|stop|kill)\b/i, reason: 'docker mutating commands blocked' }
];

function classifyCommand(command: string): { forbidden: boolean; reason?: string } {
  for (const entry of FORBIDDEN_PATTERNS) {
    if (entry.pattern.test(command)) {
      return { forbidden: true, reason: entry.reason };
    }
  }
  return { forbidden: false };
}

function extractCommandsFromTestScript(scriptContent: string): TestScriptStep[] {
  const steps: TestScriptStep[] = [];
  const fenceMatcher = /```(bash|sh|shell|zsh)?\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fenceMatcher.exec(scriptContent)) !== null) {
    const block = match[2];
    const lines = block.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith('#')) continue;
      const command = line.replace(/^\$\s+/, '').trim();
      if (!command) continue;
      const verdict = classifyCommand(command);
      steps.push({ command, forbidden: verdict.forbidden, reason: verdict.reason });
    }
  }
  return steps;
}

function runStep(command: string, cwd: string): { exitCode: number | null; stdout: string; stderr: string; durationMs: number } {
  const startedAt = Date.now();
  const isWindows = process.platform === 'win32';
  const result = spawnSync(command, {
    cwd,
    encoding: 'utf8',
    shell: isWindows ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh',
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024
  });
  return {
    exitCode: typeof result.status === 'number' ? result.status : null,
    stdout: (result.stdout || '').slice(0, 4096),
    stderr: (result.stderr || '').slice(0, 4096),
    durationMs: Date.now() - startedAt
  };
}

function renderEvidence(outcome: TestScriptsOutcome): string {
  const lines: string[] = [];
  lines.push(`# Test scripts run — ${outcome.passed ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push(`- Started at: ${outcome.startedAt}`);
  lines.push(`- Finished at: ${outcome.finishedAt}`);
  lines.push(`- Phases attempted: ${outcome.phases.length}`);
  lines.push(`- Total steps: ${outcome.totalSteps}`);
  lines.push(`- Passed steps: ${outcome.passedSteps}`);
  lines.push(`- Skipped steps: ${outcome.skippedSteps}`);
  lines.push('');
  for (const phase of outcome.phases) {
    lines.push(`## ${phase.slug} — ${phase.passed ? 'PASS' : 'FAIL'}`);
    lines.push('');
    lines.push(`Script: ${phase.scriptPath}`);
    lines.push('');
    if (phase.steps.length === 0) {
      lines.push('No executable shell commands found in TEST_SCRIPT.md.');
      lines.push('');
      continue;
    }
    lines.push('| # | Command | Status | Exit | Duration (ms) |');
    lines.push('| --- | --- | --- | --- | --- |');
    phase.steps.forEach((step, index) => {
      const status = step.skipped ? `skipped (${step.skipReason})` : step.passed ? 'pass' : 'fail';
      lines.push(
        `| ${index + 1} | \`${step.command.replace(/\|/g, '\\|')}\` | ${status} | ${step.exitCode ?? '—'} | ${step.durationMs} |`
      );
    });
    lines.push('');
    phase.steps.forEach((step, index) => {
      if (step.skipped) return;
      lines.push(`### ${phase.slug} — step ${index + 1}`);
      lines.push('');
      lines.push('```');
      lines.push(step.command);
      lines.push('```');
      if (step.stdoutSnippet.trim()) {
        lines.push('stdout:');
        lines.push('```');
        lines.push(step.stdoutSnippet.trim());
        lines.push('```');
      }
      if (step.stderrSnippet.trim()) {
        lines.push('stderr:');
        lines.push('```');
        lines.push(step.stderrSnippet.trim());
        lines.push('```');
      }
      lines.push('');
    });
  }
  return `${lines.join('\n')}\n`;
}

export function runTestScripts() {
  const packageRoot = resolvePackageRoot(getArg('package'));
  const phaseFilter = getArg('phase');
  const dryRunArg = (getArg('dry-run') || '').toLowerCase();
  const dryRun = dryRunArg === 'true' || dryRunArg === '1' || dryRunArg === 'yes';
  const state = readState(packageRoot);

  const phasesToRun = phaseFilter
    ? [phaseFilter]
    : state.completedPhases.length
      ? state.completedPhases
      : [getPhaseSlug(state.currentPhase)];

  const phaseRuns: PhaseRun[] = [];
  let totalSteps = 0;
  let passedSteps = 0;
  let skippedSteps = 0;

  for (const slug of phasesToRun) {
    const scriptPath = path.join(packageRoot, 'phases', slug, 'TEST_SCRIPT.md');
    if (!fileExists(scriptPath)) {
      phaseRuns.push({
        slug,
        scriptPath: path.relative(packageRoot, scriptPath).replace(/\\/g, '/'),
        steps: [],
        passed: false
      });
      continue;
    }
    const scriptContent = readTextFile(scriptPath);
    const steps = extractCommandsFromTestScript(scriptContent);
    const stepResults = steps.map((step) => {
      totalSteps += 1;
      if (step.forbidden) {
        skippedSteps += 1;
        return {
          command: step.command,
          skipped: true,
          skipReason: step.reason,
          exitCode: null,
          stdoutSnippet: '',
          stderrSnippet: '',
          durationMs: 0,
          passed: false
        };
      }
      if (dryRun) {
        skippedSteps += 1;
        return {
          command: step.command,
          skipped: true,
          skipReason: 'dry-run',
          exitCode: null,
          stdoutSnippet: '',
          stderrSnippet: '',
          durationMs: 0,
          passed: false
        };
      }
      const result = runStep(step.command, packageRoot);
      const passed = result.exitCode === 0;
      if (passed) passedSteps += 1;
      return {
        command: step.command,
        skipped: false,
        exitCode: result.exitCode,
        stdoutSnippet: result.stdout,
        stderrSnippet: result.stderr,
        durationMs: result.durationMs,
        passed
      };
    });

    const phasePassed = stepResults.length > 0 && stepResults.every((step) => step.passed || (step.skipped && step.skipReason === 'dry-run'));
    phaseRuns.push({
      slug,
      scriptPath: path.relative(packageRoot, scriptPath).replace(/\\/g, '/'),
      steps: stepResults,
      passed: phasePassed
    });
  }

  const startedAt = new Date().toISOString();
  const finishedAt = new Date().toISOString();
  const passed = phaseRuns.length > 0 && phaseRuns.every((phase) => phase.passed);
  const outcome: TestScriptsOutcome = {
    startedAt,
    finishedAt,
    phases: phaseRuns,
    passed,
    totalSteps,
    passedSteps,
    skippedSteps
  };

  const evidenceDir = path.join(packageRoot, 'evidence', 'runtime');
  fs.mkdirSync(evidenceDir, { recursive: true });
  const stamp = outcome.startedAt.replace(/[:.]/g, '-');
  const filePath = path.join(evidenceDir, `test-scripts-${stamp}.md`);
  fs.writeFileSync(filePath, renderEvidence(outcome), 'utf8');
  fs.writeFileSync(path.join(evidenceDir, 'last-test-scripts.json'), `${JSON.stringify(outcome, null, 2)}\n`, 'utf8');
  console.log(`Test scripts ${outcome.passed ? 'PASS' : 'FAIL'} — phases=${phaseRuns.length} steps=${totalSteps} pass=${passedSteps} skip=${skippedSteps}`);
  console.log(`Evidence: ${path.relative(packageRoot, filePath).replace(/\\/g, '/')}`);
  return outcome;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  try {
    const outcome = runTestScripts();
    process.exitCode = outcome.passed ? 0 : 1;
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}

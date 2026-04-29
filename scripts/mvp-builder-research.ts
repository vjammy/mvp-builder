#!/usr/bin/env node
/**
 * CLI: run the 10-pass research loop for a brief and write the artifacts to a workspace.
 *
 *   npm run research -- --input=examples/family-task-app.json --out=.tmp-research/family
 *   npm run research -- --input=brief.json --provider=mock --fixtures=test/fixtures/family.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runResearchLoop } from '../lib/research/loop';
import { writeResearchToWorkspace } from '../lib/research/persistence';
import { MockResearchProvider, loadAnthropicProvider, type ResearchProvider } from '../lib/research/providers';
import { baseProjectInput } from '../lib/templates';
import type { ProjectInput } from '../lib/types';

function getArg(name: string) {
  const exact = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return exact ? exact.slice(name.length + 3) : undefined;
}

function loadInput(inputPath?: string): ProjectInput {
  if (!inputPath) return baseProjectInput();
  const absolute = path.resolve(inputPath);
  const raw = fs.readFileSync(absolute, 'utf8');
  const parsed = JSON.parse(raw) as Partial<ProjectInput>;
  const base = baseProjectInput();
  return {
    ...base,
    ...parsed,
    questionnaireAnswers: { ...base.questionnaireAnswers, ...(parsed.questionnaireAnswers ?? {}) }
  };
}

async function selectProvider(): Promise<ResearchProvider> {
  const which = getArg('provider') ?? (process.env.ANTHROPIC_API_KEY ? 'anthropic-sdk' : 'mock');
  if (which === 'anthropic-sdk') {
    return loadAnthropicProvider({});
  }
  if (which === 'mock') {
    const fixturesPath = getArg('fixtures');
    if (!fixturesPath) {
      throw new Error('Mock provider requires --fixtures=<path-to-fixtures.json>.');
    }
    const fixtures = JSON.parse(fs.readFileSync(path.resolve(fixturesPath), 'utf8'));
    return new MockResearchProvider(fixtures);
  }
  throw new Error(`Unknown provider: ${which}. Use anthropic-sdk or mock.`);
}

async function main() {
  const input = loadInput(getArg('input'));
  const out = getArg('out') ?? '.tmp-research';
  const maxPasses = Number(getArg('max-passes') ?? '10');
  const provider = await selectProvider();

  console.log(`[research] provider=${provider.name} maxPasses=${maxPasses}`);
  console.log(`[research] brief="${input.productName}"`);

  const result = await runResearchLoop({ brief: input, provider, maxPasses });

  console.log(
    `[research] use-case: ${result.useCase.passes.length} passes, final ${result.useCase.finalScore}/100${
      result.useCase.convergedEarly ? ' (converged)' : result.useCase.stalled ? ' (stalled)' : ''
    }`
  );
  console.log(
    `[research] domain:   ${result.domain.passes.length} passes, final ${result.domain.finalScore}/100${
      result.domain.convergedEarly ? ' (converged)' : result.domain.stalled ? ' (stalled)' : ''
    }`
  );
  console.log(`[research] tokens used: ${result.totalTokensUsed}`);

  const workspaceRoot = path.resolve(out, 'mvp-builder-workspace');
  fs.mkdirSync(workspaceRoot, { recursive: true });
  writeResearchToWorkspace(workspaceRoot, result);
  console.log(`[research] written to ${workspaceRoot}/research/`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

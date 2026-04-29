/**
 * 10-pass research loop driver.
 *
 * Runs use-case and domain research as separate independent loops. Each loop
 * alternates researcher → critic. Loop stops on:
 *   - critic verdict 'converged' (totalScore >= 90, no critical gaps), or
 *   - critic verdict 'stalled' (score improvement < 5 over previous pass), or
 *   - hard cap MAX_PASSES.
 *
 * The driver is provider-agnostic — the same code path works with the
 * Anthropic SDK provider, a Claude Code session provider, or a mock provider
 * for tests.
 */

import { createHash } from 'node:crypto';
import type { ProjectInput } from '../types';
import type { CritiqueResult, ResearchExtractions } from './schema';
import { SCHEMA_VERSION } from './schema';
import type { ResearchProvider } from './providers';
import type { ResearchTopic } from './prompts';

export const MAX_PASSES = 10;
export const MIN_PASSES = 2;
export const CONVERGENCE_THRESHOLD = 90;
export const STALL_DELTA = 5;
export const DEFAULT_TOKEN_CAP = 200_000;

export type PassRecord = {
  pass: number;
  markdown: string;
  critique: CritiqueResult;
  tokensUsed: number;
  durationMs: number;
};

export type TopicResult = {
  topic: ResearchTopic;
  passes: PassRecord[];
  finalMarkdown: string;
  finalScore: number;
  convergedEarly: boolean;
  stalled: boolean;
};

export type LoopResult = {
  briefHash: string;
  startedAt: string;
  completedAt: string;
  useCase: TopicResult;
  domain: TopicResult;
  extractions: ResearchExtractions;
  totalTokensUsed: number;
};

export function hashBrief(brief: ProjectInput): string {
  // Hash only the user-authored fields. Whitespace-normalized so cosmetic
  // edits don't bust the cache.
  const normalized = JSON.stringify(
    {
      productName: brief.productName.trim(),
      productIdea: brief.productIdea.trim().replace(/\s+/g, ' '),
      targetAudience: brief.targetAudience.trim().replace(/\s+/g, ' '),
      problemStatement: brief.problemStatement.trim().replace(/\s+/g, ' '),
      mustHaveFeatures: brief.mustHaveFeatures.trim().replace(/\s+/g, ' '),
      niceToHaveFeatures: brief.niceToHaveFeatures.trim().replace(/\s+/g, ' '),
      dataAndIntegrations: brief.dataAndIntegrations.trim().replace(/\s+/g, ' '),
      constraints: brief.constraints.trim().replace(/\s+/g, ' '),
      nonGoals: brief.nonGoals.trim().replace(/\s+/g, ' ')
    },
    Object.keys({}).sort()
  );
  return createHash('sha256').update(normalized).digest('hex');
}

async function runOneTopic(
  topic: ResearchTopic,
  brief: ProjectInput,
  provider: ResearchProvider,
  maxPasses: number,
  tokenBudgetRemaining: { value: number }
): Promise<TopicResult> {
  const passes: PassRecord[] = [];
  let previousResearch: string | undefined;
  let previousCritique: CritiqueResult | undefined;
  let convergedEarly = false;
  let stalled = false;

  for (let pass = 1; pass <= maxPasses; pass++) {
    if (tokenBudgetRemaining.value <= 0) {
      stalled = true;
      break;
    }
    const passStart = Date.now();
    const research = await provider.runResearchPass({
      topic,
      pass,
      totalPasses: maxPasses,
      brief,
      previousResearch,
      previousCritique
    });

    const critique = await provider.runCritiquePass({
      topic,
      pass,
      totalPasses: maxPasses,
      brief,
      passOutput: research.markdown,
      previousScore: previousCritique?.totalScore
    });

    const totalTokens = research.tokensUsed + critique.tokensUsed;
    tokenBudgetRemaining.value -= totalTokens;

    passes.push({
      pass,
      markdown: research.markdown,
      critique: critique.critique,
      tokensUsed: totalTokens,
      durationMs: Date.now() - passStart
    });

    // L1: even if pass 1 reports 'converged', force a confirmation pass. The second
    // pass uses the critic's gaps as scope and can either stay at the same score
    // (true convergence) or surface what pass 1 missed.
    const aboveThreshold =
      critique.critique.verdict === 'converged' || critique.critique.totalScore >= CONVERGENCE_THRESHOLD;
    if (aboveThreshold && pass >= MIN_PASSES) {
      convergedEarly = true;
      break;
    }
    if (critique.critique.verdict === 'stalled' && pass >= MIN_PASSES) {
      stalled = true;
      break;
    }

    previousResearch = research.markdown;
    previousCritique = critique.critique;
  }

  const best = [...passes].sort((a, b) => b.critique.totalScore - a.critique.totalScore)[0]!;
  return {
    topic,
    passes,
    finalMarkdown: best.markdown,
    finalScore: best.critique.totalScore,
    convergedEarly,
    stalled
  };
}

export async function runResearchLoop(args: {
  brief: ProjectInput;
  provider: ResearchProvider;
  maxPasses?: number;
  maxTotalTokens?: number;
}): Promise<LoopResult> {
  const startedAt = new Date().toISOString();
  const briefHash = hashBrief(args.brief);
  const cap = args.maxPasses ?? MAX_PASSES;
  // Token budget shared across both topics; mutated as passes run so a runaway
  // researcher in one topic can't deplete budget for the other before alarm.
  const tokenBudgetRemaining = { value: args.maxTotalTokens ?? DEFAULT_TOKEN_CAP };

  // Run both topics in parallel — they're independent.
  const [useCase, domain] = await Promise.all([
    runOneTopic('use-case', args.brief, args.provider, cap, tokenBudgetRemaining),
    runOneTopic('domain', args.brief, args.provider, cap, tokenBudgetRemaining)
  ]);

  const totalPassTokens =
    useCase.passes.reduce((s, p) => s + p.tokensUsed, 0) +
    domain.passes.reduce((s, p) => s + p.tokensUsed, 0);

  // Produce structured extractions from the converged narratives.
  const extractionRun = await args.provider.runExtraction({
    brief: args.brief,
    useCaseResearch: useCase.finalMarkdown,
    domainResearch: domain.finalMarkdown,
    meta: {
      briefHash,
      schemaVersion: SCHEMA_VERSION,
      startedAt,
      completedAt: new Date().toISOString(),
      totalPasses: { useCase: useCase.passes.length, domain: domain.passes.length },
      finalCriticScores: { useCase: useCase.finalScore, domain: domain.finalScore },
      convergedEarly: { useCase: useCase.convergedEarly, domain: domain.convergedEarly },
      totalTokensUsed: totalPassTokens,
      modelUsed: args.provider.name === 'mock' ? 'mock' : 'claude-sonnet-4-6',
      researcher: args.provider.name
    }
  });

  return {
    briefHash,
    startedAt,
    completedAt: new Date().toISOString(),
    useCase,
    domain,
    extractions: extractionRun.extractions,
    totalTokensUsed: totalPassTokens + extractionRun.tokensUsed
  };
}

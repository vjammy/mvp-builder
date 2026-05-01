/**
 * Provider abstraction so the research loop can run via:
 *  - Anthropic SDK (production) — needs ANTHROPIC_API_KEY + web tool
 *  - Claude Code session (this conversation) — uses host's WebSearch/WebFetch
 *  - Mock (tests + cached fixtures)
 *
 * Each provider implements the same two operations: produce a research markdown
 * pass, and produce a critic JSON for a given pass.
 */

import type { ProjectInput } from '../types';
import type { CritiqueResult, ResearchExtractions } from './schema';
import type { ResearchTopic } from './prompts';

export type ProviderName = 'anthropic-sdk' | 'claude-code-session' | 'mock';

export type ResearchPassRequest = {
  topic: ResearchTopic;
  pass: number;
  totalPasses: number;
  brief: ProjectInput;
  previousResearch?: string;
  previousCritique?: CritiqueResult;
};

export type CritiquePassRequest = {
  topic: ResearchTopic;
  pass: number;
  totalPasses: number;
  brief: ProjectInput;
  passOutput: string;
  previousScore?: number;
};

export type ExtractionRequest = {
  brief: ProjectInput;
  useCaseResearch: string;
  domainResearch: string;
  meta: ResearchExtractions['meta'];
};

export interface ResearchProvider {
  readonly name: ProviderName;
  runResearchPass(req: ResearchPassRequest): Promise<{ markdown: string; tokensUsed: number }>;
  runCritiquePass(req: CritiquePassRequest): Promise<{ critique: CritiqueResult; tokensUsed: number }>;
  runExtraction(req: ExtractionRequest): Promise<{ extractions: ResearchExtractions; tokensUsed: number }>;
}

// ---------- Mock provider — fixture-driven, deterministic ----------

export type MockFixtures = {
  research: Partial<Record<`${ResearchTopic}-pass-${number}`, string>>;
  critique: Partial<Record<`${ResearchTopic}-pass-${number}`, CritiqueResult>>;
  extractions: ResearchExtractions;
};

export class MockResearchProvider implements ResearchProvider {
  readonly name: ProviderName = 'mock';
  constructor(private fixtures: MockFixtures) {}

  async runResearchPass(req: ResearchPassRequest) {
    const key: `${ResearchTopic}-pass-${number}` = `${req.topic}-pass-${req.pass}`;
    const md = this.fixtures.research[key];
    if (!md) throw new Error(`MockResearchProvider: no fixture for ${key}`);
    return { markdown: md, tokensUsed: 0 };
  }

  async runCritiquePass(req: CritiquePassRequest) {
    const key: `${ResearchTopic}-pass-${number}` = `${req.topic}-pass-${req.pass}`;
    const c = this.fixtures.critique[key];
    if (!c) throw new Error(`MockResearchProvider: no critique fixture for ${key}`);
    return { critique: c, tokensUsed: 0 };
  }

  async runExtraction(_req: ExtractionRequest) {
    return { extractions: this.fixtures.extractions, tokensUsed: 0 };
  }
}

// ---------- Anthropic SDK provider — for non-interactive runs ----------

/**
 * The SDK provider is loaded lazily so that environments without
 * @anthropic-ai/sdk installed can still run the framework with the mock
 * provider or the claude-code-session provider.
 */
export async function loadAnthropicProvider(opts: {
  apiKey?: string;
  authToken?: string;
  model?: string;
}): Promise<ResearchProvider> {
  // Two auth modes: a raw ANTHROPIC_API_KEY, or an OAuth bearer token (used when
  // mvp-builder is invoked from inside a Claude Code / Codex / OpenCode session
  // where the host already has a managed token). Pass --auth-token=$CLAUDE_CODE_OAUTH_TOKEN
  // or set CLAUDE_CODE_OAUTH_TOKEN in the environment for the agent path.
  const apiKey = opts.apiKey ?? (process.env.ANTHROPIC_API_KEY || '');
  const authToken = opts.authToken ?? (process.env.CLAUDE_CODE_OAUTH_TOKEN || '');
  if (!apiKey && !authToken) {
    throw new Error(
      'Anthropic provider requires ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN. The agent path uses the OAuth token; the standalone path uses the API key.'
    );
  }
  const model = opts.model ?? 'claude-sonnet-4-6';

  // SDK is loaded dynamically and type-erased so the framework type-checks
  // even when @anthropic-ai/sdk isn't installed (mock-only environments).
  let SDK: { default: new (opts: { apiKey?: string; authToken?: string }) => unknown };
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SDK = (await import('@anthropic-ai/sdk' as any)) as typeof SDK;
  } catch {
    throw new Error(
      'Anthropic provider requested but @anthropic-ai/sdk is not installed. Run `npm install @anthropic-ai/sdk` and retry.'
    );
  }

  // Prefer an explicit api key; fall back to OAuth. Pass apiKey: null explicitly
  // when using OAuth because the SDK auto-reads ANTHROPIC_API_KEY from env even
  // when it's an empty string, which then conflicts with the auth token.
  const clientOpts = apiKey
    ? ({ apiKey, authToken: null as unknown as string } as { apiKey: string; authToken: string })
    : ({ apiKey: null as unknown as string, authToken } as { apiKey: string; authToken: string });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = new SDK.default(clientOpts) as any;

  const { researcherPrompt, criticPrompt, extractionPrompt } = await import('./prompts');

  return {
    name: 'anthropic-sdk',
    async runResearchPass(req) {
      const prompt = researcherPrompt(req);
      const response = await client.messages.create({
        model,
        max_tokens: 8000,
        // Web tool name and shape may evolve; keep this minimal and explicit
        // so a follow-up can wire the latest server-side tools.
        messages: [{ role: 'user', content: prompt }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 12 } as never]
      });
      const markdown = response.content
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join('\n');
      return { markdown, tokensUsed: response.usage.input_tokens + response.usage.output_tokens };
    },
    async runCritiquePass(req) {
      const prompt = criticPrompt(req);
      const response = await client.messages.create({
        model,
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }]
      });
      const text = response.content
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join('\n')
        .trim();
      const json = stripFences(text);
      const critique = JSON.parse(json) as CritiqueResult;
      return { critique, tokensUsed: response.usage.input_tokens + response.usage.output_tokens };
    },
    async runExtraction(req) {
      const prompt = extractionPrompt(req);
      const response = await client.messages.create({
        model,
        max_tokens: 12000,
        messages: [{ role: 'user', content: prompt }]
      });
      const text = response.content
        .filter((b: { type: string }) => b.type === 'text')
        .map((b: { text: string }) => b.text)
        .join('\n')
        .trim();
      const json = stripFences(text);
      const extractions = JSON.parse(json) as ResearchExtractions;
      // Overwrite meta fields the prompt asked us not to invent.
      extractions.meta = { ...extractions.meta, ...req.meta };
      return { extractions, tokensUsed: response.usage.input_tokens + response.usage.output_tokens };
    }
  };
}

function stripFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]+?)\s*```/);
  return (fenced ? fenced[1] : text).trim();
}

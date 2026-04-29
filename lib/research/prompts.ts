/**
 * Prompts for the 10-pass research loop.
 *
 * The researcher prompts are written for an LLM with WebSearch + WebFetch tools.
 * The critic prompts return strict JSON matching CritiqueResult.
 */

import type { ProjectInput } from '../types';
import type { CritiqueResult } from './schema';

export type ResearchTopic = 'use-case' | 'domain';

const SHARED_RESEARCHER_RULES = `
RESEARCH RULES — non-negotiable:
1. Cite every non-trivial claim with a SourceRef: full URL + a verbatim quote (1–3 sentences).
2. Quotes must be copied character-for-character from the source. No paraphrase. No invention.
3. Prefer primary sources (vendor docs, regulations, standards bodies, official case studies) over blog posts.
4. Prefer sources from the last 3 years unless the topic is regulatory/standards-based.
5. If you cannot verify a claim, say "uncertain — no primary source found" rather than guessing.
6. Output a single full Markdown document per pass — not a delta. This pass is the new canonical research.
7. If a previous pass and critique are provided, treat the critique's gaps as your scope for this pass. Address them, don't repeat the previous draft.
8. Hard cap: at most 12 web operations (search + fetch combined) per pass.
`;

export function researcherPrompt(args: {
  topic: ResearchTopic;
  pass: number;
  totalPasses: number;
  brief: ProjectInput;
  previousResearch?: string;
  previousCritique?: CritiqueResult;
}): string {
  const focus =
    args.topic === 'use-case'
      ? `USE-CASE RESEARCH for the specific product idea below. Focus on:
- Direct competitors and adjacent products. What do they do? What do they charge? What do users complain about?
- Validated user pain — quotes from forums, reviews, case studies, talks. Real users in their own words.
- Specific implementation pitfalls reported by builders in this space.
- Tech-stack patterns observed across the competitor set.
- Real-world success and failure metrics where available.`
      : `DOMAIN RESEARCH for the broader industry the product sits in. Focus on:
- Regulatory landscape that applies (HIPAA, FERPA, SOC 2, PCI, accessibility law, state-specific rules, etc.).
- Industry standards and protocols that the product MUST or SHOULD speak (FHIR, OAuth, OpenID, schema.org, etc.).
- Canonical actors, entities, and workflows in this domain.
- Common integration vendors and their typical failure modes.
- Hard gates the industry expects (audit, retention, isolation, accessibility, vendor BAAs).
- Domain-specific risks beyond what the brief mentions.`;

  const previousContext = args.previousResearch
    ? `\n\nPREVIOUS PASS (pass ${args.pass - 1}):\n${args.previousResearch.slice(0, 6000)}`
    : '';

  const critiqueContext = args.previousCritique
    ? `\n\nCRITIQUE OF PREVIOUS PASS:
- Total score: ${args.previousCritique.totalScore}/100
- Verdict: ${args.previousCritique.verdict}
- Gaps to address THIS pass:
${args.previousCritique.gaps
  .map((g) => `  - [${g.severity}] ${g.area}: ${g.instruction}`)
  .join('\n')}
${
  args.previousCritique.redactionsRequired.length > 0
    ? `\nREDACT these citations from the previous pass — they failed verification:\n${args.previousCritique.redactionsRequired
        .map((s) => `  - ${s.url}`)
        .join('\n')}`
    : ''
}`
    : '';

  return `You are conducting Pass ${args.pass} of ${args.totalPasses} of ${args.topic.toUpperCase()} research for an MVP planning document.

${focus}

${SHARED_RESEARCHER_RULES}

PROJECT BRIEF:
- Name: ${args.brief.productName}
- Idea: ${args.brief.productIdea}
- Audience: ${args.brief.targetAudience}
- Problem: ${args.brief.problemStatement}
- Must-have features: ${args.brief.mustHaveFeatures}
- Constraints: ${args.brief.constraints}
- Non-goals: ${args.brief.nonGoals}
- Risks the brief acknowledges: ${args.brief.risks}
${previousContext}
${critiqueContext}

OUTPUT — a single Markdown document with this structure:

# ${args.topic === 'use-case' ? 'Use-Case Research' : 'Domain Research'}: ${args.brief.productName}

## 1. ${args.topic === 'use-case' ? 'Competitor scan' : 'Regulatory landscape'}
## 2. ${args.topic === 'use-case' ? 'Validated user pain (with quotes)' : 'Industry standards and protocols'}
## 3. ${args.topic === 'use-case' ? 'Implementation pitfalls' : 'Canonical actors, entities, workflows'}
## 4. ${args.topic === 'use-case' ? 'Tech-stack patterns' : 'Common integration vendors'}
## 5. ${args.topic === 'use-case' ? 'Success/failure metrics' : 'Hard gates the industry expects'}
## 6. ${args.topic === 'use-case' ? 'Anti-features (what these products typically DO NOT do)' : 'Domain-specific risks'}
## 7. Conflicts with the brief (if any)

Each section MUST contain at least one cited claim. Citations inline as: \`[SOURCE: url | "quoted snippet"]\`.

Now run your research and produce the document.
`;
}

export function criticPrompt(args: {
  topic: ResearchTopic;
  pass: number;
  totalPasses: number;
  brief: ProjectInput;
  passOutput: string;
  previousScore?: number;
}): string {
  return `You are evaluating Pass ${args.pass} of ${args.topic.toUpperCase()} research for an MVP planning document.

Score the research on six axes (each 0..100), then return a JSON object exactly matching this TypeScript shape:

\`\`\`ts
type CritiqueResult = {
  pass: number;
  topic: 'use-case' | 'domain';
  scores: {
    coverage: number;            // does it cover all required sections substantively?
    citationDensity: number;     // does every non-trivial claim cite a real URL with a verbatim quote?
    specificity: number;         // is the language domain-specific or generic placeholder?
    recency: number;             // are sources recent enough? regulatory work can use older sources
    internalConsistency: number; // do claims contradict each other?
    briefAlignment: number;      // does the research speak to the actual brief, not a near-miss?
  };
  totalScore: number;            // weighted: coverage*0.25 + citationDensity*0.20 + specificity*0.20 + recency*0.10 + internalConsistency*0.10 + briefAlignment*0.15
  verdict: 'converged' | 'continue' | 'stalled';
  gaps: Array<{
    area: string;
    severity: 'critical' | 'important' | 'minor';
    instruction: string;          // a SPECIFIC next-search instruction the researcher can act on
  }>;
  redactionsRequired: Array<{
    url: string; title: string; quote: string; fetchedAt: string;
  }>;
};
\`\`\`

VERDICT RULES:
- 'converged' if totalScore >= 90 AND no gap of severity 'critical'
- 'stalled' if previousScore is provided and totalScore - previousScore < 5 (no material progress)
- 'continue' otherwise

GAPS RULES:
- Be specific. Bad: "more sources." Good: "find a primary FHIR R4 spec citation for the Observation resource."
- A gap with severity 'critical' means the research has a load-bearing claim with no source, or a source that contradicts itself.
- Cap at 8 gaps total. The researcher's next pass has 12 web ops budget; don't exceed it.

REDACTIONS:
- If you can't verify a citation (URL doesn't exist, quote not in the source, source is paywalled with no quote), include it in redactionsRequired so the next pass drops it.

PROJECT BRIEF (for briefAlignment scoring):
- Name: ${args.brief.productName}
- Idea: ${args.brief.productIdea}
- Audience: ${args.brief.targetAudience}
- Problem: ${args.brief.problemStatement}
- Must-haves: ${args.brief.mustHaveFeatures}

PASS OUTPUT TO CRITIQUE:
${args.passOutput}

${args.previousScore !== undefined ? `PREVIOUS PASS SCORE: ${args.previousScore}` : 'This is the first pass.'}

Return ONLY the JSON object. No prose, no markdown fences. Just the JSON.
`;
}

export function extractionPrompt(args: {
  brief: ProjectInput;
  useCaseResearch: string;
  domainResearch: string;
}): string {
  return `You are converting two research markdown documents into structured JSON extractions for an MVP planning generator.

Read the use-case research and the domain research below. Produce a single JSON object exactly matching this TypeScript shape (no extra fields):

\`\`\`ts
type ResearchExtractions = {
  meta: { briefHash: string; schemaVersion: '0.2'; startedAt: string; completedAt: string;
    totalPasses: { useCase: number; domain: number };
    finalCriticScores: { useCase: number; domain: number };
    convergedEarly: { useCase: boolean; domain: boolean };
    totalTokensUsed: number;
    modelUsed: string;
    researcher: 'anthropic-sdk' | 'claude-code-session' | 'mock';
  };
  actors: Actor[];
  entities: Entity[];
  workflows: Workflow[];
  integrations: Integration[];
  risks: Risk[];
  gates: Gate[];
  antiFeatures: AntiFeature[];
  conflicts: Conflict[];
  removed: [];
};
\`\`\`

(Full type definitions in lib/research/schema.ts — every item must include id, origin: 'use-case'|'domain'|'both', evidenceStrength: 'strong'|'moderate'|'weak', sources: SourceRef[], firstSeenInPass: number, updatedInPass: number.)

EXTRACTION RULES:
- Every item carries SourceRef[] copied verbatim from the research markdown's citations. Never invent sources.
- evidenceStrength: 'strong' if 3+ independent sources agree, 'moderate' if 2, 'weak' if 1.
- popularity (Integration only): 'dominant' if 3+ sources call it the default, 'common' if 1-2, 'niche' if 0.
- All actor/entity/gate ids referenced from elsewhere MUST appear in the corresponding list.
- conflicts MUST be set with severity AND resolution (NOT 'pending'). If you can't decide resolution, use 'ambiguous'.
- For risks with mandatedGate, the gate id must exist in gates[].

Set meta fields conservatively from the research markdown headers if they exist; leave others as placeholders that the loop runner will overwrite.

PROJECT BRIEF:
${JSON.stringify(args.brief, null, 2)}

USE-CASE RESEARCH:
${args.useCaseResearch}

DOMAIN RESEARCH:
${args.domainResearch}

Return ONLY the JSON object.
`;
}

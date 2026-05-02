/**
 * Generate product-strategy/IDEA_CRITIQUE.md from research extractions.
 * Sources: meta.discovery.ideaCritique + meta.discovery.competingAlternatives
 *          + meta.researchSource (RC2: explicit provenance — synth output
 *          gets a clear limitation notice; real research gets a fully
 *          rendered critique).
 *
 * Phase E4 / RC2 audit dimension `idea-clarity` rewards non-empty critique
 * only when researchSource is not 'synthesized'.
 */
import type { ResearchExtractions } from '../research/schema';
import { getResearchSource } from '../research/schema';

export function renderIdeaCritiqueMarkdown(ex: ResearchExtractions): string {
  const critique = ex.meta.discovery?.ideaCritique ?? [];
  const alternatives = ex.meta.discovery?.competingAlternatives ?? [];
  const source = getResearchSource(ex.meta);
  const isSynth = source === 'synthesized';

  if (isSynth) {
    // Synthesized research: don't pretend to critique a brief. Tell the agent
    // exactly how to upgrade to a real critique and what's missing.
    return `# IDEA_CRITIQUE

> ⚠️ **This is NOT a real product critique.** It was generated from deterministic synthesized research (\`meta.researchSource === 'synthesized'\`). The synthesizer does not call an LLM and cannot critique a brief honestly — anything it produced here would be hollow restatement.

## How to populate this file with real critique

1. Run **docs/RESEARCH_RECIPE.md** inside an LLM-driven coding agent (Claude Code, Codex, Kimi, OpenCode).
2. The recipe's **Pass 0** is the brief-critique pass: it produces \`ideaCritique[]\` and \`competingAlternatives[]\` with concrete weak spots, mitigations, and named alternatives the audience could pick instead.
3. Save the agent's research output under \`<dir>/research/extracted/\`.
4. Regenerate the workspace with \`--research-from=<dir>\`.

## Why this matters

Synthesized research proves the schema, generator, audit, and file-emission paths work end-to-end (regression-grade). It does **not** prove the product idea is sound. The audit's \`idea-clarity\` dimension does not credit synthesized critique, and the \`demoReady\` flag will remain \`false\` until real research populates this file.

## Open questions the agent should answer in Pass 0

- What are the 3-5 strongest weak spots in this brief? (answer goes in \`ideaCritique[]\`)
- Which named competitors / status-quo workarounds could the audience pick instead? (answer goes in \`competingAlternatives[]\`)
- For each weak spot: what's the smallest mitigation that doesn't bloat scope?
- Is the value proposition concrete enough that a target user would pay (or switch) for it?
- What's the cheapest alternative the audience already has — and is this product clearly better?

## What this file MUST contain after a real-recipe run

- [ ] At least 3 \`ideaCritique\` weak-spots, each with a non-generic \`mitigation\`
- [ ] At least 1 \`competingAlternatives\` entry with a non-generic \`whyInsufficient\`
- [ ] Concrete adoption-risk language (not "users may not like it")
- [ ] No invented competitors (only ones the brief or research actually surface)
`;
  }

  // Real research path (agent-recipe, imported-real, manual): render actual content.
  const critiqueBlock = critique.length
    ? critique
        .map((c, i) => `### Weak spot ${i + 1}

- **What's risky:** ${c.weakSpot}
- **How to mitigate:** ${c.mitigation}`)
        .join('\n\n')
    : `_No idea-critique points extracted. Either the brief is unusually airtight or Pass 0 of docs/RESEARCH_RECIPE.md needs another iteration. Re-run with explicit gap-targeting before treating the workspace as demo-ready._`;

  const alternativesBlock = alternatives.length
    ? alternatives
        .map(
          (a, i) =>
            `### Alternative ${i + 1}: ${a.name}

- Why insufficient: ${a.whyInsufficient}`
        )
        .join('\n\n')
    : `_No competing alternatives recorded. Verify before claiming "no good options exist." Pass 0 should always name at least one — even if it's "paper + spreadsheet"._`;

  return `# IDEA_CRITIQUE

> Generated from real research extractions (\`meta.researchSource === '${source}'\`). The point of this file is to surface weak spots in the brief itself — before phase work begins — and to record how each weak spot will be mitigated. Do not start phase 1 until every weak spot has either a mitigation plan or an explicit decision to accept the risk.

## Weak spots in the brief

${critiqueBlock}

## Competing alternatives the audience could choose instead

${alternativesBlock}

## Adoption risks to surface in OPEN_QUESTIONS.md

- For each weak spot: is the mitigation funded in a phase, or deferred?
- For each alternative: does the value proposition explain *why* the audience would switch?
- What's the cheapest alternative the audience already has — and how will they discover this product is better?

## Open questions for the human to answer before phase 1

- [ ] Is each weak spot above acknowledged with a decision (mitigate, accept, defer)?
- [ ] If "accept": is the failure mode it leaves open documented in \`requirements/REQUIREMENTS_RISK_REVIEW.md\`?
- [ ] If "defer": is the decision recorded with a date for revisitation?
- [ ] For each competing alternative: does our value proposition explain why it's not enough? If not, the value prop needs another iteration.
- [ ] Does the brief justify investment vs. the cheapest alternative (paper + spreadsheet)? If no, phase work is risky.
`;
}

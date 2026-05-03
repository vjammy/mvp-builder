// E4 content-quality probes. Loaded by mvp-builder-autoresearch.ts; run against
// each generated workspace to produce a per-probe score that actually measures
// content diversity (unlike the legacy rubric that checked only file presence).

import fs from 'node:fs';
import path from 'node:path';

export type ProbeConfig = {
  name: string;
  max: number;
  inspect: string[];
  extract: string;
  rule: string;
  // Rule-specific knobs (optional, depends on rule):
  min?: number | Record<string, number>;
  minUnique?: number;
  maxStddev?: number;
};

export type ProbeCap = {
  when: string;
  max: number;
  label?: string;
};

export type ProbeRubric = {
  version: number;
  description?: string;
  probes: ProbeConfig[];
  caps: ProbeCap[];
};

export type ProbeResult = {
  name: string;
  max: number;
  score: number;
  ratio: number;
  notes: string[];
  details: Record<string, unknown>;
};

export type ProbeReport = {
  probes: ProbeResult[];
  artifactQuality: number;
  totalMax: number;
  triggeredCaps: string[];
  capLabel?: string;
  finalScore: number;
};

function readFileSafe(packageRoot: string, relative: string): string {
  const full = path.join(packageRoot, relative);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : '';
}

// ---------------------------------------------------------------------------
// Extractors. Each one returns a typed structure used by a rule.
// ---------------------------------------------------------------------------

type ExtractedActorIds = { reqIds: string[]; actorIdByReq: Record<string, string>; uniqueActors: string[] };
type ExtractedVerbs = { firstVerbs: string[] };
type ExtractedFailureCases = { lines: string[] };
type ExtractedScreenPurposes = { purposes: string[] };
type ExtractedWorkflowScreenActor = {
  workflows: { name: string; targetUser: string; screens: string[] }[];
  screens: { name: string; primaryUser: string }[];
};
type ExtractedSamplesByActor = {
  // entityName → { actorId → { happy, negative, boundary, rolePermission counts } }
  byEntity: Record<string, { happy: number; negative: number; boundary: number; rolePermission: number; actors: Record<string, number> }>;
  reqActorIds: Record<string, string>;
};
type ExtractedReqIdsPerPhase = { phases: { slug: string; phaseType?: string; count: number }[] };
type ExtractedDomainKeywords = { hits: number; totalKeywords: number; missing: string[] };
type ExtractedSampleCategoryCounts = { byEntity: Record<string, { happy: number; negative: number; boundary: number; rolePermission: number }> };

function extractActorIdLines(packageRoot: string, _config: ProbeConfig): ExtractedActorIds {
  const content = readFileSafe(packageRoot, 'requirements/FUNCTIONAL_REQUIREMENTS.md');
  const reqHeadings = Array.from(content.matchAll(/##\s*Requirement\s+(\d+):/gi)).map((m) => `REQ-${m[1]}`);
  const actorRegex = /^- Actor ID:\s*([^\n]+)/gm;
  const actorMatches = Array.from(content.matchAll(actorRegex)).map((m) => m[1].trim().toLowerCase());
  const actorIdByReq: Record<string, string> = {};
  for (let i = 0; i < reqHeadings.length; i++) {
    if (actorMatches[i]) actorIdByReq[reqHeadings[i]] = actorMatches[i];
  }
  const uniqueActors = Array.from(new Set(actorMatches));
  return { reqIds: reqHeadings, actorIdByReq, uniqueActors };
}

function extractUserActionFirstVerbs(packageRoot: string): ExtractedVerbs {
  const content = readFileSafe(packageRoot, 'requirements/FUNCTIONAL_REQUIREMENTS.md');
  const userActionLines = Array.from(content.matchAll(/^- User action:\s*([^\n]+)/gm)).map((m) => m[1].trim());
  const firstVerbs = userActionLines
    .map((line) => {
      // Strip leading actor noun ("The user", "Parent Admin"), then take first verb.
      const tokens = line.split(/\s+/).filter(Boolean);
      // Heuristic: first lowercase verb-shaped token.
      for (const tok of tokens) {
        const lower = tok.toLowerCase().replace(/[^a-z]/g, '');
        if (!lower) continue;
        if (['the', 'a', 'an'].includes(lower)) continue;
        // Skip common actor-name nouns (Parent, SDR, etc.) by length and capitalization.
        if (tok[0] === tok[0].toUpperCase() && lower.length > 1 && !/^[a-z]+s$/.test(lower)) continue;
        return lower;
      }
      return tokens[0]?.toLowerCase().replace(/[^a-z]/g, '') || '';
    })
    .filter(Boolean);
  return { firstVerbs };
}

function extractFailureCaseLines(packageRoot: string): ExtractedFailureCases {
  const fr = readFileSafe(packageRoot, 'requirements/FUNCTIONAL_REQUIREMENTS.md');
  const ac = readFileSafe(packageRoot, 'requirements/ACCEPTANCE_CRITERIA.md');
  const failures = Array.from(fr.matchAll(/^- Failure case:\s*([^\n]+)/gm)).map((m) => m[1].trim().toLowerCase());
  const negatives = Array.from(ac.matchAll(/^- Negative case:\s*([^\n]+)/gm)).map((m) => m[1].trim().toLowerCase());
  return { lines: [...failures, ...negatives] };
}

function extractScreenPurposes(packageRoot: string): ExtractedScreenPurposes {
  const content = readFileSafe(packageRoot, 'ui-ux/SCREEN_INVENTORY.md');
  const purposes = Array.from(content.matchAll(/^- Purpose:\s*([^\n]+)/gm)).map((m) => m[1].trim().toLowerCase());
  return { purposes };
}

function extractWorkflowScreenActorMap(packageRoot: string): ExtractedWorkflowScreenActor {
  const wfContent = readFileSafe(packageRoot, 'ui-ux/USER_WORKFLOWS.md');
  const screensContent = readFileSafe(packageRoot, 'ui-ux/SCREEN_INVENTORY.md');
  const workflows: ExtractedWorkflowScreenActor['workflows'] = [];
  const wfBlocks = wfContent.split(/\n##\s+/).slice(1);
  for (const block of wfBlocks) {
    const name = block.split('\n')[0].trim();
    const target = block.match(/^- Target user:\s*([^\n]+)/m)?.[1].trim() || '';
    const required = block.match(/^- Required screens:\s*([^\n]+)/m)?.[1].trim() || '';
    const screens = required.split(',').map((s) => s.trim()).filter(Boolean);
    workflows.push({ name, targetUser: target, screens });
  }
  const screens: ExtractedWorkflowScreenActor['screens'] = [];
  const screenBlocks = screensContent.split(/\n##\s+/).slice(1);
  for (const block of screenBlocks) {
    const name = block.split('\n')[0].trim();
    const primaryUser = block.match(/^- Primary user:\s*([^\n]+)/m)?.[1].trim() || '';
    screens.push({ name, primaryUser });
  }
  return { workflows, screens };
}

function extractSamplesByActor(packageRoot: string): ExtractedSamplesByActor {
  const content = readFileSafe(packageRoot, 'SAMPLE_DATA.md');
  const sections = content.split(/\n##\s+/).slice(1);
  const byEntity: ExtractedSamplesByActor['byEntity'] = {};
  const reqActorIds: Record<string, string> = {};
  for (const section of sections) {
    const headerLine = section.split('\n')[0].trim();
    if (!headerLine || /^What|^How to|^Naming|^Update/i.test(headerLine)) continue;
    const entityName = headerLine;
    const usedByLine = section.match(/Used by requirements:\s*([^\n]+)/i)?.[1] || '';
    const reqTokenRegex = /REQ-(\d+)(?:\s*\(([^)]+)\))?/gi;
    let match: RegExpExecArray | null;
    while ((match = reqTokenRegex.exec(usedByLine)) !== null) {
      if (match[2]) reqActorIds[`REQ-${match[1]}`] = match[2].trim().toLowerCase();
    }
    const counts = { happy: 0, negative: 0, boundary: 0, rolePermission: 0, actors: {} as Record<string, number> };
    const sampleHeadings = Array.from(section.matchAll(/^### Sample\s+([a-z-]+):/gim));
    for (const heading of sampleHeadings) {
      const cat = heading[1].toLowerCase();
      if (cat === 'happy') counts.happy += 1;
      else if (cat === 'negative') counts.negative += 1;
      else if (cat === 'boundary') counts.boundary += 1;
      else if (cat === 'role-permission') counts.rolePermission += 1;
    }
    // Per-actor counts: scan for `- Actor: <id>` lines following a `### Sample` heading.
    const actorMatches = Array.from(section.matchAll(/^- Actor:\s*([^\n]+)/gm)).map((m) => m[1].trim().toLowerCase());
    for (const a of actorMatches) {
      counts.actors[a] = (counts.actors[a] || 0) + 1;
    }
    byEntity[entityName] = counts;
  }
  return { byEntity, reqActorIds };
}

function extractReqIdsPerPhase(packageRoot: string): ExtractedReqIdsPerPhase {
  const content = readFileSafe(packageRoot, 'PHASE_PLAN.md');
  const phaseBlocks = content.split(/\n##\s+/).slice(1);
  const phases: ExtractedReqIdsPerPhase['phases'] = [];
  for (const block of phaseBlocks) {
    const heading = block.split('\n')[0].trim();
    if (/^Risks|^Package status/i.test(heading)) continue;
    const slugMatch = heading.match(/^(\d+)\./);
    const slug = slugMatch ? `phase-${String(slugMatch[1]).padStart(2, '0')}` : heading;
    const reqLine = block.match(/Requirement IDs:\s*([^\n]+)/i)?.[1] || '';
    const reqs = reqLine.split(',').map((s) => s.trim()).filter((s) => /^REQ-\d+$/i.test(s));
    const phaseType = block.match(/^- Phase type:\s*([^\n]+)/m)?.[1].trim();
    phases.push({ slug, phaseType, count: reqs.length });
  }
  return { phases };
}

function extractDomainKeywordHits(packageRoot: string): ExtractedDomainKeywords {
  // Read the input.json to get the must-have features and product name.
  const inputPath = path.join(packageRoot, 'repo', 'input.json');
  if (!fs.existsSync(inputPath)) return { hits: 0, totalKeywords: 0, missing: [] };
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as { productName: string; mustHaveFeatures: string };
  const keywords = [
    input.productName,
    ...(input.mustHaveFeatures || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 6)
  ];
  const corpus = [
    readFileSafe(packageRoot, 'PROJECT_BRIEF.md'),
    readFileSafe(packageRoot, 'PHASE_PLAN.md'),
    readFileSafe(packageRoot, 'HANDOFF.md'),
    readFileSafe(packageRoot, 'requirements/ACCEPTANCE_CRITERIA.md')
  ].join('\n').toLowerCase();
  let hits = 0;
  const missing: string[] = [];
  for (const kw of keywords) {
    if (!kw) continue;
    if (corpus.includes(kw.toLowerCase())) hits += 1;
    else missing.push(kw);
  }
  return { hits, totalKeywords: keywords.length, missing };
}

function extractSampleCategoryCounts(packageRoot: string): ExtractedSampleCategoryCounts {
  const ext = extractSamplesByActor(packageRoot);
  const byEntity: ExtractedSampleCategoryCounts['byEntity'] = {};
  for (const [name, c] of Object.entries(ext.byEntity)) {
    byEntity[name] = { happy: c.happy, negative: c.negative, boundary: c.boundary, rolePermission: c.rolePermission };
  }
  return { byEntity };
}

const extractors: Record<string, (packageRoot: string, config: ProbeConfig) => unknown> = {
  actorIdLines: extractActorIdLines,
  userActionFirstVerbs: (root) => extractUserActionFirstVerbs(root),
  failureCaseLines: (root) => extractFailureCaseLines(root),
  screenPurposes: (root) => extractScreenPurposes(root),
  workflowScreenActorMap: (root) => extractWorkflowScreenActorMap(root),
  samplesByActor: (root) => extractSamplesByActor(root),
  reqIdsPerPhase: (root) => extractReqIdsPerPhase(root),
  domainKeywordHits: (root) => extractDomainKeywordHits(root),
  sampleCategoryCounts: (root) => extractSampleCategoryCounts(root)
};

// ---------------------------------------------------------------------------
// Rules. Each rule consumes an extractor's output and returns a ProbeResult.
// ---------------------------------------------------------------------------

function ruleUniqueRatio(extracted: unknown, config: ProbeConfig): { ratio: number; notes: string[]; details: Record<string, unknown> } {
  // Accept any of the shapes the extractors above produce; treat them as a list.
  let total = 0;
  let unique = 0;
  let listForReport: string[] = [];
  if ((extracted as ExtractedActorIds).uniqueActors) {
    const x = extracted as ExtractedActorIds;
    total = x.reqIds.length;
    unique = x.uniqueActors.length;
    listForReport = x.uniqueActors;
  } else if ((extracted as ExtractedVerbs).firstVerbs) {
    const x = extracted as ExtractedVerbs;
    total = x.firstVerbs.length;
    unique = new Set(x.firstVerbs).size;
    listForReport = Array.from(new Set(x.firstVerbs));
  } else if ((extracted as ExtractedFailureCases).lines) {
    const x = extracted as ExtractedFailureCases;
    total = x.lines.length;
    unique = new Set(x.lines).size;
  } else if ((extracted as ExtractedScreenPurposes).purposes) {
    const x = extracted as ExtractedScreenPurposes;
    total = x.purposes.length;
    unique = new Set(x.purposes).size;
  }
  const minUnique = config.minUnique;
  const minRatio = typeof config.min === 'number' ? config.min : 0;
  const ratio = total ? unique / total : 0;
  const notes: string[] = [];
  let scoreFraction = ratio;
  if (typeof minUnique === 'number' && unique < minUnique) {
    scoreFraction = Math.max(0, (unique / minUnique) * 0.5); // partial credit when below minimum
    notes.push(`Only ${unique} unique values; needed ${minUnique}.`);
  } else if (ratio < minRatio) {
    scoreFraction = Math.max(0, ratio / Math.max(minRatio, 0.0001) * 0.5);
    notes.push(`Unique ratio ${(ratio * 100).toFixed(0)}% below threshold ${(minRatio * 100).toFixed(0)}%.`);
  }
  return {
    ratio: scoreFraction,
    notes,
    details: { total, unique, sample: listForReport.slice(0, 8) }
  };
}

function ruleConsistencyCheck(extracted: unknown): { ratio: number; notes: string[]; details: Record<string, unknown> } {
  const x = extracted as ExtractedWorkflowScreenActor;
  const screenUserMap = new Map<string, string>();
  for (const s of x.screens) screenUserMap.set(s.name.toLowerCase(), s.primaryUser);
  let consistent = 0;
  let total = 0;
  const mismatches: string[] = [];
  for (const wf of x.workflows) {
    for (const screenName of wf.screens) {
      total += 1;
      const screenUser = screenUserMap.get(screenName.toLowerCase()) || '';
      const wfUser = wf.targetUser.toLowerCase();
      if (screenUser.toLowerCase().includes(wfUser) || wfUser.includes(screenUser.toLowerCase())) {
        consistent += 1;
      } else {
        mismatches.push(`${wf.name}'s ${screenName} → screen primary user "${screenUser}" vs workflow target "${wf.targetUser}"`);
      }
    }
  }
  const ratio = total ? consistent / total : 1;
  return {
    ratio,
    notes: mismatches.slice(0, 6),
    details: { totalPairs: total, consistentPairs: consistent }
  };
}

function rulePerActorMin(extracted: unknown, config: ProbeConfig): { ratio: number; notes: string[]; details: Record<string, unknown> } {
  const x = extracted as ExtractedSamplesByActor;
  const min = (config.min as Record<string, number>) || {};
  const actorIds = new Set<string>(Object.values(x.reqActorIds));
  if (!actorIds.size) {
    return { ratio: 0, notes: ['No actor IDs found on REQ usage lines; cannot evaluate per-actor coverage.'], details: { actorIds: [] } };
  }
  // For each actor, ensure at least `min.happy` happy + `min.negative` negative samples exist anywhere across entities the actor touches.
  let actorScores = 0;
  const detail: Record<string, unknown> = {};
  for (const actor of actorIds) {
    const entitiesForActor = Object.entries(x.byEntity).filter(([, counts]) => counts.actors[actor] || true);
    const happy = entitiesForActor.reduce((s, [, c]) => s + c.happy, 0);
    const negative = entitiesForActor.reduce((s, [, c]) => s + c.negative, 0);
    const happyOk = happy >= (min.happy || 0);
    const negativeOk = negative >= (min.negative || 0);
    actorScores += (happyOk ? 1 : 0) + (negativeOk ? 1 : 0);
    detail[actor] = { happy, negative, happyOk, negativeOk };
  }
  const denominator = actorIds.size * (Object.keys(min).length || 2);
  const ratio = actorScores / denominator;
  return { ratio, notes: [], details: { actors: Array.from(actorIds), perActor: detail } };
}

function ruleStddevBelow(extracted: unknown, config: ProbeConfig): { ratio: number; notes: string[]; details: Record<string, unknown> } {
  const x = extracted as ExtractedReqIdsPerPhase;
  const counts = x.phases
    .filter((p) => !p.phaseType || p.phaseType === 'implementation' || p.phaseType === 'design')
    .map((p) => p.count);
  if (!counts.length) return { ratio: 0, notes: ['No design/implementation phases detected.'], details: { counts } };
  const mean = counts.reduce((s, n) => s + n, 0) / counts.length;
  const variance = counts.reduce((s, n) => s + Math.pow(n - mean, 2), 0) / counts.length;
  const stddev = Math.sqrt(variance);
  const maxStddev = config.maxStddev || 4;
  // ratio: 1.0 if stddev<=maxStddev, scales down to 0 at 2*maxStddev.
  const ratio = stddev <= maxStddev ? 1 : Math.max(0, 1 - (stddev - maxStddev) / maxStddev);
  return { ratio, notes: stddev > maxStddev ? [`stddev ${stddev.toFixed(2)} exceeds threshold ${maxStddev}.`] : [], details: { mean, stddev, counts } };
}

function ruleThresholdHits(extracted: unknown, config: ProbeConfig): { ratio: number; notes: string[]; details: Record<string, unknown> } {
  const x = extracted as ExtractedDomainKeywords;
  const min = typeof config.min === 'number' ? config.min : 4;
  const ratio = Math.min(1, x.hits / Math.max(min, 1));
  return { ratio, notes: x.missing.length ? [`Missing keywords: ${x.missing.slice(0, 4).join(', ')}`] : [], details: { hits: x.hits, total: x.totalKeywords } };
}

function rulePerCategoryMin(extracted: unknown, config: ProbeConfig): { ratio: number; notes: string[]; details: Record<string, unknown> } {
  const x = extracted as ExtractedSampleCategoryCounts;
  const min = (config.min as Record<string, number>) || {};
  const entries = Object.entries(x.byEntity);
  if (!entries.length) return { ratio: 0, notes: ['No SAMPLE_DATA entities parsed.'], details: {} };
  let satisfied = 0;
  const requiredKeys = Object.keys(min);
  const perEntity: Record<string, Record<string, boolean>> = {};
  for (const [name, counts] of entries) {
    const status: Record<string, boolean> = {};
    let ok = 0;
    for (const k of requiredKeys) {
      const got = (counts as Record<string, number>)[k] || 0;
      status[k] = got >= (min[k] || 0);
      if (status[k]) ok += 1;
    }
    perEntity[name] = status;
    satisfied += ok;
  }
  const denominator = entries.length * requiredKeys.length;
  const ratio = denominator ? satisfied / denominator : 0;
  // Special case: probe passes when ANY entity satisfies the minimums (not all).
  const anyEntitySatisfies = Object.values(perEntity).some((s) => requiredKeys.every((k) => s[k]));
  const finalRatio = Math.max(ratio, anyEntitySatisfies ? 1 : 0);
  return {
    ratio: finalRatio,
    notes: anyEntitySatisfies ? [] : ['No entity has both boundary and rolePermission samples.'],
    details: { perEntity }
  };
}

const rules: Record<string, (extracted: unknown, config: ProbeConfig) => { ratio: number; notes: string[]; details: Record<string, unknown> }> = {
  uniqueRatio: ruleUniqueRatio,
  consistencyCheck: (extracted) => ruleConsistencyCheck(extracted),
  perActorMin: rulePerActorMin,
  stddevBelow: ruleStddevBelow,
  thresholdHits: ruleThresholdHits,
  perCategoryMin: rulePerCategoryMin
};

// ---------------------------------------------------------------------------
// Cap evaluator. Caps are simple "<probeName> == 0" or "<probeName> < N" expressions.
// ---------------------------------------------------------------------------

function evaluateCap(when: string, probesByName: Record<string, ProbeResult>): boolean {
  const eq = when.match(/^([\w-]+)\s*==\s*([\d.]+)$/);
  const lt = when.match(/^([\w-]+)\s*<\s*([\d.]+)$/);
  if (eq) {
    const r = probesByName[eq[1]];
    return r ? r.score === Number(eq[2]) : false;
  }
  if (lt) {
    const r = probesByName[lt[1]];
    return r ? r.score < Number(lt[2]) : false;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public runner.
// ---------------------------------------------------------------------------

export function loadProbeRubric(rubricPath: string): ProbeRubric {
  const raw = fs.readFileSync(rubricPath, 'utf8');
  return JSON.parse(raw) as ProbeRubric;
}

export function runProbes(packageRoot: string, rubric: ProbeRubric): ProbeReport {
  const probes: ProbeResult[] = [];
  for (const config of rubric.probes) {
    const extractor = extractors[config.extract];
    const rule = rules[config.rule];
    if (!extractor || !rule) {
      probes.push({
        name: config.name,
        max: config.max,
        score: 0,
        ratio: 0,
        notes: [`Missing extractor (${config.extract}) or rule (${config.rule}); skipped.`],
        details: {}
      });
      continue;
    }
    try {
      const extracted = extractor(packageRoot, config);
      const { ratio, notes, details } = rule(extracted, config);
      const score = Math.round(Math.max(0, Math.min(1, ratio)) * config.max);
      probes.push({ name: config.name, max: config.max, score, ratio, notes, details });
    } catch (err) {
      probes.push({
        name: config.name,
        max: config.max,
        score: 0,
        ratio: 0,
        notes: [`Probe failed: ${(err as Error).message}`],
        details: {}
      });
    }
  }
  const probesByName: Record<string, ProbeResult> = {};
  for (const p of probes) probesByName[p.name] = p;
  const artifactQuality = probes.reduce((sum, p) => sum + p.score, 0);
  const totalMax = probes.reduce((sum, p) => sum + p.max, 0);

  let cap: number | null = null;
  let capLabel: string | undefined;
  const triggeredCaps: string[] = [];
  for (const c of rubric.caps || []) {
    if (evaluateCap(c.when, probesByName)) {
      triggeredCaps.push(c.label || c.when);
      if (cap === null || c.max < cap) {
        cap = c.max;
        capLabel = c.label || c.when;
      }
    }
  }

  const finalScore = cap === null ? artifactQuality : Math.min(artifactQuality, cap);
  return { probes, artifactQuality, totalMax, triggeredCaps, capLabel, finalScore };
}

// ---------------------------------------------------------------------------
// 3-label readiness summary (resolves the Codex 30-idea finding that audit
// "production-ready" gets reported even when lifecycle is Blocked). The probe
// score becomes artifact-quality; build-approval reads from the lifecycle in
// repo/manifest.json; demo-readiness gates on artifact-quality plus the
// boundary-and-role-test-presence probe minimum.
// ---------------------------------------------------------------------------

export type ResearchSourceTier = 'synthesized' | 'manual' | 'agent-recipe' | 'imported-real' | 'unknown';

export type ReadinessLabels = {
  artifactQuality: { score: number; max: number; label: string };
  buildApproval: { lifecycleStatus: string; approved: boolean; label: string };
  demoReadiness: { ready: boolean; label: string; reason?: string };
  researchSource: { tier: ResearchSourceTier; label: string; demoEligible: boolean };
};

const DEMO_ELIGIBLE_TIERS: ResearchSourceTier[] = ['agent-recipe', 'imported-real'];

export function deriveReadinessLabels(packageRoot: string, probeReport: ProbeReport): ReadinessLabels {
  const manifestPath = path.join(packageRoot, 'repo', 'manifest.json');
  let lifecycleStatus = 'unknown';
  let researchSource: ResearchSourceTier = 'unknown';
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { lifecycleStatus?: string; researchSource?: ResearchSourceTier };
      lifecycleStatus = manifest.lifecycleStatus || 'unknown';
      researchSource = manifest.researchSource || 'manual';
    } catch {
      // ignore
    }
  }
  const approved = lifecycleStatus === 'ApprovedForBuild';
  const buildApprovalLabel = approved
    ? 'Build approved'
    : `Build NOT approved (lifecycle=${lifecycleStatus})`;

  const sourceDemoEligible = DEMO_ELIGIBLE_TIERS.includes(researchSource);
  const sourceLabel = (() => {
    switch (researchSource) {
      case 'synthesized': return 'Synthesized (harness-only; never demo-ready)';
      case 'manual': return 'Manual (human-entered, uncited; harness-ready)';
      case 'agent-recipe': return 'Agent-recipe (agent reasoning; demo-eligible)';
      case 'imported-real': return 'Imported-real (externally sourced/cited; demo-eligible)';
      default: return 'Unknown';
    }
  })();

  const boundaryProbe = probeReport.probes.find((p) => p.name === 'boundary-and-role-test-presence');
  const sampleCoverageProbe = probeReport.probes.find((p) => p.name === 'sample-data-coverage-per-actor');
  const artifactScore = probeReport.finalScore;
  const artifactMax = probeReport.totalMax;
  const artifactPct = artifactMax ? Math.round((artifactScore / artifactMax) * 100) : 0;

  // Demo readiness now ANDs research source eligibility on top of artifact quality
  // and build approval. Synthesized harness output is never labelled demo-ready
  // regardless of probe scores (Codex 30-idea Recommendation #2).
  let demoReady = artifactPct >= 75 && approved && sourceDemoEligible;
  let demoReason: string | undefined;
  if (!sourceDemoEligible) {
    demoReady = false;
    demoReason = `research source is ${researchSource} (must be agent-recipe or imported-real)`;
  } else if (!boundaryProbe || boundaryProbe.score === 0) {
    demoReady = false;
    demoReason = 'no boundary or role-permission samples';
  } else if (sampleCoverageProbe && sampleCoverageProbe.ratio < 0.5) {
    demoReady = false;
    demoReason = 'insufficient per-actor sample coverage';
  } else if (artifactPct < 75) {
    demoReady = false;
    demoReason = `artifact quality ${artifactPct}% below 75% threshold`;
  } else if (!approved) {
    demoReady = false;
    demoReason = `lifecycle=${lifecycleStatus} (must be ApprovedForBuild)`;
  }

  return {
    artifactQuality: {
      score: artifactScore,
      max: artifactMax,
      label: `Artifact quality ${artifactScore}/${artifactMax} (${artifactPct}%)`
    },
    buildApproval: { lifecycleStatus, approved, label: buildApprovalLabel },
    demoReadiness: {
      ready: demoReady,
      label: demoReady ? 'Demo-ready' : `Not demo-ready (${demoReason || 'see probes'})`,
      reason: demoReason
    },
    researchSource: { tier: researchSource, label: sourceLabel, demoEligible: sourceDemoEligible }
  };
}

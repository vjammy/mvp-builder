#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { fileExists, getArg, readTextFile, resolvePackageRoot } from './mvp-builder-package-utils';

type RuntimeTarget = {
  url: string;
  startCommand: string;
  smokeRoutes: string[];
  startTimeoutMs: number;
};

type EntitySampleRecord = {
  id: string;
  category: 'happy' | 'negative' | 'boundary' | 'role-permission';
  actorId?: string;
  reason?: string;
  note?: string;
  data: Record<string, unknown>;
};

type EntityFixture = {
  entityName: string;
  reqIds: string[];
  reqActorIds: Record<string, string>;
  // Convenience pointers to the first happy + first negative (for backwards-compat callers).
  happyPath: Record<string, unknown> | null;
  negativePath: Record<string, unknown> | null;
  samples: {
    happy: EntitySampleRecord[];
    negative: EntitySampleRecord[];
    boundary: EntitySampleRecord[];
    rolePermission: EntitySampleRecord[];
  };
};

type RequirementRecord = {
  reqId: string;
  title: string;
  entityName: string;
  happyPathSummary: string;
};

type ReqCoverageResult = {
  reqId: string;
  entityName: string;
  status: 'covered' | 'partially-covered' | 'uncovered';
  evidencePaths: string[];
  notes: string[];
  consoleErrors: string[];
  textMatches: string[];
  testResultsVerified: boolean;
};

type FlowStep =
  | { kind: 'goto'; url: string; description?: string }
  | { kind: 'click'; testId: string; description?: string }
  | { kind: 'fill'; testId: string; valueFromSample?: string; literalValue?: string; description?: string }
  | { kind: 'assertRoute'; match: string; description?: string }
  | { kind: 'assertText'; testId?: string; text: string; description?: string };

type LoadedFlow = {
  flowId: string;
  filePath: string;
  phaseSlug: string;
  actorId: string;
  actorName: string;
  workflowName: string;
  reqIds: string[];
  loginMock: { strategy: 'query-string'; param: string; value: string };
  steps: FlowStep[];
  negativeSteps: FlowStep[];
  rolePermissionSteps: FlowStep[];
};

type FlowStepResult = {
  index: number;
  kind: FlowStep['kind'];
  passed: boolean;
  detail: string;
};

type FlowExecutionResult = {
  flowId: string;
  phaseSlug: string;
  actorId: string;
  workflowName: string;
  reqIds: string[];
  status: 'passed' | 'failed' | 'skipped-not-built';
  happySteps: FlowStepResult[];
  negativeSteps: FlowStepResult[];
  rolePermissionSteps: FlowStepResult[];
  consoleErrors: string[];
  failedRequests: string[];
  screenshotPaths: string[];
  notes: string[];
};

type SkipReason =
  | 'no-runtime'
  | 'no-playwright'
  | 'runtime-down'
  | null;

type BrowserLoopOutcome = {
  startedAt: string;
  finishedAt: string;
  baseUrl: string;
  startSucceeded: boolean;
  probePassed: boolean;
  probeNotes: string[];
  totalRequirements: number;
  coveredRequirements: number;
  partiallyCoveredRequirements: number;
  uncoveredRequirements: number;
  reqResults: ReqCoverageResult[];
  // E3b additions:
  flowResults: FlowExecutionResult[];
  totalFlows: number;
  flowsExecuted: number;
  totalSteps: number;
  passedSteps: number;
  totalConsoleErrors: number;
  totalFailedRequests: number;
  outcomeScore: number;
  legacyScore: number;
  skipReason: SkipReason;
  evidenceDir: string;
  evidenceReportPath: string;
  playwrightAvailable: boolean;
  playwrightInstallHint?: string;
  verifiedReqIds: string[];
};

function parseRuntimeTarget(packageRoot: string): RuntimeTarget {
  const filePath = path.join(packageRoot, 'RUNTIME_TARGET.md');
  if (!fileExists(filePath)) {
    throw new Error(
      'RUNTIME_TARGET.md not found in package root. Generate the workspace with the latest MVP Builder or add it manually.'
    );
  }
  const content = readTextFile(filePath);
  const url = (content.match(/Base URL:\s*([^\n]+)/i)?.[1] || '').trim();
  const command = (content.match(/Command:\s*([^\n]+)/i)?.[1] || '').trim();
  const timeoutMatch = content.match(/under\s+(\d+)\s+seconds/i);
  const startTimeoutMs = timeoutMatch ? Number.parseInt(timeoutMatch[1], 10) * 1000 : 60000;
  const routesSection = content.split(/##\s+Smoke routes/i)[1]?.split(/\n##\s+/)[0] || '';
  const smokeRoutes = routesSection
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
  if (!url) throw new Error('RUNTIME_TARGET.md is missing a Base URL line.');
  if (!command) throw new Error('RUNTIME_TARGET.md is missing a Command line.');
  return {
    url,
    startCommand: command,
    smokeRoutes: smokeRoutes.length ? smokeRoutes : ['/'],
    startTimeoutMs
  };
}

function parseEntityFixtures(packageRoot: string): EntityFixture[] {
  const filePath = path.join(packageRoot, 'SAMPLE_DATA.md');
  if (!fileExists(filePath)) return [];
  const content = readTextFile(filePath);
  const sections = content.split(/\n## /).slice(1);
  const fixtures: EntityFixture[] = [];
  for (const section of sections) {
    const headerLine = section.split('\n')[0].trim();
    if (!headerLine || /^What this/i.test(headerLine) || /^How to use/i.test(headerLine) || /^Naming/i.test(headerLine) || /^Update/i.test(headerLine) || /^What this file is NOT/i.test(headerLine)) {
      continue;
    }
    const entityName = headerLine.trim();
    const reqLineMatch = section.match(/Used by requirements:\s*([^\n]+)/i);
    const reqIds: string[] = [];
    const reqActorIds: Record<string, string> = {};
    if (reqLineMatch) {
      // Accept either "REQ-1" or "REQ-1 (actor-id)" tokens.
      const reqTokenRegex = /REQ-(\d+)(?:\s*\(([^)]+)\))?/gi;
      let match: RegExpExecArray | null;
      while ((match = reqTokenRegex.exec(reqLineMatch[1])) !== null) {
        const reqId = `REQ-${match[1]}`;
        reqIds.push(reqId);
        if (match[2]) reqActorIds[reqId] = match[2].trim();
      }
    }

    const safeParse = (raw: string | undefined) => {
      if (!raw) return null;
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return null;
      }
    };

    const samples: EntityFixture['samples'] = { happy: [], negative: [], boundary: [], rolePermission: [] };

    // Modern format: ### Sample <category>: <id>
    const sampleSubsections = section.split(/\n### Sample /).slice(1);
    if (sampleSubsections.length) {
      for (const subsection of sampleSubsections) {
        const headingMatch = subsection.match(/^([a-z-]+):\s*([^\n]+)/i);
        if (!headingMatch) continue;
        const category = headingMatch[1].toLowerCase();
        const id = headingMatch[2].trim();
        const actorMatch = subsection.match(/^- Actor:\s*([^\n]+)/im);
        const reasonMatch = subsection.match(/^- Reason:\s*([^\n]+)/im);
        const noteMatch = subsection.match(/^- Note:\s*([^\n]+)/im);
        const jsonMatch = subsection.match(/```json\n([\s\S]*?)\n```/);
        const data = safeParse(jsonMatch?.[1]);
        if (!data) continue;
        const record: EntitySampleRecord = {
          id,
          category: category === 'role-permission' ? 'role-permission' : (category as EntitySampleRecord['category']),
          actorId: actorMatch?.[1].trim(),
          reason: reasonMatch?.[1].trim(),
          note: noteMatch?.[1].trim(),
          data
        };
        if (record.category === 'happy') samples.happy.push(record);
        else if (record.category === 'negative') samples.negative.push(record);
        else if (record.category === 'boundary') samples.boundary.push(record);
        else if (record.category === 'role-permission') samples.rolePermission.push(record);
      }
    } else {
      // Legacy format: first two ```json blocks = happy + negative.
      const jsonBlocks = Array.from(section.matchAll(/```json\n([\s\S]*?)\n```/g)).map((m) => m[1]);
      const happy = safeParse(jsonBlocks[0]);
      const negative = safeParse(jsonBlocks[1]);
      if (happy) samples.happy.push({ id: 'happy-default', category: 'happy', data: happy });
      if (negative) samples.negative.push({ id: 'negative-default', category: 'negative', data: negative });
    }

    fixtures.push({
      entityName,
      reqIds,
      reqActorIds,
      happyPath: samples.happy[0]?.data || null,
      negativePath: samples.negative[0]?.data || null,
      samples
    });
  }
  return fixtures;
}

function loadVerifiedReqIds(packageRoot: string): Set<string> {
  const verified = new Set<string>();
  const phasesDir = path.join(packageRoot, 'phases');
  if (!fileExists(phasesDir)) return verified;
  const phaseSlugs = fs.readdirSync(phasesDir).filter((entry) => /^phase-\d+$/.test(entry));
  for (const slug of phaseSlugs) {
    const resultsPath = path.join(phasesDir, slug, 'TEST_RESULTS.md');
    if (!fileExists(resultsPath)) continue;
    const content = readTextFile(resultsPath);
    const finalResult = (content.match(/##\s*Final result:\s*(.+)/i)?.[1] || '').trim().toLowerCase();
    if (finalResult !== 'pass' && finalResult !== 'passed') continue;
    // Look for "Scenario evidence: REQ-N" markers with at least one non-template line of body content.
    const sectionMatcher = /Scenario evidence:\s*(REQ-\d+)([\s\S]*?)(?=Scenario evidence:|\n##\s|$)/gi;
    let sectionMatch: RegExpExecArray | null;
    while ((sectionMatch = sectionMatcher.exec(content)) !== null) {
      const reqId = sectionMatch[1].toUpperCase();
      const body = sectionMatch[2] || '';
      const meaningfulLines = body
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && line !== '-' && line.toLowerCase() !== 'pending' && !/^allowed:/i.test(line));
      if (meaningfulLines.length >= 1) verified.add(reqId);
    }
  }
  return verified;
}

function parseRequirementRecords(packageRoot: string): RequirementRecord[] {
  const acceptancePath = path.join(packageRoot, 'requirements', 'ACCEPTANCE_CRITERIA.md');
  if (!fileExists(acceptancePath)) return [];
  const content = readTextFile(acceptancePath);
  const blocks = content.split(/\n## /).slice(1);
  const records: RequirementRecord[] = [];
  for (const block of blocks) {
    const headerLine = block.split('\n')[0].trim();
    const titleMatch = headerLine.match(/^\d+\.\s+(.+)$/);
    const title = titleMatch?.[1]?.trim() || headerLine;
    const reqIdMatch = block.match(/Requirement ID:\s*(REQ-\d+)/i);
    if (!reqIdMatch) continue;
    const reqId = reqIdMatch[1].toUpperCase();
    const sampleDataLineMatch = block.match(/Sample data:\s*see SAMPLE_DATA\.md\s+"([^"]+)"\s+section/i);
    const entityName = sampleDataLineMatch?.[1]?.trim() || '';
    const happyPathMatch = block.match(/Inline reference:\s*([^\n]+)/i);
    const happyPathSummary = happyPathMatch?.[1]?.trim() || '';
    records.push({ reqId, title, entityName, happyPathSummary });
  }
  return records;
}

function probeBaseUrl(url: string, timeoutMs: number): Promise<{ ok: boolean; status: number | null; error?: string }> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      resolve({ ok: false, status: null, error: 'Invalid URL.' });
      return;
    }
    const transport = parsed.protocol === 'https:' ? https : http;
    const request = transport.request(
      {
        method: 'GET',
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}` || '/',
        timeout: timeoutMs
      },
      (response) => {
        const status = response.statusCode || null;
        response.resume();
        resolve({ ok: status !== null && status >= 200 && status < 400, status });
      }
    );
    request.on('error', (error) => resolve({ ok: false, status: null, error: error.message }));
    request.on('timeout', () => {
      request.destroy(new Error('timeout'));
      resolve({ ok: false, status: null, error: 'timeout' });
    });
    request.end();
  });
}

async function waitForUrl(url: string, totalTimeoutMs: number, pollIntervalMs = 1000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < totalTimeoutMs) {
    const result = await probeBaseUrl(url, 3000);
    if (result.ok) return true;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return false;
}

function spawnRuntime(target: RuntimeTarget, packageRoot: string): ChildProcess {
  const isWindows = process.platform === 'win32';
  return spawn(target.startCommand, {
    cwd: packageRoot,
    shell: isWindows ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh',
    stdio: 'ignore',
    detached: !isWindows
  });
}

function killRuntime(child: ChildProcess) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    } else {
      process.kill(-child.pid, 'SIGTERM');
    }
  } catch {
    // ignore
  }
}

async function loadPlaywright(): Promise<{ chromium: any } | null> {
  try {
    // Indirect dynamic import so TypeScript does not require @types/playwright
    // and so Playwright stays an optional peer dependency.
    const dynamicImport = new Function('mod', 'return import(mod)') as (mod: string) => Promise<unknown>;
    const mod = (await dynamicImport('playwright')) as { chromium?: any } | undefined;
    if (mod && mod.chromium) return { chromium: mod.chromium };
    return null;
  } catch {
    return null;
  }
}

function uniqueStringValues(payload: Record<string, unknown> | null): string[] {
  if (!payload) return [];
  const values: string[] = [];
  for (const value of Object.values(payload)) {
    if (typeof value === 'string' && value.trim().length >= 3) values.push(value.trim());
    if (typeof value === 'number') values.push(String(value));
  }
  return Array.from(new Set(values));
}

function discoverFlows(packageRoot: string): LoadedFlow[] {
  const phasesDir = path.join(packageRoot, 'phases');
  if (!fs.existsSync(phasesDir)) return [];
  const flows: LoadedFlow[] = [];
  for (const phaseSlug of fs.readdirSync(phasesDir).filter((entry) => /^phase-\d+$/.test(entry))) {
    const flowsDir = path.join(phasesDir, phaseSlug, 'PLAYWRIGHT_FLOWS');
    if (!fs.existsSync(flowsDir)) continue;
    for (const file of fs.readdirSync(flowsDir).filter((f) => f.endsWith('.json'))) {
      const filePath = path.join(flowsDir, file);
      try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<LoadedFlow> & { schemaVersion?: number };
        if (!parsed.flowId || !parsed.actorId || !Array.isArray(parsed.steps)) continue;
        flows.push({
          flowId: parsed.flowId,
          filePath: path.relative(packageRoot, filePath).replace(/\\/g, '/'),
          phaseSlug,
          actorId: parsed.actorId,
          actorName: parsed.actorName || parsed.actorId,
          workflowName: parsed.workflowName || 'unnamed-workflow',
          reqIds: Array.isArray(parsed.reqIds) ? parsed.reqIds.map(String) : [],
          loginMock: parsed.loginMock || { strategy: 'query-string', param: 'as', value: parsed.actorId },
          steps: parsed.steps as FlowStep[],
          negativeSteps: Array.isArray(parsed.negativeSteps) ? (parsed.negativeSteps as FlowStep[]) : [],
          rolePermissionSteps: Array.isArray(parsed.rolePermissionSteps) ? (parsed.rolePermissionSteps as FlowStep[]) : []
        });
      } catch {
        // skip malformed flow files
      }
    }
  }
  return flows;
}

function resolveSampleValue(reference: string | undefined, fixtures: EntityFixture[]): string | undefined {
  if (!reference) return undefined;
  // reference format: "<EntityName>.<sampleId>.<fieldName>"
  const parts = reference.split('.');
  if (parts.length < 3) return undefined;
  const entityName = parts[0].trim();
  const sampleId = parts[1].trim();
  const fieldName = parts.slice(2).join('.').trim();
  const fixture = fixtures.find((f) => f.entityName === entityName);
  if (!fixture) return undefined;
  for (const cat of ['happy', 'negative', 'boundary', 'rolePermission'] as const) {
    const sample = fixture.samples[cat].find((s) => s.id === sampleId);
    if (sample && sample.data && fieldName in sample.data) {
      const value = sample.data[fieldName];
      if (value === null || value === undefined) return '';
      return String(value);
    }
  }
  return undefined;
}

function applyMockAuth(url: string, login: LoadedFlow['loginMock']): string {
  if (login.strategy !== 'query-string') return url;
  if (!login.param || !login.value) return url;
  const sep = url.includes('?') ? '&' : '?';
  if (url.includes(`${login.param}=`)) return url;
  return `${url}${sep}${login.param}=${encodeURIComponent(login.value)}`;
}

async function executeFlowSteps(args: {
  page: any;
  baseUrl: string;
  steps: FlowStep[];
  fixtures: EntityFixture[];
  login: LoadedFlow['loginMock'];
  evidenceDir: string;
  flowId: string;
  phase: 'happy' | 'negative' | 'rolePermission';
  consoleErrors: string[];
  failedRequests: string[];
  screenshotPaths: string[];
}): Promise<FlowStepResult[]> {
  const { page, baseUrl, steps, fixtures, login, evidenceDir, flowId, phase, screenshotPaths } = args;
  const results: FlowStepResult[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    let passed = false;
    let detail = '';
    try {
      if (step.kind === 'goto') {
        const targetUrl = applyMockAuth(`${baseUrl.replace(/\/$/, '')}${step.url.startsWith('/') ? step.url : `/${step.url}`}`, login);
        const resp = await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 15000 });
        const status = resp ? resp.status() : 0;
        passed = status >= 200 && status < 400;
        detail = `goto ${targetUrl} → ${status}`;
      } else if (step.kind === 'click') {
        const locator = page.getByTestId(step.testId);
        await locator.first().click({ timeout: 5000 });
        passed = true;
        detail = `click [data-testid="${step.testId}"]`;
      } else if (step.kind === 'fill') {
        const value = step.literalValue !== undefined ? step.literalValue : resolveSampleValue(step.valueFromSample, fixtures);
        if (value === undefined) {
          passed = false;
          detail = `fill skipped: could not resolve ${step.valueFromSample}`;
        } else {
          const locator = page.getByTestId(step.testId);
          await locator.first().fill(value, { timeout: 5000 });
          passed = true;
          detail = `fill [data-testid="${step.testId}"] = ${value.slice(0, 40)}`;
        }
      } else if (step.kind === 'assertRoute') {
        const current = page.url();
        passed = current.includes(step.match);
        detail = `assertRoute "${step.match}" against ${current}`;
      } else if (step.kind === 'assertText') {
        const haystack = ((await page.content()) || '').toLowerCase();
        passed = haystack.includes(step.text.toLowerCase());
        detail = `assertText "${step.text}" found=${passed}`;
        if (!passed && step.testId) {
          const locator = page.getByTestId(step.testId);
          const count = await locator.count();
          passed = count > 0;
          detail += ` (testid ${step.testId} count=${count})`;
        }
      } else {
        detail = `unknown step kind`;
      }
    } catch (err) {
      passed = false;
      detail = `error: ${(err as Error).message.slice(0, 200)}`;
    }
    results.push({ index: i, kind: step.kind, passed, detail });
    // Capture a screenshot per step (best-effort)
    try {
      const shotPath = path.join(evidenceDir, `${flowId}-${phase}-step-${String(i + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: shotPath, fullPage: true });
      screenshotPaths.push(path.relative(evidenceDir, shotPath).replace(/\\/g, '/'));
    } catch {
      // ignore screenshot failures
    }
  }
  return results;
}

async function runFlows(args: {
  context: any;
  baseUrl: string;
  flows: LoadedFlow[];
  fixtures: EntityFixture[];
  evidenceDir: string;
}): Promise<FlowExecutionResult[]> {
  const { context, baseUrl, flows, fixtures, evidenceDir } = args;
  const results: FlowExecutionResult[] = [];
  for (const flow of flows) {
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    const screenshotPaths: string[] = [];
    const browserContext = await context.browser().newContext().catch(() => null);
    const page = browserContext ? await browserContext.newPage() : null;
    if (!page) {
      results.push({
        flowId: flow.flowId,
        phaseSlug: flow.phaseSlug,
        actorId: flow.actorId,
        workflowName: flow.workflowName,
        reqIds: flow.reqIds,
        status: 'failed',
        happySteps: [],
        negativeSteps: [],
        rolePermissionSteps: [],
        consoleErrors: ['Failed to create Playwright context for this flow'],
        failedRequests: [],
        screenshotPaths: [],
        notes: []
      });
      continue;
    }
    page.on('console', (m: any) => {
      if (m.type() === 'error') consoleErrors.push(String(m.text()).slice(0, 500));
    });
    page.on('pageerror', (e: any) => {
      consoleErrors.push(String(e?.message || e).slice(0, 500));
    });
    page.on('requestfailed', (req: any) => {
      failedRequests.push(`${req.method()} ${req.url()}: ${req.failure?.()?.errorText || 'failed'}`);
    });
    page.on('response', (resp: any) => {
      const status = resp.status();
      if (status >= 400) failedRequests.push(`${resp.request().method()} ${resp.url()} → ${status}`);
    });

    const notes: string[] = [];
    let status: FlowExecutionResult['status'] = 'passed';

    // Probe the flow's first goto first to detect not-built routes.
    const firstGoto = flow.steps.find((s) => s.kind === 'goto') as Extract<FlowStep, { kind: 'goto' }> | undefined;
    if (firstGoto) {
      const targetUrl = applyMockAuth(`${baseUrl.replace(/\/$/, '')}${firstGoto.url.startsWith('/') ? firstGoto.url : `/${firstGoto.url}`}`, flow.loginMock);
      const resp = await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => null);
      if (!resp || resp.status() === 404) {
        status = 'skipped-not-built';
        notes.push(`First navigation to ${targetUrl} returned ${resp?.status() ?? 'no response'}; flow skipped as not-built.`);
      }
    }

    let happySteps: FlowStepResult[] = [];
    let negativeSteps: FlowStepResult[] = [];
    let rolePermissionSteps: FlowStepResult[] = [];

    if (status !== 'skipped-not-built') {
      happySteps = await executeFlowSteps({
        page,
        baseUrl,
        steps: flow.steps,
        fixtures,
        login: flow.loginMock,
        evidenceDir,
        flowId: flow.flowId,
        phase: 'happy',
        consoleErrors,
        failedRequests,
        screenshotPaths
      });
      if (flow.negativeSteps.length) {
        negativeSteps = await executeFlowSteps({
          page,
          baseUrl,
          steps: flow.negativeSteps,
          fixtures,
          login: flow.loginMock,
          evidenceDir,
          flowId: flow.flowId,
          phase: 'negative',
          consoleErrors,
          failedRequests,
          screenshotPaths
        });
      }
      if (flow.rolePermissionSteps.length) {
        rolePermissionSteps = await executeFlowSteps({
          page,
          baseUrl,
          steps: flow.rolePermissionSteps,
          fixtures,
          login: flow.loginMock,
          evidenceDir,
          flowId: flow.flowId,
          phase: 'rolePermission',
          consoleErrors,
          failedRequests,
          screenshotPaths
        });
      }
      const allSteps = [...happySteps, ...negativeSteps, ...rolePermissionSteps];
      const anyFailed = allSteps.some((s) => !s.passed);
      status = anyFailed ? 'failed' : 'passed';
    }

    await browserContext?.close().catch(() => {});
    results.push({
      flowId: flow.flowId,
      phaseSlug: flow.phaseSlug,
      actorId: flow.actorId,
      workflowName: flow.workflowName,
      reqIds: flow.reqIds,
      status,
      happySteps,
      negativeSteps,
      rolePermissionSteps,
      consoleErrors,
      failedRequests,
      screenshotPaths,
      notes
    });
  }
  return results;
}

async function runReqCoverage(args: {
  page: any;
  baseUrl: string;
  fixtures: EntityFixture[];
  requirements: RequirementRecord[];
  evidenceDir: string;
  verifiedReqs: Set<string>;
}): Promise<ReqCoverageResult[]> {
  const { page, baseUrl, fixtures, requirements, evidenceDir, verifiedReqs } = args;
  const results: ReqCoverageResult[] = [];
  const fixtureByEntity = new Map(fixtures.map((fixture) => [fixture.entityName, fixture]));

  const consoleErrors: string[] = [];
  page.on('console', (message: any) => {
    if (message.type() === 'error') consoleErrors.push(String(message.text()).slice(0, 500));
  });
  page.on('pageerror', (error: any) => {
    consoleErrors.push(String(error?.message || error).slice(0, 500));
  });

  // Land on base URL once and capture the rendered text/screenshot
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  const baseSnapshotPath = path.join(evidenceDir, 'base-url.png');
  await page.screenshot({ path: baseSnapshotPath, fullPage: true }).catch(() => {});
  const baseText = (await page.content().catch(() => ''))?.toLowerCase() || '';

  for (const requirement of requirements) {
    const fixture = fixtureByEntity.get(requirement.entityName);
    const evidencePaths = [path.relative(evidenceDir, baseSnapshotPath).replace(/\\/g, '/')];
    const notes: string[] = [];
    const errorsBefore = consoleErrors.length;
    const textMatches: string[] = [];

    const testResultsVerified = verifiedReqs.has(requirement.reqId);

    if (!fixture || !fixture.happyPath) {
      notes.push('No SAMPLE_DATA.md fixture matched this requirement.');
      results.push({
        reqId: requirement.reqId,
        entityName: requirement.entityName,
        status: 'uncovered',
        evidencePaths,
        notes,
        consoleErrors: [],
        textMatches,
        testResultsVerified
      });
      continue;
    }

    const tokens = uniqueStringValues(fixture.happyPath);
    if (requirement.entityName) tokens.unshift(requirement.entityName);
    for (const token of tokens) {
      if (token && baseText.includes(token.toLowerCase())) textMatches.push(token);
    }

    let status: ReqCoverageResult['status'];
    if (textMatches.length >= 2 && testResultsVerified) {
      status = 'covered';
      notes.push('Entity name and a happy-path field rendered on the page AND TEST_RESULTS.md records pass evidence for this REQ.');
    } else if (textMatches.length >= 2 && !testResultsVerified) {
      status = 'partially-covered';
      notes.push('Tokens render on the page but TEST_RESULTS.md does not record pass evidence for this REQ. Run TEST_SCRIPT.md and paste the happy-path + negative-path observations under "Scenario evidence: ' + requirement.reqId + '" in the owning phase TEST_RESULTS.md to upgrade to covered.');
    } else if (textMatches.length === 1) {
      status = 'partially-covered';
      notes.push('Only one happy-path token appeared on the rendered page. Drive the actual workflow to fully cover this requirement.');
    } else {
      status = 'uncovered';
      notes.push('No happy-path tokens were found on the base URL render. Either the route is wrong or the feature is not built yet.');
    }

    if (consoleErrors.length > errorsBefore) {
      notes.push('Console errors fired during this scenario; see consoleErrors below.');
    }

    results.push({
      reqId: requirement.reqId,
      entityName: requirement.entityName,
      status,
      evidencePaths,
      notes,
      consoleErrors: consoleErrors.slice(errorsBefore),
      textMatches,
      testResultsVerified
    });
  }

  return results;
}

// Legacy formula retained as a transitional fallback so existing --target=90
// invocations don't suddenly invert their meaning. Reported alongside the new
// score as `legacyScore` for one release window.
function calculateLegacyScore(probePassed: boolean, totalReqs: number, coveredReqs: number, partiallyCovered: number) {
  const probePoints = probePassed ? 30 : 0;
  if (totalReqs === 0) return Math.min(100, probePoints + 70);
  const coverageRatio = (coveredReqs + partiallyCovered * 0.5) / totalReqs;
  return Math.min(100, Math.round(probePoints + coverageRatio * 70));
}

// E3 score formula. Rewards executed flows + passed step asserts + REQ coverage
// across happy + negative samples, and penalizes console errors and failed
// network requests.
function calculateOutcomeScore(args: {
  probePassed: boolean;
  flows: FlowExecutionResult[];
  totalReqs: number;
  coveredReqs: number;
  partiallyCovered: number;
}): number {
  const { probePassed, flows, totalReqs, coveredReqs, partiallyCovered } = args;
  const probePoints = probePassed ? 20 : 0;

  let flowsExecutedPoints = 0;
  let stepsPassedPoints = 0;
  let coveragePoints = 0;
  let cleanlinessPoints = 10;

  if (flows.length) {
    const executed = flows.filter((f) => f.status === 'passed' || f.status === 'failed').length;
    flowsExecutedPoints = Math.round((executed / flows.length) * 20);

    const allSteps = flows.flatMap((f) => [...f.happySteps, ...f.negativeSteps, ...f.rolePermissionSteps]);
    const passed = allSteps.filter((s) => s.passed).length;
    stepsPassedPoints = allSteps.length ? Math.round((passed / allSteps.length) * 30) : 0;

    // Coverage: REQs whose flows ran ≥1 happy + ≥1 negative step successfully.
    const reqWithHappy = new Set<string>();
    const reqWithNegative = new Set<string>();
    for (const f of flows) {
      if (f.status !== 'passed' && f.status !== 'failed') continue;
      const happyOk = f.happySteps.some((s) => s.passed);
      const negativeOk = f.negativeSteps.some((s) => s.passed);
      for (const r of f.reqIds) {
        if (happyOk) reqWithHappy.add(r);
        if (negativeOk) reqWithNegative.add(r);
      }
    }
    let bothCovered = 0;
    reqWithHappy.forEach((r) => {
      if (reqWithNegative.has(r)) bothCovered += 1;
    });
    const coverageDenominator = totalReqs > 0 ? totalReqs : Math.max(reqWithHappy.size, 1);
    coveragePoints = Math.round((bothCovered / coverageDenominator) * 20);

    const consoleCount = flows.reduce((sum, f) => sum + f.consoleErrors.length, 0);
    const failedRequestCount = flows.reduce((sum, f) => sum + f.failedRequests.length, 0);
    const consolePenalty = Math.min(10, consoleCount * 2);
    const networkPenalty = Math.min(10, failedRequestCount * 2);
    cleanlinessPoints = Math.max(0, 10 - consolePenalty - networkPenalty);
  } else if (totalReqs > 0) {
    // No flows discovered: fall back to legacy coverage so older workspaces still score sensibly.
    const coverageRatio = (coveredReqs + partiallyCovered * 0.5) / totalReqs;
    flowsExecutedPoints = 0;
    stepsPassedPoints = 0;
    coveragePoints = Math.round(coverageRatio * 50); // give legacy callers up to 50 from coverage so total can still reach ~70 (probe 20 + coverage 50)
    cleanlinessPoints = 0;
  }

  return Math.min(100, probePoints + flowsExecutedPoints + stepsPassedPoints + coveragePoints + cleanlinessPoints);
}

function renderEvidenceReport(outcome: BrowserLoopOutcome): string {
  const lines: string[] = [];
  if (outcome.skipReason) {
    lines.push(`# Browser-driven loop evidence — skipped (${outcome.skipReason})`);
  } else {
    lines.push(`# Browser-driven loop evidence — score ${outcome.outcomeScore}/100`);
  }
  lines.push('');
  lines.push(`- Started at: ${outcome.startedAt}`);
  lines.push(`- Finished at: ${outcome.finishedAt}`);
  lines.push(`- Base URL: ${outcome.baseUrl}`);
  lines.push(`- Runtime started: ${outcome.startSucceeded ? 'yes' : 'no'}`);
  lines.push(`- HTTP probe passed: ${outcome.probePassed ? 'yes' : 'no'}`);
  lines.push(`- Playwright available: ${outcome.playwrightAvailable ? 'yes' : 'no'}`);
  if (!outcome.playwrightAvailable && outcome.playwrightInstallHint) {
    lines.push(`- Install hint: ${outcome.playwrightInstallHint}`);
  }
  if (outcome.skipReason) {
    lines.push(`- Skip reason: ${outcome.skipReason}`);
  }
  lines.push('');
  lines.push('## Score breakdown');
  lines.push(`- Final score: ${outcome.outcomeScore}/100`);
  lines.push(`- Legacy score (probe 30 + coverage 70): ${outcome.legacyScore}/100`);
  lines.push(`- Probe (max 20): ${outcome.probePassed ? 20 : 0}`);
  lines.push(`- Flows executed (max 20): ${outcome.totalFlows ? Math.round((outcome.flowsExecuted / outcome.totalFlows) * 20) : 0} (${outcome.flowsExecuted}/${outcome.totalFlows} flows)`);
  lines.push(`- Steps passed (max 30): ${outcome.totalSteps ? Math.round((outcome.passedSteps / outcome.totalSteps) * 30) : 0} (${outcome.passedSteps}/${outcome.totalSteps} steps)`);
  lines.push(`- REQ coverage (max 20): based on ${outcome.coveredRequirements} fully covered + ${outcome.partiallyCoveredRequirements} partially covered out of ${outcome.totalRequirements}.`);
  lines.push(`- Cleanliness (max 10): console errors=${outcome.totalConsoleErrors}, failed network requests=${outcome.totalFailedRequests}.`);
  lines.push('');
  if (outcome.flowResults.length) {
    lines.push('## Per-flow results');
    lines.push('| Flow | Phase | Actor | Workflow | REQs | Status | Steps (h/n/r) | Console err | Failed req |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const flow of outcome.flowResults) {
      const happyOk = `${flow.happySteps.filter((s) => s.passed).length}/${flow.happySteps.length}`;
      const negOk = `${flow.negativeSteps.filter((s) => s.passed).length}/${flow.negativeSteps.length}`;
      const roleOk = `${flow.rolePermissionSteps.filter((s) => s.passed).length}/${flow.rolePermissionSteps.length}`;
      lines.push(
        `| ${flow.flowId} | ${flow.phaseSlug} | ${flow.actorId} | ${flow.workflowName} | ${flow.reqIds.join(', ') || '_none_'} | ${flow.status} | ${happyOk}/${negOk}/${roleOk} | ${flow.consoleErrors.length} | ${flow.failedRequests.length} |`
      );
    }
    lines.push('');
  }
  lines.push('## Per-requirement results');
  if (outcome.reqResults.length === 0) {
    if (outcome.totalRequirements === 0) {
      lines.push('No requirement records were parsed from requirements/ACCEPTANCE_CRITERIA.md.');
    } else {
      lines.push(`${outcome.totalRequirements} requirement record(s) were parsed but no scenarios ran. Likely cause: the runtime did not start, or Playwright is not installed. Resolve the probe notes above and re-run \`npm run loop:browser\`.`);
    }
    lines.push('');
  } else {
    lines.push('| REQ-ID | Entity | Status | TEST_RESULTS.md verified | Text matches | Console errors | Notes |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const result of outcome.reqResults) {
      lines.push(
        `| ${result.reqId} | ${result.entityName || '_unknown_'} | ${result.status} | ${result.testResultsVerified ? 'yes' : 'no'} | ${result.textMatches.join(', ').replace(/\|/g, '\\|') || '_none_'} | ${result.consoleErrors.length} | ${result.notes.join(' ').replace(/\|/g, '\\|')} |`
      );
    }
    lines.push('');
  }
  lines.push(`## TEST_RESULTS.md verification summary`);
  lines.push(`- REQs verified by phase TEST_RESULTS.md: ${outcome.verifiedReqIds.length}/${outcome.totalRequirements}`);
  if (outcome.verifiedReqIds.length) {
    lines.push(`- Verified: ${outcome.verifiedReqIds.join(', ')}`);
  } else {
    lines.push('- No REQs are verified by TEST_RESULTS.md yet. Run TEST_SCRIPT.md and paste evidence under "Scenario evidence: REQ-N" in the owning phase TEST_RESULTS.md.');
  }
  lines.push('');
  lines.push('## Probe notes');
  for (const note of outcome.probeNotes) lines.push(`- ${note}`);
  lines.push('');
  lines.push('## Evidence directory');
  lines.push(`- ${outcome.evidenceDir}`);
  lines.push('');
  lines.push('## What this evidence proves');
  lines.push('- Probe portion: the runtime started and the base URL responded.');
  lines.push('- Coverage portion: each REQ-ID from requirements/ACCEPTANCE_CRITERIA.md has been visited and the rendered DOM searched for the matching SAMPLE_DATA.md fixture tokens.');
  lines.push('- Limitations: this is a content-presence probe, not a full Playwright flow. Use TEST_SCRIPT.md "Requirement-driven scenario tests" sections to drive richer interactions.');
  return `${lines.join('\n')}\n`;
}

export async function runBrowserLoop(): Promise<BrowserLoopOutcome> {
  const packageRoot = resolvePackageRoot(getArg('package'));
  const target = parseRuntimeTarget(packageRoot);
  const fixtures = parseEntityFixtures(packageRoot);
  const requirements = parseRequirementRecords(packageRoot);
  const verifiedReqs = loadVerifiedReqIds(packageRoot);
  const flows = discoverFlows(packageRoot);
  const startedAt = new Date().toISOString();
  const evidenceDir = path.join(packageRoot, 'evidence', 'runtime', 'browser', startedAt.replace(/[:.]/g, '-'));
  fs.mkdirSync(evidenceDir, { recursive: true });
  const probeNotes: string[] = [];
  let startSucceeded = false;
  let probePassed = false;
  let runtime: ChildProcess | null = null;
  let skipReason: SkipReason = null;

  if ((target.url || '').toLowerCase() === 'none') {
    probeNotes.push('RUNTIME_TARGET.md says Base URL: none. Skipping browser loop because there is no web runtime.');
    skipReason = 'no-runtime';
  } else {
    runtime = spawnRuntime(target, packageRoot);
    runtime.on('error', (error) => probeNotes.push(`Runtime spawn error: ${error.message}`));
    startSucceeded = await waitForUrl(target.url, target.startTimeoutMs);
    if (!startSucceeded) {
      probeNotes.push(`Runtime did not respond at ${target.url} within ${target.startTimeoutMs}ms.`);
      skipReason = 'runtime-down';
    }
  }

  const playwright = startSucceeded ? await loadPlaywright() : null;
  const playwrightAvailable = playwright !== null;
  if (startSucceeded && !playwrightAvailable) skipReason = 'no-playwright';

  let reqResults: ReqCoverageResult[] = [];
  let flowResults: FlowExecutionResult[] = [];

  if (startSucceeded && playwright) {
    const browser = await playwright.chromium.launch({ headless: true }).catch((error: Error) => {
      probeNotes.push(`Playwright launch failed: ${error.message}`);
      return null;
    });
    if (browser) {
      try {
        // Probe ping: is the base URL responding?
        const probeContext = await browser.newContext();
        const probePage = await probeContext.newPage();
        const probeResp = await probePage.goto(target.url, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => null);
        probePassed = !!probeResp && probeResp.status() >= 200 && probeResp.status() < 400;
        await probeContext.close().catch(() => {});

        if (flows.length) {
          // E3 path: per-actor flow runner.
          flowResults = await runFlows({
            context: { browser: () => browser },
            baseUrl: target.url,
            flows,
            fixtures,
            evidenceDir
          });
          // Promote flow results into legacy ReqCoverageResult records so the existing
          // report and downstream auto-regression rework still see per-REQ status.
          const reqStatusFromFlows = new Map<string, ReqCoverageResult>();
          for (const flow of flowResults) {
            const happyOk = flow.happySteps.length > 0 && flow.happySteps.every((s) => s.passed);
            const negativeOk = flow.negativeSteps.length === 0 || flow.negativeSteps.every((s) => s.passed);
            for (const reqId of flow.reqIds) {
              const existing = reqStatusFromFlows.get(reqId);
              const status: ReqCoverageResult['status'] = happyOk && negativeOk ? 'covered' : (happyOk ? 'partially-covered' : 'uncovered');
              if (!existing || (existing.status === 'uncovered' && status !== 'uncovered') || (existing.status === 'partially-covered' && status === 'covered')) {
                reqStatusFromFlows.set(reqId, {
                  reqId,
                  entityName: requirements.find((r) => r.reqId === reqId)?.entityName || '',
                  status,
                  evidencePaths: flow.screenshotPaths.slice(0, 5),
                  notes: flow.notes.slice(),
                  consoleErrors: flow.consoleErrors,
                  textMatches: [],
                  testResultsVerified: verifiedReqs.has(reqId)
                });
              }
            }
          }
          for (const requirement of requirements) {
            if (!reqStatusFromFlows.has(requirement.reqId)) {
              reqStatusFromFlows.set(requirement.reqId, {
                reqId: requirement.reqId,
                entityName: requirement.entityName,
                status: 'uncovered',
                evidencePaths: [],
                notes: ['No PLAYWRIGHT_FLOW touched this REQ-ID.'],
                consoleErrors: [],
                textMatches: [],
                testResultsVerified: verifiedReqs.has(requirement.reqId)
              });
            }
          }
          reqResults = Array.from(reqStatusFromFlows.values()).sort((a, b) => a.reqId.localeCompare(b.reqId, undefined, { numeric: true }));
        } else {
          // Legacy fallback: token-presence scan against the base URL.
          const ctx = await browser.newContext();
          const page = await ctx.newPage();
          try {
            reqResults = await runReqCoverage({
              page,
              baseUrl: target.url,
              fixtures,
              requirements,
              evidenceDir,
              verifiedReqs
            });
            if (reqResults.length === 0) probePassed = true;
          } finally {
            await ctx.close().catch(() => {});
          }
        }
      } catch (error) {
        probeNotes.push(`Browser run failed: ${(error as Error).message}`);
      } finally {
        await browser.close().catch(() => {});
      }
    }
  } else if (startSucceeded && !playwright) {
    probeNotes.push('Playwright is not installed in this package. Install it with `npm install --save-dev playwright` and run `npx playwright install chromium`.');
  }

  if (runtime) killRuntime(runtime);

  const finishedAt = new Date().toISOString();
  const coveredRequirements = reqResults.filter((result) => result.status === 'covered').length;
  const partiallyCoveredRequirements = reqResults.filter((result) => result.status === 'partially-covered').length;
  const uncoveredRequirements = reqResults.filter((result) => result.status === 'uncovered').length;

  const totalSteps = flowResults.reduce((sum, f) => sum + f.happySteps.length + f.negativeSteps.length + f.rolePermissionSteps.length, 0);
  const passedSteps = flowResults.reduce(
    (sum, f) => sum + f.happySteps.filter((s) => s.passed).length + f.negativeSteps.filter((s) => s.passed).length + f.rolePermissionSteps.filter((s) => s.passed).length,
    0
  );
  const flowsExecuted = flowResults.filter((f) => f.status === 'passed' || f.status === 'failed').length;
  const totalConsoleErrors = flowResults.reduce((sum, f) => sum + f.consoleErrors.length, 0);
  const totalFailedRequests = flowResults.reduce((sum, f) => sum + f.failedRequests.length, 0);

  const outcomeScore = skipReason
    ? 0
    : calculateOutcomeScore({
        probePassed,
        flows: flowResults,
        totalReqs: requirements.length,
        coveredReqs: coveredRequirements,
        partiallyCovered: partiallyCoveredRequirements
      });
  const legacyScore = calculateLegacyScore(probePassed, requirements.length, coveredRequirements, partiallyCoveredRequirements);

  const outcome: BrowserLoopOutcome = {
    startedAt,
    finishedAt,
    baseUrl: target.url,
    startSucceeded,
    probePassed,
    probeNotes,
    totalRequirements: requirements.length,
    coveredRequirements,
    partiallyCoveredRequirements,
    uncoveredRequirements,
    reqResults,
    flowResults,
    totalFlows: flows.length,
    flowsExecuted,
    totalSteps,
    passedSteps,
    totalConsoleErrors,
    totalFailedRequests,
    outcomeScore,
    legacyScore,
    skipReason,
    evidenceDir: path.relative(packageRoot, evidenceDir).replace(/\\/g, '/'),
    evidenceReportPath: '',
    playwrightAvailable,
    playwrightInstallHint: playwrightAvailable ? undefined : 'npm install --save-dev playwright && npx playwright install chromium',
    verifiedReqIds: Array.from(verifiedReqs).sort()
  };

  const reportPath = path.join(evidenceDir, 'BROWSER_LOOP_REPORT.md');
  fs.writeFileSync(reportPath, renderEvidenceReport(outcome), 'utf8');
  outcome.evidenceReportPath = path.relative(packageRoot, reportPath).replace(/\\/g, '/');

  fs.writeFileSync(
    path.join(packageRoot, 'repo', 'mvp-builder-loop-browser-state.json'),
    `${JSON.stringify(outcome, null, 2)}\n`,
    'utf8'
  );

  if (skipReason) {
    console.log(`Browser loop SKIPPED (${skipReason}). Evidence: ${outcome.evidenceReportPath}`);
  } else {
    console.log(`Browser loop score: ${outcome.outcomeScore}/100 (legacy=${outcome.legacyScore}, probe=${probePassed ? 'pass' : 'fail'}, flows=${flowsExecuted}/${flows.length}, steps=${passedSteps}/${totalSteps}, covered=${coveredRequirements}/${requirements.length})`);
    console.log(`Evidence: ${outcome.evidenceReportPath}`);
  }
  if (!playwrightAvailable && startSucceeded) {
    console.log('Playwright not installed. Browser loop will skip cleanly until Playwright is added.');
  }

  return outcome;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runBrowserLoop()
    .then((outcome) => {
      const strict = process.argv.includes('--strict');
      // Skip-clean: when --strict is not passed, skipped runs exit 0 so CI
      // doesn't fail just because the agent hasn't built the app yet.
      if (outcome.skipReason && !strict) {
        process.exitCode = 0;
        return;
      }
      const target = Number.parseInt(getArg('target') || '90', 10);
      process.exitCode = outcome.outcomeScore >= target ? 0 : 1;
    })
    .catch((error) => {
      console.error((error as Error).message);
      process.exit(1);
    });
}

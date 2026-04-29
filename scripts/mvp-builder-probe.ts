#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileExists, getArg, readTextFile, resolvePackageRoot } from './mvp-builder-package-utils';

type RuntimeTarget = {
  url: string;
  startCommand: string;
  smokeRoutes: string[];
  startTimeoutMs: number;
};

type RouteProbeResult = {
  route: string;
  url: string;
  status: number | null;
  ok: boolean;
  durationMs: number;
  error?: string;
  headers?: Record<string, string>;
  bodySnippet?: string;
};

type ProbeOutcome = {
  startedAt: string;
  finishedAt: string;
  command: string;
  baseUrl: string;
  startSucceeded: boolean;
  routes: RouteProbeResult[];
  passed: boolean;
  evidencePath: string;
  notes: string[];
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

function joinUrl(base: string, route: string) {
  if (route.startsWith('http://') || route.startsWith('https://')) return route;
  return base.replace(/\/$/, '') + (route.startsWith('/') ? route : `/${route}`);
}

function probeRoute(targetUrl: string, timeoutMs: number): Promise<RouteProbeResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      resolve({
        route: targetUrl,
        url: targetUrl,
        status: null,
        ok: false,
        durationMs: 0,
        error: 'Invalid URL.'
      });
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
        const chunks: Buffer[] = [];
        let totalBytes = 0;
        response.on('data', (chunk: Buffer) => {
          if (totalBytes < 4096) {
            chunks.push(chunk);
            totalBytes += chunk.length;
          }
        });
        response.on('end', () => {
          const status = response.statusCode ?? null;
          const ok = status !== null && status >= 200 && status < 400;
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers)) {
            if (value === undefined) continue;
            headers[key] = Array.isArray(value) ? value.join(', ') : String(value);
          }
          const body = Buffer.concat(chunks).slice(0, 2048).toString('utf8');
          resolve({
            route: targetUrl,
            url: targetUrl,
            status,
            ok,
            durationMs: Date.now() - startedAt,
            headers,
            bodySnippet: body
          });
        });
        response.on('error', (error) => {
          resolve({
            route: targetUrl,
            url: targetUrl,
            status: null,
            ok: false,
            durationMs: Date.now() - startedAt,
            error: error.message
          });
        });
      }
    );
    request.on('error', (error: NodeJS.ErrnoException) => {
      resolve({
        route: targetUrl,
        url: targetUrl,
        status: null,
        ok: false,
        durationMs: Date.now() - startedAt,
        error: error.message
      });
    });
    request.on('timeout', () => {
      request.destroy(new Error('probe timeout'));
    });
    request.end();
  });
}

async function waitForBaseUrlReady(baseUrl: string, deadline: number, pollIntervalMs: number) {
  while (Date.now() < deadline) {
    const remaining = Math.max(1000, deadline - Date.now());
    const result = await probeRoute(baseUrl, Math.min(5000, remaining));
    if (result.ok || (result.status !== null && result.status >= 200 && result.status < 500)) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return null;
}

function spawnProcess(command: string, cwd: string): ChildProcess {
  const isWindows = process.platform === 'win32';
  const shell = isWindows ? process.env.ComSpec || 'cmd.exe' : '/bin/sh';
  const args = isWindows ? ['/d', '/s', '/c', command] : ['-c', command];
  return spawn(shell, args, {
    cwd,
    detached: !isWindows,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function killProcessTree(child: ChildProcess) {
  if (!child || child.killed || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    try {
      const { spawnSync } = require('node:child_process') as typeof import('node:child_process');
      if (typeof child.pid === 'number') {
        spawnSync('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
      }
    } catch {
      child.kill('SIGKILL');
    }
  } else {
    try {
      if (typeof child.pid === 'number') process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

function renderEvidence(outcome: ProbeOutcome) {
  const lines: string[] = [];
  lines.push(`# Runtime probe — ${outcome.passed ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push(`- Started at: ${outcome.startedAt}`);
  lines.push(`- Finished at: ${outcome.finishedAt}`);
  lines.push(`- Base URL: ${outcome.baseUrl}`);
  lines.push(`- Start command: ${outcome.command}`);
  lines.push(`- Start succeeded: ${outcome.startSucceeded ? 'yes' : 'no'}`);
  lines.push(`- Overall outcome: ${outcome.passed ? 'PASS' : 'FAIL'}`);
  lines.push('');
  if (outcome.notes.length) {
    lines.push('## Notes');
    outcome.notes.forEach((note) => lines.push(`- ${note}`));
    lines.push('');
  }
  lines.push('## Per-route results');
  lines.push('');
  lines.push('| Route | URL | Status | OK | Duration (ms) | Error |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const route of outcome.routes) {
    lines.push(
      `| ${route.route} | ${route.url} | ${route.status ?? '—'} | ${route.ok ? 'yes' : 'no'} | ${route.durationMs} | ${
        route.error ? route.error.replace(/\|/g, '\\|') : ''
      } |`
    );
  }
  lines.push('');
  for (const route of outcome.routes) {
    lines.push(`### ${route.route}`);
    lines.push('');
    if (route.headers) {
      lines.push('Headers:');
      lines.push('```');
      for (const [key, value] of Object.entries(route.headers)) {
        lines.push(`${key}: ${value}`);
      }
      lines.push('```');
      lines.push('');
    }
    if (route.bodySnippet) {
      lines.push('Body snippet (first 2 KB):');
      lines.push('```');
      lines.push(route.bodySnippet);
      lines.push('```');
      lines.push('');
    }
  }
  return `${lines.join('\n')}\n`;
}

export async function runProbe() {
  const packageRoot = resolvePackageRoot(getArg('package'));
  const target = parseRuntimeTarget(packageRoot);
  const skipStartArg = (getArg('skip-start') || '').toLowerCase();
  const skipStart = skipStartArg === 'true' || skipStartArg === '1' || skipStartArg === 'yes';

  const evidenceDir = path.join(packageRoot, 'evidence', 'runtime');
  fs.mkdirSync(evidenceDir, { recursive: true });

  const startedAt = new Date().toISOString();
  const notes: string[] = [];
  let startSucceeded = false;
  let child: ChildProcess | null = null;

  try {
    if (target.url.toLowerCase() === 'none') {
      notes.push('RUNTIME_TARGET.md declares Base URL: none. Skipping HTTP probe.');
      const finishedAt = new Date().toISOString();
      const outcome: ProbeOutcome = {
        startedAt,
        finishedAt,
        command: target.startCommand,
        baseUrl: target.url,
        startSucceeded: true,
        routes: [],
        passed: true,
        evidencePath: '',
        notes
      };
      return writeAndReport(packageRoot, evidenceDir, outcome);
    }

    if (!skipStart) {
      child = spawnProcess(target.startCommand, packageRoot);
      const stdoutLog: string[] = [];
      const stderrLog: string[] = [];
      child.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        if (stdoutLog.join('').length < 8192) stdoutLog.push(text);
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        if (stderrLog.join('').length < 8192) stderrLog.push(text);
      });
      const deadline = Date.now() + target.startTimeoutMs;
      const ready = await waitForBaseUrlReady(target.url, deadline, 1000);
      if (!ready) {
        notes.push(`Base URL did not become reachable within ${Math.round(target.startTimeoutMs / 1000)} seconds.`);
        if (stderrLog.length) notes.push(`stderr snippet: ${stderrLog.join('').slice(0, 1024)}`);
        if (stdoutLog.length) notes.push(`stdout snippet: ${stdoutLog.join('').slice(0, 1024)}`);
      } else {
        startSucceeded = true;
      }
    } else {
      notes.push('skip-start=true was passed. Probe is hitting an externally started process.');
      startSucceeded = true;
    }

    const routeResults: RouteProbeResult[] = [];
    if (startSucceeded) {
      for (const route of target.smokeRoutes) {
        const fullUrl = joinUrl(target.url, route);
        const result = await probeRoute(fullUrl, 10000);
        routeResults.push({ ...result, route });
      }
    } else {
      for (const route of target.smokeRoutes) {
        routeResults.push({
          route,
          url: joinUrl(target.url, route),
          status: null,
          ok: false,
          durationMs: 0,
          error: 'Start command did not produce a reachable URL.'
        });
      }
    }

    const finishedAt = new Date().toISOString();
    const passed = startSucceeded && routeResults.every((result) => result.ok);
    const outcome: ProbeOutcome = {
      startedAt,
      finishedAt,
      command: target.startCommand,
      baseUrl: target.url,
      startSucceeded,
      routes: routeResults,
      passed,
      evidencePath: '',
      notes
    };
    return writeAndReport(packageRoot, evidenceDir, outcome);
  } finally {
    if (child) killProcessTree(child);
  }
}

function writeAndReport(packageRoot: string, evidenceDir: string, outcome: ProbeOutcome) {
  const stamp = outcome.startedAt.replace(/[:.]/g, '-');
  const filePath = path.join(evidenceDir, `probe-${stamp}.md`);
  outcome.evidencePath = path.relative(packageRoot, filePath).replace(/\\/g, '/');
  fs.writeFileSync(filePath, renderEvidence(outcome), 'utf8');
  const outcomeJsonPath = path.join(evidenceDir, 'last-probe.json');
  fs.writeFileSync(outcomeJsonPath, `${JSON.stringify(outcome, null, 2)}\n`, 'utf8');
  console.log(`Runtime probe ${outcome.passed ? 'PASS' : 'FAIL'} — evidence: ${outcome.evidencePath}`);
  if (!outcome.passed) {
    console.log('  Notes:');
    outcome.notes.forEach((note) => console.log(`   - ${note}`));
  }
  return outcome;
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  runProbe()
    .then((outcome) => {
      process.exitCode = outcome.passed ? 0 : 1;
    })
    .catch((error) => {
      console.error((error as Error).message);
      process.exit(1);
    });
}

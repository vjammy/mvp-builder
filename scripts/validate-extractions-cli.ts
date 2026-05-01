#!/usr/bin/env node
/**
 * Validate a <dir>/research/extracted/ tree against the schema and report.
 * Used as a standalone check before invoking create-project --research-from.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readExtractions } from '../lib/research/persistence';
import { validateExtractions } from '../lib/research/schema';

function getArg(name: string): string | undefined {
  const exact = process.argv.find((a) => a.startsWith(`--${name}=`));
  return exact ? exact.slice(name.length + 3) : undefined;
}

function main() {
  const root = path.resolve(getArg('dir') || process.cwd());
  if (!fs.existsSync(path.join(root, 'research', 'extracted', 'meta.json'))) {
    console.error(`No research/extracted/meta.json under ${root}`);
    process.exit(1);
  }
  const ex = readExtractions(root);
  if (!ex) {
    console.error('readExtractions returned null; persistence layer rejected the layout.');
    process.exit(2);
  }
  const issues = validateExtractions(ex);
  if (issues.length) {
    console.error(`FAIL — ${issues.length} schema issue(s):`);
    for (const i of issues) console.error(`  - ${i.path}: ${i.message}`);
    process.exit(3);
  }
  console.log(
    `OK — actors=${ex.actors.length} entities=${ex.entities.length} workflows=${ex.workflows.length} (steps=${ex.workflows.reduce((s, w) => s + w.steps.length, 0)}) integrations=${ex.integrations.length} risks=${ex.risks.length} gates=${ex.gates.length} antiFeatures=${ex.antiFeatures.length} conflicts=${ex.conflicts.length}`
  );
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main();
}

import fs from 'node:fs';
import path from 'node:path';
import { validateExtractions, type ResearchExtractions } from '../lib/research/schema';

const root = process.argv[2] || '.tmp/Claude/research-runs/countloop-real/mvp-builder-workspace/research/extracted';
const read = <T>(name: string): T => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')) as T;

const extractions: ResearchExtractions = {
  meta: read('meta.json'),
  actors: read('actors.json'),
  entities: read('entities.json'),
  workflows: read('workflows.json'),
  integrations: read('integrations.json'),
  risks: read('risks.json'),
  gates: read('gates.json'),
  antiFeatures: read('antiFeatures.json'),
  conflicts: read('conflicts.json'),
  removed: read('_removed.json')
};
const issues = validateExtractions(extractions);
if (issues.length === 0) {
  console.log('VALID:',
    `actors=${extractions.actors.length}`,
    `entities=${extractions.entities.length}`,
    `workflows=${extractions.workflows.length}`,
    `integrations=${extractions.integrations.length}`,
    `risks=${extractions.risks.length}`,
    `gates=${extractions.gates.length}`,
    `antiFeatures=${extractions.antiFeatures.length}`,
    `conflicts=${extractions.conflicts.length}`
  );
} else {
  console.log(`INVALID (${issues.length}):`);
  for (const i of issues.slice(0, 20)) console.log(`  - ${i.path}: ${i.message}`);
  process.exit(1);
}

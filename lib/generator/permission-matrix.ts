/**
 * Generate requirements/PERMISSION_MATRIX.md from a ResearchExtractions
 * document. Deterministic; no LLM judge.
 *
 * Cell allocation rules (per actor × entity pair):
 *   - "create / read / update / delete" if actor is in entity.ownerActors
 *   - "read" if the entity name (or its fields) appear in actor.visibility[]
 *     OR if a workflow with this actor as primaryActor or secondaryActor
 *     touches this entity
 *   - "DENY" otherwise (explicit denial, surfaced for the audit)
 *
 * The audit's role-permission-matrix dimension scores:
 *   - File exists (when actors > 1)
 *   - Grid coverage (≥80% cells filled with explicit value, including DENY)
 *   - At least one DENY cell exists (proves boundaries are enforced)
 */
import type { ResearchExtractions } from '../research/schema';

export type CellValue = {
  raw: string;            // "create / read / update / delete" or "read" or "DENY"
  isAllow: boolean;
  isDeny: boolean;
};

export type PermissionMatrix = {
  actors: string[];
  entities: string[];
  cells: Record<string, Record<string, CellValue>>; // cells[actor][entity]
  totalCells: number;
  allowCells: number;
  denyCells: number;
};

function entityIsVisibleToActor(
  entityName: string,
  entityAliases: string[],
  fieldNames: string[],
  visibility: string[]
): boolean {
  const haystack = visibility.join(' ').toLowerCase();
  if (haystack.includes(entityName.toLowerCase())) return true;
  for (const alias of entityAliases) {
    if (alias && haystack.includes(alias.toLowerCase())) return true;
  }
  for (const field of fieldNames) {
    if (field && haystack.includes(field.toLowerCase())) return true;
  }
  return false;
}

export function buildPermissionMatrix(extractions: ResearchExtractions): PermissionMatrix {
  const actorsList = extractions.actors.map((a) => a.name);
  const entitiesList = extractions.entities.map((e) => e.name);
  const cells: Record<string, Record<string, CellValue>> = {};
  let totalCells = 0;
  let allowCells = 0;
  let denyCells = 0;

  // Pre-compute workflow→entities lookup so we can mark "read" on entities that
  // an actor's workflow touches but doesn't own.
  const workflowEntitiesByActor = new Map<string, Set<string>>();
  for (const wf of extractions.workflows) {
    const wfEntityNames = wf.entitiesTouched
      .map((eid) => extractions.entities.find((e) => e.id === eid)?.name)
      .filter((n): n is string => typeof n === 'string');
    const actorIds = [wf.primaryActor, ...wf.secondaryActors];
    for (const aid of actorIds) {
      const actor = extractions.actors.find((a) => a.id === aid);
      if (!actor) continue;
      if (!workflowEntitiesByActor.has(actor.name)) workflowEntitiesByActor.set(actor.name, new Set());
      const set = workflowEntitiesByActor.get(actor.name)!;
      for (const en of wfEntityNames) set.add(en);
    }
  }

  for (const actor of extractions.actors) {
    cells[actor.name] = {};
    for (const entity of extractions.entities) {
      totalCells += 1;
      const fieldNames = entity.fields.map((f) => f.name);
      const ownsEntity = entity.ownerActors.includes(actor.id);
      const inVisibility = entityIsVisibleToActor(entity.name, [], fieldNames, actor.visibility);
      const inWorkflow = workflowEntitiesByActor.get(actor.name)?.has(entity.name) ?? false;

      let raw: string;
      let isAllow = false;
      let isDeny = false;
      if (ownsEntity) {
        raw = 'create / read / update / delete';
        isAllow = true;
      } else if (inWorkflow) {
        raw = 'read / update (within workflow scope)';
        isAllow = true;
      } else if (inVisibility) {
        raw = 'read';
        isAllow = true;
      } else {
        raw = 'DENY';
        isDeny = true;
      }
      cells[actor.name][entity.name] = { raw, isAllow, isDeny };
      if (isAllow) allowCells += 1;
      if (isDeny) denyCells += 1;
    }
  }

  return { actors: actorsList, entities: entitiesList, cells, totalCells, allowCells, denyCells };
}

export function renderPermissionMatrixMarkdown(extractions: ResearchExtractions): string {
  const matrix = buildPermissionMatrix(extractions);
  if (matrix.actors.length === 0 || matrix.entities.length === 0) {
    return '# PERMISSION_MATRIX\n\n> Research extractions did not contain enough actors or entities to build a permission matrix.\n';
  }

  const lines: string[] = [];
  lines.push('# PERMISSION_MATRIX');
  lines.push('');
  lines.push('> Generated from `research/extracted/actors.json` and `research/extracted/entities.json`. Each row is an actor; each column is an entity. Cell content is the actor\'s allowed actions on that entity. `DENY` cells prove the role boundary is enforced — they should not be silently dropped during implementation.');
  lines.push('');
  lines.push('## Coverage');
  lines.push(`- Actors: ${matrix.actors.length}`);
  lines.push(`- Entities: ${matrix.entities.length}`);
  lines.push(`- Total cells: ${matrix.totalCells}`);
  lines.push(`- Allow cells: ${matrix.allowCells}`);
  lines.push(`- Deny cells: ${matrix.denyCells}`);
  lines.push('');
  lines.push('## Matrix');
  lines.push('');
  // Build the table
  const header = `| Actor \\ Entity | ${matrix.entities.join(' | ')} |`;
  const sep = `| --- | ${matrix.entities.map(() => '---').join(' | ')} |`;
  lines.push(header);
  lines.push(sep);
  for (const actor of matrix.actors) {
    const row = matrix.entities.map((e) => {
      const cell = matrix.cells[actor][e];
      return cell.raw;
    });
    lines.push(`| **${actor}** | ${row.join(' | ')} |`);
  }
  lines.push('');
  lines.push('## Implementation rules');
  lines.push('');
  lines.push('- Every `DENY` cell must be enforced server-side. Client-side hiding alone is not sufficient.');
  lines.push('- Every "read / update (within workflow scope)" cell must be scoped to records the actor\'s workflow legitimately touches — usually filtered by ownership, assignment, or active workflow enrollment.');
  lines.push('- When tests exercise role-based access (see TEST_SCRIPT.md for each phase), every test must assert at least one DENY cell behaves correctly: an actor who should not be able to read or write must receive a clear, non-leaking error.');
  lines.push('');
  return lines.join('\n');
}

/**
 * Generate architecture/DATABASE_SCHEMA.md and architecture/DATABASE_SCHEMA.sql
 * from research extractions. Field-level metadata (dbType, nullable, indexed,
 * unique, default, FK) comes from EntityField; the SQL is PostgreSQL-flavored
 * but should be portable enough for SQLite and MySQL with minor adjustments.
 *
 * Phase E3 audit dimension `schema-realism` scores:
 *   - % fields with concrete dbType (not derived heuristically at audit time)
 *   - % FKs declared
 *   - % indexed fields
 *   - presence of the SQL file
 */
import type { Entity, EntityField, ResearchExtractions } from '../research/schema';

function tableName(entity: Entity): string {
  return entity.name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function columnLine(field: EntityField, entity: Entity, ex: ResearchExtractions): string {
  const dbType = field.dbType || 'TEXT';
  const enumSuffix = dbType === 'ENUM' && field.enumValues?.length
    ? ` /* ENUM: ${field.enumValues.join(' | ')} */ TEXT CHECK (${field.name} IN (${field.enumValues.map((v) => `'${v}'`).join(', ')}))`
    : ` ${dbType}`;
  const nullable = field.nullable === undefined ? !field.required : field.nullable;
  const nullSql = nullable ? '' : ' NOT NULL';
  const uniqueSql = field.unique ? ' UNIQUE' : '';
  const defaultSql = field.defaultValue
    ? dbType === 'TIMESTAMPTZ' && field.defaultValue === 'CURRENT_TIMESTAMP'
      ? ' DEFAULT CURRENT_TIMESTAMP'
      : dbType === 'BOOLEAN'
        ? ` DEFAULT ${field.defaultValue}`
        : ` DEFAULT '${field.defaultValue}'`
    : '';
  // FK is rendered as a separate constraint after columns; primary keys: id-like + first column
  return `  ${field.name}${dbType === 'ENUM' ? enumSuffix : ` ${dbType}${nullSql}${uniqueSql}${defaultSql}`}${dbType !== 'ENUM' ? '' : nullSql}`;
}

function fkConstraint(field: EntityField, entity: Entity, ex: ResearchExtractions): string | null {
  if (!field.fk) return null;
  const target = ex.entities.find((e) => e.id === field.fk!.entityId);
  if (!target) return null;
  return `  CONSTRAINT fk_${tableName(entity)}_${field.name} FOREIGN KEY (${field.name}) REFERENCES ${tableName(target)}(${field.fk.fieldName}) ON DELETE ${field.fk.onDelete}`;
}

function primaryKeyField(entity: Entity): EntityField | undefined {
  return entity.fields.find((f) => f.name === 'id' || /^id$/i.test(f.name)) ||
    entity.fields.find((f) => /Id$/.test(f.name) && !f.fk);
}

function buildCreateTable(entity: Entity, ex: ResearchExtractions): string {
  const lines: string[] = [];
  lines.push(`CREATE TABLE ${tableName(entity)} (`);
  const colLines = entity.fields.map((f) => columnLine(f, entity, ex));
  const pkField = primaryKeyField(entity);
  if (pkField) {
    colLines.push(`  PRIMARY KEY (${pkField.name})`);
  }
  for (const f of entity.fields) {
    const fk = fkConstraint(f, entity, ex);
    if (fk) colLines.push(fk);
  }
  lines.push(colLines.join(',\n'));
  lines.push(');');

  // Indexes for fields marked indexed (skip the PK since it's already indexed)
  for (const f of entity.fields) {
    if (f.indexed && (!pkField || pkField.name !== f.name) && !f.unique) {
      lines.push(`CREATE INDEX idx_${tableName(entity)}_${f.name} ON ${tableName(entity)}(${f.name});`);
    }
  }

  return lines.join('\n');
}

export function renderDatabaseSchemaSql(ex: ResearchExtractions): string {
  const tables = ex.entities.map((e) => buildCreateTable(e, ex)).join('\n\n');
  return `-- DATABASE_SCHEMA.sql
-- Generated from research extractions in research/extracted/entities.json.
-- PostgreSQL-flavored DDL. SQLite/MySQL users will need to adjust ENUM CHECK
-- syntax and CURRENT_TIMESTAMP defaults but the structure is portable.

${tables}
`;
}

export function renderDatabaseSchemaMarkdown(ex: ResearchExtractions): string {
  const tableSummaries = ex.entities
    .map((e) => {
      const fkLines = e.fields
        .filter((f) => f.fk)
        .map((f) => {
          const target = ex.entities.find((x) => x.id === f.fk!.entityId);
          return `  - \`${f.name}\` → \`${target ? target.name.toLowerCase().replace(/\s+/g, '_') : f.fk!.entityId}\`(${f.fk!.fieldName}) on delete ${f.fk!.onDelete}`;
        });
      const fkBlock = fkLines.length ? `\n- Foreign keys:\n${fkLines.join('\n')}` : '\n- Foreign keys: none';
      const idxLines = e.fields.filter((f) => f.indexed).map((f) => `\`${f.name}\``);
      const uniqLines = e.fields.filter((f) => f.unique).map((f) => `\`${f.name}\``);
      return `### ${e.name} (\`${tableName(e)}\`)

- Columns: ${e.fields.length}
- Primary key: \`${primaryKeyField(e)?.name || 'id'}\`
- Indexes: ${idxLines.join(', ') || 'none'}
- Unique: ${uniqLines.join(', ') || 'none'}${fkBlock}`;
    })
    .join('\n\n');

  return `# DATABASE_SCHEMA

> Generated from research extractions. The companion file \`DATABASE_SCHEMA.sql\` is the executable PostgreSQL DDL; this file is the human-reviewable explanation. Field-level types, foreign keys, and indexes come from \`research/extracted/entities.json\`.

## Tables

${tableSummaries}

## Migrations

This is the v1 schema. Subsequent migrations should:
- Add columns as nullable first, then backfill, then enforce NOT NULL.
- Drop columns only after consumers stop reading them (two-deploy pattern).
- Never drop or rename a foreign key in the same migration that drops the referenced table.

## Verification

Apply the SQL once into a fresh database and verify:
- Every table accepts the corresponding sample record from \`SAMPLE_DATA.md\`.
- Foreign-key INSERTs in dependency order succeed; reverse order fails.
- Each indexed column appears in the database catalog.
- ENUM CHECK constraints reject values outside the researched enum set.

## See also

- \`SAMPLE_DATA.md\` — happy-path / variant / negative-path records that exercise this schema.
- \`architecture/DATA_MODEL.md\` — narrative walkthrough with risks and validation rules per entity.
- \`architecture/API_CONTRACTS.md\` — workflow steps mapped to endpoints that mutate these tables.
`;
}

/**
 * audit Б3 (2026-05-29) — добавляет поле `externalSource String?` в указанные
 * модели `schema.prisma` (после первой строки `tenantId`). Идемпотентный.
 *
 * Использование (одноразово; в STEPS не регистрируется):
 *   bun run scripts/_lib/add-external-source.mjs
 *
 * После прогона: `cd backend && bun run prisma:push && bun run prisma:generate`.
 */
/* global console */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, '..', '..', 'prisma', 'schema.prisma');

/** Модели, удаляемые в `resetDemoWorkspace` и не имеющие FK на demo-meeting/-issue. */
const MODELS = [
  'CloneAccessGrant',
  'IdeaBlock',
  'Entity',
  'Theme',
  'Goal',
  'GoalAlignmentSnapshot',
  'Department',
  'Role',
  'Person',
  'Appointment',
  'CompanyProfile',
  'FunctionalDomain',
  'Process',
  'ProcessStep',
  'Decision',
  'Insight',
  'Notification',
  'DailyCheckIn',
  'WeeklyOperationsDigest',
  'DailyOperationsDigest',
  'ChatV2Conversation',
  'SkillProfile',
  'ExecutablePersona',
  'Project',
  'ProjectDocument',
  'IssueState',
  'Cycle',
  'SprintHint',
  'HelpfulnessSpotlight',
  'Recognition',
  'Card',
];

const source = readFileSync(schemaPath, 'utf8');
const lines = source.split('\n');
const FIELD_COMMENT =
  '  /// audit Б3 (2026-05-29) — источник записи. \'demo\' для seed-данных демо-кабинета;';
const FIELD_COMMENT2 = '  /// null для боевых. Фильтр в `resetDemoWorkspace`.';
const FIELD = '  externalSource          String?';

let edits = 0;
const out = [];
let i = 0;
while (i < lines.length) {
  const line = lines[i];
  const m = line.match(/^model\s+(\w+)\s*\{/);
  if (!m || !MODELS.includes(m[1])) {
    out.push(line);
    i++;
    continue;
  }
  // Захватим всё тело модели до закрывающей `}`.
  const modelStart = i;
  let depth = 1;
  let j = i + 1;
  while (j < lines.length && depth > 0) {
    if (lines[j].includes('{')) depth += (lines[j].match(/\{/g) ?? []).length;
    if (lines[j].includes('}')) depth -= (lines[j].match(/\}/g) ?? []).length;
    if (depth === 0) break;
    j++;
  }
  const modelBody = lines.slice(modelStart, j + 1);
  // Если уже есть externalSource — пропускаем.
  const hasExternalSource = modelBody.some((l) => /^\s*externalSource\s+String\??/.test(l));
  if (hasExternalSource) {
    out.push(...modelBody);
    i = j + 1;
    continue;
  }
  // Найдём строку с `tenantId` (или `tenant`) на верхнем уровне (но не closing).
  // Иначе — после первой `id` строки. Чтобы поле логически стояло рядом с tenant.
  let insertAfter = -1;
  for (let k = 0; k < modelBody.length; k++) {
    const l = modelBody[k];
    if (/^\s+tenant\s+Org\b/.test(l)) {
      insertAfter = k;
      break;
    }
    if (insertAfter === -1 && /^\s+tenantId\s+String/.test(l)) {
      insertAfter = k;
    }
  }
  if (insertAfter === -1) {
    // нет tenant — пропускаем, чтобы не сломать
    out.push(...modelBody);
    i = j + 1;
    continue;
  }
  modelBody.splice(insertAfter + 1, 0, FIELD_COMMENT, FIELD_COMMENT2, FIELD);
  edits++;
  out.push(...modelBody);
  i = j + 1;
}

writeFileSync(schemaPath, out.join('\n'), 'utf8');
console.log(`add-external-source: edits=${edits} models=${MODELS.length}`);

/**
 * Seed системных шаблонов промптов AI-отчёта в БД (Фаза A.1).
 *
 * Источник: plans/tz/2026-05-21-phase-A-prompt-registry-admin.md §6.
 *
 * Что делает:
 *   1. Импортирует все 9 системных промптов из
 *      `backend/src/modules/ai/services/prompts/type-*.ts` в БД
 *      как PromptTemplate(scope='system') + первая PromptTemplateVersion +
 *      PromptTemplateSection[] (по полям JSON-схемы).
 *   2. Дополнительно создаёт 4 «общих» шаблона:
 *        tasks-default     (universal, meetingType=null, taskType='tasks')
 *        chapters-default  (universal, meetingType=null, taskType='chapters')
 *        follow-up-default (universal, meetingType=null, taskType='follow-up')
 *        card-rollup-default (universal, meetingType=null, taskType='card-rollup')
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - на повторный запуск НЕ перезаписывает шаблоны с `editedByAdmin=true`;
 *   - НЕ перезаписывает шаблоны, у которых >1 версии (значит, админ
 *     создавал новые версии через UI);
 *   - в остальных случаях upsert обновляет содержимое первой версии,
 *     чтобы можно было выкатывать новые системные промпты вместе с релизом.
 *
 * Запуск:
 *   cd backend && bun run scripts/seed-prompt-templates.ts
 *
 * Выход:
 *   - в БД появляются 13 системных шаблонов с активной версией №1;
 *   - в `AiResult.promptTemplateVersionId` для всех новых встреч будет
 *     записан id версии шаблона, а не NULL.
 */

import { PrismaClient, type MeetingType, type PromptTemplateScope, type PromptTemplateStatus } from '@prisma/client';

import * as customDev from '../src/modules/ai/services/prompts/type-custdev';
import * as customerSuccess from '../src/modules/ai/services/prompts/type-customer_success';
import * as interview from '../src/modules/ai/services/prompts/type-interview';
import * as partner from '../src/modules/ai/services/prompts/type-partner';
import * as planFact from '../src/modules/ai/services/prompts/type-plan_fact';
import * as project from '../src/modules/ai/services/prompts/type-project';
import * as sales from '../src/modules/ai/services/prompts/type-sales';
import * as standup from '../src/modules/ai/services/prompts/type-standup';
import * as team from '../src/modules/ai/services/prompts/type-team';
import {
  FOLLOW_UP_TOOL,
  FOLLOW_UP_TOOL_NAME,
  buildFollowUpPrompt,
} from '../src/modules/ai/services/prompts/follow-up';
import {
  TASKS_TOOL,
  TASKS_TOOL_NAME,
  buildTasksPrompt,
} from '../src/modules/ai/services/prompts/tasks';
import { buildCardRollupSystemPrompt } from '../src/modules/ai/services/prompts/card-rollup';
import { buildChaptersPrompt } from '../src/modules/ai/services/prompts/chapters';

const prisma = new PrismaClient();

interface PromptModule {
  readonly TOOL_NAME: string;
  readonly TOOL: {
    name: string;
    description: string;
    input_schema: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
  readonly buildPrompt: (input: unknown) => { system: string; user: string };
}

interface TemplateSeed {
  key: string;
  name: string;
  description: string;
  meetingType: MeetingType | null;
  taskType: string;
  systemPrompt: string;
  toolName: string | null;
  toolDescription: string | null;
  outputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

/** Извлекает SYSTEM-промпт из существующего code-модуля промпта по типу встречи. */
function systemFromBuilder(mod: PromptModule, meetingType: MeetingType): string {
  // buildPrompt с пустым диалогом и без roomChat возвращает исторический system
  // 1:1 как у analyze.worker'а до Фазы A.1 (см. ТЗ A.1 §5.3 «code-fallback»).
  const out = mod.buildPrompt({
    meeting: { id: '__seed__', title: '__seed__', type: meetingType, customPrompt: null },
    dialog: [],
  });
  return out.system;
}

function seedForType(mod: PromptModule, key: string, name: string, description: string, meetingType: MeetingType): TemplateSeed {
  return {
    key,
    name,
    description,
    meetingType,
    taskType: 'summary',
    systemPrompt: systemFromBuilder(mod, meetingType),
    toolName: mod.TOOL_NAME,
    toolDescription: mod.TOOL.description,
    outputSchema: mod.TOOL.input_schema,
  };
}

function tasksDefaultSeed(): TemplateSeed {
  const dummy = buildTasksPrompt({
    meeting: { id: '__seed__', title: '__seed__', type: 'team', customPrompt: null },
    dialog: [],
  });
  return {
    key: 'tasks-default',
    name: 'Извлечение задач (по умолчанию)',
    description: 'Универсальный системный шаблон для извлечения задач из встречи. Применяется ко всем типам встреч, где включён tasks-агент.',
    meetingType: null,
    taskType: 'tasks',
    systemPrompt: dummy.system,
    toolName: TASKS_TOOL_NAME,
    toolDescription: TASKS_TOOL.description,
    outputSchema: TASKS_TOOL.input_schema,
  };
}

function followUpDefaultSeed(): TemplateSeed {
  const dummy = buildFollowUpPrompt({
    meeting: { id: '__seed__', title: '__seed__', type: 'sales', customPrompt: null },
    dialog: [],
  });
  return {
    key: 'follow-up-default',
    name: 'Follow-up письмо (по умолчанию)',
    description: 'Универсальный системный шаблон для генерации follow-up письма по итогам встречи (sales / customer_success).',
    meetingType: null,
    taskType: 'follow-up',
    systemPrompt: dummy.system,
    toolName: FOLLOW_UP_TOOL_NAME,
    toolDescription: FOLLOW_UP_TOOL.description,
    outputSchema: FOLLOW_UP_TOOL.input_schema,
  };
}

function chaptersDefaultSeed(): TemplateSeed {
  const dummy = buildChaptersPrompt({
    meeting: { id: '__seed__', title: '__seed__', type: 'team' },
    dialog: [],
  });
  return {
    key: 'chapters-default',
    name: 'Извлечение глав встречи (по умолчанию)',
    description: 'Универсальный системный шаблон для разбиения встречи на смысловые главы (chapters).',
    meetingType: null,
    taskType: 'chapters',
    systemPrompt: dummy.system,
    // Chapters работает через responseFormat=json, без tool_use — toolName = null.
    toolName: null,
    toolDescription: null,
    outputSchema: {
      type: 'object',
      properties: {
        chapters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              startMs: { type: 'integer' },
              endMs: { type: 'integer' },
              title: { type: 'string' },
              summary: { type: ['string', 'null'] },
              order: { type: 'integer' },
            },
            required: ['startMs', 'endMs', 'title', 'order'],
          },
        },
      },
      required: ['chapters'],
    },
  };
}

function cardRollupDefaultSeed(): TemplateSeed {
  return {
    key: 'card-rollup-default',
    name: 'Сводка карточки (по умолчанию)',
    description: 'Универсальный системный шаблон для обзора всех встреч карточки (CRM card rollup).',
    meetingType: null,
    taskType: 'card-rollup',
    systemPrompt: buildCardRollupSystemPrompt('custom'),
    toolName: null,
    toolDescription: null,
    outputSchema: {
      type: 'object',
      properties: { overview: { type: 'string' } },
      required: ['overview'],
      additionalProperties: false,
    },
  };
}

function buildAllSeeds(): TemplateSeed[] {
  return [
    seedForType(team, 'type-team', 'Командная встреча', 'Системный шаблон AI-отчёта для командных встреч.', 'team'),
    seedForType(standup, 'type-standup', 'Дейли-standup', 'Системный шаблон AI-отчёта для планёрок / standup.', 'standup'),
    seedForType(planFact, 'type-plan_fact', 'План-факт', 'Системный шаблон AI-отчёта для встреч «план/факт».', 'plan_fact'),
    seedForType(project, 'type-project', 'Проектная встреча', 'Системный шаблон AI-отчёта для проектных встреч.', 'project'),
    seedForType(sales, 'type-sales', 'Встреча с клиентом (продажи)', 'Системный шаблон AI-отчёта для встреч с клиентом (sales).', 'sales'),
    seedForType(customDev, 'type-custdev', 'CustDev / интервью с пользователем', 'Системный шаблон AI-отчёта для CustDev-интервью.', 'custdev'),
    seedForType(partner, 'type-partner', 'Встреча с партнёром', 'Системный шаблон AI-отчёта для партнёрских встреч.', 'partner'),
    seedForType(interview, 'type-interview', 'Собеседование', 'Системный шаблон AI-отчёта для собеседований с кандидатами.', 'interview'),
    seedForType(customerSuccess, 'type-customer_success', 'Customer Success', 'Системный шаблон AI-отчёта для встреч customer success.', 'customer_success'),
    tasksDefaultSeed(),
    chaptersDefaultSeed(),
    followUpDefaultSeed(),
    cardRollupDefaultSeed(),
  ];
}

async function pickSystemAdminUserId(): Promise<string> {
  // Все системные шаблоны принадлежат super_admin'у. Если super_admin нет —
  // выбираем первого `User.role = admin`. Если и его нет — кидаем понятную
  // ошибку, чтобы оператор завёл админа перед seed'ом.
  const superAdmin = await prisma.user.findFirst({
    where: { isSuperAdmin: true, deletedAt: null },
    select: { id: true },
  });
  if (superAdmin) return superAdmin.id;

  const adminUser = await prisma.user.findFirst({
    where: { role: 'admin', deletedAt: null },
    select: { id: true },
  });
  if (adminUser) return adminUser.id;

  throw new Error(
    'seed-prompt-templates: не найден super_admin или admin user в БД. ' +
    'Заведи администратора: bun run scripts/set-admin-password.ts',
  );
}

interface SeedStats {
  created: number;
  updated: number;
  skipped: number;
}

/**
 * Идемпотентный upsert одного шаблона. Семантика skill `safe-seed-rules`:
 *   - если шаблона нет → создаём + первую версию + sections;
 *   - если шаблон есть и `editedByAdmin=true` → пропускаем;
 *   - если шаблон есть и версий >1 → пропускаем (админ создавал новые версии);
 *   - иначе обновляем version №1 (метаданные + outputSchema + sections).
 */
async function upsertTemplate(seed: TemplateSeed, createdById: string, stats: SeedStats): Promise<void> {
  const existing = await prisma.promptTemplate.findFirst({
    where: { orgId: null, key: seed.key },
    include: { versions: true },
  });

  if (existing) {
    if (existing.editedByAdmin) {
      stats.skipped += 1;
      // eslint-disable-next-line no-console
      console.log(`[skipped editedByAdmin] ${seed.key}`);
      return;
    }
    if (existing.versions.length > 1) {
      stats.skipped += 1;
      // eslint-disable-next-line no-console
      console.log(`[skipped versions>1] ${seed.key} (${existing.versions.length} versions)`);
      return;
    }

    // Обновим первую версию + sections.
    const firstVersion = existing.versions[0];
    if (!firstVersion) {
      // Странный случай: шаблон без версий. Создадим версию №1.
      await createFirstVersion(existing.id, seed, createdById);
    } else {
      await prisma.promptTemplateSection.deleteMany({ where: { versionId: firstVersion.id } });
      await prisma.promptTemplateVersion.update({
        where: { id: firstVersion.id },
        data: {
          systemPrompt: seed.systemPrompt,
          outputSchema: seed.outputSchema as object,
          toolName: seed.toolName,
          sections: { create: sectionsFromSeed(seed) },
        },
      });
    }

    await prisma.promptTemplate.update({
      where: { id: existing.id },
      data: {
        name: seed.name,
        description: seed.description,
        meetingType: seed.meetingType,
        taskType: seed.taskType,
        status: 'active' satisfies PromptTemplateStatus,
        scope: 'system' satisfies PromptTemplateScope,
      },
    });

    stats.updated += 1;
    // eslint-disable-next-line no-console
    console.log(`[updated] ${seed.key}`);
    return;
  }

  // create-path.
  await prisma.$transaction(async (tx) => {
    const template = await tx.promptTemplate.create({
      data: {
        scope: 'system',
        orgId: null,
        key: seed.key,
        name: seed.name,
        description: seed.description,
        meetingType: seed.meetingType,
        taskType: seed.taskType,
        status: 'active',
        editedByAdmin: false,
        createdById,
      },
    });
    const version = await tx.promptTemplateVersion.create({
      data: {
        templateId: template.id,
        versionNumber: 1,
        systemPrompt: seed.systemPrompt,
        outputSchema: seed.outputSchema as object,
        toolName: seed.toolName,
        createdById,
        notes: 'seed: первоначальный импорт системного шаблона из кода',
        sections: { create: sectionsFromSeed(seed) },
      },
    });
    await tx.promptTemplate.update({
      where: { id: template.id },
      data: { activeVersionId: version.id },
    });
  });

  stats.created += 1;
  // eslint-disable-next-line no-console
  console.log(`[created] ${seed.key}`);
}

async function createFirstVersion(templateId: string, seed: TemplateSeed, createdById: string): Promise<void> {
  const version = await prisma.promptTemplateVersion.create({
    data: {
      templateId,
      versionNumber: 1,
      systemPrompt: seed.systemPrompt,
      outputSchema: seed.outputSchema as object,
      toolName: seed.toolName,
      createdById,
      notes: 'seed: восстановлена первая версия после потери',
      sections: { create: sectionsFromSeed(seed) },
    },
  });
  await prisma.promptTemplate.update({
    where: { id: templateId },
    data: { activeVersionId: version.id },
  });
}

function sectionsFromSeed(seed: TemplateSeed): Array<{
  order: number;
  key: string;
  title: string;
  instruction: string;
  outputType: string;
  required: boolean;
}> {
  const required = new Set(seed.outputSchema.required ?? []);
  const props = (seed.outputSchema.properties ?? {}) as Record<
    string,
    { type?: string | string[]; description?: string }
  >;
  const sections: Array<{
    order: number;
    key: string;
    title: string;
    instruction: string;
    outputType: string;
    required: boolean;
  }> = [];
  let order = 1;
  for (const [key, propRaw] of Object.entries(props)) {
    const prop = propRaw ?? {};
    const type = Array.isArray(prop.type) ? prop.type[0] : prop.type;
    let outputType: 'text' | 'bullet_list' | 'json_object' = 'text';
    if (type === 'array') outputType = 'bullet_list';
    else if (type === 'object') outputType = 'json_object';
    sections.push({
      order,
      key,
      title: humanize(key),
      instruction:
        prop.description ??
        `Заполни поле "${key}" согласно JSON-схеме. См. system-промпт шаблона для полного контекста.`,
      outputType,
      required: required.has(key),
    });
    order += 1;
  }
  return sections;
}

function humanize(key: string): string {
  return key
    .split('_')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('=== seed-prompt-templates START ===');

  const createdById = await pickSystemAdminUserId();
  // eslint-disable-next-line no-console
  console.log(`createdById = ${createdById}`);

  const seeds = buildAllSeeds();
  const stats: SeedStats = { created: 0, updated: 0, skipped: 0 };

  for (const seed of seeds) {
    await upsertTemplate(seed, createdById, stats);
  }

  // eslint-disable-next-line no-console
  console.log(`created: ${stats.created}, updated: ${stats.updated}, skipped: ${stats.skipped}`);
  // eslint-disable-next-line no-console
  console.log('=== seed-prompt-templates DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-prompt-templates FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

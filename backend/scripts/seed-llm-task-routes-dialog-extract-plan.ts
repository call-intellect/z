/**
 * Seed LlmTaskRoute для Query Understanding Волна 1 (ТЗ 2026-06-10 Tier 0).
 *
 * Источник: plans/tz/2026-06-10-query-understanding-tier0-tier1.md §Р9.
 *
 * TaskType (1 шт.):
 *   - dialog-extract-plan — извлечение структуры вопроса (период / типы
 *     сигналов / ветки тем / сущности / «я» / агрегация / нужно-действие)
 *     для recall-safe фильтрации chat-v2.
 *
 * Цепочка (Р9 — это дешёвый частый сервисный шаг, поэтому primary = FLASH,
 * не Pro). Модели согласно second-brain/01_projects/llm-providers-verified.md:
 *   primary    deepseek          deepseek-v4-flash   (cheap, частый сервисный шаг)
 *   secondary  openai-via-proxy  gpt-5.4-mini        (reserve)
 *   tertiary   ollama            qwen3.5:9b          (local fallback)
 *
 * Anthropic НЕ используем (нет ключа). См. project_z_infra_and_ai.
 *
 * requiredDataClass: primary/secondary = 'internal' (вопрос может содержать
 * internal-факты), tertiary ollama = 'private' (локальная модель, можно всё).
 *
 * Идемпотентность:
 *   - upsert по (taskType, tenantId=null, tier, providerName).
 *   - existing + editedByAdmin=true → skip ВСЕГДА;
 *   - existing + editedByAdmin=false → skip без флага; обновить с
 *     `--update-existing`.
 *
 * Порядок в apply-prod-deploy: фаза `seed-llm-routes` ПЕРЕД глобальным
 * default-pro seed, чтобы flash-primary пережил как exists-different.
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-dialog-extract-plan.ts
 *   bun run scripts/seed-llm-task-routes-dialog-extract-plan.ts --update-existing
 */

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const TASK_TYPES = ['dialog-extract-plan'] as const;

interface RouteSeed {
  tier: 'primary' | 'secondary' | 'tertiary';
  provider: string;
  model: string;
  priority: number;
  maxDataClass: 'public' | 'internal' | 'sensitive' | 'private';
}

const ROUTES: RouteSeed[] = [
  {
    tier: 'primary',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    priority: 0,
    maxDataClass: 'internal',
  },
  {
    tier: 'secondary',
    provider: 'openai-via-proxy',
    model: 'gpt-5.4-mini',
    priority: 0,
    maxDataClass: 'internal',
  },
  {
    tier: 'tertiary',
    provider: 'ollama',
    model: 'qwen3.5:9b',
    priority: 0,
    maxDataClass: 'private',
  },
];

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  // eslint-disable-next-line no-console
  console.log(
    `=== seed-llm-task-routes-dialog-extract-plan START (taskTypes=${TASK_TYPES.join(',')}, updateExisting=${updateExisting}) ===`,
  );

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let skippedEdited = 0;

  for (const taskType of TASK_TYPES) {
    for (const r of ROUTES) {
      const existing = await prisma.llmTaskRoute.findFirst({
        where: {
          taskType,
          tenantId: null,
          tier: r.tier,
          providerName: r.provider,
        },
      });
      if (existing) {
        if (existing.editedByAdmin) {
          skippedEdited++;
          // eslint-disable-next-line no-console
          console.log(
            `[skipped:edited] ${taskType} ${r.tier} ${r.provider}:${r.model} (admin отредактировал — не трогаем)`,
          );
          continue;
        }
        if (!updateExisting) {
          skipped++;
          // eslint-disable-next-line no-console
          console.log(
            `[skipped:exists] ${taskType} ${r.tier} ${r.provider}:${r.model}`,
          );
          continue;
        }
        if (
          existing.model === r.model &&
          existing.priority === r.priority &&
          existing.isActive === true &&
          existing.requiredDataClass === r.maxDataClass
        ) {
          skipped++;
          continue;
        }
        await prisma.llmTaskRoute.update({
          where: { id: existing.id },
          data: {
            model: r.model,
            priority: r.priority,
            isActive: true,
            requiredDataClass: r.maxDataClass,
          },
        });
        updated++;
        // eslint-disable-next-line no-console
        console.log(
          `[updated] ${taskType} ${r.tier} ${r.provider}:${r.model}`,
        );
        continue;
      }
      await prisma.llmTaskRoute.create({
        data: {
          taskType,
          tenantId: null,
          tier: r.tier,
          providerName: r.provider,
          model: r.model,
          priority: r.priority,
          isActive: true,
          editedByAdmin: false,
          requiredDataClass: r.maxDataClass,
        },
      });
      inserted++;
      // eslint-disable-next-line no-console
      console.log(`[created] ${taskType} ${r.tier} ${r.provider}:${r.model}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `inserted: ${inserted}, updated: ${updated}, skipped(exists): ${skipped}, skipped(edited): ${skippedEdited}`,
  );
  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-dialog-extract-plan DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-dialog-extract-plan FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

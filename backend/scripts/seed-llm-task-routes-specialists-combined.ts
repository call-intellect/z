/**
 * ТЗ 2026-05-25 llm-architecture-changes §3 — Specialists Combined (Variant Б+).
 *
 * Seed маршрута LLM для нового taskType `knowledge-specialists-combined`:
 * один объединённый вызов на ВСЕ блоки одной встречи через tool
 * `submit_all_8_entities`. Эксперимент показал победу 18:13 vs Variant Г
 * (8 раздельных) при 3.7× меньшей стоимости.
 *
 * Цепочка (по §3.4 ТЗ):
 *   primary   — deepseek deepseek-v4-pro (capable + thinking + tools 'auto')
 *   secondary — openai-via-proxy gpt-5.4 (capable, тот же шаблон tool_use)
 *   tertiary  — ollama qwen3.5:9b        (локальный fallback; вряд ли
 *                                          справится с 32k output, но
 *                                          гарантирует, что pipeline не
 *                                          застрянет при падении внешних)
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-specialists-combined.ts
 *   bun run scripts/seed-llm-task-routes-specialists-combined.ts --update-existing
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - запись с `editedByAdmin=true` НЕ перезаписывается.
 *   - без флага `--update-existing` существующая запись пропускается.
 *   - с флагом — обновляются providers JSON + isActive (но НЕ editedByAdmin).
 *
 * NB: формат записи — `providers` JSON в одной строке `llmTaskRoute`
 * (как у `meeting-report-fast` в seed-llm-task-routes-knowledge-core.ts).
 * Это компактный вариант — секции по tier-ам выводятся из priority внутри JSON.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ProviderEntry {
  provider: string;
  model: string;
}

interface TaskRoute {
  taskType: string;
  providers: ProviderEntry[];
  isActive: boolean;
}

const ROUTES: TaskRoute[] = [
  {
    taskType: 'knowledge-specialists-combined',
    providers: [
      { provider: 'deepseek', model: 'deepseek-v4-pro' },
      { provider: 'openai-via-proxy', model: 'gpt-5.4' },
      { provider: 'ollama', model: 'qwen3.5:9b' },
    ],
    isActive: true,
  },
];

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  // eslint-disable-next-line no-console
  console.log(
    `=== seed-llm-task-routes-specialists-combined START (updateExisting=${updateExisting}) ===`,
  );

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let protectedByAdmin = 0;

  for (const route of ROUTES) {
    const existing = await prisma.llmTaskRoute.findFirst({
      where: { taskType: route.taskType, tenantId: null },
    });
    if (!existing) {
      await prisma.llmTaskRoute.create({
        data: {
          taskType: route.taskType,
          tenantId: null,
          providers: route.providers as unknown as object,
          isActive: route.isActive,
        },
      });
      inserted++;
      // eslint-disable-next-line no-console
      console.log(`[created] ${route.taskType}`);
      continue;
    }
    if (existing.editedByAdmin) {
      protectedByAdmin++;
      // eslint-disable-next-line no-console
      console.log(`[skip:edited-by-admin] ${route.taskType}`);
      continue;
    }
    if (!updateExisting) {
      skipped++;
      // eslint-disable-next-line no-console
      console.log(`[skip] ${route.taskType}`);
      continue;
    }
    await prisma.llmTaskRoute.update({
      where: { id: existing.id },
      data: {
        providers: route.providers as unknown as object,
        isActive: route.isActive,
      },
    });
    updated++;
    // eslint-disable-next-line no-console
    console.log(`[updated] ${route.taskType}`);
  }

  // eslint-disable-next-line no-console
  console.log(
    `inserted=${inserted}, updated=${updated}, skipped=${skipped}, protected_by_admin=${protectedByAdmin}`,
  );
  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-specialists-combined DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-specialists-combined FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

export { ROUTES };

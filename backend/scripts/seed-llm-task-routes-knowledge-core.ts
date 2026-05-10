/**
 * Seed дефолтных LlmTaskRoute (Фаза 0 knowledge-core).
 *
 * Создаёт глобальные (tenantId=NULL) маршруты для каждого taskType,
 * используемого в существующем pipeline. До Фаз 5/6 эти routes продолжают
 * обслуживать summary/chapters/tasks/chat/card-rollup/etc.
 *
 * Согласно ТЗ: primary — `deepseek-v4-pro` (через нашу прокси / api), fallback —
 * `gpt-5.4`. Адаптеры под provider 'deepseek' будут добавлены в Шаге 1.5
 * (если ещё не добавлены), а пока fallback chain работает на anthropic/minimax/openai.
 *
 * ВАЖНО: на Шаге 1 у нас ещё нет адаптеров `DeepSeekService` и `OllamaService`.
 * Чтобы не сломать существующий pipeline, мы оставляем fallback chain в порядке
 * 'anthropic' → 'minimax' → 'openai-via-proxy' для текущих taskType. Чистый
 * перевод на deepseek primary будет в отдельном коммите после добавления
 * `DeepSeekService` (вне Фазы 0).
 *
 * Идемпотентность: upsert по (taskType, tenantId=null). Без --update-existing
 * ничего не меняем у уже-существующих записей. С флагом — обновляем providers.
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-knowledge-core.ts
 *   bun run scripts/seed-llm-task-routes-knowledge-core.ts --update-existing
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface RouteSeed {
  taskType: string;
  providers: Array<{ provider: string; model?: string }>;
  isActive: boolean;
}

const ROUTES: RouteSeed[] = [
  // Существующие taskType (legacy, продолжают работать до Фаз 5/6).
  // Чистый перевод на deepseek primary — после добавления DeepSeekService.
  { taskType: 'summary', providers: [{ provider: 'anthropic' }, { provider: 'minimax' }, { provider: 'openai-via-proxy' }], isActive: true },
  { taskType: 'chapters', providers: [{ provider: 'anthropic' }, { provider: 'minimax' }, { provider: 'openai-via-proxy' }], isActive: true },
  { taskType: 'tasks', providers: [{ provider: 'anthropic' }, { provider: 'minimax' }, { provider: 'openai-via-proxy' }], isActive: true },
  { taskType: 'chat', providers: [{ provider: 'anthropic' }, { provider: 'minimax' }, { provider: 'openai-via-proxy' }], isActive: true },
  { taskType: 'regenerate-section', providers: [{ provider: 'anthropic' }, { provider: 'minimax' }, { provider: 'openai-via-proxy' }], isActive: true },
  { taskType: 'custom-prompt', providers: [{ provider: 'anthropic' }, { provider: 'minimax' }, { provider: 'openai-via-proxy' }], isActive: true },
  { taskType: 'follow-up', providers: [{ provider: 'anthropic' }, { provider: 'minimax' }, { provider: 'openai-via-proxy' }], isActive: true },
  { taskType: 'clip-title', providers: [{ provider: 'anthropic' }, { provider: 'minimax' }, { provider: 'openai-via-proxy' }], isActive: true },
  { taskType: 'card-rollup', providers: [{ provider: 'anthropic' }, { provider: 'minimax' }, { provider: 'openai-via-proxy' }], isActive: true },
  { taskType: 'card-chat', providers: [{ provider: 'anthropic' }, { provider: 'minimax' }, { provider: 'openai-via-proxy' }], isActive: true },
];

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  // eslint-disable-next-line no-console
  console.log(`=== seed-llm-task-routes-knowledge-core START (updateExisting=${updateExisting}) ===`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const route of ROUTES) {
    // findFirst+create-or-update вместо upsert: тут unique = composite (taskType+tenantId),
    // и tenantId=null — Prisma уникальный where по NULL не поддерживает напрямую.
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
    } else if (updateExisting) {
      await prisma.llmTaskRoute.update({
        where: { id: existing.id },
        data: {
          providers: route.providers as unknown as object,
          isActive: route.isActive,
        },
      });
      updated++;
    } else {
      skipped++;
    }
  }

  // eslint-disable-next-line no-console
  console.log(`inserted: ${inserted}, updated: ${updated}, skipped: ${skipped}`);
  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-knowledge-core DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-knowledge-core FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

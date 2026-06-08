/**
 * Seed дефолтного LlmTaskRoute для taskType `task-dedupe` (Ф5 Р2, 2026-06-08).
 *
 * `task-dedupe` — дешёвый бинарный арбитр семантического совпадения двух задач
 * встречи (action items). Вызывается только в «серой зоне» KNN-дедупа задач:
 *   primary  : deepseek deepseek-v4-flash — лучшее качество/цена на бинарных
 *              JSON-strict вердиктах (тот же профиль, что у fact-supersede-detect);
 *   secondary: openai-via-proxy gpt-5.4-mini — внешний fallback;
 *   tertiary : ollama qwen3.5:9b — local safety-net (дешёвый бинарный verdict —
 *              qwen3.5:9b приемлем, см. feedback_ollama_tertiary_only).
 *
 * Идемпотентность: upsert по (taskType, tenantId=null). Без --update-existing
 * существующую запись не трогаем; с флагом — обновляем providers/isActive.
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-task-dedupe.ts
 *   bun run scripts/seed-llm-task-routes-task-dedupe.ts --update-existing
 */

import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const TASK_TYPE = 'task-dedupe';

const PROVIDERS = [
  { provider: 'deepseek', model: 'deepseek-v4-flash' },
  { provider: 'openai-via-proxy', model: 'gpt-5.4-mini' },
  { provider: 'ollama', model: 'qwen3.5:9b' },
];

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  // eslint-disable-next-line no-console
  console.log(
    `=== seed-llm-task-routes-task-dedupe START (updateExisting=${updateExisting}) ===`,
  );

  const existing = await prisma.llmTaskRoute.findFirst({
    where: { taskType: TASK_TYPE, tenantId: null },
  });

  if (!existing) {
    await prisma.llmTaskRoute.create({
      data: {
        taskType: TASK_TYPE,
        tenantId: null,
        providers: PROVIDERS as unknown as object,
        isActive: true,
      },
    });
    // eslint-disable-next-line no-console
    console.log(`[created] ${TASK_TYPE}`);
  } else if (updateExisting) {
    await prisma.llmTaskRoute.update({
      where: { id: existing.id },
      data: {
        providers: PROVIDERS as unknown as object,
        isActive: true,
      },
    });
    // eslint-disable-next-line no-console
    console.log(`[updated] ${TASK_TYPE}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[skipped] ${TASK_TYPE} (уже существует)`);
  }

  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-task-dedupe DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-task-dedupe FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

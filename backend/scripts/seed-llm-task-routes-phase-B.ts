/**
 * Seed LlmTaskRoute для фазы B (behavior-refine).
 *
 * Источник цепочки: docs/reference/llm-models-playbook.md §2.1 (classifier-задачи).
 * behavior-refine — короткий батч-классификатор сегментов транскрипта на filler/question.
 *
 * Все 3 tier'а: maxDataClass=internal (метаданные речи участников, не контент решений).
 *
 *  | Tier      | Provider          | Model              | Обоснование |
 *  | primary   | openai-via-proxy  | gpt-5.4-nano       | Дешёвый, отлично справляется с JSON-классификацией (playbook §2.1). |
 *  | secondary | deepseek          | deepseek-v4-flash  | Резерв при недоступности OpenAI proxy. |
 *  | tertiary  | ollama            | qwen3.5:9b         | Local fallback (см. memory `reference_llm_integration_crossmark`). |
 *
 * Это только seed-пресет: после применения super_admin может через
 * `/admin/ai-models/behavior-refine` (страница из A.4) переключить
 * primary без релиза.
 *
 * Идемпотентность (skill `safe-seed-rules`): upsert по
 * (taskType='behavior-refine', tenantId=null). Без `--update-existing`
 * НЕ перезаписываем уже отредактированный admin'ом маршрут.
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-phase-B.ts
 *   bun run scripts/seed-llm-task-routes-phase-B.ts --update-existing
 */

import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const BEHAVIOR_REFINE_PROVIDERS = [
  // Primary — короткий yes/no JSON-классификатор; gpt-5.4-nano самый дешёвый
  // ($0.20/$1.25 за 1M токенов) с надёжным JSON-выходом. См. playbook §2.1.
  { provider: 'openai-via-proxy', model: 'gpt-5.4-nano' },
  // Secondary — наш собственный proxy deepseek-v4-flash, сравнимая цена ($0.14/$0.28),
  // переключается при ошибке/timeout primary. См. playbook §11 fallback-chain.
  { provider: 'deepseek', model: 'deepseek-v4-flash' },
  // Tertiary — local. На нашем ollama.agent-lia.ru фактически стоит только
  // qwen3.5:9b (см. memory reference_llm_integration_crossmark + footnote
  // playbook'а про несоответствие). Для коротких yes/no классификаций
  // qwen3.5 справляется; smoke-test обязателен в A.4 DoD.
  { provider: 'ollama', model: 'qwen3.5:9b' },
];

async function main(): Promise<void> {
  const updateExisting = process.argv.includes('--update-existing');
  // eslint-disable-next-line no-console
  console.log(
    `=== seed-llm-task-routes-phase-B START (updateExisting=${updateExisting}) ===`,
  );

  const taskType = 'behavior-refine';
  const existing = await prisma.llmTaskRoute.findFirst({
    where: { taskType, tenantId: null },
  });

  if (!existing) {
    await prisma.llmTaskRoute.create({
      data: {
        taskType,
        tenantId: null,
        providers: BEHAVIOR_REFINE_PROVIDERS as unknown as object,
        isActive: true,
        requiredDataClass: 'internal',
      },
    });
    // eslint-disable-next-line no-console
    console.log(`[created] ${taskType}: 3 providers (primary=gpt-5.4-nano)`);
  } else if (updateExisting) {
    await prisma.llmTaskRoute.update({
      where: { id: existing.id },
      data: {
        providers: BEHAVIOR_REFINE_PROVIDERS as unknown as object,
        isActive: true,
        requiredDataClass: 'internal',
      },
    });
    // eslint-disable-next-line no-console
    console.log(`[updated] ${taskType}: 3 providers (primary=gpt-5.4-nano)`);
  } else {
    // eslint-disable-next-line no-console
    console.log(
      `[skipped] ${taskType}: existing route preserved (use --update-existing to overwrite)`,
    );
  }

  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-phase-B DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-phase-B FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

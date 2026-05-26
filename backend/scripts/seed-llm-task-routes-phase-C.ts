/**
 * Seed LlmTaskRoute для taskType='meeting-quality-score' (Фаза C).
 *
 * Источник: plans/tz/2026-05-21-phase-C-meeting-quality-score.md §5.4.
 * Reference: docs/reference/llm-models-playbook.md §11 (fallback chain).
 *
 * Цепочка из трёх tier'ов:
 *   - primary    deepseek          deepseek-v4-pro   (thinking on, internal)
 *   - secondary  openai-via-proxy  gpt-5.4           (internal)
 *   - tertiary   ollama            qwen3.5:9b        (private, degraded mode)
 *
 * meeting-quality-score — middle reasoning: оценить структурированно 5 категорий
 * и сгенерировать рекомендации. На tertiary воркер автоматически проставляет
 * `degradedMode=true` в каждый элемент `recommendations` (см. sub-TZ §5.4).
 *
 * Идемпотентность (skill `safe-seed-rules`):
 *   - upsert по (taskType, tenantId=null, tier, providerName).
 *   - если запись существует и `editedByAdmin=true` → пропуск
 *     (не перетираем ручные правки super_admin'а).
 *   - если запись существует и `editedByAdmin=false` → пропуск
 *     (seed создаёт только отсутствующие; обновлять — вручную через UI).
 *
 * Запуск:
 *   bun run scripts/seed-llm-task-routes-phase-C.ts
 *
 * Этот seed НЕ запускается автоматически — выполняется при rollout'е Фазы C
 * на проде. См. docs/reference/llm-models-playbook.md §11.
 */

import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './_lib/prisma';

const prisma = createPrismaClient();

const TASK_TYPE = 'meeting-quality-score' as const;

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
    model: 'deepseek-v4-pro',
    priority: 0,
    maxDataClass: 'internal',
  },
  {
    tier: 'secondary',
    provider: 'openai-via-proxy',
    model: 'gpt-5.4',
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
  // eslint-disable-next-line no-console
  console.log(`=== seed-llm-task-routes-phase-C START (taskType=${TASK_TYPE}) ===`);

  let inserted = 0;
  let skipped = 0;
  let skippedEdited = 0;

  for (const r of ROUTES) {
    const existing = await prisma.llmTaskRoute.findFirst({
      where: {
        taskType: TASK_TYPE,
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
          `[skipped:edited] ${r.tier} ${r.provider}:${r.model} (admin отредактировал — не трогаем)`,
        );
      } else {
        skipped++;
        // eslint-disable-next-line no-console
        console.log(`[skipped:exists] ${r.tier} ${r.provider}:${r.model}`);
      }
      continue;
    }
    await prisma.llmTaskRoute.create({
      data: {
        taskType: TASK_TYPE,
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
    console.log(`[created] ${r.tier} ${r.provider}:${r.model}`);
  }

  // eslint-disable-next-line no-console
  console.log(
    `inserted: ${inserted}, skipped(exists): ${skipped}, skipped(edited): ${skippedEdited}`,
  );
  // eslint-disable-next-line no-console
  console.log('=== seed-llm-task-routes-phase-C DONE ===');
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('seed-llm-task-routes-phase-C FAILED:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
